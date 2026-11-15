import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  emptyCanvasCreationDraft,
  type CanvasCreation,
} from "../../packages/shared/src/canvas-creations";
import {
  prepareZhiya,
  loadZhiya,
  openZhiya,
  elementBox,
} from "./zhiya-fixture";
import { useCanvasPhotograph } from "./canvas-photo-fixture";
import { mockVoice } from "./assistant-voice-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

test.setTimeout(90_000);
const input = (page: Page) =>
  page.getByRole("textbox", { name: "描述设计需求", exact: true });
const assistant = (page: Page) => page.locator("#workflow-design-assistant");
async function start(page: Page, width = 1440) {
  const state = await prepareZhiya(page, {
    realClock: true,
    count: 3,
    viewport: { width, height: 900 },
  });
  await useCanvasPhotograph(page);
  await loadZhiya(page);
  await openZhiya(page);
  return state;
}
async function addReference(page: Page) {
  await page.getByRole("button", { name: "添加素材", exact: true }).click();
  await page.getByRole("button", { name: "添加引用", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加引用", exact: true });
  await picker.getByRole("checkbox", { name: /通勤外套 1/ }).check();
  await picker.getByRole("button", { name: "使用所选引用" }).click();
  await expect(picker).toBeHidden();
}
async function selectNode(page: Page, number: number) {
  const box = await elementBox(
    page.getByRole("group", { name: `通勤外套 ${number}`, exact: true }),
  );
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("region", { name: "图片创作框" })).toBeVisible();
}

test("悬停预览、编号插入、双击定位与返回保留草稿和编辑对象", async ({
  page,
}) => {
  const state = await start(page);
  await addReference(page);
  await input(page).fill("保留领口，参考");
  const target = page.locator(
    '.tl-shape[data-shape-id="shape:canvas-material-1"]',
  );
  await selectNode(page, 2);
  const creationInput = page.getByRole("textbox", {
    name: "本次创作要求",
    exact: true,
  });
  await creationInput.fill("这份画布草稿也要保留");
  const original = await creationInput.elementHandle();
  const thumb = assistant(page).locator(
    '[data-reference-preview="material-0"]',
  );
  await thumb.hover();
  await expect(
    page.getByRole("tooltip").getByRole("img", { name: /引用 1/ }),
  ).toBeVisible();
  await mkdir("output/assistant-motion/screenshots", { recursive: true });
  await page.screenshot({
    path: "output/assistant-motion/screenshots/reference-hover.png",
  });
  await assistant(page)
    .getByRole("button", { name: "插入图1引用", exact: true })
    .click();
  await expect(input(page)).toHaveValue("保留领口，参考图1");
  const before = await elementBox(target);
  await thumb.dblclick();
  await expect(
    page.getByRole("button", { name: "返回节点", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => Math.abs((await elementBox(target)).x - before.x))
    .toBeGreaterThan(20);
  expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(creationInput).toHaveValue("这份画布草稿也要保留");
  await page.screenshot({
    path: "output/assistant-motion/screenshots/reference-located.png",
  });
  await page.getByRole("button", { name: "返回节点", exact: true }).click();
  await expect
    .poll(async () => Math.abs((await elementBox(target)).x - before.x))
    .toBeLessThan(3);
  await expect(input(page)).toHaveValue("保留领口，参考图1");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("画布创作框同样使用缩略图、插入编号与返回定位", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 3 });
  await useCanvasPhotograph(page);
  await loadZhiya(page);
  await selectNode(page, 2);
  const composer = page.getByRole("region", { name: "图片创作框" });
  const field = composer.getByRole("textbox", { name: "本次创作要求" });
  await field.fill("参考");
  await composer.getByRole("button", { name: "画布参考", exact: true }).click();
  await composer.getByRole("option", { name: /通勤外套 1/ }).click();
  await composer.locator("[data-creation-reference]").nth(1).hover();
  await composer
    .getByRole("button", { name: "插入图2引用", exact: true })
    .click();
  await expect(field).toHaveValue("参考图2");
  await composer
    .getByRole("button", { name: "图2 通勤外套 1", exact: true })
    .dblclick();
  await expect(page.getByRole("button", { name: "返回节点" })).toBeVisible();
  await page.getByRole("button", { name: "返回节点" }).click();
  await expect(field).toHaveValue("参考图2");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("真实待回复状态显示ThoughtLine，收起和减弱动态时停止循环", async ({
  page,
}) => {
  await prepareZhiya(page, { realClock: true });
  const message = {
    id: "thinking",
    conversationId: "visual-chat",
    role: "assistant",
    status: "pending",
    content: "",
    createdAt: new Date().toISOString(),
    updatedAt: NOW,
  };
  await page.route(
    "**/api/agent-conversations/visual-chat/messages*",
    (route) => route.fulfill({ json: { items: [message], nextCursor: null } }),
  );
  await loadZhiya(page);
  await openZhiya(page);
  const lattice = assistant(page).locator(
    '[data-thought-line][data-working="true"]',
  );
  await expect(lattice).toBeVisible();
  await expect(lattice.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  await expect(lattice.getByRole("listitem")).toHaveCount(0);
  await expect(lattice).toHaveAttribute("data-active", "true");
  await expect
    .poll(() =>
      lattice.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "output/assistant-motion/screenshots/thinking.png",
  });
  await mkdir("output/thought-line", { recursive: true });
  await page.screenshot({ path: "output/thought-line/desktop.png" });
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(lattice).toHaveAttribute("data-active", "false");
  await openZhiya(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      lattice.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(lattice.getByRole("button")).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: "output/thought-line/mobile.png" });
  message.status = "completed"; message.content = "已整理设计需求。"; message.updatedAt = new Date().toISOString();
  const settled = assistant(page).locator('[data-thought-line][data-working="false"]');
  await expect(settled).toBeVisible({ timeout: 15000 });
  await expect(settled.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  await settled.getByRole("button").click();
  await expect(settled.getByRole("listitem")).toHaveCount(1);
  await page.screenshot({ path: "output/thought-line/settled.png" });
});

for (const width of [1440, 390, 320])
  test(`${width}px语音波形使用麦克风采样，停止后只写草稿`, async ({ page }) => {
    await mockVoice(page);
    const state = await start(page, width);
    await addReference(page);
    await input(page).fill("设计红色风衣");
    await input(page).evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(2, 4),
    );
    await expect(input(page)).toHaveValue("设计红色风衣");
    await assistant(page)
      .getByRole("button", { name: "开始语音输入", exact: true })
      .click();
    await expect(
      assistant(page).getByRole("button", {
        name: "结束语音输入",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "发送需求", exact: true }),
    ).toBeDisabled();
    await page.evaluate(() =>
      window.voiceFixture.instances.at(-1)?.emit("蓝色", false),
    );
    await expect(page.getByText("蓝色", { exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.voiceFixture.samples))
      .toBeGreaterThan(90);
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: `output/assistant-motion/screenshots/voice-${width}.png`,
    });
    await page.evaluate(() =>
      window.voiceFixture.instances.at(-1)?.emit("蓝色"),
    );
    await assistant(page)
      .getByRole("button", { name: "结束语音输入", exact: true })
      .click();
    await expect(input(page)).toHaveValue("设计蓝色风衣");
    await expect(page.locator("[data-assistant-reference-id]")).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => window.voiceFixture.stopped))
      .toBe(1);
    expect(state.mutations).toEqual([]);
    expect(state.errors).toEqual([]);
  });

test("麦克风拒绝、取消后的迟到权限与原稿保护", async ({ page }) => {
  await mockVoice(page);
  await start(page);
  await input(page).fill("保留原稿");
  await page.evaluate(() => {
    window.voiceFixture.denied = true;
  });
  await page.getByRole("button", { name: "开始语音输入", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "麦克风权限" }),
  ).toBeVisible();
  await expect(input(page)).toHaveValue("保留原稿");
  await page.evaluate(() => {
    window.voiceFixture.denied = false;
    window.voiceFixture.pending = true;
  });
  await page.getByRole("button", { name: "开始语音输入", exact: true }).click();
  await page
    .getByRole("button", { name: "取消连接麦克风", exact: true })
    .click();
  await page.evaluate(() => window.voiceFixture.grant?.());
  await expect
    .poll(() => page.evaluate(() => window.voiceFixture.stopped))
    .toBe(1);
  expect(
    await page.evaluate(() => window.voiceFixture.instances.at(-1)?.starts),
  ).toBe(0);
  await expect(input(page)).toHaveValue("保留原稿");
});

test("收起助手停止录音，迟到结果不能改写草稿", async ({ page }) => {
  await mockVoice(page);
  await start(page);
  await input(page).fill("我的草稿");
  await page.getByRole("button", { name: "开始语音输入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "结束语音输入", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.voiceFixture.stopped))
    .toBe(1);
  await page.evaluate(() =>
    window.voiceFixture.instances.at(-1)?.emit("迟到文字"),
  );
  await openZhiya(page);
  await expect(input(page)).toHaveValue("我的草稿");
});

test("录音中编辑和按Enter不会提交，键盘停止仅追加文字，Esc可取消", async ({
  page,
}) => {
  await mockVoice(page);
  const state = await start(page);
  await input(page).fill("原稿");
  await page
    .getByRole("button", { name: "开始语音输入", exact: true })
    .press("Space");
  const stop = page.getByRole("button", { name: "结束语音输入", exact: true });
  await expect(stop).toBeVisible();
  await input(page).fill("录音期间新的想法");
  await input(page).press("Enter");
  await expect(input(page)).toHaveValue("录音期间新的想法");
  expect(state.mutations).toEqual([]);
  await page.evaluate(() =>
    window.voiceFixture.instances.at(-1)?.emit("添加蓝色领口"),
  );
  await stop.press("Enter");
  await expect(input(page)).toHaveValue("录音期间新的想法\n添加蓝色领口");
  expect(await page.evaluate(() => window.voiceFixture.instances.length)).toBe(
    1,
  );
  await page
    .getByRole("button", { name: "开始语音输入", exact: true })
    .press("Enter");
  await expect(stop).toBeVisible();
  await page.evaluate(() =>
    window.voiceFixture.instances.at(-1)?.emit("取消的文字"),
  );
  await page.keyboard.press("Escape");
  await expect(input(page)).toHaveValue("录音期间新的想法\n添加蓝色领口");
  await expect
    .poll(() => page.evaluate(() => window.voiceFixture.stopped))
    .toBe(2);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("画布创作框语音写入原选区，超限文字可以恢复且不会生成", async ({
  page,
}) => {
  await mockVoice(page);
  const state = await prepareZhiya(page, { realClock: true, count: 3 });
  await useCanvasPhotograph(page);
  await loadZhiya(page);
  await selectNode(page, 2);
  const composer = page.getByRole("region", { name: "图片创作框" });
  const field = composer.getByRole("textbox", { name: "本次创作要求" });
  await field.fill("藏蓝色长风衣");
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 3));
  await composer
    .getByRole("button", { name: "开始语音输入", exact: true })
    .click();
  const stop = composer.getByRole("button", {
    name: "结束语音输入",
    exact: true,
  });
  await expect(stop).toBeVisible();
  await page.evaluate(() =>
    window.voiceFixture.instances.at(-1)?.emit("浅绿色"),
  );
  await stop.click();
  await expect(field).toHaveValue("浅绿色长风衣");
  await field.fill("稿".repeat(4000));
  await field.evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(4000, 4000),
  );
  await composer
    .getByRole("button", { name: "开始语音输入", exact: true })
    .click();
  await expect(stop).toBeVisible();
  await page.evaluate(() =>
    window.voiceFixture.instances.at(-1)?.emit("补充细节"),
  );
  await stop.click();
  await expect(composer.getByRole("alert")).toContainText("超出");
  await expect(field).toHaveValue("稿".repeat(4000));
  await field.fill("精简草稿");
  await composer.getByRole("button", { name: "加入草稿", exact: true }).click();
  await expect(field).toHaveValue("精简草稿\n补充细节");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("生成阶段替换绘画视频，真实结果到达才进行清晰显现", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 1 });
  await useCanvasPhotograph(page);
  const draft = emptyCanvasCreationDraft();
  const item: CanvasCreation = {
    id: "frame-creation",
    projectId: PROJECT,
    title: "外套生成",
    module: "image",
    draft,
    revision: 0,
    position: { x: 450, y: 0 },
    currentResult: null,
    currentResultNodeId: null,
    resource: null,
    removed: false,
    createdAt: NOW,
    updatedAt: NOW,
    runs: [
      {
        id: "frame-run",
        creationId: "frame-creation",
        executionId: null,
        toolNodeId: null,
        conversationId: null,
        status: "queued",
        draft,
        inputSnapshot: [],
        results: [],
        error: null,
        createdAt: NOW,
      },
    ],
  };
  const obsolete: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("painting-loaders"))
      obsolete.push(request.url());
  });
  await page.route(`**/api/projects/${PROJECT}/canvas/creations**`, (route) =>
    route.fulfill({ json: { items: [item], canEdit: true } }),
  );
  await loadZhiya(page);
  const frame = page.locator('[data-refine-status="queued"]');
  await expect(frame).toBeVisible();
  await page.screenshot({
    path: "output/assistant-motion/screenshots/generation-queued.png",
  });
  const run = item.runs[0];
  if (!run) throw new Error("生成夹具缺少执行记录");
  run.status = "running";
  await expect(page.locator('[data-refine-status="generating"]')).toBeVisible({
    timeout: 15000,
  });
  const result = {
    nodeId: "frame-result",
    assetId: "frame-asset",
    title: "生成外套",
    imageUrl: "/visual-garment.svg",
    text: null,
    width: 600,
    height: 800,
  };
  run.status = "completed";
  run.results = [result];
  item.currentResult = result;
  item.currentResultNodeId = result.nodeId;
  await expect(page.locator('[data-refine-status="complete"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.locator('[data-refine-status="complete"] img'),
  ).toBeVisible();
  await expect(
    page.locator('[data-refine-status="complete"]'),
  ).not.toHaveAttribute("data-revealing", "true");
  await page.screenshot({
    path: "output/assistant-motion/screenshots/generation-complete.png",
    animations: "disabled",
  });
  expect(obsolete).toEqual([]);
  expect(state.errors).toEqual([]);
});
