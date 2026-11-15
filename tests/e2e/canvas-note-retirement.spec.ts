import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { prepareZhiya, loadZhiya } from "./zhiya-fixture";
import { useCanvasPhotograph } from "./canvas-photo-fixture";

for (const width of [1440, 390]) test(`${width}px 便签退役与画布管理入口`, async ({ page }) => {
  const state = await prepareZhiya(page, { count: 2, realClock: true, viewport: { width, height: width < 700 ? 844 : 900 } });
  state.setCanvasSnapshot({ legacyRecords: [{ id: "shape:retired-note", typeName: "shape", type: "fashion-note", x: 0, y: 0, props: { w: 260, h: 210, text: "不应恢复的旧便签", role: "note", tone: "#ff0000" } }] });
  await useCanvasPhotograph(page); await loadZhiya(page);
  await expect(page.getByRole("button", { name: "添加灵感便签", exact: true })).toHaveCount(0);
  await expect(page.getByText("不应恢复的旧便签", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "画布对象", exact: true })).toHaveCount(0);
  const functions = page.getByRole("button", { name: "全部功能模块", exact: true });
  await functions.click();
  const catalog = page.getByRole("dialog", { name: "全部功能模块", exact: true });
  await catalog.getByRole("button", { name: "画布管理", exact: true }).click();
  await mkdir("output/add-nodes", { recursive: true });
  await page.screenshot({ path: `output/add-nodes/management-${width}.png`, animations: "disabled" });
  await catalog.getByRole("button", { name: /^画布对象/ }).click();
  const objects = page.getByRole("region", { name: "画布对象", exact: true }); await expect(objects).toBeVisible();
  await objects.getByRole("button", { name: "关闭画布对象" }).click();
  await expect(functions).toBeFocused();
  await page.reload();
  await expect(page.getByText("不应恢复的旧便签", { exact: true })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
