import { mkdir } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import sharp from "../../apps/worker/node_modules/sharp";
import { prepareImageOrientation } from "./image-orientation-fixture";

test.setTimeout(90_000);
test.use({ video: process.env.FASHION_MOTION_VIDEO === "1" ? { mode: "on", size: { width: 1440, height: 1100 } } : "off" });
test.beforeEach(async () => { await mkdir("output/playwright/image-adjustments", { recursive: true }); });
const controls = (workspace: Locator) => workspace.getByRole("complementary", { name: "图片工具参数" });
const settings = { brightness: 12, contrast: 20, saturation: -40, warmth: 15 };
async function adjust(panel: Locator) {
  for (const [label, value] of [["亮度", 12], ["对比度", 20], ["饱和度", -40], ["冷暖", 15]] as const) {
    await panel.getByLabel(label, { exact: true }).fill(String(value));
    await panel.getByLabel(label, { exact: true }).press("Enter");
  }
}

for (const [width, height] of [[1440, 1100], [320, 900], [390, 650]] as const) {
  test(`${width}x${height} 色彩预览、原图比较和新版本保存`, async ({ page }) => {
    const state = await prepareImageOrientation(page, width, height);
    const original = Buffer.from(state.assets.get("look-0") ?? []);
    await state.open();
    const workspace = page.getByRole("dialog", { name: "图片工作区" });
    await workspace.getByRole("button", { name: "色彩与明暗", exact: true }).click();
    const panel = controls(workspace);
    await expect(panel.getByRole("button", { name: "保存为新版本" })).toBeDisabled();
    await adjust(panel);
    const picture = workspace.getByAltText("藏蓝通勤外套", { exact: true });
    await expect(picture).toHaveAttribute("data-image-adjustments", JSON.stringify(settings));
    await expect(picture).toHaveCSS("filter", /url/);
    await panel.getByRole("button", { name: "查看原图" }).click();
    await expect(picture).toHaveCSS("filter", "none");
    await expect(panel.getByLabel("饱和度", { exact: true })).toHaveValue("-40");
    await panel.getByRole("button", { name: "返回预览" }).click();
    await panel.getByRole("group", { name: "色彩调整参数" }).evaluate(element => { element.scrollTop = 0; });
    await expect(panel.getByRole("button", { name: "保存为新版本" })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await workspace.screenshot({ path: `output/playwright/image-adjustments/preview-${width}x${height}.png` });
    await panel.getByRole("button", { name: "保存为新版本" }).click();
    await expect.poll(() => state.commands.length).toBe(1);
    expect(state.commands[0]).toMatchObject({ toolKey: "transform_image", parameters: { width: 600, height: 800, adjustments: settings } });
    await expect(workspace.getByRole("button", { name: "查看编辑结果" })).toBeVisible();
    const result = state.assets.get("edited-1");
    expect(result).toBeDefined();
    expect(await sharp(result).metadata()).toMatchObject({ width: 600, height: 800, format: "png" });
    expect(result).not.toEqual(original);
    expect(state.assets.get("look-0")).toEqual(original);
    await workspace.getByRole("button", { name: "色彩与明暗", exact: true }).click();
    await expect(panel.getByLabel("亮度", { exact: true })).toHaveValue("0");
    await expect(panel.getByRole("button", { name: "保存为新版本" })).toBeDisabled();
    expect(state.errors).toEqual([]);
  });
}

test("关闭和刷新恢复颜色参数，复位持久生效，无效数值不能提交", async ({ page }) => {
  const state = await prepareImageOrientation(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace.getByRole("button", { name: "色彩与明暗", exact: true }).click();
  await adjust(controls(workspace));
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await page.reload(); await state.open();
  await expect(workspace.getByRole("button", { name: "色彩与明暗", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(controls(workspace).getByLabel("冷暖", { exact: true })).toHaveValue("15");
  await controls(workspace).getByLabel("亮度", { exact: true }).fill("101");
  await expect(controls(workspace).getByRole("alert")).toContainText("−100 至 100");
  await expect(controls(workspace).getByRole("button", { name: "保存为新版本" })).toBeDisabled();
  await controls(workspace).getByLabel("亮度", { exact: true }).press("Escape");
  await expect(controls(workspace).getByLabel("亮度", { exact: true })).toHaveValue("12");
  await controls(workspace).getByRole("button", { name: "复位", exact: true }).click();
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await page.reload(); await state.open();
  await expect(workspace.getByRole("button", { name: "色彩与明暗", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const label of ["亮度", "对比度", "饱和度", "冷暖"]) await expect(controls(workspace).getByLabel(label, { exact: true })).toHaveValue("0");
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("未确认调色锁定参数，刷新后重试使用同一操作", async ({ page }) => {
  const state = await prepareImageOrientation(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace.getByRole("button", { name: "色彩与明暗", exact: true }).click();
  await adjust(controls(workspace));
  state.failNextSubmission();
  await controls(workspace).getByRole("button", { name: "保存为新版本" }).click();
  await expect(workspace.getByRole("button", { name: "重试原操作" })).toBeVisible();
  await expect(controls(workspace).getByLabel("亮度", { exact: true })).toBeDisabled();
  await page.reload(); await state.open();
  await expect(workspace.getByRole("button", { name: "色彩与明暗", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(controls(workspace).getByLabel("冷暖", { exact: true })).toBeDisabled();
  await workspace.getByRole("button", { name: "重试原操作" }).click();
  await expect.poll(() => state.commands.length).toBe(2);
  expect(state.commands[1]).toEqual(state.commands[0]);
  await expect.poll(() => state.results.size).toBe(1);
  await expect(workspace.getByRole("button", { name: "查看编辑结果" })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("浏览器色彩预览与实际保存的色块一致", async ({ page }) => {
  const state = await prepareImageOrientation(page, 1440, 1100);
  const pixels = Buffer.alloc(600 * 800 * 4);
  const colors = [[60, 100, 140, 255], [160, 60, 80, 255], [200, 210, 220, 255], [20, 40, 60, 255]];
  for (let y = 0; y < 800; y++) for (let x = 0; x < 600; x++) pixels.set(colors[(y >= 400 ? 2 : 0) + (x >= 300 ? 1 : 0)] ?? [], (y * 600 + x) * 4);
  state.assets.set("look-0", await sharp(pixels, { raw: { width: 600, height: 800, channels: 4 } }).png().toBuffer());
  await page.reload();
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace.getByRole("button", { name: "色彩与明暗", exact: true }).click();
  await adjust(controls(workspace));
  const preview = await workspace.getByAltText("藏蓝通勤外套", { exact: true }).screenshot();
  await controls(workspace).getByRole("button", { name: "保存为新版本" }).click();
  await expect.poll(() => state.results.size).toBe(1);
  const output = state.assets.get("edited-1");
  if (!output) throw new Error("未保存颜色调整结果");
  const screen = await sharp(preview).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const saved = await sharp(output).ensureAlpha().raw().toBuffer();
  expect(Math.abs(screen.info.width - 600)).toBeLessThanOrEqual(1);
  expect(Math.abs(screen.info.height - 800)).toBeLessThanOrEqual(1);
  for (const [x = 0, y = 0] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]]) {
    const screenIndex = (Math.round(y * screen.info.height) * screen.info.width + Math.round(x * screen.info.width)) * 4;
    const savedIndex = (Math.round(y * 800) * 600 + Math.round(x * 600)) * 4;
    for (let channel = 0; channel < 3; channel++) expect(Math.abs((screen.data[screenIndex + channel] ?? 0) - (saved[savedIndex + channel] ?? 0))).toBeLessThanOrEqual(2);
  }
});
