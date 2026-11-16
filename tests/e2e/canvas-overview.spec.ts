import { openCanvasFunction } from "./canvas-function-navigation";
import { mkdir, readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { canvasAction } from "./canvas-workspace-controls";
import { loadZhiya, openZhiya, prepareZhiya, zhiya } from "./zhiya-fixture";

test.setTimeout(60_000);
const panel = (page: Page) => page.getByRole("region", { name: "画布总览", exact: true });
const map = (page: Page) => page.getByRole("application", { name: "画布总览导航", exact: true });
const shape = (page: Page, index = 0) => page.locator(`.tl-shape[data-shape-id="shape:canvas-material-${index}"]`);
const open = async (page: Page) => { await canvasAction(page, "画布总览"); await expect(map(page)).toHaveAttribute("data-bounds", /./); };
const close = async (page: Page) => panel(page).getByRole("button", { name: "关闭画布总览", exact: true }).click();
const view = async (page: Page): Promise<{ x: number; y: number; w: number; h: number }> => JSON.parse(await map(page).getAttribute("data-viewport") ?? "null");
const bounds = async (page: Page): Promise<{ x: number; y: number; w: number; h: number }> => JSON.parse(await map(page).getAttribute("data-bounds") ?? "null");

async function centerPoint(page: Page) {
  const box = await map(page).boundingBox();
  if (!box) throw new Error("总览尚未显示");
  const viewport = await view(page), content = await bounds(page);
  return { x: box.x + (viewport.x + viewport.w / 2 - content.x) / content.w * box.width,
    y: box.y + (viewport.y + viewport.h / 2 - content.y) / content.h * box.height };
}

test("总览开合保留视野和聊天，键盘平移缩放只改变视野", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 30 });
  await loadZhiya(page); await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("先整理画布，再继续设计");
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 4));
  const instance = await input.elementHandle(), original = await shape(page).boundingBox();
  await open(page); await expect(map(page)).toBeFocused();
  await expect(map(page)).toHaveAttribute("data-object-count", "30");
  expect(await shape(page).boundingBox()).toEqual(original);
  const initial = await view(page), zoom = await map(page).getAttribute("data-zoom");
  await map(page).press("ArrowRight");
  await expect.poll(async () => (await view(page)).x).toBeGreaterThan(initial.x);
  expect(await map(page).getAttribute("data-zoom")).toBe(zoom);
  expect((await shape(page).boundingBox())?.x).toBeLessThan(original?.x ?? 0);
  await map(page).press("+");
  await expect.poll(async () => Number(await map(page).getAttribute("data-zoom"))).toBeGreaterThan(Number(zoom));
  await map(page).press("0");
  await expect(map(page)).toHaveAttribute("data-zoom", "1");
  await map(page).press("Home");
  await map(page).press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "更多白板操作", exact: true })).toBeFocused();
  await expect(input).toHaveValue("先整理画布，再继续设计");
  expect(await instance?.evaluate(element => element.isConnected)).toBe(true);
  expect(await input.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 4]);
  expect(state.mutations).toEqual([]); expect(state.saves).toEqual([]); expect(state.errors).toEqual([]);
});

test("点击总览跳转作品区域，拖动视野框保持缩放并可Escape取消", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 100 });
  await loadZhiya(page); await canvasAction(page, "画布原始比例"); await open(page);
  const initial = await view(page), zoom = await map(page).getAttribute("data-zoom");
  const canvas = await map(page).boundingBox();
  if (!canvas) throw new Error("缺少总览画布");
  await map(page).click({ position: { x: canvas.width * .8, y: canvas.height * .8 } });
  await expect.poll(async () => (await view(page)).y).not.toBe(initial.y);
  expect(await map(page).getAttribute("data-zoom")).toBe(zoom);
  const start = await view(page), point = await centerPoint(page);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x - 28, point.y - 18, { steps: 6 });
  await expect.poll(async () => (await view(page)).x).toBeLessThan(start.x);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => view(page)).toEqual(start);
  const next = await centerPoint(page);
  await page.mouse.move(next.x, next.y); await page.mouse.down(); await page.mouse.move(next.x - 20, next.y, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await view(page)).x).toBeLessThan(start.x);
  await close(page);
  const final = await shape(page).boundingBox();
  await page.reload(); await expect(zhiya(page)).toHaveAttribute("data-active", "true"); await expect.poll(() => shape(page).boundingBox()).toEqual(final);
  expect(state.mutations).toEqual([]); expect(state.saves).toEqual([]); expect(state.errors).toEqual([]);
});

test("隐藏对象不出现在总览，恢复后立即更新且与对象目录互斥", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 3 });
  await loadZhiya(page); await open(page);
  await expect(map(page)).toHaveAttribute("data-object-count", "3");
  await openCanvasFunction(page, "画布对象");
  await expect(panel(page)).toHaveCount(0);
  const objects = page.getByRole("region", { name: "画布对象", exact: true });
  await objects.getByRole("button", { name: "隐藏 通勤外套 1", exact: true }).click();
  await open(page);
  await expect(objects).toHaveCount(0);
  await expect(map(page)).toHaveAttribute("data-object-count", "2");
  await openCanvasFunction(page, "画布对象");
  await objects.getByRole("button", { name: "显示 通勤外套 1", exact: true }).click();
  await open(page); await expect(map(page)).toHaveAttribute("data-object-count", "3");
  const before = await view(page);
  await map(page).dispatchEvent("keydown", { key: "Escape", keyCode: 229, isComposing: true });
  await expect(panel(page)).toBeVisible(); expect(await view(page)).toEqual(before);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("总览保留已有选择，双击不会打开详情且绘图工具不会落笔", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  await openCanvasFunction(page, "画布对象");
  const objects = page.getByRole("region", { name: "画布对象", exact: true });
  await objects.getByRole("button", { name: "选择 通勤外套 1", exact: true }).click();
  await objects.getByRole("button", { name: "关闭画布对象", exact: true }).click();
  await open(page); await map(page).dblclick({ position: { x: 120, y: 60 } });
  await expect(page.getByRole("button", { name: "关闭图片工作区", exact: true })).toHaveCount(0);
  await close(page);
  await expect(page.getByRole("toolbar", { name: "常用图片工具", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await canvasAction(page, "自由手绘"); await open(page);
  const point = await centerPoint(page);
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 30, point.y + 10, { steps: 5 }); await page.mouse.up();
  await close(page); await openCanvasFunction(page, "画布对象");
  await expect(objects.locator("[data-canvas-object-id]")).toHaveCount(3);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("分组隐藏过滤整棵子树，总览随撤销恢复且不计分组外框", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 3 });
  await loadZhiya(page);
  await openCanvasFunction(page, "画布对象");
  const objects = page.getByRole("region", { name: "画布对象", exact: true });
  await objects.getByRole("button", { name: "选择 通勤外套 1", exact: true }).click();
  await objects.getByRole("button", { name: "选择 通勤外套 2", exact: true }).click({ modifiers: ["Shift"] });
  await objects.getByRole("button", { name: "关闭画布对象", exact: true }).click();
  await page.getByRole("button", { name: "分组", exact: true }).click();
  await open(page); await expect(map(page)).toHaveAttribute("data-object-count", "3");
  await openCanvasFunction(page, "画布对象");
  await objects.getByRole("button", { name: "隐藏 分组", exact: true }).click();
  await open(page); await expect(map(page)).toHaveAttribute("data-object-count", "1");
  await canvasAction(page, "撤销白板操作");
  await expect(map(page)).toHaveAttribute("data-object-count", "3");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("总览绘制只随变化发生，离屏后台和卸载停止，重开不累积绘制", async ({ page }) => {
  await page.addInitScript(() => {
    let draws = 0;
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args: Parameters<typeof fill>) {
      if (this.canvas.getAttribute("aria-label") === "画布总览导航") draws++;
      return fill.apply(this, args);
    };
    Object.assign(window, { overviewDrawCount: () => draws });
  });
  const state = await prepareZhiya(page, { realClock: true, count: 3 });
  await loadZhiya(page); await open(page);
  const draws = () => page.evaluate(() => (window as unknown as { overviewDrawCount: () => number }).overviewDrawCount());
  await page.waitForTimeout(350);
  const staticCount = await draws(); await page.waitForTimeout(200); expect(await draws()).toBe(staticCount);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await map(page).press("ArrowLeft"); await page.waitForTimeout(150); expect(await draws()).toBe(staticCount);
  await page.evaluate(() => { Reflect.deleteProperty(document, "hidden"); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(draws).toBeGreaterThan(staticCount);
  await panel(page).evaluate(element => { (element as HTMLElement).style.display = "none"; });
  await page.waitForTimeout(150); const hiddenCount = await draws();
  await page.evaluate(() => window.dispatchEvent(new Event("resize"))); await page.waitForTimeout(150);
  expect(await draws()).toBe(hiddenCount);
  await page.locator("[data-canvas-overview]").evaluate(element => { (element as HTMLElement).style.display = ""; });
  await expect.poll(draws).toBeGreaterThan(hiddenCount);
  for (let repeat = 0; repeat < 3; repeat++) {
    await close(page); const closed = await draws();
    await canvasAction(page, "放大画布"); await page.waitForTimeout(100); expect(await draws()).toBe(closed);
    await open(page); await page.waitForTimeout(150);
    const before = await draws(); await map(page).press("ArrowRight");
    await expect.poll(draws).toBeGreaterThan(before);
    await page.waitForTimeout(150);
    // Three object rectangles plus the background and viewport fill, once per camera event.
    expect(await draws() - before).toBeLessThanOrEqual(10);
  }
  await page.getByRole("button", { name: "流程画布", exact: true }).click();
  await expect(panel(page)).toHaveCount(0); const exited = await draws();
  await page.waitForTimeout(150); expect(await draws()).toBe(exited);
  expect(state.errors).toEqual([]);
});

test("总览绘图不可用时保留全图和缩放入口", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
      if (this.getAttribute("aria-label") === "画布总览导航") return null;
      return original.apply(this, args);
    } as typeof original;
  });
  const state = await prepareZhiya(page, { realClock: true, count: 30 });
  await loadZhiya(page); await canvasAction(page, "画布总览");
  await expect(panel(page).getByText("总览暂不可用，可使用下方按钮查看全图。", { exact: true })).toBeVisible();
  await panel(page).getByRole("button", { name: "全图", exact: true }).click();
  await panel(page).getByRole("button", { name: "总览放大画布", exact: true }).click();
  await close(page); await expect(panel(page)).toHaveCount(0);
  expect(state.mutations).toEqual([]); expect(state.saves).toEqual([]); expect(state.errors).toEqual([]);
});

test("总览和视野框不进入导出，打开后PNG与原图一致", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 10 });
  await loadZhiya(page);
  const download = async () => {

    const pending = page.waitForEvent("download");
    await openCanvasFunction(page, "导出画布 PNG");
    const file = await pending, path = await file.path();
    if (!path) throw new Error("没有导出文件");
    return readFile(path);
  };
  const before = await download();
  await open(page); await map(page).press("ArrowRight"); await map(page).press("+");
  expect(await download()).toEqual(before);
  expect(state.saves).toEqual([]); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

for (const count of [0, 3]) test(`只读${count ? "有对象" : "空白"}画布可查看总览，不写入文档`, async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count, canEdit: false });
  await loadZhiya(page); await open(page); await expect(map(page)).toHaveAttribute("data-object-count", String(count));
  await map(page).press("ArrowLeft"); await map(page).press("Home");
  await panel(page).getByRole("button", { name: "总览放大画布", exact: true }).click();
  expect(Object.values(await view(page)).every(Number.isFinite)).toBe(true);
  expect(state.mutations).toEqual([]); expect(state.saves).toEqual([]); expect(state.errors).toEqual([]);
});

test.describe("触控总览", () => {
  test.use({ hasTouch: true });
  for (const height of [568, 400]) test(`320×${height}触控拖动与取消，关闭后织芽恢复`, async ({ page, context }) => {
    const state = await prepareZhiya(page, { realClock: true, count: 100, viewport: { width: 320, height } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loadZhiya(page); await open(page);
    await expect(panel(page)).toBeInViewport({ ratio: 1 });
    await expect(zhiya(page)).toHaveAttribute("data-active", "false");
    const closeButton = panel(page).getByRole("button", { name: "关闭画布总览", exact: true });
    expect((await closeButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    const initial = await view(page), point = await centerPoint(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x + 24, y: point.y - 18, id: 1 }] });
    await expect.poll(async () => (await view(page)).x).not.toBe(initial.x);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect.poll(() => view(page)).toEqual(initial);
    await mkdir("output/playwright/canvas-overview", { recursive: true });
    await page.screenshot({ path: `output/playwright/canvas-overview/touch-${height}.png` });
    await closeButton.tap(); await expect(zhiya(page)).toHaveAttribute("data-active", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
  });
});
