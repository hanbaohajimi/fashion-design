import { openCanvasFunction } from "./canvas-function-navigation";
import { mkdir, readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { CanvasSave } from "../../packages/shared/src/canvas-workspace";
import { canvasAction } from "./canvas-workspace-controls";
import { loadZhiya, prepareZhiya } from "./zhiya-fixture";
import { PROJECT } from "../visual/fixtures";

test.setTimeout(60_000);
const panel = (page: Page) => page.getByRole("region", { name: "画布对象", exact: true });
const row = (page: Page, index: number) => panel(page).locator(`[data-canvas-object-id="shape:canvas-material-${index}"]`);
const shape = (page: Page, index: number) => page.locator(`.tl-shape[data-shape-id="shape:canvas-material-${index}"]`);
const open = async (page: Page) => { await openCanvasFunction(page, "画布对象"); await expect(panel(page)).toBeVisible(); };
const close = async (page: Page) => { await panel(page).getByRole("button", { name: "关闭画布对象" }).click(); };
const hide = async (page: Page, index: number) => { await row(page, index).getByRole("button", { name: /^隐藏/ }).click(); };
const show = async (page: Page, index: number) => { await row(page, index).getByRole("button", { name: /^显示/ }).click(); };
type SavedShape = { id: string; typeName: string; type: string; x: number; y: number; parentId: string; isLocked: boolean; meta: { canvasHidden?: boolean }; props: Record<string, unknown> };
const records = (save?: CanvasSave): SavedShape[] => Object.values((save?.snapshot as { document?: { store: Record<string, SavedShape> } })?.document?.store ?? {}).filter(record => record.typeName === "shape");
const saved = (saves: CanvasSave[], index: number) => records(saves.at(-1)).find(record => record.id === `shape:canvas-material-${index}`);

async function groupFirstTwo(page: Page) {
  await open(page);
  await row(page, 0).getByRole("button", { name: /^选择/ }).click();
  await row(page, 1).getByRole("button", { name: /^选择/ }).click({ modifiers: ["Shift"] });
  await close(page);
  await page.getByRole("button", { name: "分组", exact: true }).click();
  await open(page);
}

test("隐藏清除选择、退出命中且独立撤销，刷新可恢复原位置", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  const before = await shape(page, 0).boundingBox();
  const neighborBefore = await shape(page, 1).boundingBox();
  if (!before) throw new Error("测试对象没有呈现");
  if (!neighborBefore) throw new Error("相邻对象没有呈现");
  await open(page);
  await row(page, 0).getByRole("button", { name: /^选择/ }).click();
  await hide(page, 0);
  await expect(row(page, 0)).toHaveAttribute("data-selected", "false");
  await expect(row(page, 0).getByRole("button", { name: /^选择/ })).toBeDisabled();
  await expect(shape(page, 0)).toHaveCount(0);
  await close(page);
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 20, before.y + before.height / 2 + 10); await page.mouse.up();
  await page.keyboard.press("Delete");
  await open(page);
  await expect(panel(page)).toContainText("选择对象以调整");
  await expect(panel(page).locator("[data-canvas-object-id]")).toHaveCount(3);
  await canvasAction(page, "撤销白板操作");
  await expect(shape(page, 0)).toBeVisible();
  await canvasAction(page, "重做白板操作");
  await expect(shape(page, 0)).toHaveCount(0);
  await expect.poll(() => saved(state.saves, 0)?.meta.canvasHidden).toBe(true);
  const hidden = saved(state.saves, 0);
  await page.reload(); await open(page);
  await expect(row(page, 0)).toHaveAttribute("data-hidden", "true");
  await panel(page).getByRole("searchbox").fill("通勤外套 1");
  await expect(row(page, 0)).toBeVisible();
  await show(page, 0);
  await expect(shape(page, 0)).toBeVisible();
  await expect.poll(() => saved(state.saves, 0)?.meta.canvasHidden).toBe(false);
  expect(saved(state.saves, 0)).toMatchObject({ x: hidden?.x, y: hidden?.y });
  const restored = await shape(page, 0).boundingBox(), neighborRestored = await shape(page, 1).boundingBox();
  if (!restored || !neighborRestored) throw new Error("恢复后对象没有呈现");
  expect(restored.width).toBe(before.width);
  expect(restored.height).toBe(before.height);
  expect(restored.x - neighborRestored.x).toBeCloseTo(before.x - neighborBefore.x, 1);
  expect(restored.y - neighborRestored.y).toBeCloseTo(before.y - neighborBefore.y, 1);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("分组继承显隐，子级独立隐藏保留，锁定不阻止显隐", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page); await groupFirstTwo(page);
  // Hiding a child clears its selected ancestor as well as a direct selection.
  await hide(page, 0);
  await expect(panel(page)).toContainText("选择对象以调整");
  await panel(page).getByRole("button", { name: "锁定 分组", exact: true }).click();
  await panel(page).getByRole("button", { name: "隐藏 分组", exact: true }).click();
  await expect(shape(page, 1)).toHaveCount(0);
  for (const index of [0, 1]) {
    await expect(row(page, index)).toHaveAttribute("data-hidden", "true");
    await expect(row(page, index).getByRole("button", { name: /随父级隐藏/ })).toBeDisabled();
  }
  await panel(page).getByRole("button", { name: "显示 分组", exact: true }).click();
  await expect(shape(page, 1)).toBeVisible();
  await expect(shape(page, 0)).toHaveCount(0);
  await expect(row(page, 1)).toHaveAttribute("data-locked", "true");
  await show(page, 0);
  await expect(shape(page, 0)).toBeVisible();
  await expect(row(page, 0)).toHaveAttribute("data-locked", "true");
  await expect.poll(() => saved(state.saves, 0)?.meta.canvasHidden).toBe(false);
  expect(records(state.saves.at(-1)).find(record => record.type === "group")?.isLocked).toBe(true);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("键盘全选和删除跳过隐藏对象，撤销与恢复显示仍可用", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page); await open(page); await hide(page, 0); await close(page);
  await page.getByLabel("无限白板", { exact: true }).click({ position: { x: 1100, y: 700 } });
  await page.keyboard.press("Control+a");
  await open(page);
  await expect(row(page, 0)).toHaveAttribute("data-selected", "false");
  for (const index of [1, 2]) await expect(row(page, index)).toHaveAttribute("data-selected", "true");
  await close(page);
  await page.keyboard.press("Delete");
  await open(page);
  await expect(panel(page).locator("[data-canvas-object-id]")).toHaveCount(1);
  await expect(row(page, 0)).toHaveAttribute("data-hidden", "true");
  await canvasAction(page, "撤销白板操作");
  await expect(panel(page).locator("[data-canvas-object-id]")).toHaveCount(3);
  await show(page, 0); await expect(shape(page, 0)).toBeVisible();
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("定位分组和查看全图只按可见内容取景，隐藏子级不占空白", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 2 });
  await loadZhiya(page); await groupFirstTwo(page); await hide(page, 0);
  await panel(page).getByRole("button", { name: "选择 分组", exact: true }).click();
  await panel(page).getByRole("button", { name: "定位所选对象" }).click();
  const groupView = await shape(page, 1).boundingBox();
  await row(page, 1).getByRole("button", { name: /^选择/ }).click();
  await panel(page).getByRole("button", { name: "定位所选对象" }).click();
  expect(await shape(page, 1).boundingBox()).toEqual(groupView);
  await close(page); await canvasAction(page, "查看全图");
  const canvas = await page.getByLabel("无限白板", { exact: true }).boundingBox();
  const visible = await shape(page, 1).boundingBox();
  if (!canvas || !visible) throw new Error("可见对象没有呈现");
  expect(visible.x + visible.width / 2).toBeCloseTo(canvas.x + canvas.width / 2, 0);
  expect(visible.y + visible.height / 2).toBeCloseTo(canvas.y + canvas.height / 2, 0);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("分组引用跳过隐藏内容，已明确添加的引用不受显隐影响", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page); await groupFirstTwo(page); await hide(page, 0);
  await panel(page).getByRole("button", { name: "选择 分组", exact: true }).click();
  await close(page);
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  const discussion = page.getByLabel("正在讨论", { exact: true });
  await expect(discussion.getByRole("button", { name: /移除引用/ })).toHaveCount(1);
  await expect(discussion.getByRole("button", { name: "移除引用 通勤外套 2", exact: true })).toBeVisible();
  await open(page); await hide(page, 1); await close(page);
  await expect(discussion.getByRole("button", { name: /移除引用/ })).toHaveCount(1);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("隐藏素材收到新版本保留显隐，外部链接打开详情且不显示对象", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page); await open(page); await hide(page, 0);
  await expect.poll(() => saved(state.saves, 0)?.meta.canvasHidden).toBe(true);
  const node = state.graph.nodes[0];
  if (!node) throw new Error("测试素材缺失");
  node.title = "更新后的隐蔽外套";
  node.payload.imageUrl = "/visual-garment.svg?version=2";
  state.graph.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(row(page, 0)).toContainText("更新后的隐蔽外套");
  await expect(row(page, 0)).toHaveAttribute("data-hidden", "true");
  // Authoritative material updates are projected without writing another layout snapshot.
  expect(saved(state.saves, 0)?.meta.canvasHidden).toBe(true);
  await page.goto(`/${PROJECT}?nodeId=material-0`);
  await expect(page.getByRole("button", { name: "关闭图片工作区", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭图片工作区", exact: true }).click();
  await open(page);
  await expect(row(page, 0)).toContainText("更新后的隐蔽外套");
  await expect(row(page, 0)).toHaveAttribute("data-hidden", "true");
  await expect(shape(page, 0)).toHaveCount(0);
  await show(page, 0);
  await expect(shape(page, 0).locator("img")).toHaveAttribute("src", "/visual-garment.svg?version=2");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

async function exportPixels(page: Page, name: string) {

  const waiting = page.waitForEvent("download");
  await openCanvasFunction(page, "导出画布 PNG");
  const download = await waiting;
  await mkdir("output/playwright/canvas-visibility", { recursive: true });
  const path = `output/playwright/canvas-visibility/${name}.png`;
  await download.saveAs(path);
  const data = (await readFile(path)).toString("base64");
  return page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取导出图片的像素");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = { red: 0, green: 0, blue: 0 };
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i] ?? 0, green = pixels[i + 1] ?? 0, blue = pixels[i + 2] ?? 0;
      if (red > 245 && green < 10 && blue < 10) counts.red++;
      if (red < 10 && green > 245 && blue < 10) counts.green++;
      if (red < 10 && green < 10 && blue > 245) counts.blue++;
    }
    return { width: canvas.width, height: canvas.height, ...counts };
  }, data);
}

test("下载的 PNG 排除隐藏对象与分组后代，空画布不下载", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  const colors = ["#ff0000", "#00ff00", "#0000ff"];
  for (const [index, node] of state.graph.nodes.entries()) node.payload.imageUrl = `/visibility-${index}.svg`;
  await page.route(/\/visibility-(\d)\.svg$/, route => {
    const index = Number(route.request().url().match(/visibility-(\d)/)?.[1]);
    return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${colors[index]}"/></svg>` });
  });
  await loadZhiya(page);
  const full = await exportPixels(page, "all-visible");
  for (const color of ["red", "green", "blue"] as const) expect(full[color]).toBeGreaterThan(1000);
  // A second export remounts the material shell; neither export may capture its entry fade.
  const repeated = await exportPixels(page, "all-visible-again");
  for (const color of ["red", "green", "blue"] as const) expect(repeated[color]).toBe(full[color]);
  await open(page); await row(page, 0).getByRole("button", { name: /^选择/ }).click(); await close(page);
  await expect(page.getByRole("toolbar", { name: "常用图片工具", exact: true }).getByRole("button", { name: "局部重绘", exact: true })).toBeVisible();
  await exportPixels(page, "selected-image");
  // Selection controls belong to the workspace and must not change the exported artwork.
  expect(await readFile("output/playwright/canvas-visibility/selected-image.png")).toEqual(
    await readFile("output/playwright/canvas-visibility/all-visible.png"),
  );
  await groupFirstTwo(page);
  await hide(page, 0); await hide(page, 2); await close(page);
  const single = await exportPixels(page, "one-visible-child");
  expect(single.red).toBe(0); expect(single.blue).toBe(0); expect(single.green).toBeGreaterThan(1000);
  // Invisible descendants must not leave a group-sized blank area in the export.
  expect(single.width).toBeLessThan(full.width * 0.6);
  await open(page); await show(page, 2);
  await panel(page).getByRole("button", { name: "隐藏 分组", exact: true }).click(); await close(page);
  const outside = await exportPixels(page, "hidden-group");
  expect(outside.red).toBe(0); expect(outside.green).toBe(0); expect(outside.blue).toBeGreaterThan(1000);
  expect(outside.width).toBe(single.width);
  await open(page); await hide(page, 2); await close(page);
  let downloads = 0; page.on("download", () => downloads++);

  await openCanvasFunction(page, "导出画布 PNG");
  await expect(page.getByRole("alert").filter({ hasText: "当前没有可导出的可见对象" })).toBeVisible();
  expect(downloads).toBe(0);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("分组内全部对象独立隐藏后，全图不跳动且不导出空白 PNG", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 2 });
  await loadZhiya(page); await groupFirstTwo(page);
  await hide(page, 0); await hide(page, 1); await close(page);
  await canvasAction(page, "查看全图");
  let downloads = 0; page.on("download", () => downloads++);

  await openCanvasFunction(page, "导出画布 PNG");
  await expect(page.getByRole("alert").filter({ hasText: "当前没有可导出的可见对象" })).toBeVisible();
  expect(downloads).toBe(0);
  await open(page); await show(page, 0); await expect(shape(page, 0)).toBeVisible();
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});
