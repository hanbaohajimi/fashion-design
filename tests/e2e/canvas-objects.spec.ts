import { openCanvasFunction } from "./canvas-function-navigation";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { CanvasSave } from "../../packages/shared/src/canvas-workspace";
import { canvasAction } from "./canvas-workspace-controls";
import { loadZhiya, openZhiya, prepareZhiya } from "./zhiya-fixture";
import { PROJECT } from "../visual/fixtures";

test.setTimeout(60_000);
const panel = (page: Page) => page.getByRole("region", { name: "画布对象", exact: true });
const row = (page: Page, index: number) => panel(page).locator(`[data-canvas-object-id="shape:canvas-material-${index}"]`);
const shape = (page: Page, index: number) => page.locator(`.tl-shape[data-shape-id="shape:canvas-material-${index}"]`);
const open = async (page: Page) => { await openCanvasFunction(page, "画布对象"); await expect(panel(page)).toBeVisible(); };
const close = async (page: Page) => { await panel(page).getByRole("button", { name: "关闭画布对象" }).click(); };
type RecordShape = { id: string; type: string; typeName: string; x: number; y: number; index: string; parentId: string; isLocked: boolean; props: { title?: string }; meta?: { canvasHidden?: boolean } };
function records(save?: CanvasSave): RecordShape[] {
  const snapshot = save?.snapshot as { document?: { store: Record<string, RecordShape> } } | undefined;
  return Object.values(snapshot?.document?.store ?? {}).filter(record => record.typeName === "shape");
}
const saved = (saves: CanvasSave[], index: number) => records(saves.at(-1)).find(record => record.id === `shape:canvas-material-${index}`);

test("开合不移动视野、不重建聊天；选择不追加引用或发送", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page); await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("保留这份草稿，先整理画布。");
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 5));
  const handle = await input.elementHandle();
  const before = await shape(page, 1).boundingBox();
  for (let count = 0; count < 3; count++) { await open(page); await close(page); }
  expect(await shape(page, 1).boundingBox()).toEqual(before);
  await open(page);
  await row(page, 0).getByRole("button", { name: /^选择/ }).click();
  await row(page, 1).getByRole("button", { name: /^选择/ }).click({ modifiers: ["Shift"] });
  await expect(panel(page)).toContainText("已选 2 项");
  await close(page);
  await expect(input).toHaveValue("保留这份草稿，先整理画布。");
  expect(await handle?.evaluate(element => element.isConnected)).toBe(true);
  expect(await input.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([3, 5]);
  const discussion = page.getByLabel("正在讨论", { exact: true });
  await expect(discussion).toHaveAttribute("data-has-references", "false");
  await expect(discussion.getByRole("button", { name: /移除引用/ })).toHaveCount(0);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("层级调整按前后顺序显示，撤销重做和刷新保留结果", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page); await open(page);
  const order = () => panel(page).locator("[data-canvas-object-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-canvas-object-id")));
  const initial = await order();
  await row(page, 0).getByRole("button", { name: /^选择/ }).click();
  await panel(page).getByRole("button", { name: "上移一层", exact: true }).click();
  await expect.poll(order).toEqual([initial[0], initial[2], initial[1]]);
  await panel(page).getByRole("button", { name: "置于顶层", exact: true }).click();
  await expect.poll(order).toEqual([initial[2], initial[0], initial[1]]);
  await canvasAction(page, "撤销白板操作");
  await expect.poll(order).toEqual([initial[0], initial[2], initial[1]]);
  await canvasAction(page, "重做白板操作");
  await expect.poll(order).toEqual([initial[2], initial[0], initial[1]]);
  await expect.poll(() => saved(state.saves, 0)?.index > (saved(state.saves, 2)?.index ?? "")).toBe(true);
  await page.reload(); await open(page);
  await expect.poll(order).toEqual([initial[2], initial[0], initial[1]]);
  await expect(page.getByText("已恢复本机草稿，尚未保存到项目。", { exact: true })).toHaveCount(0);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("分组搜索保留上下文，折叠不删除对象，父级锁定传给子对象", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page); await open(page);
  await row(page, 0).getByRole("button", { name: /^选择/ }).click();
  await row(page, 1).getByRole("button", { name: /^选择/ }).click({ modifiers: ["Shift"] });
  await close(page); await page.getByRole("button", { name: "分组", exact: true }).click(); await open(page);
  await panel(page).getByRole("button", { name: "收起 分组", exact: true }).click();
  await expect(row(page, 0)).toHaveCount(0);
  await panel(page).getByRole("searchbox").fill("通勤外套 1");
  await expect(row(page, 0)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "选择 分组", exact: true })).toBeVisible();
  await expect(row(page, 1)).toHaveCount(0);
  await panel(page).getByRole("searchbox").fill("");
  await panel(page).getByRole("button", { name: "展开 分组", exact: true }).click();
  await panel(page).getByRole("button", { name: "锁定 分组", exact: true }).click();
  await expect(row(page, 0)).toHaveAttribute("data-locked", "true");
  await expect(row(page, 0).getByRole("button", { name: /随父级锁定/ })).toBeDisabled();
  await row(page, 0).getByRole("button", { name: /^选择/ }).click();
  await expect(panel(page).getByRole("button", { name: "置于顶层" })).toBeDisabled();
  await panel(page).getByRole("button", { name: "解锁 分组", exact: true }).click();
  await expect(row(page, 0)).toHaveAttribute("data-locked", "false");
  await close(page); await canvasAction(page, "撤销白板操作"); await open(page);
  await expect(row(page, 1)).toHaveAttribute("data-locked", "true");
  await expect.poll(() => records(state.saves.at(-1)).find(record => record.type === "group")?.isLocked).toBe(true);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("锁定防止误拖和删除，刷新后仍可解锁且素材更新正常", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page); await open(page);
  await row(page, 1).getByRole("button", { name: /^锁定/ }).click();
  await expect.poll(() => saved(state.saves, 1)?.isLocked).toBe(true);
  const before = saved(state.saves, 1);
  await row(page, 1).getByRole("button", { name: /^选择/ }).click(); await close(page);
  await page.getByRole("button", { name: "更多白板操作", exact: true }).click();
  await expect(page.getByRole("button", { name: "移除所选摆放", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  const box = await shape(page, 1).boundingBox();
  if (!box) throw new Error("待保护对象不可见");
  await page.mouse.move(box.x + 80, box.y + 80); await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 140, { steps: 12 }); await page.mouse.up();
  await page.keyboard.press("Delete"); await page.waitForTimeout(700);
  await expect(shape(page, 1)).toBeVisible();
  expect(saved(state.saves, 1)).toMatchObject({ x: before?.x, y: before?.y, isLocked: true });
  const updatedNode = state.graph.nodes[1];
  if (!updatedNode) throw new Error("待更新素材缺失");
  updatedNode.title = "新版通勤外套"; state.graph.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await open(page);
  await expect(row(page, 1)).toContainText("新版通勤外套");
  await expect(row(page, 1)).toHaveAttribute("data-locked", "true");
  await page.reload(); await open(page);
  await expect(row(page, 1)).toHaveAttribute("data-locked", "true");
  await row(page, 1).getByRole("button", { name: /^解锁/ }).click();
  await expect(row(page, 1)).toHaveAttribute("data-locked", "false");
  await expect.poll(() => saved(state.saves, 1)?.isLocked).toBe(false);
  expect(state.errors).toEqual([]);
});

test("只读画布允许查找定位，拒绝锁定与排序", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, canEdit: false });
  await loadZhiya(page); await open(page);
  await row(page, 1).getByRole("button", { name: /^选择/ }).click();
  await expect(row(page, 1).getByRole("button", { name: /^锁定/ })).toBeDisabled();
  await expect(row(page, 1).getByRole("button", { name: /^隐藏/ })).toBeDisabled();
  await expect(panel(page).getByRole("button", { name: "置于顶层" })).toBeDisabled();
  await panel(page).getByRole("button", { name: "定位所选对象" }).click();
  await expect(shape(page, 1)).toBeInViewport({ ratio: 1 });
  expect(state.saves).toEqual([]); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("保存失败保留锁定、隐藏状态和本机草稿，可显式重试", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  let fail = true;
  await page.route(`**/api/projects/${PROJECT}/canvas`, route => route.request().method() === "PATCH" && fail ? route.fulfill({ status: 503, json: { message: "本轮保存暂时失败" } }) : route.fallback());
  await loadZhiya(page); await open(page);
  await row(page, 1).getByRole("button", { name: /^锁定/ }).click();
  await row(page, 1).getByRole("button", { name: /^隐藏/ }).click();
  await expect(page.getByText("本轮保存暂时失败", { exact: false }).first()).toBeVisible();
  await expect(row(page, 1)).toHaveAttribute("data-locked", "true");
  await expect(row(page, 1)).toHaveAttribute("data-hidden", "true");
  fail = false;
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect.poll(() => saved(state.saves, 1)?.isLocked).toBe(true);
  await expect.poll(() => saved(state.saves, 1)?.meta?.canvasHidden).toBe(true);
  expect(state.mutations).toEqual([]);
});

for (const width of [1440, 320]) test(`${width}px 长名称、键盘与定位保持可用`, async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 30, viewport: { width, height: width === 320 ? 568 : 900 } });
  const firstNode = state.graph.nodes[0];
  if (!firstNode) throw new Error("长名称素材缺失");
  firstNode.title = "秋冬通勤外套的长名称用于检查对象目录中信息与按钮的完整呈现";
  if (width === 320) await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await loadZhiya(page); await open(page);
  const search = panel(page).getByRole("searchbox");
  await search.focus();
  await search.dispatchEvent("keydown", { key: "Escape", keyCode: 229, isComposing: true });
  await expect(panel(page)).toBeVisible();
  await search.fill("秋冬");
  await row(page, 0).getByRole("button", { name: /^选择/ }).click();
  await expect(panel(page).getByRole("button", { name: "定位所选对象" })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("output/playwright/canvas-objects", { recursive: true });
  await page.screenshot({ path: `output/playwright/canvas-objects/objects-${width}.png` });
  await search.fill("");
  await page.screenshot({ path: `output/playwright/canvas-objects/objects-${width}-full.png` });
  await panel(page).getByRole("button", { name: "定位所选对象" }).click();
  // IntersectionObserver may round a fully visible scaled shape just below 1.
  await expect(shape(page, 0)).toBeInViewport({ ratio: 0.999 });
  if (width === 320) { await expect(panel(page)).toBeHidden(); await open(page); }
  await panel(page).getByRole("searchbox").focus(); await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "全部功能模块", exact: true })).toBeFocused();
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

for (const width of [1440, 320]) test(`${width}px 八层分组保持可搜索、可折叠且深层对象操作不会越界`, async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 12 });
  const firstNode = state.graph.nodes[0];
  if (!firstNode) throw new Error("深层分组素材缺失");
  firstNode.title = "深层唯一目标";
  await loadZhiya(page);
  for (let level = 0; level < 8; level++) {
    await open(page);
    if (level === 0) await row(page, 0).getByRole("button", { name: /^选择/ }).click();
    else await panel(page).getByRole("button", { name: /^选择 分组/ }).first().click();
    await row(page, level + 1).getByRole("button", { name: /^选择/ }).click({ modifiers: ["Shift"] });
    await close(page);
    await page.getByRole("button", { name: "分组", exact: true }).click();
  }
  await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
  await open(page);
  await expect(panel(page).locator("[data-canvas-object-id]")).toHaveCount(20);
  await panel(page).getByRole("searchbox").fill("深层唯一目标");
  await expect(panel(page).locator("[data-canvas-object-id]")).toHaveCount(9);
  const target = row(page, 0).getByRole("button", { name: /^选择/ });
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport({ ratio: 1 });
  expect(await row(page, 0).evaluate(element => parseFloat(getComputedStyle(element).paddingInlineStart))).toBe(width === 320 ? 24 : 60);
  expect(await target.locator("span").evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(56);
  const targetBox = await target.boundingBox(), panelBox = await panel(page).boundingBox();
  if (!targetBox || !panelBox) throw new Error("深层分组不可见");
  expect(targetBox.x + targetBox.width).toBeLessThan(panelBox.x + panelBox.width);
  const hide = row(page, 0).getByRole("button", { name: /^隐藏/ });
  if (width === 320) expect((await hide.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  await hide.click();
  await expect(row(page, 0)).toHaveAttribute("data-hidden", "true");
  await row(page, 0).getByRole("button", { name: /^显示/ }).click();
  await expect(row(page, 0)).toHaveAttribute("data-hidden", "false");
  await panel(page).getByRole("searchbox").fill("");
  await panel(page).getByRole("button", { name: /^收起 分组/ }).first().click();
  await expect(row(page, 0)).toHaveCount(0);
  await expect(panel(page).locator("[data-canvas-object-id]")).toHaveCount(4);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test.describe("对象面板触控", () => {
  test.use({ hasTouch: true });
  for (const height of [568, 400]) test(`320×${height} 原生触摸滚动独立，织芽暂停且定位后恢复`, async ({ page }) => {
    const state = await prepareZhiya(page, { realClock: true, count: 30, viewport: { width: 320, height } });
    await loadZhiya(page);
    const before = await shape(page, 0).boundingBox();
    await openCanvasFunction(page, "画布对象");
    await expect(panel(page)).toBeVisible();
    await expect(page.locator("[data-zhiya]")).toBeHidden();
    await expect(page.locator("[data-zhiya]")).toHaveAttribute("data-active", "false");
    await expect(panel(page).getByRole("heading", { name: "画布对象" })).toBeInViewport({ ratio: 1 });
    await expect(panel(page).getByRole("button", { name: "关闭画布对象" })).toBeInViewport({ ratio: 1 });
    const canvasControls = page.getByRole("button", { name: "全部功能模块", exact: true });
    const list = panel(page).getByRole("list", { name: "画布对象列表" });
    const bounds = await list.boundingBox();
    if (!bounds || bounds.height < 44) throw new Error("列表未保留完整触摸行");
    const cdp = await page.context().newCDPSession(page);
    try {
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height - 10;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
      for (let step = 1; step <= 6; step++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - (bounds.height - 20) * step / 6, id: 0 }] });
        await page.waitForTimeout(32);
      }
      await page.waitForTimeout(120);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    } finally { await cdp.detach(); }
    expect(await shape(page, 0).boundingBox()).toEqual(before);
    // A touch tap during native momentum only stops scrolling. Wait for the
    // list to settle before testing a separate, intentional button activation.
    await list.evaluate(element => new Promise<void>(resolve => {
      let previous = element.scrollTop, unchangedSince = performance.now();
      const settle = () => {
        if (element.scrollTop !== previous) { previous = element.scrollTop; unchangedSince = performance.now(); }
        if (performance.now() - unchangedSince >= 160) resolve();
        else requestAnimationFrame(settle);
      };
      requestAnimationFrame(settle);
    }));
    await list.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0);
    const lock = panel(page).locator("[data-canvas-object-id]").first().getByRole("button", { name: /^锁定/ });
    const lockBox = await lock.boundingBox();
    if (!lockBox) throw new Error("触摸锁定入口不可见");
    expect(lockBox.width).toBeGreaterThanOrEqual(44); expect(lockBox.height).toBeGreaterThanOrEqual(44);
    await lock.tap();
    await expect(panel(page).locator("[data-canvas-object-id]").first()).toHaveAttribute("data-locked", "true");
    const eye = panel(page).locator("[data-canvas-object-id]").first().getByRole("button", { name: /^隐藏/ });
    const eyeBox = await eye.boundingBox();
    expect(eyeBox?.width).toBeGreaterThanOrEqual(44); expect(eyeBox?.height).toBeGreaterThanOrEqual(44);
    await eye.tap();
    await expect(panel(page).locator("[data-canvas-object-id]").first()).toHaveAttribute("data-hidden", "true");
    await panel(page).locator("[data-canvas-object-id]").first().getByRole("button", { name: /^显示/ }).tap();
    await panel(page).locator("[data-canvas-object-id]").first().getByRole("button", { name: /^选择/ }).tap();
    const locate = panel(page).getByRole("button", { name: "定位所选对象" });
    await expect(locate).toBeInViewport({ ratio: 1 });
    await mkdir("output/playwright/canvas-objects", { recursive: true });
    await page.screenshot({ path: `output/playwright/canvas-objects/objects-touch-${height}.png` });
    await locate.tap();
    await expect(panel(page)).toBeHidden();
    await expect(page.locator("[data-zhiya]")).toBeVisible();
    await expect(page.locator("[data-zhiya]")).toHaveAttribute("data-active", "true");
    await expect(canvasControls).toBeVisible();
    expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
  });
});
