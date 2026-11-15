import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  loadZhiya,
  openZhiya,
  prepareZhiya,
  elementBox,
} from "./zhiya-fixture";
import { assistantResultsFixture } from "./assistant-results-fixture";
import {
  assistantImageUploadFixture,
  chatImageBytes,
} from "./assistant-image-upload-fixture";
import { PROJECT } from "../visual/fixtures";

test.setTimeout(90_000);

for (const width of [1440, 390])
  test(`${width}px编号缩略图紧凑显示并支持预览移除`, async ({ page }) => {
    const state = await assistantImageUploadFixture(page, { width });
    await state.open();
    await input(page).fill("保留图1的领口，参考图2的面料。");
    await page
      .getByLabel("选择助手参考图片", { exact: true })
      .setInputFiles(
        [1, 2, 3].map((index) => ({
          name: `参考${index}.png`,
          mimeType: "image/png",
          buffer: Buffer.concat([chatImageBytes, Buffer.from([index])]),
        })),
      );
    const chips = page.locator(
      "[data-discussion-references] [data-assistant-reference-id]",
    );
    await expect(chips).toHaveCount(3);
    expect(
      await chips.locator("[data-reference-index]").allTextContents(),
    ).toEqual(["1", "2", "3"]);
    for (const thumb of await chips.locator("[data-reference-preview]").all()) {
      const bounds = await elementBox(thumb);
      expect(Math.round(bounds.width)).toBe(48);
      expect(Math.round(bounds.height)).toBe(48);
    }
    expect((await elementBox(page.getByRole("button", { name: "历史对话", exact: true }))).height).toBeGreaterThanOrEqual(width < 768 ? 43.99 : 31.99);
    await input(page).blur();
    await mkdir("output/assistant-redesign/screenshots", { recursive: true });
    await page.screenshot({
      path: `output/assistant-redesign/screenshots/numbered-references-${width}.png`,
      animations: "disabled",
    });
    if (width === 1440)
      await page
        .locator("[data-discussion-references]")
        .screenshot({
          path: "output/assistant-redesign/screenshots/numbered-reference-strip.png",
          animations: "disabled",
        });
    await chips.first().locator("[data-reference-preview]").press("Enter");
    const preview = page.getByRole("dialog", {
      name: "参考图片预览",
      exact: true,
    });
    await expect(preview).toBeVisible();
    await preview
      .getByRole("button", { name: "移除引用", exact: true })
      .click();
    await expect(chips).toHaveCount(2);
    expect(
      await chips.locator("[data-reference-index]").allTextContents(),
    ).toEqual(["1", "2"]);
    await expect(chips.first()).toHaveAttribute(
      "data-assistant-reference-id",
      "uploaded-2",
    );
    await expect(
      chips.first().locator("[data-reference-preview]"),
    ).toBeFocused();
    await expect(input(page)).toHaveValue("保留图1的领口，参考图2的面料。");
    await chips.first().locator("[data-reference-preview]").press("Delete");
    await expect(chips).toHaveCount(1);
    expect(state.placements).toEqual([]);
    expect(state.sends).toEqual([]);
    expect(state.errors).toEqual([]);
  });
const input = (page: Page) =>
  page.getByRole("textbox", { name: "描述设计需求", exact: true });
const panel = (page: Page) => page.locator("#workflow-design-assistant");
const floating = (page: Page) =>
  page.locator('dialog[data-floating="true"][open]');
async function start(page: Page, width = 1440, height = 900, count = 3) {
  const state = await prepareZhiya(page, {
    realClock: true,
    count,
    viewport: { width, height },
  });
  await loadZhiya(page);
  await openZhiya(page);
  return state;
}
async function reference(page: Page) {
  await page.getByRole("button", { name: "添加素材", exact: true }).click();
  await page.getByRole("button", { name: "添加引用", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加引用", exact: true });
  await picker.getByRole("checkbox", { name: /通勤外套 1/ }).check();
  await picker.getByRole("button", { name: "使用所选引用" }).click();
  await expect(picker).toBeHidden();
}

test("默认浮窗、图标工具和停靠切换保留同一输入、引用与光标", async ({
  page,
}) => {
  const state = await start(page);
  await expect(floating(page)).toBeVisible();
  const bounds = await elementBox(floating(page));
  expect(Math.round(bounds.width)).toBe(400);
  expect(Math.round(bounds.height)).toBe(640);
  await expect(
    page.getByRole("button", { name: "发送需求", exact: true }),
  ).toHaveText("");
  await expect(
    page.getByRole("button", { name: "添加素材", exact: true }),
  ).toHaveText("");
  await expect(panel(page).getByRole("heading", { level: 3 })).toHaveCount(1);
  await reference(page);
  await input(page).fill("保留领口，继续完善我的设计。");
  await input(page).evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(2, 5),
  );
  const handle = await input(page).elementHandle();
  await page.getByRole("button", { name: "停靠到右侧", exact: true }).click();
  await expect(
    page.getByRole("separator", { name: "调整侧栏宽度" }),
  ).toBeVisible();
  await mkdir("output/assistant-redesign/screenshots", { recursive: true });
  await page.screenshot({
    path: "output/assistant-redesign/screenshots/docked-1440.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "切换为浮窗", exact: true }).click();
  await expect(floating(page)).toBeVisible();
  expect(await handle?.evaluate((el) => el.isConnected)).toBe(true);
  await expect(input(page)).toHaveValue("保留领口，继续完善我的设计。");
  expect(
    await input(page).evaluate((el: HTMLTextAreaElement) => [
      el.selectionStart,
      el.selectionEnd,
    ]),
  ).toEqual([2, 5]);
  await expect(
    page.getByRole("button", { name: "移除引用 通勤外套 1", exact: true }),
  ).toBeVisible();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("浮窗键盘移动缩放、取消及刷新恢复", async ({ page }) => {
  await start(page);
  const header = page.locator('header[aria-label="移动设计助手"]');
  const before = await elementBox(floating(page));
  await header.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  expect((await elementBox(floating(page))).x).toBe(before.x - 8);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  expect((await elementBox(floating(page))).y).toBe(before.y);
  const resize = page.getByRole("separator", {
    name: "调整助手浮窗左边",
    exact: true,
  });
  await resize.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Enter");
  expect((await elementBox(floating(page))).width).toBe(432);
  const saved = await elementBox(floating(page));
  await input(page).fill("刷新后保留草稿。");
  // The existing draft repository coalesces writes for 300ms.
  await page.waitForTimeout(450);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem(
              "fashion:workspace-split:visual-designer:atelier-visual",
            ) ?? "{}",
          ).floatingBounds?.width,
      ),
    )
    .toBe(432);
  await page.reload();
  await expect(input(page)).toHaveValue("刷新后保留草稿。");
  expect(await elementBox(floating(page))).toMatchObject({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
  });
});

test("技能预览追加与替换保留引用，管理能力退出主菜单", async ({ page }) => {
  const state = await start(page);
  await reference(page);
  await input(page).fill("这是不能丢失的原始草稿。");
  await page.getByRole("button", { name: "常用技能", exact: true }).click();
  await page.getByRole("button", { name: /^整理设计方向/ }).click();
  const dialog = page.getByRole("dialog", { name: "载入技能", exact: true });
  await expect(dialog).toBeVisible();
  await mkdir("output/assistant-redesign/screenshots", { recursive: true });
  await page.screenshot({
    path: "output/assistant-redesign/screenshots/skill-preview-1440.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "追加到草稿" }).click();
  await expect(input(page)).toHaveValue(/这是不能丢失的原始草稿。\n\n请先整理/);
  await expect(
    page.getByRole("button", { name: "移除引用 通勤外套 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "助手设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停本项目设计助手" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "分步计划", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "历史任务", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "output/assistant-redesign/screenshots/more-menu-1440.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  const longDraft = "保留".repeat(1998);
  await input(page).fill(longDraft);
  await page.getByRole("button", { name: "常用技能", exact: true }).click();
  await page.getByRole("button", { name: /^整理设计方向/ }).click();
  await dialog.getByRole("button", { name: "追加到草稿" }).click();
  await expect(dialog.getByRole("alert")).toContainText("超出输入上限");
  await expect(input(page)).toHaveValue(longDraft);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(state.mutations).toEqual([]);
});

test("历史任务可查看且不再创建委托或计划", async ({ page }) => {
  await prepareZhiya(page, { realClock: true });
  await page.route(
    `**/api/projects/${PROJECT}/assistant-delegations`,
    (route) => route.fulfill({ json: [] }),
  );
  await page.route("**/api/agent-conversations/visual-chat/plans*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await loadZhiya(page);
  await openZhiya(page);
  await page.getByRole("button", { name: "助手设置", exact: true }).click();
  await page.getByRole("button", { name: "历史任务", exact: true }).click();
  const tasks = page.getByRole("dialog", { name: "历史任务", exact: true });
  await expect(tasks).toBeVisible();
  await expect(tasks.getByRole("button", { name: "保存委托" })).toHaveCount(0);
  await tasks.getByRole("button", { name: "分步计划", exact: true }).click();
  await expect(tasks.getByRole("button", { name: "规划设计步骤" })).toHaveCount(
    0,
  );
  await expect(tasks.getByText("这段对话还没有历史计划。")).toBeVisible();
});

for (const width of [1920, 1440, 1366, 390, 320]) {
  test(`${width}px空态与输入图标可达`, async ({ page }) => {
    const state = await start(page, width, width <= 390 ? 640 : 900, 0);
    await mkdir("output/assistant-redesign/screenshots", { recursive: true });
    await input(page).fill("设计一件轻盈的夏日外套");
    const send = page.getByRole("button", { name: "发送需求", exact: true });
    await expect(send).toBeEnabled();
    expect(
      (await elementBox(send)).y + (await elementBox(send)).height,
    ).toBeLessThanOrEqual(width <= 390 ? 640 : 900);
    if (width <= 390)
      expect((await elementBox(send)).width).toBeGreaterThanOrEqual(43.99);
    await input(page).fill("");
    await input(page).blur();
    await expect(input(page)).toHaveCSS("box-shadow", "none");
    await page.screenshot({
      path: `output/assistant-redesign/screenshots/empty-${width}.png`,
      animations: "disabled",
    });
    if (width === 1440)
      await panel(page).screenshot({
        path: "output/assistant-redesign/screenshots/assistant-closeup.png",
        animations: "disabled",
      });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(state.errors).toEqual([]);
  });
}

test("结果图片完整呈现且比较和修改使用图标", async ({ page }) => {
  const state = await assistantResultsFixture(page);
  await state.open();
  const gallery = page.getByRole("region", {
    name: "本次图片结果",
    exact: true,
  });
  await expect(gallery).toBeVisible();
  expect(
    await gallery
      .locator("img")
      .evaluateAll((images) =>
        images.every((el) => getComputedStyle(el).objectFit === "contain"),
      ),
  ).toBe(true);
  await expect(
    gallery.getByRole("button", { name: "比较本次结果", exact: true }),
  ).toHaveText("");
  await gallery
    .getByRole("button", { name: "查看大图：藏蓝通勤外套", exact: true })
    .hover();
  await gallery
    .getByRole("button", { name: "继续修改：藏蓝通勤外套", exact: true })
    .click();
  await expect(input(page)).toBeFocused();
  await expect(
    page.getByRole("button", { name: /移除引用.*藏蓝通勤外套/ }),
  ).toBeVisible();
  await mkdir("output/assistant-redesign/screenshots", { recursive: true });
  await page.screenshot({
    path: "output/assistant-redesign/screenshots/results-1440.png",
    animations: "disabled",
  });
  expect(state.errors).toEqual([]);
});

test("指针移动、边角缩放和取消不会误操作画布", async ({ page }) => {
  const state = await start(page);
  const before = await elementBox(floating(page));
  const header = await elementBox(
    page.locator('header[aria-label="移动设计助手"]'),
  );
  await page.mouse.move(header.x + 150, header.y + 26);
  await page.mouse.down();
  await page.mouse.move(header.x + 30, header.y - 54, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await elementBox(floating(page))).x))
    .toBe(Math.round(before.x - 120));
  const corner = await elementBox(
    page.getByRole("separator", { name: "调整助手浮窗右下角", exact: true }),
  );
  const moved = await elementBox(floating(page));
  await page.mouse.move(corner.x + 8, corner.y + 8);
  await page.mouse.down();
  await page.mouse.move(corner.x + 68, corner.y + 58, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await elementBox(floating(page))).toEqual(moved);
  await input(page).fill("拖动后仍能继续输入");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("320×400短屏多附件仍能输入和发送", async ({ page }) => {
  const state = await assistantImageUploadFixture(page, { width: 320 });
  await state.open();
  await page.setViewportSize({ width: 320, height: 400 });
  await page.getByLabel("选择助手参考图片", { exact: true }).setInputFiles([
    { name: "正面参考.png", mimeType: "image/png", buffer: chatImageBytes },
    {
      name: "领口参考.png",
      mimeType: "image/png",
      buffer: Buffer.concat([chatImageBytes, Buffer.from([2])]),
    },
  ]);
  await expect(page.locator("[data-assistant-reference-id]")).toHaveCount(2);
  await input(page).fill("保留宽松廓形，比较两张图的领口细节。");
  const send = page.getByRole("button", { name: "发送需求", exact: true });
  await expect(send).toBeEnabled();
  await expect(send).toBeInViewport({ ratio: 1 });
  await expect(input(page)).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: "output/assistant-redesign/screenshots/references-320x400.png",
    animations: "disabled",
  });
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("已有委托仍可恢复，暂停项目在输入区恢复", async ({ page }) => {
  await prepareZhiya(page, { realClock: true });
  let version = 1;
  const item = {
    id: "old-delegation",
    name: "每周复盘",
    prompt: "检查当前方案",
    status: "PAUSED",
    cadence: "WEEKLY",
    nextRunAt: "2026-12-01T12:00:00Z",
    lastError: null,
  };
  const restored: unknown[] = [];
  await page.route(`**/api/projects/${PROJECT}/workflow/tools`, (route) =>
    route.fulfill({ json: { agentVersion: version, tools: [] } }),
  );
  await page.route(
    `**/api/projects/${PROJECT}/workflow/agent-settings`,
    (route) => {
      version = 2;
      return route.fulfill({ json: { version: 2 } });
    },
  );
  await page.route(
    `**/api/projects/${PROJECT}/assistant-delegations`,
    (route) => route.fulfill({ json: [item] }),
  );
  await page.route("**/api/assistant-delegations/old-delegation", (route) => {
    restored.push(route.request().postDataJSON());
    item.status = "ACTIVE";
    return route.fulfill({ json: item });
  });
  await loadZhiya(page);
  await page.locator("[data-zhiya] .pp-hit").click();
  await expect(
    page.getByRole("button", { name: "恢复设计助手", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复设计助手", exact: true }).click();
  await expect(input(page)).toBeVisible();
  await page.getByRole("button", { name: "助手设置", exact: true }).click();
  await page.getByRole("button", { name: "历史任务", exact: true }).click();
  const tasks = page.getByRole("dialog", { name: "历史任务", exact: true });
  await tasks.getByRole("button", { name: "恢复", exact: true }).click();
  expect(restored).toEqual([{ status: "ACTIVE" }]);
  await expect(
    tasks.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await expect(tasks.getByRole("button", { name: "保存委托" })).toHaveCount(0);
});
