import { openCanvasFunction } from "./canvas-function-navigation";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepareImageComparison } from "./image-comparison-fixture";
import { openZhiya, prepareZhiya, loadZhiya, zhiya } from "./zhiya-fixture";
import { PROJECT } from "../visual/fixtures";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";

test.setTimeout(60_000);
const history = (page: Page) => page.getByRole("dialog", { name: "对象历史", exact: true });
const objects = (page: Page) => page.getByRole("region", { name: "画布对象", exact: true });
const openObjects = async (page: Page) => { await openCanvasFunction(page, "画布对象"); await expect(objects(page)).toBeVisible(); };
async function pathFixture(page: Page) {
  await page.route("**/api/design-assets/*/path", route => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    return route.fulfill({ json: { assetId: id, incomplete: false, decisions: [], steps: [{ id: "original-step", version: 1, actor: "agent", tool: "t2i", intent: "原来的藏蓝外套", sources: [], constraints: { palette: [], notes: ["保留藏蓝色和宽松廓形"], avoidLabels: [], fabricTerms: [] }, parameters: {}, createdAt: "2026-11-08T12:00:00.000Z", status: "succeeded", snapshotAvailable: true, conversationId: null, outputs: [{ id, url: `/api/design-assets/${id}/content`, thumbnailUrl: null, parentAssetId: null }] }] } });
  });
}

test("从所选图片浏览历史、比较和路径，保留画布及聊天草稿", async ({ page }) => {
  const state = await prepareImageComparison(page); await pathFixture(page); await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("先查看这件衣服的修改来源");
  await input.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(2, 4));
  const instance = await input.elementHandle();
  const image = page.getByRole("group", { name: "藏蓝通勤外套", exact: true });
  const box = await image.boundingBox(); if (!box) throw new Error("图片不可见");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const before = await image.boundingBox();
  await openObjects(page);
  const trigger = objects(page).getByRole("button", { name: "查看 藏蓝通勤外套 的历史", exact: true });
  await trigger.click();
  await expect(history(page)).toBeVisible();
  await expect(history(page).getByRole("button", { name: "恢复此版" })).toHaveCount(0);
  await history(page).getByRole("button", { name: "加载更多版本" }).click();
  await expect(history(page)).toContainText("已显示完整资产链");
  await history(page).getByRole("button", { name: "对比当前版本", exact: true }).first().click();
  const compare = history(page).getByRole("region", { name: "对比历史版本", exact: true });
  await expect(compare).toBeVisible();
  await expect(compare.getByRole("button", { name: "恢复为新版本" })).toHaveCount(0);
  const panes = await compare.getByLabel("图片查看区域", { exact: true }).evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(panes).toHaveLength(2); expect(panes[0]).toBe(panes[1]);
  await compare.getByRole("button", { name: "返回版本历史", exact: true }).first().press("Escape");
  await expect(history(page)).toBeVisible();
  await expect(history(page).getByRole("region", { name: "版本时间线" })).toBeVisible();
  await history(page).getByRole("button", { name: "设计路径", exact: true }).click();
  await expect(history(page)).toContainText("保留藏蓝色和宽松廓形");
  await expect(history(page).getByRole("button", { name: "选定此方案" })).toHaveCount(0);
  await history(page).getByRole("button", { name: "关闭对象历史" }).click();
  await expect(trigger).toBeFocused();
  expect(await image.boundingBox()).toEqual(before);
  await expect(input).toHaveValue("先查看这件衣服的修改来源");
  expect(await instance?.evaluate(element => element.isConnected)).toBe(true);
  expect(await input.evaluate((input: HTMLTextAreaElement) => [input.selectionStart, input.selectionEnd])).toEqual([2, 4]);
  expect(state.mutations).toEqual([]); expect(state.restores).toEqual([]); expect(state.errors).toEqual([]);
});

test("隐藏锁定图片仍能读历史，关闭返回原目录及查询", async ({ page }) => {
  const state = await prepareImageComparison(page);
  await openObjects(page);
  const row = objects(page).locator('[data-canvas-object-id="shape:canvas-look-a"]');
  await row.getByRole("button", { name: /^隐藏/ }).click();
  await row.getByRole("button", { name: /^锁定/ }).click();
  await objects(page).getByRole("searchbox").fill("藏蓝");
  const trigger = row.getByRole("button", { name: "查看 藏蓝通勤外套 的历史", exact: true });
  await trigger.click();
  await expect(history(page).getByRole("region", { name: "版本时间线" })).toBeVisible();
  await expect(zhiya(page)).toHaveAttribute("data-active", "false");
  await history(page).getByRole("button", { name: "关闭对象历史" }).press("Escape");
  await expect(history(page)).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(row).toHaveAttribute("data-hidden", "true"); await expect(row).toHaveAttribute("data-locked", "true");
  await expect(objects(page).getByRole("searchbox")).toHaveValue("藏蓝");
  expect(state.restores).toEqual([]); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("由对象历史进入原图片工作区，恢复后编辑新产物", async ({ page }) => {
  const state = await prepareImageComparison(page);
  await openObjects(page);
  await objects(page).getByRole("button", { name: "查看 藏蓝通勤外套 的历史", exact: true }).click();
  await history(page).getByRole("button", { name: "在图片工作区恢复版本", exact: true }).click();
  await expect(history(page)).toHaveCount(0);
  const workspace = page.getByRole("dialog", { name: "图片工作区", exact: true }).filter({ visible: true });
  await expect(workspace.getByRole("region", { name: "版本时间线" })).toBeVisible();
  expect(state.restores).toEqual([]);
  await workspace.getByRole("button", { name: "恢复此版", exact: true }).click();
  await expect.poll(() => state.restores.length).toBe(1); await expect.poll(() => state.imports.length).toBe(1);
  await expect(workspace.getByRole("img", { name: "恢复的版本", exact: true })).toBeVisible();
  expect(state.restores[0]).toMatchObject({ target: "historic", currentAssetId: "look-a" });
  expect(state.imports[0]).toMatchObject({ sourceNodeId: "look-a", assetId: "restored-1" });
  expect(state.errors).toEqual([]);
});

test("只读画布可比较历史，不能进入恢复操作", async ({ page }) => {
  const state = await prepareZhiya(page, { canEdit: false, realClock: true });
  await page.route("**/api/design-assets/*/versions?*", route => route.fulfill({ json: { items: [{ id: "look-0", operation: "generated", createdAt: "2026-11-10T00:00:00Z", url: "/visual-garment.svg" }, { id: "old", operation: "transform", createdAt: "2026-11-09T00:00:00Z", url: "/visual-garment.svg" }], nextCursor: null } }));
  await loadZhiya(page); await openObjects(page);
  await objects(page).getByRole("button", { name: "查看 通勤外套 1 的历史", exact: true }).click();
  await expect(history(page).getByRole("button", { name: "在图片工作区恢复版本" })).toHaveCount(0);
  await history(page).getByRole("button", { name: "对比当前版本" }).click();
  await expect(history(page).getByRole("region", { name: "对比历史版本" })).toBeVisible();
  await expect(history(page).getByRole("button", { name: /恢复为新版本|恢复此版/ })).toHaveCount(0);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("320px历史、比较和来源完整可达，没有横向溢出", async ({ page }) => {
  const state = await prepareImageComparison(page, 320, 568); await pathFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openObjects(page);
  await objects(page).getByRole("button", { name: "查看 藏蓝通勤外套 的历史", exact: true }).click();
  await expect(history(page).getByRole("button", { name: "对比当前版本" })).toBeVisible();
  await mkdir("output/playwright/canvas-object-history", { recursive: true });
  await page.screenshot({ path: "output/playwright/canvas-object-history/history-320.png" });
  await history(page).getByRole("button", { name: "对比当前版本" }).click();
  await expect(history(page).getByRole("button", { name: "历史版本", exact: true })).toBeVisible();
  const noOverflow = async () => history(page).evaluate(element => [...element.querySelectorAll<HTMLElement>("*")].filter(node => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 2 && getComputedStyle(node).overflowX === "visible").map(node => node.tagName));
  expect(await noOverflow()).toEqual([]);
  await page.screenshot({ path: "output/playwright/canvas-object-history/compare-320.png" });
  await history(page).getByRole("button", { name: "返回版本历史", exact: true }).first().click();
  await history(page).getByRole("button", { name: "设计路径", exact: true }).click();
  await expect(history(page)).toContainText("保留藏蓝色和宽松廓形");
  expect(await noOverflow()).toEqual([]);
  await expect(history(page).getByRole("button", { name: "关闭对象历史" })).toBeInViewport({ ratio: 1 });
  await history(page).getByRole("button", { name: "关闭对象历史" }).click();
  await expect(objects(page)).toBeVisible();
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("历史读取失败可以重试，关闭取消在途读取", async ({ page }) => {
  const state = await prepareImageComparison(page); state.setHistoryFailure(true);
  await openObjects(page);
  const trigger = objects(page).getByRole("button", { name: "查看 藏蓝通勤外套 的历史", exact: true });
  await trigger.click();
  await expect(history(page).getByRole("alert")).toContainText("暂时读不到版本历史");
  state.setHistoryFailure(false);
  await history(page).getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(history(page).getByRole("button", { name: "加载更多版本" })).toBeVisible();
  await history(page).getByRole("button", { name: "关闭对象历史" }).click();
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; }); let started = false;
  await page.route("**/api/design-assets/*/versions?*", async route => { started = true; await hold; await route.fulfill({ json: { items: [], nextCursor: null } }).catch(() => {}); });
  const canceled: string[] = []; page.on("requestfailed", request => { if (request.url().includes("/versions?")) canceled.push(request.url()); });
  await trigger.click(); await expect.poll(() => started).toBe(true);
  await history(page).getByRole("button", { name: "关闭对象历史" }).click();
  await expect.poll(() => canceled.length).toBeGreaterThan(0); release();
  await expect(history(page)).toHaveCount(0);
  expect(state.restores).toEqual([]); expect(state.errors).toEqual([]);
});

test("账号切换关闭旧历史并重新读取，不复用上一账号内容", async ({ page }) => {
  const state = await prepareImageComparison(page);
  await openObjects(page);
  await objects(page).getByRole("button", { name: "查看 藏蓝通勤外套 的历史", exact: true }).click();
  await expect(history(page)).toContainText("局部重绘");
  await page.route("**/api/me", route => route.fulfill({ json: { user: { id: "history-other-user", email: "history-other@example.test", name: "另一位设计师" }, credits: { limit: 600, used: 0, remaining: 600 } } }));
  await seedReturningFeatureGuideUser(page, ["history-other-user"]);
  let calls = 0;
  await page.route("**/api/design-assets/*/versions?*", route => { calls++; return route.fulfill({ json: { items: [], nextCursor: null } }); });
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "fashion:session-change", newValue: "history-account-change" })));
  await expect(history(page)).toHaveCount(0);
  await openObjects(page);
  await objects(page).getByRole("button", { name: "查看 藏蓝通勤外套 的历史", exact: true }).click();
  await expect(history(page)).toContainText("尚无可展示的版本");
  expect(calls).toBeGreaterThan(0);
  await expect(history(page).getByText("局部重绘", { exact: true })).toHaveCount(0);
  expect(state.restores).toEqual([]); expect(state.errors).toEqual([]);
});

test("版本关联变化时不恢复到另一张图，保留可查阅的旧历史", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await page.route("**/api/design-assets/*/versions?*", route => route.fulfill({ json: { items: [{ id: "look-0", operation: "generated", createdAt: "2026-11-10T00:00:00Z", url: "/visual-garment.svg" }], nextCursor: null } }));
  await loadZhiya(page); await openObjects(page);
  await objects(page).getByRole("button", { name: "查看 通勤外套 1 的历史", exact: true }).click();
  const first = state.graph.nodes[0]; if (!first) throw new Error("Missing canvas node");
  first.payload = { ...first.payload, assetId: "changed-asset" };
  (state.graph as { revision: number }).revision++;
  await expect.poll(() => page.locator('.tl-shape[data-shape-id="shape:canvas-material-0"]').count()).toBe(1);
  const refreshed = page.waitForResponse(response => response.url().includes(`/api/projects/${PROJECT}/workflow`) && !response.url().includes("/tools"));
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await refreshed;
  await history(page).getByRole("button", { name: "在图片工作区恢复版本" }).click();
  await expect(history(page).getByRole("status")).toContainText("画布关联已变化");
  await expect(history(page)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "图片工作区", exact: true })).toHaveCount(0);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("历史入口复用已打开的图片编辑器，保留未提交方向草稿", async ({ page }) => {
  const state = await prepareImageComparison(page); await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区", exact: true }).filter({ visible: true });
  await workspace.getByRole("button", { name: "旋转与翻转", exact: true }).click();
  await workspace.getByRole("button", { name: "向右旋转 90 度" }).click();
  const instance = await workspace.elementHandle();
  await workspace.getByRole("button", { name: "关闭图片工作区", exact: true }).click();
  await openObjects(page);
  await objects(page).getByRole("button", { name: "查看 藏蓝通勤外套 的历史", exact: true }).click();
  await history(page).getByRole("button", { name: "在图片工作区恢复版本" }).click();
  await expect(workspace.getByRole("region", { name: "版本时间线" })).toBeVisible();
  expect(await instance?.evaluate(element => element.isConnected)).toBe(true);
  await workspace.getByRole("button", { name: "返回图片", exact: false }).first().click();
  await workspace.getByRole("button", { name: "旋转与翻转", exact: true }).click();
  await expect(workspace.getByRole("spinbutton", { name: "旋转角度", exact: true })).toHaveValue("90");
  expect(state.commands).toEqual([]); expect(state.restores).toEqual([]); expect(state.errors).toEqual([]);
});
