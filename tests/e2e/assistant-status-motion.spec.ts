import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  assistantShapeStamp,
  type AssistantCanvasEnvelope,
  type AssistantCanvasProof,
  type AssistantCanvasObservation,
} from "../../packages/shared/src/assistant-canvas-actions";
import type { WorkflowMessageView } from "../../apps/web/src/modules/board/agent/agent-api";
import { prepareZhiya, loadZhiya, openZhiya } from "./zhiya-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

test.setTimeout(60_000);
test.use({ video: process.env.STATUS_MOTION_VIDEO === "1" ? { mode: "on", size: { width: 1440, height: 900 } } : "off" });
const pendingGates = new Set<() => void>();
test.afterEach(() => {
  for (const release of pendingGates) release();
  pendingGates.clear();
});
const output = "output/assistant-status-motion";
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "设计助手", exact: true });
const mark = (page: Page) =>
  page.locator(
    "#workflow-design-assistant [data-assistant-feedback] [data-status-mark]",
  );
const fixedId = (n: number) =>
  `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("缺少验收夹具数据");
  return value;
}
const runningAnimations = async (page: Page) =>
  mark(page).evaluate(
    (root) =>
      root
        .getAnimations({ subtree: true })
        .filter((item) => item.playState === "running").length,
  );

async function workflow(page: Page, width = 1440, history = false) {
  const state = await prepareZhiya(page, {
    realClock: true,
    count: 3,
    viewport: { width, height: 900 },
  });
  const messages: WorkflowMessageView[] = [];
  if (history)
    for (let i = 0; i < 18; i++)
      messages.push({
        id: `history-${i}`,
        role: i % 2 ? "assistant" : "user",
        status: "completed",
        content: `第${i + 1}轮服装讨论。${"保留领口结构，检查整体比例与袖型。".repeat(5)}`,
        createdAt: NOW,
        updatedAt: NOW,
        context: null,
      } as WorkflowMessageView);
  let observation: AssistantCanvasObservation | undefined;
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  pendingGates.add(release);
  const actions = { claim: 0, receipt: 0 };
  const timestamp = new Date().toISOString();
  const reply = {
    id: "motion-reply",
    role: "assistant",
    status: "pending",
    content: "正在理解画布与设计过程…",
    replyToId: "motion-request",
    createdAt: timestamp,
    updatedAt: timestamp,
    context: null,
  } as WorkflowMessageView;
  await page.route(
    "**/api/agent-conversations/visual-chat/messages*",
    (route) => route.fulfill({ json: { items: messages, nextCursor: null } }),
  );
  await page.route(
    "**/api/agent-conversations/visual-chat/workflow-messages",
    (route) => {
      const body = route.request().postDataJSON();
      observation = body.canvasObservation;
      const user = {
        id: "motion-request",
        role: "user",
        status: "completed",
        content: body.content,
        clientRequestId: body.clientRequestId,
        createdAt: timestamp,
        updatedAt: timestamp,
        context: null,
      } as WorkflowMessageView;
      messages.push(user, reply);
      return route.fulfill({
        json: { userMessage: user, assistantMessage: reply },
      });
    },
  );
  await page.route(
    "**/api/agent-conversations/visual-chat/canvas-actions/**",
    async (route) => {
      const action = required(reply.context?.canvasAction);
      if (route.request().url().endsWith("/claim")) {
        actions.claim++;
        action.state = "applying";
        return route.fulfill({ json: reply });
      }
      if (!route.request().url().endsWith("/receipt"))
        throw new Error("排版不应提交素材或生成任务");
      actions.receipt++;
      const { proof, status } = route.request().postDataJSON() as {
        proof: AssistantCanvasProof;
        status: string;
      };
      expect(status).toBe("succeeded");
      const snapshot = state.getCanvasDocument().snapshot as {
        document?: { store?: Record<string, unknown> };
      };
      for (const item of proof.shapes)
        expect(assistantShapeStamp(snapshot.document?.store?.[item.id])).toBe(
          item.stamp,
        );
      await hold;
      action.state = "succeeded";
      reply.updatedAt = new Date().toISOString();
      reply.content = "已完成：对齐对象。";
      return route.fulfill({ json: reply });
    },
  );
  await mkdir(output, { recursive: true });
  await loadZhiya(page);
  await openZhiya(page);
  await page
    .getByRole("textbox", { name: "描述设计需求", exact: true })
    .fill("把三张参考图的上边缘对齐。不要生成图片。");
  await page.getByRole("button", { name: "发送需求", exact: true }).click();
  await expect(panel(page).locator("[data-thought-line]")).toBeVisible();
  return {
    state,
    reply,
    messages,
    actions,
    finish: release,
    apply: () => {
      const saved = required(observation);
      const envelope: AssistantCanvasEnvelope = {
        id: fixedId(1),
        projectId: PROJECT,
        conversationId: "visual-chat",
        messageId: reply.id,
        clientId: saved.clientId,
        intentEpoch: 1,
        state: "pending",
        action: {
          type: "align_objects",
          shapeIds: saved.objects
            .filter((item) => item.nodeId?.startsWith("material-"))
            .map((item) => item.id),
          alignment: "top",
        },
        observation: saved,
      };
      reply.status = "completed";
      reply.kind = "canvas";
      reply.content = "正在应用画布操作，完成后会核对保存结果。";
      reply.context = { canvasAction: envelope };
      reply.updatedAt = new Date().toISOString();
    },
  };
}

for (const width of [1440, 320])
  test(`${width}px思考交接执行，图标转成功而文字与结果块保持稳定`, async ({
    page,
  }) => {
    const f = await workflow(page, width);
    const thought = panel(page).locator("[data-thought-line]");
    await expect(thought.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(thought.getByRole("listitem")).toHaveCount(0);
    await expect(
      panel(page).getByText("正在理解画布与设计过程…", { exact: true }),
    ).toHaveCount(0);
    await expect(thought).toHaveAttribute("data-active", "true");
    const thinkingStyle = await thought.locator("button").evaluate((head) => {
      const label = requiredElement(head.querySelector("span:nth-child(2)"));
      const style = getComputedStyle(label);
      function requiredElement(value: Element | null) {
        if (!value) throw new Error("缺少状态文字");
        return value;
      }
      return {
        animation: style.animationName,
        filter: style.filter,
        opacity: style.opacity,
        height: head.getBoundingClientRect().height,
        width: head.getBoundingClientRect().width,
      };
    });
    expect(thinkingStyle.animation).toBe("none");
    expect(thinkingStyle.filter).toBe("none");
    expect(thinkingStyle.opacity).toBe("1");
    if (width === 320) expect(thinkingStyle.height).toBeGreaterThanOrEqual(44);
    await thought.getByRole("button").click();
    await expect(thought.getByRole("listitem")).toHaveCount(1);
    await thought.getByRole("button").click();
    await expect(thought.getByRole("listitem")).toHaveCount(0);
    await thought.getByRole("button").focus();
    await thought.getByRole("button").press("Enter");
    await expect(thought.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      await thought.evaluate((root) => {
        const id = root.querySelector("button")?.getAttribute("aria-controls");
        const trace = id ? document.getElementById(id) : null;
        if (!trace) throw new Error("缺少过程区域");
        return getComputedStyle(trace).transitionDuration;
      }),
    ).toBe("0s");
    await thought.getByRole("button").press("Enter");
    await panel(page).screenshot({ path: `${output}/thinking-${width}.png` });
    f.apply();
    await expect.poll(() => f.actions.receipt).toBe(1);
    const feedback = panel(page).locator("[data-assistant-feedback]");
    await expect(mark(page)).toHaveAttribute("data-status", "running");
    await expect(thought).toHaveCount(0);
    await expect.poll(() => runningAnimations(page)).toBeGreaterThan(0);
    const before = await feedback.evaluate((root) => {
      const title = root.querySelector<HTMLElement>("[data-feedback-title]");
      if (!title) throw new Error("缺少结果标题");
      const style = getComputedStyle(title),
        box = root.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        titleX: title.getBoundingClientRect().x,
        titleY: title.getBoundingClientRect().y,
        color: style.color,
        opacity: style.opacity,
        weight: style.fontWeight,
        textDecoration: style.textDecorationLine,
      };
    });
    await feedback.evaluate((root) => {
      (
        window as unknown as {
          statusMotionCapture: Promise<Record<string, unknown>[]>;
        }
      ).statusMotionCapture = new Promise<Record<string, unknown>[]>(
        (resolve) => {
          const frames: Record<string, unknown>[] = [];
          const observer = new MutationObserver(() => {
            if (root.getAttribute("data-state") !== "succeeded") return;
            observer.disconnect();
            const start = performance.now();
            const sample = () => {
              const title = root.querySelector<HTMLElement>(
                  "[data-feedback-title]",
                ),
                glyph = root.querySelector("[data-status-mark]"),
                check = glyph?.querySelector("path"),
                rect = root.getBoundingClientRect();
              if (!title || !glyph || !check) throw new Error("反馈未完成渲染");
              const style = getComputedStyle(title);
              frames.push({
                ms: performance.now() - start,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                titleX: title.getBoundingClientRect().x,
                titleY: title.getBoundingClientRect().y,
                opacity: style.opacity,
                color: style.color,
                weight: style.fontWeight,
                textDecoration: style.textDecorationLine,
                checkOffset: parseFloat(
                  getComputedStyle(check).strokeDashoffset,
                ),
                rootAnimation: getComputedStyle(root).animationName,
                rootTransform: getComputedStyle(root).transform,
              });
              if (performance.now() - start < 360)
                requestAnimationFrame(sample);
              else resolve(frames);
            };
            requestAnimationFrame(sample);
          });
          observer.observe(root, {
            attributes: true,
            attributeFilter: ["data-state"],
          });
        },
      );
    });
    f.finish();
    const samples = await page.evaluate(
      () =>
        (
          window as unknown as {
            statusMotionCapture: Promise<Record<string, unknown>[]>;
          }
        ).statusMotionCapture,
    );
    await expect(mark(page)).toHaveAttribute("data-status", "done");
    await expect(feedback.locator("[data-feedback-title]")).toHaveText(
      "已对齐 3 张图片",
    );
    expect(
      samples.some(
        (sample) =>
          Number(sample.checkOffset) > 0 && Number(sample.checkOffset) < 1.05,
      ),
    ).toBe(true);
    expect(Number(samples.at(-1)?.checkOffset)).toBe(0);
    for (const sample of samples) {
      expect(Math.abs(Number(sample.width) - before.width)).toBeLessThan(1);
      expect(Math.abs((Number(sample.titleX) - Number(sample.x)) - (before.titleX - before.x))).toBeLessThan(1);
      expect(Math.abs((Number(sample.titleY) - Number(sample.y)) - (before.titleY - before.y))).toBeLessThan(1);
      expect(sample.opacity).toBe("1");
      expect(sample.color).toBe(before.color);
      expect(sample.weight).toBe(before.weight);
      expect(sample.textDecoration).toBe("none");
      expect(sample.rootAnimation).toBe("none");
      expect(sample.rootTransform).toBe("none");
    }
    await expect.poll(() => runningAnimations(page)).toBe(0);
    await panel(page).screenshot({ path: `${output}/done-${width}.png` });
    await writeFile(
      `${output}/transition-${width}.json`,
      JSON.stringify({ panel: await panel(page).boundingBox(), before, samples }, null, 2),
    );
    expect(f.actions.claim).toBe(1);
    expect(f.state.errors).toEqual([]);
    await page.reload();
    await expect(
      panel(page).locator("[data-assistant-feedback]"),
    ).toBeVisible();
    await expect(mark(page)).toHaveAttribute("data-status", "done");
    expect(
      await mark(page).evaluate(
        (root) =>
          root
            .getAnimations({ subtree: true })
            .filter((item) => item.playState === "running").length,
      ),
    ).toBe(0);
    await expect(thought).toHaveCount(0);
  });

test("执行期间收起、离屏和后台暂停，恢复后不重新播放已经确认的成功", async ({
  page,
}) => {
  const f = await workflow(page, 1440, true);
  f.apply();
  await expect.poll(() => f.actions.receipt).toBe(1);
  await expect(mark(page)).toHaveAttribute("data-motion", "true");
  const conversation = page.getByLabel("设计对话", { exact: true });
  await conversation.hover();
  await page.mouse.wheel(0, -100000);
  await expect
    .poll(() => conversation.evaluate((element) => element.scrollTop))
    .toBeLessThan(1);
  await expect(mark(page)).toHaveAttribute("data-motion", "false");
  expect(await runningAnimations(page)).toBe(0);
  await conversation.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(mark(page)).toHaveAttribute("data-motion", "true");
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(mark(page)).toHaveAttribute("data-motion", "false");
  expect(await runningAnimations(page)).toBe(0);
  await openZhiya(page);
  await expect(mark(page)).toHaveAttribute("data-motion", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(mark(page)).toHaveAttribute("data-motion", "false");
  expect(await runningAnimations(page)).toBe(0);
  f.finish();
  await expect(mark(page)).toHaveAttribute("data-status", "done");
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(mark(page)).toHaveAttribute("data-motion", "true");
  expect(await runningAnimations(page)).toBe(0);
  expect(f.state.errors).toEqual([]);
});

test("减弱动态状态直接到位，没有循环、描边过渡或文字变化", async ({ page }) => {
  const f = await workflow(page, 320);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const thought = panel(page).locator("[data-thought-line]");
  await expect(thought).toHaveAttribute("data-active", "false");
  expect(
    await thought.evaluate(
      (root) =>
        root
          .getAnimations({ subtree: true })
          .filter((item) => item.playState === "running").length,
    ),
  ).toBe(0);
  f.apply();
  await expect.poll(() => f.actions.receipt).toBe(1);
  await expect(mark(page)).toHaveAttribute("data-motion", "false");
  expect(await runningAnimations(page)).toBe(0);
  f.finish();
  await expect(mark(page)).toHaveAttribute("data-status", "done");
  const style = await mark(page).evaluate((root) => {
    const path = root.querySelector("path");
    if (!path) throw new Error("缺少结果图标");
    return {
      duration: getComputedStyle(path).transitionDuration,
      offset: getComputedStyle(path).strokeDashoffset,
    };
  });
  expect(style.duration).toBe("0s");
  expect(parseFloat(style.offset)).toBe(0);
  expect(await runningAnimations(page)).toBe(0);
  expect(f.state.errors).toEqual([]);
});

for (const status of [
  "failed",
  "partial_failed",
  "canceled",
  "queued",
] as const)
  test(`${status}保留真实状态，不能用成功勾号`, async ({ page }) => {
    const base = await prepareZhiya(page, { realClock: true, count: 0 });
    const message = {
      id: "terminal",
      role: "assistant",
      status: "completed",
      content: "旧文本不控制图标",
      context: {
        creationActivity: {
          creationId: fixedId(10),
          runId: fixedId(11),
          event: "completed",
          title: "秋冬夹克",
          prompt: "",
          inputNodeIds: [],
          resultNodeId: null,
          status,
        },
      },
      createdAt: NOW,
      updatedAt: NOW,
    };
    await page.route(
      "**/api/agent-conversations/visual-chat/messages*",
      (route) =>
        route.fulfill({ json: { items: [message], nextCursor: null } }),
    );
    await loadZhiya(page);
    await openZhiya(page);
    const taskMark = panel(page).locator("[data-assistant-task] [data-status-mark]");
    await expect(taskMark).toHaveAttribute(
      "data-status",
      status === "partial_failed"
        ? "partial"
        : status === "canceled"
          ? "cancelled"
          : status === "queued"
            ? "pending"
            : "failed",
    );
    expect(
      await taskMark.evaluate((root) => {
        const check = root.querySelector("path");
        if (!check) throw new Error("缺少状态图形");
        return getComputedStyle(check).opacity;
      }),
    ).toBe("0");
    expect(await taskMark.evaluate(root => root.getAnimations({ subtree: true }).filter(item => item.playState === "running").length)).toBe(0);
    expect(base.mutations).toEqual([]);
    expect(base.errors).toEqual([]);
  });
