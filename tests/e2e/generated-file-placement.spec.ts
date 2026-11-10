import { expect, test, type Page } from "@playwright/test";
import { generatedFilePlacementFixture } from "./generated-file-placement-fixture";
import { loadZhiya, openZhiya } from "./zhiya-fixture";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";

test.setTimeout(60_000);
const panel = (page: Page) => page.getByRole("dialog", { name: "生成文件", exact: true });
const row = (page: Page, id = "asset:result-1") => panel(page).locator(`[data-generated-file-id="${id}"]`);
const open = async (page: Page) => { await page.getByRole("button", { name: "项目菜单", exact: true }).click(); await page.getByRole("button", { name: "生成文件", exact: true }).click(); await expect(panel(page)).toBeVisible(); };
const close = async (page: Page) => panel(page).getByRole("button", { name: "关闭生成文件" }).click();

for (const width of [1440, 320]) test(`${width}px归档历史放回为新版本，保留文件列表并可定位继续编辑`, async ({ page }) => {
  const state = await generatedFilePlacementFixture(page, { width }); await loadZhiya(page); await open(page);
  await row(page).getByRole("button", { name: "以新版本放入画布", exact: true }).click();
  await expect(panel(page).getByRole("button", { name: "查看已放入的图片" })).toBeVisible();
  expect(state.placements).toHaveLength(1); expect(state.placements[0]).toMatchObject({ type: "place_generated_asset", assetId: "result-1", archived: true });
  await expect(panel(page)).toBeVisible(); await expect(row(page)).toContainText("已归档");
  await expect(row(page).getByRole("button", { name: "以新版本放入画布" })).toHaveCount(0);
  await expect(page.getByText("新的设计方案已到达", { exact: true })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "查看已放入的图片" }).click();
  await expect(panel(page)).toHaveCount(0);
  const node = state.getGraph().nodes.find(node => node.payload.assetId === "restored-1"); if (!node) throw new Error("恢复结果不存在");
  const image = page.locator(`[data-canvas-node-id="${node.id}"]`); await expect(image).toBeVisible();
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  const workspace = page.getByRole("dialog", { name: "图片工作区", exact: true });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("img", { name: "已移出画布的初稿", exact: true })).toHaveAttribute("src", "/api/design-assets/restored-1/content");
  expect(state.errors).toEqual([]);
});

test("未归档图片放置不创建新版本，不移动原图和聊天草稿", async ({ page }) => {
  const state = await generatedFilePlacementFixture(page); await loadZhiya(page); await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求" }); await input.fill("保留我的下一条设计需求");
  const handle = await input.elementHandle(), original = page.locator('.tl-shape[data-shape-id="shape:canvas-material-0"]');
  const before = await original.boundingBox();
  await open(page); await row(page, "asset:result-2").getByRole("button", { name: "放入画布", exact: true }).click();
  await expect(panel(page).getByRole("button", { name: "查看已放入的图片" })).toBeVisible();
  await expect(row(page, "asset:result-2").getByRole("button", { name: "放入画布", exact: true })).toHaveCount(0);
  await close(page); expect(await original.boundingBox()).toEqual(before);
  await expect(input).toHaveValue("保留我的下一条设计需求"); expect(await handle?.evaluate(element => element.isConnected)).toBe(true);
  expect(state.getGraph().nodes.filter(node => node.payload.assetId === "result-2")).toHaveLength(1);
  expect(state.placements).toHaveLength(1); expect(state.errors).toEqual([]);
  await page.reload();
  const reloaded = page.locator('[data-canvas-node-id="placed-1"]'); await expect(reloaded).toHaveCount(1);
  await open(page); await expect(panel(page).getByRole("button", { name: "继续确认放置" })).toHaveCount(0);
});

test("已有画布保存失败时不发送放置，草稿留在原处可重试", async ({ page }) => {
  const state = await generatedFilePlacementFixture(page); await loadZhiya(page);
  await page.getByRole("button", { name: "画布对象", exact: true }).click();
  const object = page.getByRole("region", { name: "画布对象", exact: true });
  state.failSave = true;
  await object.getByRole("button", { name: "隐藏 通勤外套 1", exact: true }).click();
  await object.getByRole("button", { name: "关闭画布对象" }).click();
  await open(page); await row(page).getByRole("button", { name: "以新版本放入画布" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("画布保存暂不可用");
  expect(state.placements).toEqual([]);
  state.failSave = false; await row(page).getByRole("button", { name: "以新版本放入画布" }).click();
  await expect(panel(page).getByRole("button", { name: "查看已放入的图片" })).toBeVisible();
  expect(state.placements).toHaveLength(1); expect(state.errors).toEqual([]);
});

test("放置回执丢失后刷新明确续办，编号与位置不变", async ({ page }) => {
  const state = await generatedFilePlacementFixture(page); state.loseResponse = true; await loadZhiya(page); await open(page);
  await row(page).getByRole("button", { name: "以新版本放入画布" }).click();
  await expect(panel(page).getByRole("button", { name: "继续确认放置" })).toBeVisible();
  const first = structuredClone(state.placements[0]);
  await page.reload(); await open(page);
  await expect(panel(page).getByRole("button", { name: "继续确认放置" })).toBeVisible(); expect(state.placements).toHaveLength(1);
  await panel(page).getByRole("button", { name: "继续确认放置" }).click();
  await expect(panel(page).getByRole("button", { name: "查看已放入的图片" })).toBeVisible();
  expect(state.placements).toHaveLength(2); expect(state.placements[1]).toEqual(first);
  expect(state.getGraph().nodes.filter(node => node.payload.assetId === "restored-1")).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("只读画布没有放置操作，明确拒绝后保留列表可重试", async ({ page }) => {
  const state = await generatedFilePlacementFixture(page, { canEdit: false }); await loadZhiya(page); await open(page);
  await expect(panel(page).getByRole("button", { name: /以新版本放入画布|^放入画布$/ })).toHaveCount(0);
  expect(state.placements).toEqual([]); expect(state.errors).toEqual([]);
});

test("已拒绝的放置保留图片和草稿，可更正后重新尝试", async ({ page }) => {
  const state = await generatedFilePlacementFixture(page); state.failCode = 403; await loadZhiya(page); await open(page);
  await row(page).getByRole("button", { name: "以新版本放入画布" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("当前图片无法放置");
  await expect(panel(page).getByRole("button", { name: "继续确认放置" })).toHaveCount(0);
  state.failCode = 0; await row(page).getByRole("button", { name: "以新版本放入画布" }).click();
  await expect(panel(page).getByRole("button", { name: "查看已放入的图片" })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("关闭和账号切换不应用迟到放置，不显示上一账号的续办", async ({ page }) => {
  const state = await generatedFilePlacementFixture(page); let account = "visual-designer";
  await seedReturningFeatureGuideUser(page, ["placement-other"]);
  await page.route("**/api/me", route => route.fulfill({ json: { user: { id: account, email: "test@example.test", name: "设计师" }, credits: { limit: 600, used: 0, remaining: 600 } } }));
  await loadZhiya(page); await open(page); let release!: () => void; state.hold = new Promise(resolve => { release = resolve; });
  await row(page).getByRole("button", { name: "以新版本放入画布" }).click();
  await expect.poll(() => state.placements.length).toBe(1);
  await close(page); await expect(panel(page)).toHaveCount(0);
  account = "placement-other"; await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "fashion:session-change", newValue: "placement-other" })));
  await expect(page.getByRole("button", { name: "项目菜单", exact: true })).toBeVisible();
  release(); state.hold = null; await open(page);
  await expect(panel(page).getByRole("button", { name: "继续确认放置" })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "查看已放入的图片" })).toHaveCount(0);
  expect(state.placements).toHaveLength(1); expect(state.errors).toEqual([]);
});

test("关闭在途放置后重新打开可续办，原位置和单份产物保持", async ({ page }) => {
  const state = await generatedFilePlacementFixture(page); await loadZhiya(page); await open(page);
  let release!: () => void; state.hold = new Promise(resolve => { release = resolve; });
  await row(page).getByRole("button", { name: "以新版本放入画布" }).click();
  await expect.poll(() => state.placements.length).toBe(1);
  const first = structuredClone(state.placements[0]);
  await close(page); release(); state.hold = null; await open(page);
  await expect(panel(page).getByRole("button", { name: "继续确认放置" })).toBeVisible();
  await panel(page).getByRole("button", { name: "继续确认放置" }).click();
  await expect(panel(page).getByRole("button", { name: "查看已放入的图片" })).toBeVisible();
  expect(state.placements).toHaveLength(2); expect(state.placements[1]).toEqual(first);
  expect(state.getGraph().nodes.filter(node => node.payload.assetId === "restored-1")).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
