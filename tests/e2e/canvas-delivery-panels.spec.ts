import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepareZhiya, loadZhiya, openZhiya } from "./zhiya-fixture";
import { openCanvasFunction } from "./canvas-function-navigation";
import { useCanvasPhotograph } from "./canvas-photo-fixture";
import { PROJECT, NOW } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";
import {
  studioDocumentInputSchema,
  type StudioDocumentView,
} from "../../packages/shared/src/studio";

const panels = [
  { id: "tech", title: "技术包", field: "技术包名称" },
  { id: "samples", title: "样衣反馈", field: "轮次名称" },
  { id: "team", title: "团队评审", field: "评审意见" },
] as const;
const output = "output/canvas-delivery-panels";

async function setup(page: Page, width = 1440) {
  const state = await prepareZhiya(page, {
    count: 1,
    realClock: true,
    viewport: { width, height: width < 768 ? 844 : 900 },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await useCanvasPhotograph(page);
  let data = workspaceFixture();
  let failRead = false;
  let reads = 0;
  await page.route(/\/api\/projects\/[^/]+\/studio$/, (route) => {
    reads++;
    return failRead
      ? route.fulfill({ status: 503, json: { message: "资料服务暂不可用" } })
      : route.fulfill({ json: data });
  });
  await page.route(
    /\/api\/projects\/[^/]+\/studio\/shares(?:\?.*)?$/,
    (route) => route.fulfill({ json: [] }),
  );
  await mkdir(output, { recursive: true });
  return Object.assign(state, {
    setData: (next: typeof data) => {
      data = next;
    },
    setFailRead: (next: boolean) => {
      failRead = next;
    },
    reads: () => reads,
  });
}

for (const width of [1440, 390])
  for (const panel of panels) {
    test(`${width}px${panel.title}留在画布中打开，关闭重开保留输入、滚动与画布位置`, async ({
      page,
    }) => {
      const state = await setup(page, width);
      await loadZhiya(page);
      const canvas = page.getByLabel("无限白板", { exact: true });
      const identity = await canvas.elementHandle();
      const image = page.getByRole("group", {
        name: "通勤外套 1",
        exact: true,
      });
      const shapeIdentity = await image.elementHandle();
      await page.mouse.move(width / 2, 320);
      await page.mouse.wheel(50, 90);
      const before = await image.boundingBox();
      await openCanvasFunction(page, panel.title);
      const dialog = page.getByRole("dialog", {
        name: panel.title,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
      await expect(page.locator("[data-archive-navigation]")).toHaveCount(0);
      const field = dialog.getByRole("textbox", {
        name: panel.field,
        exact: true,
      });
      await field.fill(`${panel.title}尚未保存的中文草稿`);
      const fieldIdentity = await field.elementHandle();
        const scrollArea = dialog.locator("[data-canvas-project-scroll]");
      await scrollArea.evaluate((element) => {
        element.scrollTop = 180;
      });
      const scrollTop = await scrollArea.evaluate(
        (element) => element.scrollTop,
      );
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${output}/${panel.id}-${width}.png`,
        animations: "disabled",
      });
      await dialog
        .getByRole("button", { name: "返回画布", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "全部功能模块", exact: true }),
      ).toBeFocused();
      expect(await identity?.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      expect(
        await shapeIdentity?.evaluate((element) => element.isConnected),
      ).toBe(true);
      expect(await image.boundingBox()).toEqual(before);
      await openCanvasFunction(page, panel.title);
      await expect(field).toHaveValue(`${panel.title}尚未保存的中文草稿`);
      expect(
        await fieldIdentity?.evaluate((element) => element.isConnected),
      ).toBe(true);
      await expect
        .poll(() => scrollArea.evaluate((element) => element.scrollTop))
        .toBe(scrollTop);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
      expect(state.mutations).toEqual([]);
      expect(state.errors).toEqual([]);
    });
  }

test("三种面板与画布创作框独立保留草稿，画布和聊天保持原实例", async ({
  page,
}) => {
  const state = await setup(page);
  await loadZhiya(page);
  const image = page.getByRole("group", { name: "通勤外套 1", exact: true });
  const box = await image.boundingBox();
  if (!box) throw new Error("画布图片未就绪");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const prompt = page.getByRole("textbox", {
    name: "本次创作要求",
    exact: true,
  });
  await prompt.fill("保留画布里这份图片要求");
  await prompt.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(2, 6),
  );
  const canvasIdentity = await page
    .getByLabel("无限白板", { exact: true })
    .elementHandle();
  await openZhiya(page);
  const chat = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await chat.fill("保留尚未发送的对话");
  await chat.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(1, 4),
  );
  const chatIdentity = await chat.elementHandle();
  for (const panel of panels) {
    await openCanvasFunction(page, panel.title);
    const dialog = page.getByRole("dialog", { name: panel.title, exact: true });
    await dialog
      .getByRole("textbox", { name: panel.field, exact: true })
      .fill(`${panel.id}草稿`);
    await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  for (const panel of panels) {
    await openCanvasFunction(page, panel.title);
    const dialog = page.getByRole("dialog", { name: panel.title, exact: true });
    await expect(
      dialog.getByRole("textbox", { name: panel.field, exact: true }),
    ).toHaveValue(`${panel.id}草稿`);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  await expect(prompt).toHaveValue("保留画布里这份图片要求");
  await expect(chat).toHaveValue("保留尚未发送的对话");
  expect(await canvasIdentity?.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  expect(await chatIdentity?.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  expect(
    await chat.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([1, 4]);
  expect(state.errors).toEqual([]);
});

test("读取失败可关闭重试，不能跳转页面或重建画布", async ({ page }) => {
  const state = await setup(page);
  state.setFailRead(true);
  await loadZhiya(page);
  const canvas = await page
    .getByLabel("无限白板", { exact: true })
    .elementHandle();
  await openCanvasFunction(page, "技术包");
  const dialog = page.getByRole("dialog", { name: "技术包", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("资料服务暂不可用");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  state.setFailRead(false);
  await openCanvasFunction(page, "技术包");
  await dialog
    .getByRole("button", { name: "重新读取资料", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "技术包名称", exact: true }),
  ).toBeVisible();
  expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
});

test("关闭后刷新画布，各表单从原项目的本机草稿恢复", async ({ page }) => {
  const state = await setup(page);
  await loadZhiya(page);
  for (const panel of panels) {
    await openCanvasFunction(page, panel.title);
    const dialog = page.getByRole("dialog", { name: panel.title, exact: true });
    await dialog
      .getByRole("textbox", { name: panel.field, exact: true })
      .fill(`刷新后保留${panel.title}`);
    await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await page.reload();
  for (const panel of panels) {
    await openCanvasFunction(page, panel.title);
    const dialog = page.getByRole("dialog", { name: panel.title, exact: true });
    await expect(
      dialog.getByRole("textbox", { name: panel.field, exact: true }),
    ).toHaveValue(`刷新后保留${panel.title}`);
    await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  expect(state.errors).toEqual([]);
});

test("只读与评审权限沿用原有约束", async ({ page }) => {
  const state = await setup(page);
  const viewer = workspaceFixture();
  viewer.role = "VIEWER";
  viewer.capabilities = { edit: false, review: false, manageMembers: false };
  state.setData(viewer);
  await loadZhiya(page);
  for (const panel of panels) {
    await openCanvasFunction(page, panel.title);
    const dialog = page.getByRole("dialog", { name: panel.title, exact: true });
    if (panel.id === "team")
      await expect(
        dialog.getByRole("textbox", { name: panel.field, exact: true }),
      ).toHaveCount(0);
    else
      await expect(
        dialog.getByRole("textbox", { name: panel.field, exact: true }),
      ).toBeDisabled();
    await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  const reviewer = workspaceFixture();
  reviewer.role = "REVIEWER";
  reviewer.capabilities = { edit: false, review: true, manageMembers: false };
  state.setData(reviewer);
  await page.reload();
  await openCanvasFunction(page, "团队评审");
  const dialog = page.getByRole("dialog", { name: "团队评审", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "评审意见", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "批准此修订", exact: true }),
  ).toBeEnabled();
  expect(state.mutations).toEqual([]);
});

test("320px短屏仍能编辑和关闭面板，嵌套弹层优先处理Escape", async ({
  page,
}) => {
  const state = await setup(page, 320);
  await page.setViewportSize({ width: 320, height: 568 });
  await loadZhiya(page);
  await openCanvasFunction(page, "样衣反馈");
  const dialog = page.getByRole("dialog", { name: "样衣反馈", exact: true });
  await expect(
    dialog.getByRole("button", { name: "返回画布", exact: true }),
  ).toBeInViewport();
  await dialog
    .getByRole("textbox", { name: "轮次名称", exact: true })
    .fill("短屏草稿");
  await dialog
    .getByRole("button", { name: "建立样衣轮次", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "切换资料", exact: true });
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "轮次名称", exact: true }),
  ).toHaveValue("短屏草稿");
  await page.screenshot({
    path: `${output}/samples-320.png`,
    animations: "disabled",
  });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(state.errors).toEqual([]);
});

test("保存失败保留草稿；关闭面板后到达的成功回执仍回到原技术包", async ({
  page,
}) => {
  const state = await setup(page);
  const data = workspaceFixture();
  const requests: string[] = [];
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/projects/${PROJECT}/studio/documents`,
    async (route) => {
      const input = studioDocumentInputSchema.parse(
        route.request().postDataJSON(),
      );
      if (input.type !== "TECH_PACK") throw new Error("本测试只保存技术包");
      requests.push(input.requestKey);
      if (requests.length === 1)
        return route.fulfill({
          status: 503,
          json: { message: "保存暂不可用" },
        });
      await delayed;
      const original = data.techPacks[0];
      if (!original) throw new Error("技术包夹具未就绪");
      const revision = {
        id: `${original.id}-r2`,
        revision: 2,
        payload: input.payload,
        createdAt: NOW,
      };
      const saved: StudioDocumentView = {
        ...original,
        version: 2,
        currentRevision: revision,
        revisions: [revision, ...original.revisions],
      };
      state.setData({ ...data, techPacks: [saved] });
      return route.fulfill({ json: saved });
    },
  );
  await loadZhiya(page);
  await openCanvasFunction(page, "技术包");
  const dialog = page.getByRole("dialog", { name: "技术包", exact: true });
  const field = dialog.getByRole("textbox", {
    name: "技术包名称",
    exact: true,
  });
  await field.fill("等待保存的技术草稿");
  await dialog.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(
    dialog.getByRole("alert").filter({ hasText: "保存暂不可用" }).first(),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  await openCanvasFunction(page, "技术包");
  await expect(field).toHaveValue("等待保存的技术草稿");
  await dialog.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  release?.();
  await expect.poll(state.reads).toBeGreaterThan(1);
  await openCanvasFunction(page, "技术包");
  await expect(field).toHaveValue("等待保存的技术草稿");
  await expect(
    dialog.getByText("已保存 r2", { exact: false }).first(),
  ).toBeVisible();
  expect(requests[0]).toBe(requests[1]);
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  expect(state.errors).toEqual([]);
});

test("切换项目后的面板不读取上一项目草稿", async ({ page }) => {
  const state = await setup(page);
  const second = "delivery-second";
  await page.route(`**/api/projects/${second}`, (route) =>
    route.fulfill({
      json: {
        id: second,
        name: "第二个项目",
        archived: false,
        assetCount: 1,
        coverAssetId: null,
        coverUrl: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
  );
  await loadZhiya(page);
  await openCanvasFunction(page, "技术包");
  const dialog = page.getByRole("dialog", { name: "技术包", exact: true });
  await dialog
    .getByRole("textbox", { name: "技术包名称", exact: true })
    .fill("第一个项目的独立草稿");
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto(`/${second}`);
  await openCanvasFunction(page, "技术包");
  await expect(
    dialog.getByRole("textbox", { name: "技术包名称", exact: true }),
  ).toHaveValue("褶线夹克技术资料");
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto(`/${PROJECT}`);
  await openCanvasFunction(page, "技术包");
  await expect(
    dialog.getByRole("textbox", { name: "技术包名称", exact: true }),
  ).toHaveValue("第一个项目的独立草稿");
  expect(state.errors).toEqual([]);
});

test("普通动效下关闭恢复功能入口，重开保留表单章节", async ({ page }) => {
  const state = await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await loadZhiya(page);
  await openCanvasFunction(page, "技术包");
  const dialog = page.getByRole("dialog", { name: "技术包", exact: true });
  await expect(dialog).toHaveAttribute("data-phase", "open");
  await dialog.getByRole("button", { name: "BOM", exact: true }).click();
  await expect(dialog.getByLabel("BOM 1 材料", { exact: true })).toBeVisible();
  await dialog
    .getByLabel("BOM 1 材料", { exact: true })
    .fill("继续编辑的羊毛面料");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "全部功能模块", exact: true }),
  ).toBeFocused();
  await openCanvasFunction(page, "技术包");
  await expect(dialog.getByLabel("BOM 1 材料", { exact: true })).toHaveValue(
    "继续编辑的羊毛面料",
  );
  await expect(
    dialog.getByRole("button", { name: "BOM", exact: true }),
  ).toHaveAttribute("aria-current", "step");
  expect(state.errors).toEqual([]);
});

test("面板内确认中断的保存后，后续输入随原技术包继续编辑", async ({ page }) => {
  const state = await setup(page);
  const data = workspaceFixture();
  const keys: string[] = [];
  await page.route(
    `**/api/projects/${PROJECT}/studio/documents`,
    async (route) => {
      const input = studioDocumentInputSchema.parse(
        route.request().postDataJSON(),
      );
      if (input.type !== "TECH_PACK") throw new Error("本测试只保存技术包");
      keys.push(input.requestKey);
      if (keys.length === 1)
        return route.fulfill({
          status: 503,
          json: { message: "保存连接中断" },
        });
      const original = data.techPacks[0];
      if (!original) throw new Error("技术包夹具未就绪");
      const revision = {
        id: `${original.id}-r2`,
        revision: 2,
        payload: input.payload,
        createdAt: NOW,
      };
      const saved: StudioDocumentView = {
        ...original,
        version: 2,
        currentRevision: revision,
        revisions: [revision, ...original.revisions],
      };
      state.setData({ ...data, techPacks: [saved] });
      return route.fulfill({ json: saved });
    },
  );
  await loadZhiya(page);
  await openCanvasFunction(page, "技术包");
  const dialog = page.getByRole("dialog", { name: "技术包", exact: true });
  const field = dialog.getByRole("textbox", {
    name: "技术包名称",
    exact: true,
  });
  await field.fill("原提交的技术包");
  await dialog.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "继续确认保存", exact: true }),
  ).toBeVisible();
  await field.fill("原提交之后继续写的草稿");
  await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  await openCanvasFunction(page, "技术包");
  await dialog
    .getByRole("button", { name: "继续确认保存", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "打开已保存资料", exact: true }),
  ).toBeVisible();
  await expect(field).toHaveValue("原提交之后继续写的草稿");
  await dialog
    .getByRole("button", { name: "打开已保存资料", exact: true })
    .click();
  await expect(field).toHaveValue("原提交之后继续写的草稿");
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(page).toHaveURL(new RegExp(`/${PROJECT}$`));
  expect(state.errors).toEqual([]);
});
