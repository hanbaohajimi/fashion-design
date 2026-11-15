import { expect, test, type Page } from "@playwright/test";
import { prepareImageEditing } from "./image-editing-fixture";
import { prepareImageOrientation } from "./image-orientation-fixture";
import { prepareZhiya, loadZhiya, openZhiya } from "./zhiya-fixture";
import { imageToolEntries } from "../../apps/web/src/modules/board/workflow/image-tool-entry";
import { PROJECT } from "../visual/fixtures";
import { openCanvasFunction } from "./canvas-function-navigation";

test.setTimeout(70_000);
const workspace = (page: Page) => page.getByRole("dialog", { name: "图片工作区", exact: true }).filter({ visible: true });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "常用图片工具", exact: true });
const toolTrigger = (page: Page, label: string) => toolbar(page).getByRole("button", { name: imageToolEntries.slice(0, 3).some(entry => entry.label === label) ? label : "更多图片操作", exact: true });
const select = async (page: Page, title = "藏蓝通勤外套") => {
  const image = page.getByRole("group", { name: title, exact: true });
  const box = await image.boundingBox(); if (!box) throw new Error("图片未就绪");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(toolbar(page)).toBeVisible();
};
const openTool = async (page: Page, label: string) => {
  await toolTrigger(page, label).click();
  if (!imageToolEntries.slice(0, 3).some(entry => entry.label === label)) await page.getByRole("group", { name: "更多图片操作选项", exact: true }).getByRole("button", { name: label, exact: true }).click();
  await expect(workspace(page)).toBeVisible();
};

for (const width of [1440, 320]) test(`${width}px 从所选图直达九种工具，打开不提交生成`, async ({ page }) => {
  const state = await prepareImageEditing(page, width, width === 320 ? 568 : 900);
  await select(page);
  for (const entry of imageToolEntries) {
    await openTool(page, entry.label);
    if (entry.action === "inpaint" || entry.action === "erase") await expect(workspace(page).getByRole("tabpanel", { name: "局部重绘", exact: true })).toBeVisible();
    else if (entry.action === "variation") await expect(workspace(page).getByRole("tabpanel", { name: "生成变体", exact: true })).toBeVisible();
    else if (entry.action === "crop") await expect(workspace(page).getByRole("button", { name: "裁剪比例", exact: true })).toBeVisible();
    else await expect(workspace(page).getByRole("complementary", { name: "图片工具参数" }).getByRole("heading", { name: entry.action === "outpaint" ? "AI 扩图" : entry.label, exact: true })).toBeVisible();
    await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
    await expect(workspace(page)).toHaveCount(0);
    await expect(toolTrigger(page, entry.label)).toBeFocused();
  }
  expect(state.commands).toEqual([]); expect(state.masks).toEqual([]); expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test("去背景快捷入口只打开参数，明确提交时仍使用原图和现有命令", async ({ page }) => {
  const state = await prepareImageEditing(page); await select(page); await openTool(page, "移除背景");
  expect(state.commands).toEqual([]);
  await workspace(page).getByRole("button", { name: "移除背景并生成新版本", exact: true }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0]).toMatchObject({ type: "run_tool", toolKey: "edit_design", inputs: [{ nodeId: "material-0", port: "source" }], parameters: { intent: "remove_background" } });
  expect(state.errors).toEqual([]);
});

test("不同快捷工具复用原编辑器并保留方向、扩图和聊天草稿", async ({ page }) => {
  const state = await prepareImageOrientation(page); await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("先看看细节，保留这条需求"); const chat = await input.elementHandle();
  await select(page); const shape = page.locator('.tl-shape[data-shape-id="shape:canvas-material-0"]'), before = await shape.boundingBox();
  await openTool(page, "旋转与翻转"); const editor = await workspace(page).elementHandle();
  await workspace(page).getByRole("button", { name: "向右旋转 90 度" }).click();
  await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
  await openTool(page, "扩展画面");
  await workspace(page).getByRole("textbox", { name: "扩图要求", exact: true }).fill("延续米白背景，保留衣服");
  await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
  await openTool(page, "旋转与翻转");
  await expect(workspace(page).getByLabel("旋转角度", { exact: true })).toHaveValue("90");
  expect(await editor?.evaluate(element => element.isConnected)).toBe(true);
  await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
  await openTool(page, "扩展画面"); await expect(workspace(page).getByRole("textbox", { name: "扩图要求", exact: true })).toHaveValue("延续米白背景，保留衣服");
  await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
  expect(await shape.boundingBox()).toEqual(before); await expect(input).toHaveValue("先看看细节，保留这条需求");
  expect(await chat?.evaluate(element => element.isConnected)).toBe(true); expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});

test("只读图片可预览和读历史，不显示编辑、分享或恢复入口", async ({ page }) => {
  const state = await prepareZhiya(page, { canEdit: false, realClock: true }); await loadZhiya(page);
  await expect(page.getByRole("button", { name: "图片工具", exact: true })).toHaveCount(0);
  const image = page.getByRole("group", { name: "通勤外套 1", exact: true });
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error("只读图片不可见");
  await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(workspace(page)).toContainText("仅查看");
  await expect(workspace(page).getByRole("navigation", { name: "图片工具", exact: true })).toBeHidden();
  await workspace(page).getByRole("button", { name: "导出", exact: true }).click();
  await expect(workspace(page).getByRole("button", { name: "下载图片", exact: true })).toBeVisible();
  await expect(workspace(page).getByRole("button", { name: "分享链接", exact: true })).toHaveCount(0);
  await expect(workspace(page).getByRole("link", { name: "保存为款式", exact: true })).toHaveCount(0);
  await workspace(page).getByRole("button", { name: "版本与对比", exact: true }).click();
  await workspace(page).getByRole("button", { name: "版本历史", exact: true }).click();
  await expect(workspace(page).getByRole("button", { name: /恢复此版|恢复为新版本/ })).toHaveCount(0);
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
});

test("图片工具菜单支持键盘，多选不显示图片工具且锁定不能编辑", async ({ page }) => {
  const state = await prepareImageOrientation(page, 1440, 900, 3); await select(page);
  const trigger = toolTrigger(page, "裁剪图片");
  await trigger.press("ArrowDown");
  const search = page.getByRole("searchbox", { name: "搜索更多图片操作", exact: true });
  await expect(search).toBeFocused();
  await search.press("ArrowDown");
  await expect(page.getByRole("group", { name: "更多图片操作选项" }).getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await openCanvasFunction(page, "画布对象");
  const objects = page.getByRole("region", { name: "画布对象", exact: true });
  await objects.getByRole("button", { name: "锁定 藏蓝通勤外套", exact: true }).click();
  await objects.getByRole("button", { name: "关闭画布对象" }).click();
  await expect(toolbar(page)).toHaveCount(0);
  await openCanvasFunction(page, "画布对象");
  await objects.getByRole("button", { name: "解锁 藏蓝通勤外套", exact: true }).click();
  await objects.getByRole("button", { name: "选择 藏蓝通勤外套", exact: true }).click();
  await objects.getByRole("button", { name: "选择 参考素材 1", exact: true }).click({ modifiers: ["Shift"] });
  await objects.getByRole("button", { name: "关闭画布对象" }).click();
  await expect(trigger).toHaveCount(0); await expect(page.getByRole("button", { name: "分组", exact: true })).toBeEnabled();
  expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});

test("进入编辑后撤销权限立即回到查看，已有方向草稿不提交", async ({ page }) => {
  const state = await prepareImageOrientation(page); await select(page); await openTool(page, "旋转与翻转");
  await workspace(page).getByRole("button", { name: "向右旋转 90 度" }).click();
  const graph = state.getGraph();
  state.setCanEdit(false);
  state.replaceGraph({ ...graph, revision: graph.revision + 1 });
  const response = page.waitForResponse(response => response.url().includes(`/api/projects/${PROJECT}/workflow/sync`));
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh"))); await response;
  await expect(workspace(page)).toContainText("仅查看");
  await expect(workspace(page).getByRole("button", { name: "保存为新版本", exact: true })).toHaveCount(0);
  await expect(workspace(page).getByRole("button", { name: "关闭图片工作区" })).toBeEnabled();
  const restricted = state.getGraph();
  state.setCanEdit(true);
  state.replaceGraph({ ...restricted, revision: restricted.revision + 1 });
  const restored = page.waitForResponse(response => response.url().includes(`/api/projects/${PROJECT}/workflow/sync`));
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh"))); await restored;
  await expect(workspace(page).getByLabel("旋转角度", { exact: true })).toHaveValue("90");
  expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});

test("未确认提交优先于新入口，完成后旧入口不会突然切换模式", async ({ page }) => {
  const state = await prepareImageOrientation(page); await select(page); await openTool(page, "旋转与翻转");
  await workspace(page).getByRole("button", { name: "向右旋转 90 度" }).click();
  state.failNextSubmission();
  await workspace(page).getByRole("button", { name: "保存为新版本", exact: true }).click();
  await expect(workspace(page).getByRole("button", { name: "重试原操作", exact: true })).toBeVisible();
  const first = structuredClone(state.commands[0]);
  await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
  await openTool(page, "移除背景");
  await expect(workspace(page)).toContainText("请先继续原操作");
  await expect(workspace(page).getByRole("button", { name: "移除背景并生成新版本" })).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
  await workspace(page).getByRole("button", { name: "重试原操作", exact: true }).click();
  await expect(workspace(page)).toContainText("任务已提交");
  await expect(workspace(page).getByRole("button", { name: "移除背景并生成新版本" })).toHaveCount(0);
  expect(state.commands).toHaveLength(2); expect(state.commands[1]).toEqual(first); expect(state.errors).toEqual([]);
});

test("等待标注读取时关闭，新工具请求不会在下次普通打开时补执行", async ({ page }) => {
  const state = await prepareImageOrientation(page);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/design-assets/look-0/feedback", async route => { await held; await route.fulfill({ json: { revision: 0, annotations: [], comments: [] } }); });
  await select(page); await openTool(page, "旋转与翻转");
  await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
  await expect(workspace(page)).toHaveCount(0); release();
  await state.open();
  await expect(workspace(page).getByRole("complementary", { name: "图片工具参数" })).toHaveCount(0);
  expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});

test("中文组合输入期间Escape不退出工具或关闭图片，正常Escape返回", async ({ page }) => {
  const state = await prepareImageOrientation(page); await select(page); await openTool(page, "扩展画面");
  const prompt = workspace(page).getByRole("textbox", { name: "扩图要求" });
  await prompt.fill("正在输入设计要求");
  await prompt.dispatchEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, isComposing: true, keyCode: 229 });
  await expect(prompt).toBeVisible(); await expect(prompt).toHaveValue("正在输入设计要求");
  await prompt.press("Escape"); await expect(workspace(page)).toBeVisible();
  await expect(workspace(page).getByRole("complementary", { name: "图片工具参数" })).toHaveCount(0);
  expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});

test("局部重绘回执未知时快捷入口回到原操作，不跳到新的编辑", async ({ page }) => {
  const state = await prepareImageEditing(page); await select(page); await openTool(page, "局部重绘");
  await workspace(page).getByLabel("局部重绘说明").fill("调整袖口，保留面料和衣身");
  await workspace(page).getByRole("button", { name: "标记中央区域", exact: true }).click();
  state.loseNextResponse();
  await workspace(page).getByRole("button", { name: "提交局部重绘" }).click();
  await expect(workspace(page).getByRole("button", { name: "重试局部重绘" })).toBeVisible();
  await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
  await openTool(page, "色彩与明暗");
  await expect(workspace(page)).toContainText("请先继续原操作");
  await expect(workspace(page).getByRole("button", { name: "重试局部重绘" })).toBeVisible();
  await expect(workspace(page).getByRole("heading", { name: "色彩与明暗", exact: true })).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.errors).toEqual([]);
});

test("旧菜单打开后图片变更不会打开另一张图的编辑器", async ({ page }) => {
  const state = await prepareImageOrientation(page); await select(page);
  await toolTrigger(page, "裁剪图片").click();
  const graph = state.getGraph(), first = graph.nodes[0]; if (!first) throw new Error("缺少原图片");
  state.replaceGraph({ ...graph, revision: graph.revision + 1, nodes: [{ ...first, payload: { ...first.payload, assetId: "replacement" } }] });
  const received = page.waitForResponse(response => response.url().includes(`/api/projects/${PROJECT}/workflow/sync`));
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh"))); await received;
  await expect(page.getByRole("group", { name: "更多图片操作选项", exact: true })).toHaveCount(0);
  await expect(workspace(page)).toHaveCount(0);
  expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});

test("冷启动恢复草稿后执行明确入口，原方向草稿继续保留", async ({ page }) => {
  const state = await prepareImageOrientation(page); await select(page); await openTool(page, "旋转与翻转");
  await workspace(page).getByRole("button", { name: "向右旋转 90 度" }).click();
  await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
  await page.reload(); await select(page); await openTool(page, "色彩与明暗");
  await expect(workspace(page).getByRole("heading", { name: "色彩与明暗", exact: true })).toBeVisible();
  await workspace(page).getByRole("button", { name: "旋转与翻转", exact: true }).click();
  await expect(workspace(page).getByLabel("旋转角度", { exact: true })).toHaveValue("90");
  expect(state.commands).toEqual([]);
  await workspace(page).getByRole("button", { name: "保存为新版本", exact: true }).click();
  await expect(workspace(page)).toContainText("任务已提交");
  await workspace(page).getByRole("button", { name: "关闭图片工作区" }).click();
  await page.reload(); await select(page); await openTool(page, "旋转与翻转");
  await expect(workspace(page).getByLabel("旋转角度", { exact: true })).toHaveValue("0");
  expect(state.commands).toHaveLength(1); expect(state.errors).toEqual([]);
});
