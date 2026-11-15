import { mkdir } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import { prepareImageOrientation } from "./image-orientation-fixture";
import { prepareImageComparison } from "./image-comparison-fixture";

const output = "output/image-workspace-actions";
async function boundsFor(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("图片或查看区域不可见");
  return bounds;
}
test.beforeAll(async () => { await mkdir(output, { recursive: true }); });

for (const width of [1440, 320]) test(`${width}px 精简菜单下载、分享和键盘复位`, async ({ page }) => {
  const state = await prepareImageOrientation(page, width);
  let created = 0;
  let revoked = false;
  await page.route("**/api/design-assets/*/shares**", route => {
    if (route.request().method() === "POST") { created++; return route.fulfill({ json: { path: "/share/test-link" } }); }
    if (route.request().method() === "DELETE") { revoked = true; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: created ? [{ id: "share-a", expiresAt: "2099-01-01T00:00:00Z", revokedAt: revoked ? "2026-11-15T00:00:00Z" : null }] : [] });
  });
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区", exact: true });
  const view = workspace.getByLabel("图片查看区域", { exact: true });
  await expect(workspace.getByLabel("缩放比例", { exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: /适合窗口/ })).toHaveCount(0);
  await expect(workspace.getByRole("link", { name: /款式|试穿|衣架/ })).toHaveCount(0);
  await workspace.screenshot({ path: `${output}/workspace-${width}.png` });
  await workspace.getByRole("button", { name: "版本与对比", exact: true }).click();
  await expect(workspace.getByRole("group", { name: "版本与对比选项" }).getByRole("button")).toHaveText(["版本历史"]);
  await page.keyboard.press("Escape");
  await expect(workspace.getByRole("button", { name: "版本与对比", exact: true })).toBeFocused();
  await workspace.getByRole("button", { name: "导出", exact: true }).click();
  const menu = workspace.getByRole("group", { name: "导出选项" });
  await expect(menu.getByRole("button")).toHaveText(["下载图片", "分享链接"]);
  await expect(menu).toBeInViewport({ ratio: 1 });
  await workspace.screenshot({ path: `${output}/download-${width}.png` });
  const downloaded = page.waitForEvent("download");
  await menu.getByRole("button", { name: "下载图片", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("藏蓝通勤外套.png");
  await expect(menu).toBeHidden();
  await workspace.getByRole("button", { name: "导出", exact: true }).click();
  await menu.getByRole("button", { name: "分享链接", exact: true }).click();
  await menu.getByRole("button", { name: "创建只读链接" }).click();
  await expect(menu.getByRole("textbox", { name: "分享链接" })).toHaveValue(/\/share\/test-link$/);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } }));
  await menu.getByRole("button", { name: "复制链接", exact: true }).click();
  await expect(menu.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
  await workspace.screenshot({ path: `${output}/share-${width}.png` });
  await expect(menu.getByRole("button", { name: "复制链接", exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Clipboard denied"); } } }));
  await menu.getByRole("button", { name: "复制链接", exact: true }).click();
  await expect(menu.getByRole("alert")).toContainText("未能复制链接");
  await expect(menu.getByRole("button", { name: "复制链接", exact: true })).toHaveAttribute("data-copied", "false");
  await menu.getByRole("button", { name: "撤销链接" }).click();
  await expect(menu.getByText("已撤销", { exact: true })).toBeVisible();
  await expect(menu.getByRole("textbox", { name: "分享链接" })).toHaveCount(0);
  expect(created).toBe(1);
  expect(revoked).toBe(true);
  await page.keyboard.press("Escape");
  await expect(workspace.getByRole("button", { name: "导出", exact: true })).toBeFocused();
  const picture = view.getByRole("img").first();
  const original = await boundsFor(picture);
  await view.dblclick();
  const detailWidth = await picture.evaluate((element: HTMLImageElement) => element.naturalWidth * 2);
  await expect.poll(async () => (await boundsFor(picture)).width).toBeCloseTo(detailWidth, 0);
  const zoomedWidth = (await boundsFor(picture)).width;
  await workspace.getByRole("button", { name: "添加评论", exact: true }).click();
  await workspace.getByLabel("图片评论").fill("袖口");
  await workspace.getByLabel("图片评论").press("f");
  await expect(workspace.getByLabel("图片评论")).toHaveValue("袖口f");
  expect((await boundsFor(picture)).width).toBeCloseTo(zoomedWidth, 0);
  await workspace.getByRole("button", { name: "收起工具", exact: true }).click();
  await view.press("f");
  await expect.poll(async () => Math.abs((await boundsFor(picture)).width - original.width)).toBeLessThan(1);
  await workspace.getByRole("button", { name: "标注", exact: true }).click();
  await workspace.getByRole("button", { name: "导出", exact: true }).click();
  await expect(menu.getByRole("checkbox", { name: "包含标注" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const box = await boundsFor(view);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30, { steps: 3 });
  await page.mouse.up();
  await workspace.getByRole("button", { name: "导出", exact: true }).click();
  await menu.getByRole("checkbox", { name: "包含标注" }).check();
  const annotated = page.waitForEvent("download");
  await menu.getByRole("button", { name: "下载图片", exact: true }).click();
  expect((await annotated).suggestedFilename()).toBe("藏蓝通勤外套-标注.png");
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("可对比时只保留一个入口，关闭对比返回触发按钮", async ({ page }) => {
  const state = await prepareImageComparison(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区", exact: true });
  const trigger = workspace.getByRole("button", { name: "版本与对比", exact: true });
  await trigger.click();
  await expect(workspace.getByRole("button", { name: "对比图片", exact: true })).toHaveCount(1);
  await workspace.getByRole("button", { name: "对比图片", exact: true }).click();
  await expect(workspace.getByRole("region", { name: "比较方案", exact: true })).toBeVisible();
  await workspace.getByRole("button", { name: "返回图片", exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await workspace.getByRole("button", { name: "版本历史", exact: true }).click();
  await expect(workspace.getByRole("region", { name: "版本时间线" })).toBeVisible();
});

test("分享读取失败可重试，创建失败不显示无效链接", async ({ page }) => {
  const state = await prepareImageOrientation(page);
  let failRead = true;
  await page.route("**/api/design-assets/*/shares", route => route.fulfill(route.request().method() === "POST" ? { status: 503, json: { message: "暂时无法创建分享链接" } } : failRead ? { status: 503, json: { message: "分享读取失败" } } : { json: [] }));
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区", exact: true });
  await workspace.getByRole("button", { name: "导出", exact: true }).click();
  await workspace.getByRole("button", { name: "分享链接", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "创建只读链接" })).toBeDisabled();
  failRead = false;
  await workspace.getByRole("button", { name: "重新读取分享链接" }).click();
  await workspace.getByRole("button", { name: "创建只读链接" }).click();
  await expect(workspace.getByRole("alert")).toContainText("暂时无法创建分享链接");
  await expect(workspace.getByRole("textbox", { name: "分享链接" })).toHaveCount(0);
  expect(state.commands).toHaveLength(0);
});
