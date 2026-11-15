import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { prepareZhiya, loadZhiya } from "./zhiya-fixture";
import { useCanvasPhotograph } from "./canvas-photo-fixture";

async function prepare(page: Page, width = 1440) {
  const state = await prepareZhiya(page, { count: 2, realClock: true, viewport: { width, height: width < 700 ? 844 : 900 } });
  await useCanvasPhotograph(page); await loadZhiya(page);
  const box = await page.getByRole("group", { name: "通勤外套 1", exact: true }).boundingBox();
  if (!box) throw new Error("图片不可见");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("region", { name: "图片创作框" })).toBeVisible();
  return state;
}

for (const width of [1440, 1280, 390, 320]) test(`${width}px 图上分组工具、图下创作框与纯图标常驻入口`, async ({ page }) => {
  const state = await prepare(page, width);
  const composer = page.getByRole("region", { name: "图片创作框" });
  await composer.getByRole("textbox", { name: "本次创作要求" }).fill("保留图1的版型，改为墨绿色羊毛面料");
  for (const button of [page.getByRole("button", { name: "全部功能模块", exact: true }), page.getByRole("switch", { name: "显示连接关系" })]) {
    await expect(button).toHaveText(""); await expect(button.locator("svg")).toHaveCount(1);
  }
  await expect(composer.getByRole("button", { name: "生成", exact: true })).toHaveText("");
  await mkdir("output/canvas-toolbar", { recursive: true });
  await page.screenshot({ path: `output/canvas-toolbar/selected-${width}.png`, animations: "disabled" });
  await page.getByRole("complementary", { name: "工具条", exact: true }).screenshot({ path: `output/canvas-toolbar/bottom-${width}.png`, animations: "disabled" });
  await composer.getByRole("button", { name: "生成参数" }).click();
  await expect(composer.getByLabel("画面比例")).toBeVisible();
  await expect(composer.getByLabel("画面比例")).toBeInViewport();
  await expect(composer.getByLabel("数量")).toBeInViewport();
  await page.screenshot({ path: `output/canvas-toolbar/settings-${width}.png`, animations: "disabled" });
  await composer.getByLabel("画面比例").press("Escape");
  await expect(composer.getByRole("button", { name: "生成参数" })).toBeFocused();
  await composer.getByRole("button", { name: "展开创作框" }).click();
  await expect(composer).toHaveAttribute("data-expanded", "true");
  await expect(composer.getByRole("textbox")).toHaveValue("保留图1的版型，改为墨绿色羊毛面料");
  await composer.getByRole("button", { name: "收起创作框" }).click();
  await expect(composer).toHaveAttribute("data-expanded", "false");
  if (process.env.CANVAS_CLIP_AUDIT_SCRIPT) {
    const source = await readFile(process.env.CANVAS_CLIP_AUDIT_SCRIPT, "utf8");
    const audit = await page.evaluate(`(${source})({ root: '[aria-label="无限白板"]', max: 200, hover: true })`) as { issues: { el: string; level: string }[] };
    await writeFile(`output/canvas-toolbar/clip-${width}.json`, JSON.stringify(audit, null, 2));
    expect(audit.issues.filter(item => item.level === "cut" && /composer|imageToolbar/.test(item.el))).toEqual([]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

test("图标提示支持悬停快速切换、键盘立即显示与Escape关闭", async ({ page }) => {
  await prepare(page);
  const toolbar = page.getByRole("toolbar", { name: "常用图片工具" });
  await toolbar.getByRole("button", { name: "局部重绘", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("局部重绘");
  await toolbar.getByRole("button", { name: "擦除", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("擦除", { timeout: 300 });
  await page.screenshot({ path: "output/canvas-toolbar/warm-tooltip.png", animations: "disabled" });
  await page.keyboard.press("Escape"); await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.mouse.move(900, 700);
  const functions = page.getByRole("button", { name: "全部功能模块", exact: true });
  await functions.focus();
  await expect(page.getByRole("tooltip")).toHaveText("全部功能模块");
  await expect(functions).toHaveAttribute("aria-describedby", /.+/);
  await page.keyboard.press("Escape"); await expect(page.getByRole("tooltip")).toHaveCount(0);
  await functions.press("Enter");
  await expect(page.getByRole("dialog", { name: "全部功能模块", exact: true })).toBeVisible();
});

test("减弱动态和边缘提示保持可见，空画布入口也使用图标", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepareZhiya(page, { count: 0, realClock: true, viewport: { width: 390, height: 844 } });
  await loadZhiya(page);
  const welcome = page.getByRole("region", { name: "开始创作" });
  await expect(welcome.getByRole("button", { name: "上传参考图", exact: true })).toHaveText("");
  await page.getByRole("button", { name: "全部功能模块", exact: true }).focus();
  const tooltip = page.getByRole("tooltip"); await expect(tooltip).toHaveText("全部功能模块");
  const box = await tooltip.boundingBox();
  expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844).toBe(true);
  await page.screenshot({ path: "output/canvas-toolbar/empty-mobile-reduced.png", animations: "disabled" });
  await page.keyboard.press("Escape"); await expect(tooltip).toHaveCount(0);
});

test.describe("触屏图标说明", () => {
  test.use({ hasTouch: true });
  test("长按松手保留提示，不执行；下一次轻触正常打开功能目录", async ({ page }) => {
    await prepare(page, 390);
    const button = page.getByRole("button", { name: "全部功能模块", exact: true });
    const box = await button.boundingBox(); if (!box) throw new Error("功能入口不可见");
    const session = await page.context().newCDPSession(page);
    const touchPoints = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
    await expect(page.getByRole("tooltip")).toHaveText("全部功能模块");
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    // The old unconditional pointerleave dismissed at80ms after native touchend.
    await page.waitForTimeout(250);
    await expect(page.getByRole("tooltip")).toHaveText("全部功能模块");
    await expect(page.getByRole("dialog", { name: "全部功能模块", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "output/canvas-toolbar/touch-tooltip-390.png", animations: "disabled" });
    await button.tap();
    await expect(page.getByRole("dialog", { name: "全部功能模块", exact: true })).toBeVisible();
    await session.detach();
  });
});
