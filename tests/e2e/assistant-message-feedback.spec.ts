import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  type AssistantCanvasAction,
  type AssistantCanvasEnvelope,
  type AssistantCanvasResult,
} from "../../packages/shared/src/assistant-canvas-actions";
import {
  prepareZhiya,
  openZhiya,
  loadZhiya,
  elementBox,
} from "./zhiya-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

test.setTimeout(60_000);
const output = "output/assistant-message-feedback";
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "设计助手", exact: true });
const fixedId = (n: number) =>
  `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const sourceId = fixedId(600),
  targetId = fixedId(601);
const scope = ["A", "B", "C"].map((name, index) => ({
  id: `shape:canvas-material-${index}`,
  title: `参考图 ${name}`,
  type: "fashion-image",
  nodeId: `material-${index}`,
  creationId: null,
  parentId: "page:page",
  locked: false,
  hidden: false,
  stamp: "saved",
  bounds: { x: index * 400, y: 0, w: 300, h: 400 },
}));
const observation: AssistantCanvasEnvelope["observation"] = {
  clientId: fixedId(99),
  sequence: 1,
  revision: 1,
  selectedIds: [],
  omitted: 0,
  viewport: { x: 0, y: 0, w: 1440, h: 960 },
  objects: scope,
};
type Case = "align" | "fabrics" | "connect";
const creationScope: AssistantCanvasEnvelope["observation"]["objects"] = [
  sourceId,
  targetId,
].map((creationId, index) => ({
  id: `shape:creation-${creationId}`,
  title: index ? "下游夹克" : "上游探索",
  type: "fashion-creation",
  nodeId: null,
  creationId,
  parentId: "page:page",
  locked: false,
  hidden: false,
  stamp: "saved",
  bounds: { x: index * 500, y: 600, w: 400, h: 300 },
}));
function pair(kind: Case, n = 1) {
  const action: AssistantCanvasAction =
    kind === "align"
      ? {
          type: "align_objects",
          shapeIds: scope.map((item) => item.id),
          alignment: "top",
        }
      : kind === "fabrics"
        ? { type: "open_panel", panel: "fabrics" }
        : {
            type: "connect_inputs",
            targetCreationId: targetId,
            sourceShapeIds: [creationScope[0]?.id ?? ""],
          };
  const request =
    kind === "align"
      ? "把参考图 A、B、C 的上边缘对齐，其他东西不要动。"
      : kind === "fabrics"
        ? "把面料库调出来，我想看看有哪些面料。"
        : "把上游探索连到下游夹克，作为参考，先别生成。";
  const envelope: AssistantCanvasEnvelope = {
    id: fixedId(n),
    projectId: PROJECT,
    conversationId: "visual-chat",
    messageId: `reply-${n}`,
    clientId: observation.clientId,
    intentEpoch: n,
    state: "succeeded",
    action,
    observation:
      kind === "connect"
        ? { ...observation, objects: creationScope }
        : observation,
  };
  const result: AssistantCanvasResult = {
    version: 1,
    actionId: envelope.id,
    targets:
      kind === "align"
        ? scope.map((item) => ({
            id: item.id,
            title: item.title,
            kind: "image",
          }))
        : kind === "connect"
          ? [
              {
                id: creationScope[0]?.id ?? "",
                title: "上游探索",
                kind: "creation",
              },
            ]
          : [],
    ...(kind === "connect"
      ? {
          destination: {
            id: targetId,
            title: "下游夹克",
            kind: "creation" as const,
          },
          generation: "not_started" as const,
        }
      : {}),
  };
  return [
    {
      id: `request-${n}`,
      conversationId: "visual-chat",
      role: "user",
      status: "completed",
      content: request,
      context: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: `reply-${n}`,
      conversationId: "visual-chat",
      role: "assistant",
      status: "completed",
      kind: "canvas",
      replyToId: `request-${n}`,
      content: "已完成：原技术化文本不应重复显示。",
      context: { canvasAction: envelope, canvasActionResult: result },
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
}

async function setup(
  page: Page,
  width: number,
  items: ReturnType<typeof pair>,
  height = 960,
) {
  const state = await prepareZhiya(page, {
    count: 3,
    realClock: true,
    viewport: {
      width: width === 320 ? 320 : 1440,
      height: width === 320 ? Math.min(height, 844) : height,
    },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ projectId, desired }) => {
      localStorage.setItem(
        `fashion:workspace-split:visual-designer:${projectId}`,
        JSON.stringify({
          open: false,
          presentation: "floating",
          width: 400,
          floatingBounds: {
            x: 1440 - desired - 16,
            y: 150,
            width: desired,
            height: 640,
          },
        }),
      );
    },
    { projectId: PROJECT, desired: width },
  );
  const data = { items };
  await page.route(
    "**/api/agent-conversations/visual-chat/messages*",
    (route) => route.fulfill({ json: { items: data.items, nextCursor: null } }),
  );
  await loadZhiya(page);
  await openZhiya(page);
  await expect(
    panel(page).locator('article[data-role="assistant"]').first(),
  ).toBeVisible();
  return { state, data };
}

async function auditFeedback(
  page: Page,
  label: string,
  root = '[aria-label="设计对话"]',
) {
  const source = process.env.ASSISTANT_FEEDBACK_AUDIT;
  if (!source) return;
  const script = (await readFile(source, "utf8")).trim().replace(/;$/u, "");
  const audit = (await page.evaluate(
    `(${script})(${JSON.stringify({ root, viewport: true })})`,
  )) as { cut: number; hidden: number };
  await writeFile(
    `${output}/${label}-clip.json`,
    JSON.stringify(audit, null, 2),
  );
  expect(audit.cut).toBe(0);
}

async function metrics(page: Page) {
  return panel(page).evaluate((element) => {
    const thread = element.querySelector<HTMLElement>(
      '[aria-label="设计对话"]',
    );
    const user = element.querySelector<HTMLElement>(
      'article[data-role="user"]',
    );
    const reply = element.querySelector<HTMLElement>(
      'article[data-role="assistant"]',
    );
    const title = element.querySelector<HTMLElement>("[data-feedback-title]");
    const bubble = user?.firstElementChild as HTMLElement | null;
    if (!thread || !user || !reply || !title || !bubble)
      throw new Error("消息结构未就绪");
    const s = getComputedStyle(thread),
      r = element.getBoundingClientRect();
    const rgba = (color: string): number[] => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("颜色读取失败");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const luminance = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((value) => {
          const v = value / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
          0,
        );
    const contrast = (text: HTMLElement) => {
      let background: Element | null = text;
      let color = "";
      while (background) {
        color = getComputedStyle(background).backgroundColor;
        if (rgba(color)[3] > 0) break;
        background = background.parentElement;
      }
      const a = luminance(rgba(getComputedStyle(text).color)),
        b = luminance(rgba(color || "white"));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const details = element.querySelector<HTMLElement>("[data-feedback-scope]");
    return {
      panelWidth: r.width,
      userWidth: bubble.getBoundingClientRect().width,
      available:
        thread.clientWidth -
        parseFloat(s.paddingLeft) -
        parseFloat(s.paddingRight),
      userRight: bubble.getBoundingClientRect().right,
      replyRight: reply.getBoundingClientRect().right,
      turnGap:
        reply.getBoundingClientRect().top - user.getBoundingClientRect().bottom,
      titleSize: parseFloat(getComputedStyle(title).fontSize),
      titleWeight: Number(getComputedStyle(title).fontWeight),
      titleContrast: contrast(title),
      secondaryContrast: details ? contrast(details) : null,
      overflow:
        element.scrollWidth > element.clientWidth + 1 ||
        thread.scrollWidth > thread.clientWidth + 1,
    };
  });
}

for (const width of [400, 320, 360, 420])
  for (const kind of ["align", "fabrics", "connect"] as const) {
    test(`${width}px ${kind}执行反馈清晰、克制并保留实际面板宽度`, async ({
      page,
    }) => {
      const { state } = await setup(page, width, pair(kind));
      const feedback = panel(page).locator("[data-assistant-feedback]");
      await expect(feedback).toHaveAttribute("data-state", "succeeded");
      await expect(feedback.locator("[data-feedback-title]")).toHaveText(
        kind === "align"
          ? "已对齐 3 张参考图"
          : kind === "fabrics"
            ? "面料库已打开"
            : "参考连接已建立",
      );
      await expect(panel(page)).not.toContainText("原技术化文本");
      await expect(
        feedback.locator("[data-feedback-mark=succeeded]"),
      ).toHaveCount(1);
      await expect(
        panel(page).getByRole("button", { name: "继续确认画布操作" }),
      ).toHaveCount(0);
      if (kind === "fabrics") {
        await expect(feedback).toHaveAttribute("data-presentation", "inline");
        await expect(feedback.locator("[data-feedback-scope]")).toHaveCount(0);
      }
      if (kind === "align") {
        await expect(feedback).toHaveAttribute("data-presentation", "inline");
        await expect(feedback).toHaveAttribute("aria-label", /参考图 A、参考图 B、参考图 C/);
        await expect(feedback).toContainText("上边缘对齐");
        await expect(feedback.locator("[data-feedback-note]")).toHaveCount(0);
      }
      if (kind === "connect") {
        await expect(feedback).toContainText("上游探索");
        await expect(feedback).toContainText("下游夹克");
        await expect(feedback.locator("[data-feedback-note]")).toHaveText(
          "尚未开始生成",
        );
      }
      await mkdir(output, { recursive: true });
      await page
        .getByRole("textbox", { name: "描述设计需求", exact: true })
        .blur();
      await page.mouse.move(8, 8);
      const measured = await metrics(page);
      expect(Math.abs(measured.panelWidth - width)).toBeLessThan(2);
      expect(measured.userWidth).toBeLessThanOrEqual(
        measured.available * 0.9 + 1,
      );
      expect(Math.abs(measured.userRight - measured.replyRight)).toBeLessThan(
        2,
      );
      expect(measured.turnGap).toBeGreaterThanOrEqual(8);
      expect(measured.turnGap).toBeLessThanOrEqual(12);
      expect(measured.titleSize).toBeGreaterThanOrEqual(14);
      expect(measured.titleSize).toBeLessThanOrEqual(15);
      expect(measured.titleWeight).toBeGreaterThanOrEqual(kind === "align" ? 500 : 550);
      expect(measured.titleContrast).toBeGreaterThanOrEqual(4.5);
      if (measured.secondaryContrast !== null)
        expect(measured.secondaryContrast).toBeGreaterThanOrEqual(4.5);
      expect(measured.overflow).toBe(false);
      await auditFeedback(page, `${kind}-${width}`);
      await writeFile(
        `${output}/${kind}-${width}-metrics.json`,
        JSON.stringify(measured, null, 2),
      );
      await panel(page).screenshot({
        path: `${output}/${kind}-${width}.png`,
        animations: "disabled",
      });
      expect(state.mutations).toEqual([]);
      expect(state.errors).toEqual([]);
    });
  }

test("进行中、待确认、成功在同一条反馈更新，不新增日志或提前显示成功", async ({
  page,
}) => {
  const items = pair("align");
  const reply = items[1];
  if (!reply || !("canvasAction" in reply.context))
    throw new Error("缺少反馈夹具");
  const action = reply.context.canvasAction;
  action.state = "applying";
  const { state, data } = await setup(page, 400, items);
  const feedback = panel(page).locator("[data-assistant-feedback]");
  await expect(feedback).toHaveAttribute("data-state", "unconfirmed");
  await expect(feedback).toContainText("对齐结果待确认");
  await auditFeedback(page, "awaiting-confirmation");
  await expect(feedback.locator("[data-feedback-mark=succeeded]")).toHaveCount(
    0,
  );
  await feedback.evaluate((element) =>
    element.setAttribute("data-stable-feedback", "same-instance"),
  );
  reply.context.canvasAction = { ...action, state: "succeeded" };
  reply.updatedAt = "2026-11-08T12:00:03.000Z";
  data.items = [...items];
  await expect(feedback).toHaveAttribute("data-state", "succeeded", {
    timeout: 15000,
  });
  await expect(feedback).toHaveAttribute(
    "data-stable-feedback",
    "same-instance",
  );
  await expect(
    panel(page).locator('article[data-role="assistant"]'),
  ).toHaveCount(1);
  await expect(feedback).toContainText("已对齐 3 张参考图");
  await auditFeedback(page, "updated-in-place");
  expect(state.mutations).toEqual([]);
});

for (const width of [320, 420])
  test(`${width}px长名称与失败反馈换行，真实错误不沿用成功样式`, async ({
    page,
  }) => {
    const items = pair("align");
    const reply = items[1];
    if (!reply || !("canvasAction" in reply.context))
      throw new Error("缺少失败夹具");
    reply.context.canvasAction = {
      ...reply.context.canvasAction,
      state: "failed",
      error: "参考图 B 已锁定，请解锁后重试。",
    };
    const name =
      "秋冬系列参考图_very_long_design_reference_without_breaks_".repeat(3);
    reply.context.canvasAction.observation = {
      ...observation,
      objects: scope.map((item) => ({ ...item, title: name })),
    };
    const { state } = await setup(
      page,
      width,
      items,
      width === 320 ? 640 : 960,
    );
    const feedback = panel(page).locator("[data-assistant-feedback]");
    await expect(feedback).toHaveAttribute("data-state", "failed");
    await expect(feedback).toContainText("参考图 B 已锁定，请解锁后重试。");
    await expect(
      feedback.locator("[data-feedback-mark=succeeded]"),
    ).toHaveCount(0);
    await expect(feedback.locator("[data-feedback-note]")).toHaveCount(0);
    expect(
      await panel(page).evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await feedback.getByLabel(name, { exact: true }).first().focus();
    await expect(
      page.getByRole("tooltip").filter({ hasText: name }),
    ).toBeVisible();
    await auditFeedback(
      page,
      `long-name-focused-${width}`,
      width === 320 ? "body" : 'dialog[data-floating="true"]',
    );
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("tooltip").filter({ hasText: name }),
    ).toBeHidden();
    await auditFeedback(page, `failed-${width}`);
    await panel(page).screenshot({
      path: `${output}/long-failed-${width}.png`,
      animations: "disabled",
    });
    expect(state.errors).toEqual([]);
  });

test("不同轮次保留22px间距，不恢复引用记录入口", async ({ page }) => {
  const items = [...pair("fabrics", 1), ...pair("connect", 2)];
  const { state } = await setup(page, 400, items);
  const articles = panel(page).locator("article[data-role]");
  const a = await elementBox(articles.nth(1)),
    b = await elementBox(articles.nth(2));
  expect(b.y - a.y - a.height).toBeGreaterThanOrEqual(20);
  expect(b.y - a.y - a.height).toBeLessThanOrEqual(24);
  await expect(
    panel(page).getByText("查看引用记录", { exact: true }),
  ).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test("部分完成以真实成果计数，普通聊天不被当成执行卡", async ({ page }) => {
  const items = pair("align");
  const reply = items[1];
  if (!reply) throw new Error("缺少部分完成夹具");
  reply.context = {
    creationActivity: {
      creationId: targetId,
      runId: fixedId(800),
      event: "completed",
      title: "冬季夹克系列",
      prompt: "保留原领型",
      inputNodeIds: [],
      resultNodeId: "material-0",
      resultNodeIds: ["material-0", "material-1"],
      status: "partial_failed",
    },
  };
  const { state, data } = await setup(page, 400, items);
  const feedback = panel(page).locator("[data-assistant-task]");
  await expect(feedback).toHaveAttribute("data-task-state", "partial_failed");
  await expect(feedback).toContainText("其余操作未完成");
  await expect(feedback).toContainText("2 张图片");
  await expect(feedback.locator("[data-feedback-mark=succeeded]")).toHaveCount(
    0,
  );
  await panel(page).getByText("查看过程", { exact: true }).click();
  await expect(
    panel(page).getByText("保留原领型", { exact: true }),
  ).toBeVisible();
  await auditFeedback(page, "partial-expanded");
  await panel(page).screenshot({
    path: `${output}/partial-400.png`,
    animations: "disabled",
  });
  reply.context = {};
  reply.kind = "reply";
  reply.content = "已完成：这段模型文字没有执行回执，仍按普通聊天显示。";
  reply.updatedAt = "2026-11-08T12:00:05.000Z";
  data.items = [...items];
  await expect(panel(page).locator("[data-assistant-task]")).toHaveCount(
    0,
    { timeout: 15000 },
  );
  await expect(panel(page)).toContainText(reply.content);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
