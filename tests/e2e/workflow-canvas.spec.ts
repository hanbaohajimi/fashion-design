import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { REVIEW_VIEWPORTS, contrastFailures, controlFontFailures, tabTo } from "./review-accessibility";

const PROJECT_ID = "e2e-workflow-canvas";
const NOW = "2026-10-14T00:00:00.000Z";
async function openDesignRequirements(page: Page) {
  await page.getByLabel("对话操作", { exact: true }).click();
  await page.getByRole("button", { name: "设计要求与偏好", exact: true }).click();
  return page.getByRole("dialog", { name: "设计要求与偏好", exact: true });
}

test("讨论对象与发送一致：引用优先、失败保留、清空保留正文及切换会话隔离", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getContext().focusNodeIds = ["candidate-a"];
  await page.route("**/api/agent-conversations/chat-new/context", (route) => route.fulfill({ json: { ...mocked.getContext(), focusNodeIds: [], summaryRevision: 0 } }));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  const discussion = page.getByLabel("正在讨论", { exact: true });
  const input = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await expect(discussion).toContainText("候选 A");
  await page.locator('[data-type="candidate"]').filter({ hasText: "候选 B" }).click();
  await expect(discussion).toContainText("候选 A");
  expect(mocked.contextPatches).toHaveLength(0);
  await input.fill("@候选 B 保留衣领");
  await expect(discussion).toContainText("候选 B");
  await expect(discussion).not.toContainText("候选 A");
  await page.getByRole("button", { name: "移除引用 候选 B", exact: true }).click();
  await expect(discussion).toContainText("候选 A");
  await expect(input).toHaveValue(" 保留衣领");
  await input.fill("@候选 B 保留衣领");
  let rejectSend = true;
  await page.route("**/api/agent-conversations/*/workflow-messages", (route) => {
    if (rejectSend) { rejectSend = false; return route.fulfill({ status: 503, json: { message: "发送失败，请重试" } }); }
    return route.fallback();
  });
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(input).toHaveValue("@候选 B 保留衣领");
  await expect(discussion).toContainText("候选 B");
  let rejectClear = true;
  await page.route("**/api/agent-conversations/workflow-current/context", (route) => {
    if (route.request().method() === "PATCH" && rejectClear) { rejectClear = false; return route.fulfill({ status: 409, json: { message: "讨论对象版本已更新，请重试" } }); }
    return route.fallback();
  });
  await page.getByRole("button", { name: "讨论整个项目", exact: true }).click();
  await expect(page.getByText("讨论对象版本已更新，请重试", { exact: false }).first()).toBeVisible();
  await expect(input).toHaveValue("@候选 B 保留衣领");
  expect(mocked.getContext().focusNodeIds).toEqual(["candidate-a"]);
  await page.getByRole("button", { name: "讨论整个项目", exact: true }).click();
  await expect(discussion).toContainText("整个项目");
  await expect(input).toHaveValue(" 保留衣领");
  expect(mocked.contextPatches.at(-1)).toMatchObject({ focusNodeIds: [], summaryRevision: 0 });
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(1);
  expect(mocked.workflowRequests[0]).toMatchObject({ content: "保留衣领", referencedNodeIds: [], focusNodeIds: [] });
  await input.fill("@候选 B 新会话不应继承这条引用");
  await page.getByLabel("对话操作", { exact: true }).click();
  await page.getByRole("button", { name: "新建设计对话", exact: true }).click();
  await expect(discussion).toContainText("整个项目");
  await expect(input).toHaveValue("");
  await expect(page.getByRole("button", { name: "移除引用 候选 B", exact: true })).toHaveCount(0);
});

test("发送成功后讨论对象读取失败时不沿用旧焦点，恢复读取后再继续发送", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getContext().focusNodeIds = ["candidate-a"];
  let blockContext = false;
  await page.route("**/api/agent-conversations/*/context", (route) => blockContext
    ? route.fulfill({ status: 503, json: { message: "讨论对象读取暂不可用" } }) : route.fallback());
  await page.goto(`/${PROJECT_ID}`);
  const input = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  const discussion = page.getByLabel("正在讨论", { exact: true });
  await expect(discussion).toContainText("候选 A");
  await input.fill("比较两张风衣图 @候选 B");
  blockContext = true;
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(discussion).toContainText("讨论对象读取失败");
  await expect(discussion).not.toContainText("候选 A");
  await input.fill("比较两张风衣图，继续");
  await expect(page.getByRole("button", { name: "发送 ↑" })).toBeDisabled();
  blockContext = false;
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(discussion).toContainText("候选 B");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(2);
  expect(mocked.workflowRequests[1]).toMatchObject({ referencedNodeIds: [], focusNodeIds: ["candidate-b"] });
});

for (const width of [1440, 390]) {
  test(`引用记录 ${width}：历史名称、旧消息和图片失败信息保持准确`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    mocked.getGraph().nodes.find((entry) => entry.id === "candidate-a")!.title = "后来改名的风衣";
    mocked.setMessages([
      { id: "saved", role: "assistant", status: "completed", content: "保留衣领，参考这轮讨论的设计。", context: {
        referenceSummary: { version: 1, explicit: [{ nodeId: "candidate-a", title: "当时的候选 A" }], discussion: [{ nodeId: "deleted", title: "已删除候选的历史名称" }], images: [{ nodeId: "candidate-a", title: "当时的候选 A" }] },
        visualCoverage: { total: 2, ready: 1, pending: 0, failed: 1, attachedNodeIds: ["candidate-a"] },
      } },
      { id: "legacy", role: "assistant", status: "completed", content: "旧回复只保存了部分记录。", context: { referencedNodeIds: ["candidate-b", "removed"] } },
      { id: "unrecorded", role: "assistant", status: "completed", content: "这是一条没有历史记录的回复。", context: null },
    ]);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/${PROJECT_ID}`);
    await showAssistant(page, width);
    const saved = page.locator('[data-message-id="saved"]');
    await expect(saved.locator("details").first()).not.toHaveAttribute("open");
    await saved.getByText("查看引用记录", { exact: true }).click();
    await expect(saved.getByRole("button", { name: "当时的候选 A", exact: true })).toHaveCount(2);
    await expect(saved.getByRole("button", { name: "已删除候选的历史名称", exact: true })).toBeDisabled();
    await expect(saved).not.toContainText("后来改名的风衣");
    await saved.getByText("图片统计与读取范围", { exact: true }).click();
    await expect(saved).toContainText("读取失败 1 张");
    await expect(saved).not.toContainText("已理解");
    const legacy = page.locator('[data-message-id="legacy"]');
    await legacy.getByText("查看引用记录", { exact: true }).click();
    await expect(legacy.getByRole("button", { name: "候选 B（当前名称）", exact: true })).toBeVisible();
    await expect(legacy.getByRole("button", { name: "名称未记录", exact: true })).toBeDisabled();
    const missing = page.locator('[data-message-id="unrecorded"]');
    await expect(missing.getByText("查看引用记录", { exact: true })).toHaveCount(0);
    await expect(missing.getByText("这条回复未保存引用记录", { exact: true })).toBeVisible();
    const conversation = page.getByLabel("设计对话", { exact: true });
    await conversation.evaluate((element) => { element.scrollTop = 0; });
    await mkdir("output/playwright/context", { recursive: true });
    await page.screenshot({ path: `output/playwright/context/references-${width}.png` });
    const before = await conversation.evaluate((element) => element.scrollTop);
    const drawer = await openDesignRequirements(page);
    await expect(drawer.getByText("让助手记住这个项目的设计要求。修改会影响后续讨论，已有设计结果保持不变。")).toBeVisible();
    await page.screenshot({ path: `output/playwright/context/requirements-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("对话操作", { exact: true })).toBeFocused();
    expect(await conversation.evaluate((element) => element.scrollTop)).toBe(before);
  });
}

for (const width of [1440, 1280, 889, 390]) {
  test(`聚焦工作区 ${width}：工具轻量化、详情独立、返回保留草稿`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    const tool = mocked.getGraph().nodes.find((entry) => entry.id === "generate")!;
    tool.status = "ready";
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/${PROJECT_ID}`);
    await showCanvas(page, width);
    await page.getByRole("button", { name: "适合画布" }).click();
    const node = page.locator('[data-kind="tool"][data-type="generate_design"]');
    await expect(node).toBeVisible();
    expect(await node.evaluate((element) => ({ w: (element as HTMLElement).offsetWidth, h: (element as HTMLElement).offsetHeight }))).toEqual({ w: 96, h: 44 });
    await node.click();
    const originalBounds = await node.boundingBox();
    await node.getByRole("button", { name: "详情", exact: true }).click();
    const workspace = page.getByRole("region", { name: "节点详情工作区", exact: true });
    await expect(workspace).toBeVisible();
    const prompt = workspace.getByRole("textbox", { name: "执行指令", exact: true });
    await prompt.fill("保留本次工具草稿，不自动保存");
    await expect(workspace.getByText("未保存", { exact: true })).toBeVisible();
    if (width >= 1100) {
      const assistant = page.getByRole("complementary", { name: "设计助手", exact: true });
      await expect(assistant).toBeVisible();
      await assistant.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("助手输入保持独立");
    }
    await mkdir("output/playwright/detail-workspace", { recursive: true });
    await page.screenshot({ path: `output/playwright/detail-workspace/tool-${width}.png` });
    await workspace.getByRole("button", { name: "返回画布" }).click();
    await expect(workspace).toBeHidden();
    await expect(node).toBeFocused();
    const returnedBounds = await node.boundingBox();
    if (!originalBounds || !returnedBounds) throw new Error("工具节点不可见");
    for (const coordinate of ["x", "y", "width", "height"] as const)
      expect(Math.abs(returnedBounds[coordinate] - originalBounds[coordinate])).toBeLessThan(1);
    await node.press("Enter");
    await expect(prompt).toHaveValue("保留本次工具草稿，不自动保存");
    expect(tool.payload.params).toBeUndefined();
    await workspace.getByRole("button", { name: "放弃修改", exact: true }).click();
    await expect(prompt).toHaveValue("");
    expect(await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
}

test("聚焦工作区：候选重绘与变体分别保留，手机助手切换不丢失", async ({ page }) => {
  await mockWorkflow(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await showCanvas(page, 390);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.locator('[data-type="candidate"]').first().dblclick();
  const workspace = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await workspace.getByRole("tab", { name: "局部重绘" }).click();
  await workspace.getByRole("textbox", { name: "局部重绘说明" }).fill("调整袖口宽度");
  await workspace.getByRole("button", { name: "标记中央区域" }).click();
  await expect(workspace.getByRole("button", { name: "撤销一笔" })).toBeEnabled();
  await workspace.getByRole("tab", { name: "生成变体" }).click();
  await workspace.getByRole("textbox", { name: "变体修改说明" }).fill("尝试两种领型");
  await workspace.getByRole("textbox", { name: "变体保留特征" }).fill("保留面料与配色");
  await page.getByRole("button", { name: "助手", exact: true }).click();
  await expect(workspace).toBeHidden();
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("助手自己的草稿");
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await expect(workspace.getByRole("textbox", { name: "变体修改说明" })).toHaveValue("尝试两种领型");
  await workspace.getByRole("tab", { name: "局部重绘" }).click();
  await expect(workspace.getByRole("textbox", { name: "局部重绘说明" })).toHaveValue("调整袖口宽度");
  await expect(workspace.getByRole("button", { name: "撤销一笔" })).toBeEnabled();
  await page.screenshot({ path: "output/playwright/detail-workspace/inpaint-390.png" });
  await workspace.getByRole("button", { name: "返回画布" }).click();
  await page.locator('[data-type="candidate"]').first().dblclick();
  await expect(workspace.getByRole("textbox", { name: "局部重绘说明" })).toHaveValue("调整袖口宽度");
});

test("聚焦工作区：色卡与草图嵌入编辑、返回恢复和放弃草稿", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getGraph().nodes.push(
    Object.assign(node("palette-edit", "asset", "swatch", "秋冬配色", 40, 80, { colors: [{ hex: "#40536D", name: "雾蓝" }] }), { canEditPayload: true }),
    Object.assign(node("sketch-edit", "asset", "sketch", "版型草图", 360, 80, { sketchDocument: { version: 1, width: 640, height: 860, strokes: [] } }), { canEditPayload: true }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await expect(page.locator(".tl-canvas")).toBeVisible();
  const open = (id: string) => page.evaluate((nodeId) => window.dispatchEvent(new CustomEvent("fashion-workflow:node-details", { detail: nodeId })), id);
  await open("palette-edit");
  const workspace = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await workspace.getByLabel("颜色名称 1").fill("新的色彩名称");
  await workspace.getByRole("button", { name: "返回画布" }).click();
  await open("sketch-edit");
  const canvas = workspace.getByLabel("廓形草图画布");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("草图没有显示");
  await page.mouse.move(bounds.x + 50, bounds.y + 50);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 100, bounds.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect(workspace.getByRole("button", { name: "撤销", exact: true })).toBeEnabled();
  await page.screenshot({ path: "output/playwright/detail-workspace/sketch-1280.png" });
  await workspace.getByRole("button", { name: "返回画布" }).click();
  await open("palette-edit");
  await expect(workspace.getByLabel("颜色名称 1")).toHaveValue("新的色彩名称");
  await workspace.getByRole("button", { name: "保存色卡" }).click();
  await expect(workspace.getByText("未保存", { exact: true })).toHaveCount(0);
  await workspace.getByRole("button", { name: "返回画布" }).click();
  await open("sketch-edit");
  await expect(workspace.getByRole("button", { name: "撤销", exact: true })).toBeEnabled();
  await workspace.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "撤销", exact: true })).toBeDisabled();
  await expect(workspace.getByText("未保存", { exact: true })).toHaveCount(0);
  await workspace.locator("summary:visible").filter({ hasText: /^素材详情与用途$/u }).click();
  await expect(workspace.getByRole("combobox", { name: "参考图角色" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "从工作流移除节点" })).toBeVisible();
});

test("聚焦工作区：后台更新保护草稿，刷新提醒与录屏", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, recordVideo: { dir: testInfo.outputPath("videos") } });
  const page = await context.newPage();
  try {
    const mocked = await mockWorkflow(page);
    const tool = mocked.getGraph().nodes.find((entry) => entry.id === "generate")!;
    tool.status = "ready";
    await page.goto(`/${PROJECT_ID}`);
    await page.getByRole("button", { name: "适合画布" }).click();
    await page.screenshot({ path: "output/playwright/detail-workspace/canvas-1440.png" });
    await page.locator('[data-type="generate_design"]').dblclick();
    const workspace = page.getByRole("region", { name: "节点详情工作区", exact: true });
    await workspace.getByRole("textbox", { name: "执行指令", exact: true }).fill("我尚未保存的设计要求");
    tool.payload = { params: { prompt: "后台更新的参数" } };
    mocked.getGraph().revision++;
    await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
    await expect(workspace.getByText("节点内容或权限已更新", { exact: false })).toBeVisible();
    await expect(workspace.getByRole("textbox", { name: "执行指令", exact: true })).toHaveValue("我尚未保存的设计要求");
    await expect(workspace.getByRole("button", { name: "保存工具参数" })).toBeDisabled();
    expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    await workspace.getByRole("button", { name: "载入最新内容并放弃草稿" }).click();
    await expect(workspace.getByRole("textbox", { name: "执行指令", exact: true })).toHaveValue("后台更新的参数");
    await workspace.getByRole("button", { name: "返回画布" }).click();
    await expect(workspace).toBeHidden();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('[data-type="generate_design"]').focus();
    await page.keyboard.press("Enter");
    await expect(workspace).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(workspace).toBeHidden();
  } finally { await context.close(); }
});

test("聚焦工作区：权限变化保留草稿，删除节点清理编辑会话", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const palette = Object.assign(node("palette-permission", "asset", "swatch", "权限变化色卡", 40, 80, { colors: [{ hex: "#40536D", name: "雾蓝" }] }), { canEditPayload: true, canForkPayload: true });
  mocked.getGraph().nodes.push(palette);
  await page.goto(`/${PROJECT_ID}`);
  await expect(page.locator(".tl-canvas")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fashion-workflow:node-details", { detail: "palette-permission" })));
  const workspace = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await workspace.getByLabel("颜色名称 1").fill("应保留的修改");
  palette.canEditPayload = false;
  palette.canForkPayload = false;
  mocked.getGraph().revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(workspace.getByText("节点内容或权限已更新", { exact: false })).toBeVisible();
  await expect(workspace.getByLabel("颜色名称 1")).toHaveValue("应保留的修改");
  await expect(workspace.getByRole("button", { name: "保存色卡" })).toBeDisabled();
  mocked.getGraph().nodes = mocked.getGraph().nodes.filter((entry) => entry.id !== palette.id);
  mocked.getGraph().revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(workspace).toBeHidden();
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});

test("聚焦工作区：Escape 层级、助手独立与快速反向切换", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const tool = mocked.getGraph().nodes.find((entry) => entry.id === "generate");
  if (!tool) throw new Error("缺少工具节点");
  Object.assign(tool, { canDelete: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  const target = page.locator('[data-kind="tool"][data-type="generate_design"]');
  await target.dblclick();
  const workspace = page.getByRole("region", { name: "节点详情工作区", exact: true });
  const assistant = page.getByRole("complementary", { name: "设计助手", exact: true });
  await assistant.getByRole("textbox", { name: "向设计助手描述下一步" }).press("Escape");
  await expect(workspace).toBeVisible();
  await workspace.getByRole("button", { name: "从工作流移除节点", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认移除节点", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(workspace).toBeVisible();
  await workspace.getByRole("button", { name: "返回画布" }).click();
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await target.dblclick();
  await expect(assistant).toBeHidden();
  await workspace.getByRole("button", { name: "返回画布" }).evaluate((button: HTMLButtonElement) => button.click());
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fashion-workflow:node-details", { detail: "generate" })));
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(workspace).toBeVisible();
  const bounds = await workspace.boundingBox();
  if (!bounds) throw new Error("工作区不可见");
  expect(bounds.width).toBeGreaterThan(700);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
  await workspace.getByRole("heading", { name: tool.title, exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(workspace).toBeHidden();
  await expect(target).toBeFocused();
});

test("聚焦工作区：跨节点草稿、保存失败重试与助手独立", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const tool = mocked.getGraph().nodes.find((entry) => entry.id === "generate")!;
  tool.status = "ready";
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  const target = page.locator('[data-kind="tool"][data-type="generate_design"]');
  await target.dblclick();
  const workspace = page.getByRole("region", { name: "节点详情工作区", exact: true });
  const prompt = workspace.getByRole("textbox", { name: "执行指令", exact: true });
  await prompt.fill("保留风衣的廓形和面料");
  await workspace.getByRole("button", { name: "返回画布" }).click();
  await page.locator('[data-kind="asset"][data-type="brief"]').dblclick();
  await expect(workspace).toContainText("秋冬通勤风衣");
  await workspace.getByRole("button", { name: "返回画布" }).click();
  await target.dblclick();
  await expect(prompt).toHaveValue("保留风衣的廓形和面料");
  let fail = true;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => {
    if (route.request().method() === "PATCH" && fail) { fail = false; return route.fulfill({ status: 503, json: { message: "暂时无法保存" } }); }
    return route.fallback();
  });
  await workspace.getByRole("button", { name: "保存工具参数" }).click();
  await expect(workspace.getByRole("alert")).toBeVisible();
  await expect(prompt).toHaveValue("保留风衣的廓形和面料");
  await workspace.getByRole("button", { name: "保存工具参数" }).click();
  await expect(workspace.getByText("未保存", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "设计助手", exact: true })).toBeVisible();
});

test.describe("P1 宽屏触控", () => {
  test.use({ hasTouch: true });
  test("平板输入字号与缩放配置保持可用", async ({ page }) => {
    await mockWorkflow(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/${PROJECT_ID}`);
    await page.getByRole("button", { name: "展开设计助手" }).click();
    const input = page.getByRole("textbox", { name: "向设计助手描述下一步" });
    await expect(input).toHaveCSS("font-size", "16px");
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1/);
  });
});

test("优化侧栏性能录制：普通图与压力图各三次十秒拖动", async ({ page }) => {
  test.skip(process.env.ATELIER_OPT_PERF !== "1", "按需运行性能录制，避免增加普通回归时间");
  test.setTimeout(180_000);
  const mocked = await mockWorkflow(page);
  const graph = mocked.getGraph();
  await page.setViewportSize({ width: 1440, height: 900 });
  const samples: unknown[] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  for (const size of [12, 200]) {
    const half = size / 2;
    graph.nodes = Array.from({ length: size }, (_, index) => node(`perf-${index}`, index < half ? "asset" : "tool", index < half ? "brief" : "analyze_brief", `设计步骤 ${index + 1}`, (index < half ? 40 : 500), (index % half) * 240, index < half ? { text: "秋冬通勤风衣" } : {}));
    graph.edges = Array.from({ length: half * 3 }, (_, index) => edge(`perf-edge-${index}`, `perf-${(Math.floor(index / 3) + index % 3) % half}`, `perf-${half + Math.floor(index / 3)}`, "brief"));
    graph.revision++;
    await page.goto(`/${PROJECT_ID}`);
    const separator = page.getByRole("separator", { name: "调整侧栏宽度" });
    await expect(separator).toBeVisible();
    for (let repeat = 0; repeat < 3; repeat++) {
      const before = await cdp.send("Performance.getMetrics");
      const box = await separator.boundingBox(); if (!box) throw new Error("缺少分隔条");
      await page.evaluate(() => {
        const longTasks: number[] = [], frames: number[] = [];
        let last = performance.now(), frame = 0, writes = 0;
        const observe = new PerformanceObserver((entries) => longTasks.push(...entries.getEntries().map((entry) => entry.duration)));
        observe.observe({ type: "longtask" });
        const mutations = new MutationObserver((entries) => { writes += entries.length; });
        const workspace = document.querySelector('[data-mobile-view]');
        if (workspace) mutations.observe(workspace, { attributes: true, attributeFilter: ["style"] });
        const tick = (now: number) => { frames.push(now - last); last = now; frame = requestAnimationFrame(tick); };
        frame = requestAnimationFrame(tick);
        Object.assign(window, { stopSidebarMeasurement: () => { cancelAnimationFrame(frame); observe.disconnect(); mutations.disconnect(); return { longTasks, frames, writes }; } });
      });
      const x = box.x + box.width / 2, y = box.y + 100;
      await page.mouse.move(x, y); await page.mouse.down();
      let moves = 0;
      const started = Date.now();
      while (Date.now() - started < 10000) { await page.mouse.move(x + Math.sin(moves / 8) * 36, y); moves++; await page.waitForTimeout(16); }
      await page.mouse.up();
      const timing = await page.evaluate(() => (window as unknown as { stopSidebarMeasurement(): { longTasks: number[]; frames: number[]; writes: number } }).stopSidebarMeasurement());
      const after = await cdp.send("Performance.getMetrics");
      const metrics = Object.fromEntries(after.metrics.filter((metric) => ["LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"].includes(metric.name)).map((metric) => [metric.name, metric.value - (before.metrics.find((entry) => entry.name === metric.name)?.value ?? 0)]));
      samples.push({ nodes: size, edges: graph.edges.length, repeat: repeat + 1, elapsedMs: Date.now() - started, moves, ...timing, metrics });
    }
  }
  await mkdir("output/playwright/optimization", { recursive: true });
  await writeFile("output/playwright/optimization/sidebar-performance.json", JSON.stringify({ build: "isolated Next development server", browser: page.context().browser()?.version(), samples }, null, 2), "utf8");
});

test("P2 侧栏拖动提交最终宽度，取消恢复且 Tooltip 连续浏览即时", async ({ page }) => {
  await mockWorkflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  const separator = page.getByRole("separator", { name: "调整侧栏宽度" });
  const initial = Number(await separator.getAttribute("aria-valuenow"));
  const box = await separator.boundingBox();
  if (!box) throw new Error("分隔条不可见");
  const x = box.x + box.width / 2, y = box.y + 80;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 40, y, { steps: 10 }); await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", String(initial + 40));
  // Cancel through an active mouse gesture, retaining the last committed width.
  const next = await separator.boundingBox(); if (!next) throw new Error("缺少分隔条");
  await page.mouse.move(next.x + 3, y); await page.mouse.down(); await page.mouse.move(next.x - 30, y);
  await separator.dispatchEvent("pointercancel"); await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", String(initial + 40));
  await page.getByRole("button", { name: "缩小画布" }).hover();
  await expect(page.getByRole("tooltip", { name: "缩小画布，查看更多节点" })).toBeVisible();
  await page.getByRole("button", { name: "放大画布" }).hover();
  await expect(page.getByRole("tooltip", { name: "放大画布，查看节点细节" })).toBeVisible();
});

test("P1 手机助手在断点和键盘高度变化后保留内容", async ({ page }) => {
  await mockWorkflow(page);
  await page.setViewportSize({ width: 761, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "助手", exact: true }).click();
  const assistant = page.getByRole("complementary", { name: "设计助手" });
  const input = assistant.locator("textarea").last();
  await input.fill("保留未发送的面料设计要求");
  for (const [width, height] of [[761, 600], [767, 500], [768, 600], [1099, 700], [1100, 800], [767, 600]]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect(assistant).toBeVisible();
    await expect(input).toHaveValue("保留未发送的面料设计要求");
  }
  await mkdir("output/playwright/optimization", { recursive: true });
  await page.screenshot({ path: "output/playwright/optimization/mobile-assistant-767.png" });
});

test("P1 历史图首帧节点和连线无入场等待，静态选择不流动", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const node = page.locator('[data-type="brief"]').first();
  await expect(node).toBeVisible();
  expect(await node.evaluate((element) => ({ animation: getComputedStyle(element).animationName, transform: getComputedStyle(element).transform }))).toEqual({ animation: "none", transform: "none" });
  const edges = page.locator('[data-workflow-edge][data-running]');
  await expect(edges.first()).toBeAttached();
  expect(await edges.evaluateAll((items) => items.every((element) => Array.from(element.querySelectorAll("path")).every((path) => getComputedStyle(path).animationName === "none" || element.getAttribute("data-running") === "true")))).toBe(true);
});

for (const width of [1440, 390]) {
  test(`智能配色 ${width}：预览不保存，追加色卡保存并刷新恢复`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/${PROJECT_ID}`);
    await showCanvas(page, width);
    await page.getByRole("button", { name: "＋ 添加素材", exact: true }).click();
    await page.getByRole("button", { name: "色彩参考 色号与配色说明", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "添加色彩参考" });
    await dialog.getByRole("button", { name: "探索配色", exact: true }).click();
    const preview = dialog.getByRole("region", { name: "配色探索" });
    await expect(preview).toBeVisible();
    await preview.getByLabel("配色策略").selectOption("analogous");
    await preview.getByLabel("建议色 1 名称").fill("秋日雾蓝");
    expect(mocked.getGraph().nodes.filter((entry) => entry.type === "swatch")).toHaveLength(0);
    const suggestions = await preview.getByRole("list", { name: "建议颜色" }).locator("code").allTextContents();
    expect(suggestions).toHaveLength(3);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await mkdir("output/playwright/palette", { recursive: true });
    await preview.screenshot({ path: `output/playwright/palette/workflow-${width}.png` });
    await preview.getByRole("button", { name: "应用配色" }).click();
    expect(mocked.getGraph().nodes.filter((entry) => entry.type === "swatch")).toHaveLength(0);
    await expect(dialog.getByLabel("颜色名称 2")).toHaveValue("秋日雾蓝");
    await dialog.getByRole("button", { name: "加入工作流" }).click();
    await expect(dialog).toHaveCount(0);
    const saved = mocked.getGraph().nodes.find((entry) => entry.type === "swatch");
    expect(saved?.payload.colors).toEqual([
      { hex: "#40536D", name: "色彩 1" },
      ...suggestions.map((hex, i) => ({ hex: hex.toLowerCase(), name: i === 0 ? "秋日雾蓝" : `建议色 ${i + 2}` })),
    ]);
    expect(saved?.payload.color).toBe("#40536D");
    await page.reload();
    await showCanvas(page, width);
    await page.getByRole("button", { name: "适合画布" }).click();
    await page.locator('[data-type="swatch"]').dblclick();
    await expect(page.getByLabel("颜色名称 2")).toHaveValue("秋日雾蓝");
    await expect(page.getByLabel("色号 4", { exact: true })).toHaveValue(suggestions[2]?.toLowerCase() ?? "missing");
  });
}

test("智能配色：系列 DNA 自动保存失败可重试，重新打开保留配色并遵守锁定", async ({ page }) => {
  await mockWorkflow(page);
  await page.route(`**/api/generations?*projectId=${PROJECT_ID}`, (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  let palette = [{ hex: "#40536D", name: "雾蓝" }, { hex: "#E6D8C6", name: "暖象牙" }];
  let locked = false;
  let failNextSave = true;
  let saves = 0;
  const dna = () => ({ extractionStatus: "ready", fabrics: ["羊毛"], locks: { fabrics: false, moodWords: false, palette: locked, silhouettes: false }, moodWords: ["克制"], palette, referenceFileIds: [], signatureDetails: [], silhouettes: ["直筒"], updatedAt: NOW });
  const collection = () => ({ id: "palette-collection", name: "秋冬配色系列", projectId: PROJECT_ID, createdAt: NOW, updatedAt: NOW, sourceGarmentType: { code: "coat", label: "大衣" }, dna: dna(), hero: { assetId: "asset-a", thumbnailUrl: "/api/design-assets/asset-a/thumbnail", url: "/api/design-assets/asset-a/content" } });
  await page.route(`**/api/collections?projectId=${PROJECT_ID}`, (route) => route.fulfill({ json: [collection()] }));
  await page.route("**/api/collections/palette-collection", (route) => route.fulfill({ json: collection() }));
  await page.route("**/api/collections/palette-collection/consistency", (route) => route.fulfill({ json: { looks: [], referenceLabel: "参考相似度", similarities: [] } }));
  await page.route("**/api/collections/palette-collection/dna", (route) => {
    saves++;
    if (failNextSave) { failNextSave = false; return route.fulfill({ status: 503, json: { message: "配色保存失败，请重试" } }); }
    const body = route.request().postDataJSON();
    palette = body.palette;
    locked = body.locks.palette;
    return route.fulfill({ json: dna() });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/${PROJECT_ID}`);
  const openCollection = async () => {
    await page.getByRole("button", { name: "系列", exact: true }).click();
    await page.getByRole("button", { name: "秋冬配色系列", exact: true }).click();
  };
  await openCollection();
  const drawer = page.getByRole("dialog", { name: "系列 DNA" });
  await drawer.getByRole("button", { name: "探索配色" }).click();
  await expect(drawer.getByRole("region", { name: "配色探索" })).toBeVisible();
  await drawer.getByLabel("建议色 1 名称").fill("系列晨雾");
  expect(saves).toBe(0);
  await mkdir("output/playwright/palette", { recursive: true });
  await drawer.getByRole("region", { name: "配色探索" }).screenshot({ path: "output/playwright/palette/dna-1440.png" });
  await drawer.getByRole("button", { name: "应用配色" }).click();
  await expect(drawer.getByText("配色保存失败，请重试")).toBeVisible();
  await expect(drawer.getByLabel("颜色 3 名称")).toHaveValue("系列晨雾");
  await drawer.getByRole("button", { name: "重试保存" }).click();
  await expect.poll(() => palette.length).toBe(5);
  expect(palette.slice(0, 2)).toEqual([{ hex: "#40536D", name: "雾蓝" }, { hex: "#E6D8C6", name: "暖象牙" }]);
  await drawer.getByRole("button", { name: "关闭系列抽屉" }).click();
  await page.reload();
  await openCollection();
  await expect(drawer.getByLabel("颜色 3 名称")).toHaveValue("系列晨雾");
  await drawer.getByRole("button", { name: "探索配色" }).click();
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(drawer.getByRole("region", { name: "配色探索" })).toBeVisible();
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await drawer.getByLabel("基准色").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/playwright/palette/dna-390.png" });
  const cancelPreview = drawer.getByRole("button", { name: "取消预览" });
  await cancelPreview.scrollIntoViewIfNeeded();
  await cancelPreview.focus();
  await expect(cancelPreview).toBeFocused();
  await page.screenshot({ path: "output/playwright/palette/dna-390-actions.png" });
  await cancelPreview.press("Enter");
  const paletteSection = drawer.locator("section").filter({ has: page.getByRole("heading", { name: "色板", exact: true }) });
  await paletteSection.getByRole("button", { name: "锁定", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "探索配色" })).toBeDisabled();
  await expect.poll(() => locked).toBe(true);
});

async function showCanvas(page: Page, width: number) {
  if (width < 768) await page.getByRole("button", { name: "画布", exact: true }).click();
  else if (width < 1100 && await page.getByRole("button", { name: "收起设计助手" }).isVisible()) await page.getByRole("button", { name: "收起设计助手" }).click();
}
async function showAssistant(page: Page, width: number) {
  if (width < 768) await page.getByRole("button", { name: "助手", exact: true }).click();
  else if (await page.getByRole("button", { name: "展开设计助手" }).isVisible()) await page.getByRole("button", { name: "展开设计助手" }).click();
}

for (const width of [1280, 375]) {
  test(`精简空画布 ${width}：推荐起点唯一，素材和导出按需可达`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    mocked.getGraph().nodes.splice(0);
    mocked.getGraph().edges.splice(0);
    await page.setViewportSize({ width, height: 812 });
    await page.goto(`/${PROJECT_ID}`);
    await showCanvas(page, width);
    const welcome = page.getByRole("heading", { name: "让想法成为设计方案" }).locator("..");
    await expect(welcome.getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "导出画布 PNG", exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir("output/playwright/simplification", { recursive: true });
    await page.screenshot({ path: `output/playwright/simplification/empty-canvas-${width}.png` });
    await welcome.getByRole("button", { name: "开始设计", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await showCanvas(page, width);
    await page.getByText("资料与更多", { exact: true }).click();
    await expect(page.getByRole("button", { name: "导出画布 PNG", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "＋ 添加素材", exact: true }).click();
    await expect(page.getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true })).toBeVisible();
  });
}

for (const width of [1280, 375]) {
  test(`助手直接生成 ${width}：保存后失败可恢复，同一请求不重复生成，结果原位打开`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    const requests: Array<{ mutationId: string; conversationId: string }> = [];
    let accepts = 0;
    page.on("request", (request) => { if (request.url().endsWith("/accept")) accepts++; });
    await page.route(`**/api/projects/${PROJECT_ID}/workflow/nodes/*/execute`, async (route) => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) return route.fulfill({ status: 503, json: { message: "提交暂未完成，请重试" } });
      const id = new URL(route.request().url()).pathname.split("/").at(-2);
      const target = mocked.getGraph().nodes.find((item) => item.id === id);
      if (target) target.status = "running";
      mocked.getGraph().revision++;
      return route.fulfill({ json: mocked.getGraph() });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/${PROJECT_ID}`);
    await showAssistant(page, width);
    const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
    await composer.fill("请以 @候选 A 为基础设计一件藏蓝风衣，保留肩线。");
    await page.getByRole("button", { name: "发送 ↑" }).click();
    const card = page.getByRole("region", { name: "方案确认" });
    await expect(card).toContainText("藏蓝风衣");
    expect(requests).toHaveLength(0);
    await mkdir("output/playwright/assistant-direct", { recursive: true });
    await page.screenshot({ path: `output/playwright/assistant-direct/review-${width}.png` });
    await card.getByRole("button", { name: "确认并生成" }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await expect(card.getByRole("alert")).toBeVisible();
    expect(accepts).toBe(1);
    expect(requests).toHaveLength(1);
    expect(mocked.getGraph().nodes.filter((item) => item.id === "edit-proposed-0")).toHaveLength(1);
    await page.reload();
    await showAssistant(page, width);
    await card.getByRole("button", { name: "继续生成" }).click();
    await expect(card.getByRole("status")).toContainText("正在生成");
    expect(accepts).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]?.conversationId).toBe("workflow-current");
    await expect(card.getByRole("button", { name: /确认并生成|继续生成/ })).toHaveCount(0);
    const tool = mocked.getGraph().nodes.find((item) => item.id === "edit-proposed-0");
    if (!tool) throw new Error("缺少执行节点");
    tool.status = "completed";
    mocked.getGraph().nodes.push(node("direct-result", "asset", "candidate", "新风衣方案", 1100, 1100, { assetId: "asset-a" }));
    mocked.getGraph().edges.push(edge("direct-output", tool.id, "direct-result", "source"));
    mocked.getGraph().revision++;
    await expect(card.getByRole("button", { name: "查看新风衣方案" })).toBeVisible();
    await expect(card.getByRole("button", { name: "查看新风衣方案" })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/assistant-direct/result-${width}.png` });
    await card.getByRole("button", { name: "查看新风衣方案" }).click();
    await expect(page.getByRole("region", { name: "候选资产工作台", exact: true })).toBeVisible();
  });
}

test("帮助提示可键盘关闭，草图窗口圈定焦点并返回素材入口", async ({ page }) => {
  await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const help = page.getByRole("button", { name: "工作室帮助", exact: true });
  await help.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  const tip = await page.getByRole("tooltip").boundingBox();
  if (!tip) throw new Error("工作室帮助提示未显示");
  expect(tip.x).toBeGreaterThanOrEqual(0);
  expect(tip.x + tip.width).toBeLessThanOrEqual(1280);
  await help.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(help).toBeFocused();
  await help.press("Enter");
  const guide = page.getByRole("dialog", { name: "工作室使用帮助" });
  await expect(guide).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  const trigger = page.getByRole("button", { name: "＋ 添加素材", exact: true });
  await trigger.click();
  await page.getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true }).click();
  const sketch = page.getByRole("dialog", { name: "绘制廓形草图" });
  await expect(sketch.getByRole("textbox", { name: "素材名称" })).toBeFocused();
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press("Tab");
    expect(await sketch.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sketch).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("阅读历史时新消息不会抢走滚动位置，点击提示后回到最新消息", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.setMessages(Array.from({ length: 12 }, (_, index) => ({
    id: `reading-${index}`, role: "assistant", status: "completed", kind: "reply", proposal: null,
    content: `第 ${index + 1} 条设计讨论\n${"继续比较廓形、面料与细节。".repeat(20)}`, createdAt: NOW,
  })));
  await page.goto(`/${PROJECT_ID}`);
  const conversation = page.getByLabel("设计对话", { exact: true });
  await expect(page.getByText("第 12 条设计讨论", { exact: false })).toBeVisible();
  await conversation.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  mocked.appendMessage({ id: "reading-latest", role: "assistant", status: "completed", kind: "reply", proposal: null, content: "新到达的设计分析", createdAt: NOW });
  const jump = page.getByRole("button", { name: "有新消息 ↓", exact: true });
  await expect(jump).toBeVisible();
  expect(await conversation.evaluate((element) => element.scrollTop)).toBeLessThan(40);
  await jump.click();
  await expect(jump).toHaveCount(0);
  await expect.poll(() => conversation.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(80);
});

test("工作室详情草稿在对话切换和同步后保留；侧栏支持键盘调整", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const tool = mocked.getGraph().nodes.find((node) => node.id === "generate");
  if (!tool) throw new Error("测试图缺少生成工具");
  tool.status = "ready";
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.locator('[data-type="generate_design"]').first().click();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: "执行指令", exact: true });
  await prompt.fill("尚未保存的领口修改");
  await page.getByRole("button", { name: "返回画布" }).click();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await expect(prompt).toHaveValue("尚未保存的领口修改");
  await page.waitForTimeout(3200);
  await expect(prompt).toHaveValue("尚未保存的领口修改");
  const separator = page.getByRole("separator", { name: "调整侧栏宽度" });
  const before = Number(await separator.getAttribute("aria-valuenow"));
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 16));
  await page.getByRole("button", { name: "返回画布" }).click();
  await page.locator('[data-type="candidate"]').first().click();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "保留未保存的参数" })).toHaveCount(0);
  await page.getByRole("button", { name: "返回画布" }).click();
  await page.locator('[data-type="generate_design"]').first().dblclick();
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveValue("尚未保存的领口修改");
});

test("统一工作区在桌面、抽屉及手机视图保持操作可达", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkflow(page);
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/${PROJECT_ID}`);
  await mkdir("output/playwright/atelier", { recursive: true });
  // 683×384 also checks the CSS viewport available at 200% zoom on 1366×768.
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 683, height: 384 }]) {
    await page.setViewportSize(viewport);
    await showCanvas(page, viewport.width);
    await page.getByRole("button", { name: "适合画布" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (viewport.width >= 1100) {
      await expect(page.locator("main > header")).toHaveCSS("height", "56px");
      const bounds = await page.getByRole("region", { name: "设计工作流画布" }).boundingBox();
      expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(640);
    }
    await page.screenshot({ path: `output/playwright/atelier/studio-${viewport.width}.png` });
    await showAssistant(page, viewport.width);
    await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeVisible();
    await expect(page.getByRole("button", { name: "发送 ↑", exact: true })).toBeInViewport({ ratio: 1 });
    const send = await page.getByRole("button", { name: "发送 ↑", exact: true }).boundingBox();
    const license = page.getByRole("button", { name: "Get a license for production", exact: true });
    // Canvas visibility can remove the SDK badge between two locator reads.
    const badge = await license.evaluateAll((elements) => {
      const element = elements.find((item) => item.checkVisibility({ checkVisibilityCSS: true }));
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    if (send && badge) {
      if (badge) expect(send.x + send.width <= badge.x || send.x >= badge.x + badge.width || send.y + send.height <= badge.y || send.y >= badge.y + badge.height, "SDK 标识不能遮挡发送按钮").toBe(true);
    }
    await page.screenshot({ path: `output/playwright/atelier/assistant-${viewport.width}.png` });
    const actions = page.getByText("更多", { exact: true });
    await actions.click();
    const actionBounds = await page.getByRole("button", { name: "暂停设计协作", exact: true }).boundingBox();
    if (!actionBounds) throw new Error("协作操作菜单未显示");
    expect(actionBounds.y).toBeGreaterThanOrEqual(0);
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(viewport.height);
    await actions.press("Escape");
    await expect(actions).toBeFocused();
  }
});

type GraphNode = {
  id: string;
  kind: "asset" | "tool";
  type: string;
  title: string;
  payload: Record<string, unknown>;
  x: number;
  y: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  canDelete?: boolean;
  deleteDisabledReason?: string | null;
};
type GraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort: "out";
  targetPort: string;
};
type Operation =
  | { type: "add_node"; node: Omit<GraphNode, "status" | "createdAt" | "updatedAt"> }
  | { type: "update_node"; nodeId: string; title?: string; payload?: Record<string, unknown> }
  | { type: "link_collection"; nodeId: string; collectionId: string }
  | { type: "add_edge"; edge: GraphEdge }
  | { type: "remove_node"; nodeId: string }
  | { type: "remove_edge"; edgeId: string };

function node(id: string, kind: GraphNode["kind"], type: string, title: string, x: number, y: number, payload: Record<string, unknown> = {}): GraphNode {
  return { id, kind, type, title, x, y, payload, status: "completed", createdAt: NOW, updatedAt: NOW };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, targetPort: string): GraphEdge {
  return { id, sourceNodeId, targetNodeId, sourcePort: "out", targetPort };
}

function sampleGraph() {
  return {
    projectId: PROJECT_ID,
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: true,
    nodes: [
      node("brief", "asset", "brief", "设计需求", 40, 120, { text: "秋冬通勤风衣，藏蓝色、宽松廓形。" }),
      node("reference", "asset", "reference_text", "参考素材", 40, 420, { text: "挺括面料；保留肩线。" }),
      node("analysis", "tool", "analyze_brief", "需求分析", 390, 260),
      node("constraint", "asset", "constraint", "设计约束", 740, 260, { text: "藏蓝色与宽松 H 型廓形" }),
      node("generate", "tool", "generate_design", "方案生成", 1090, 260),
      node("candidate-a", "asset", "candidate", "候选 A", 1440, 70, { assetId: "asset-a", text: "双排扣风衣" }),
      node("candidate-b", "asset", "candidate", "候选 B", 1440, 390, { assetId: "asset-b", text: "系带风衣" }),
      node("evaluate", "tool", "evaluate_design", "服装评估", 1090, 690),
      node("report", "asset", "evaluation", "评估报告", 1440, 690, { text: "候选 A 更符合目标" }),
    ],
    edges: [
      edge("e1", "brief", "analysis", "goal"),
      edge("e2", "reference", "analysis", "reference"),
      edge("e3", "analysis", "constraint", "source"),
      edge("e4", "constraint", "generate", "constraint"),
      edge("e5", "reference", "generate", "reference"),
      edge("e6", "generate", "candidate-a", "source"),
      edge("e7", "generate", "candidate-b", "source"),
      edge("e8", "candidate-a", "evaluate", "candidate"),
      edge("e9", "candidate-b", "evaluate", "candidate"),
      edge("e10", "constraint", "evaluate", "constraint"),
      edge("e11", "evaluate", "report", "source"),
    ],
  };
}

for (const width of [1280, 375]) {
  test(`密集连线 ${width}：三类关系色、上下游聚焦与取消恢复`, async ({ page }) => {
    test.setTimeout(60_000);
    const mocked = await mockWorkflow(page);
    const graph = mocked.getGraph();
    graph.nodes = Array.from({ length: 4 }, (_, index) => node(
      `material-${index}`, "asset", index === 0 ? "candidate" : "reference_text",
      index === 0 ? "设计原图" : `参考素材 ${index}`, 40, 40 + index * 260,
      { text: ["主图输入", "廓形参考", "面料参考", "细节参考"][index], width: 1600, height: 600 },
    ));
    graph.edges = [];
    for (let branch = 0; branch < 4; branch++) {
      const y = 40 + branch * 260;
      graph.nodes.push(
        node(`tool-${branch}`, "tool", "edit_design", `方案生成 ${branch + 1}`, 600, y),
        node(`draft-${branch}`, "asset", "candidate", `分支方案 ${branch + 1}`, 1120, y, { text: "独立方案", width: 1600, height: 600 }),
        node(`refine-${branch}`, "tool", "edit_design", `细节调整 ${branch + 1}`, 1640, y),
        node(`result-${branch}`, "asset", "candidate", `最终方案 ${branch + 1}`, 2160, y, { text: "调整结果", width: 1600, height: 600 }),
      );
      for (let material = 0; material < 4; material++) {
        graph.edges.push(edge(`input-${branch}-${material}`, `material-${material}`, `tool-${branch}`, material === 0 ? "source" : "reference"));
      }
      graph.edges.push(
        edge(`output-${branch}`, `tool-${branch}`, `draft-${branch}`, "source"),
        edge(`refine-input-${branch}`, `draft-${branch}`, `refine-${branch}`, "source"),
        edge(`refine-output-${branch}`, `refine-${branch}`, `result-${branch}`, "source"),
      );
    }
    const running = graph.nodes.find((item) => item.id === "tool-3");
    if (!running) throw new Error("缺少运行中的分支");
    running.status = "running";
    await page.emulateMedia({ reducedMotion: width === 375 ? "reduce" : "no-preference" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/${PROJECT_ID}`);
    await showCanvas(page, width);
    const edges = page.locator("[data-workflow-edge]");
    await expect(edges).toHaveCount(28);
    await expect(page.getByText("画布已保存", { exact: true })).toHaveCount(0);
    await expect(page.getByText("正在保存画布…", { exact: true })).toHaveCount(0);
    const toolCards = page.locator('[data-kind="tool"]');
    await expect(toolCards).toHaveCount(8);
    expect((await toolCards.allTextContents()).join(" ")).not.toMatch(/已完成|运行中|处理中|等待执行/);
    if (width === 1280) {
      await page.getByRole("button", { name: "收起设计助手" }).click();
      await expect(page.getByRole("button", { name: "展开设计助手" })).toBeVisible();
    }
    await page.getByRole("button", { name: "适合画布" }).click();
    const wire = (id: string) => page.locator(`[data-workflow-edge="${id}"]`);
    await expect(wire("input-0-0")).toHaveAttribute("data-relation", "input");
    await expect(wire("input-0-1")).toHaveAttribute("data-relation", "reference");
    await expect(wire("output-0")).toHaveAttribute("data-relation", "result");
    const colors = await Promise.all(["input-0-0", "input-0-1", "output-0"].map((id) =>
      wire(id).evaluate((element) => getComputedStyle(element).color)));
    expect(new Set(colors).size).toBe(3);
    const legend = page.getByRole("list", { name: "连线颜色图例" });
    await expect(legend).toBeVisible();
    await expect(legend.getByRole("listitem")).toHaveText(["主输入", "参考素材", "生成结果"]);
    expect(await legend.locator("svg").evaluateAll((items) => items.map((element) => getComputedStyle(element).color))).toEqual(colors);
    const legendBounds = await legend.boundingBox();
    expect(legendBounds?.x).toBeGreaterThanOrEqual(0);
    expect((legendBounds?.x ?? 0) + (legendBounds?.width ?? 0)).toBeLessThanOrEqual(width);
    await mkdir("output/playwright/edge-focus", { recursive: true });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `output/playwright/edge-focus/dense-${width}-compact-tools.png` });
    const hoveredEdges = page.locator('[data-workflow-edge][data-node-hovered="true"]');
    const edgeLabel = page.locator("[data-workflow-edge-label]");
    await expect(edgeLabel).toHaveCount(0);
    // 总览下连接点可能覆盖标题；悬停整个节点也允许命中其内部连接点。
    const hoverNode = (title: string) => page.getByRole("group", { name: `设计节点 ${title}`, exact: true }).hover();
    // 未选中时悬停工具只突出四条输入和一条输出，继续下游的线不参与。
    await hoverNode("方案生成 1");
    await expect(hoveredEdges).toHaveCount(5);
    await expect(edgeLabel).toHaveCount(0);
    await expect(wire("input-0-0")).toHaveAttribute("data-node-hovered", "true");
    await expect(wire("output-0")).toHaveAttribute("data-node-hovered", "true");
    await expect(wire("refine-input-0")).toHaveAttribute("data-muted", "true");
    await expect(page.locator('[data-workflow-edge][data-muted="true"]')).toHaveCount(23);
    await hoverNode("方案生成 2");
    await expect(wire("output-0")).toHaveAttribute("data-node-hovered", "false");
    await expect(wire("output-1")).toHaveAttribute("data-node-hovered", "true");
    await page.mouse.move(0, 0);
    await expect(hoveredEdges).toHaveCount(0);
    await expect(page.locator('[data-workflow-edge][data-muted="true"]')).toHaveCount(0);
    // 总览下连接点保持屏幕尺寸，点击标题以避免命中卡片右侧的连接热区。
    await page.getByRole("group", { name: "设计节点 分支方案 2", exact: true }).locator("strong").first().click();
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-workflow-edge][data-muted="true"]')).toHaveCount(21);
    for (const id of ["input-1-0", "input-1-1", "input-1-2", "input-1-3", "output-1", "refine-input-1", "refine-output-1"]) {
      await expect(wire(id)).toHaveAttribute("data-highlighted", "true");
    }
    const lineOpacity = (id: string) => wire(id).locator("path").nth(1).evaluate((element) => Number(getComputedStyle(element).opacity));
    await expect.poll(() => lineOpacity("output-0")).toBeCloseTo(0.18);
    await expect.poll(() => lineOpacity("output-1")).toBe(1);
    expect(await wire("output-1").evaluate((element) => getComputedStyle(element).color)).toBe(colors[2]);
    await expect.poll(() => wire("output-3").locator("path").nth(2).evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/edge-focus/dense-${width}-focused-legend.png` });
    const focusedState = await edges.evaluateAll((items) => items.map((element) => [element.getAttribute("data-workflow-edge"), element.getAttribute("data-highlighted"), element.getAttribute("data-muted")]));
    await hoverNode("分支方案 1");
    await expect(hoveredEdges).toHaveCount(2);
    await expect(wire("output-0")).toHaveAttribute("data-node-hovered", "true");
    await expect(wire("refine-input-0")).toHaveAttribute("data-node-hovered", "true");
    await expect.poll(() => lineOpacity("output-0")).toBe(1);
    await expect.poll(() => lineOpacity("output-1")).toBeCloseTo(0.18);
    expect(await wire("output-0").evaluate((element) => getComputedStyle(element).color)).toBe(colors[2]);
    await page.screenshot({ path: `output/playwright/edge-focus/dense-${width}-hover.png` });
    await page.mouse.move(0, 0);
    await expect.poll(() => edges.evaluateAll((items) => items.map((element) => [element.getAttribute("data-workflow-edge"), element.getAttribute("data-highlighted"), element.getAttribute("data-muted")]))).toEqual(focusedState);
    // 切出窗口同样清除临时悬停，不留下整图变淡的状态。
    await hoverNode("分支方案 1");
    await expect(hoveredEdges).toHaveCount(2);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(hoveredEdges).toHaveCount(0);
    await expect(page.locator('[data-workflow-edge][data-muted="true"]')).toHaveCount(21);
    await page.mouse.move(0, 0);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-workflow-edge][data-muted="true"]')).toHaveCount(0);
    await expect.poll(() => lineOpacity("output-0")).toBeCloseTo(0.9);
    for (const [id, label] of width === 1280
      ? [["input-0-0", "主图输入"], ["input-0-1", "参考素材"], ["output-0", "生成结果"]] as const
      : [["output-0", "生成结果"]] as const) {
      const point = await wirePoint(page, id);
      await page.mouse.move(point.x, point.y);
      await expect(edgeLabel).toHaveText(label);
      await expect(edgeLabel).toHaveCSS("font-size", "12px");
      const labelBounds = await edgeLabel.boundingBox();
      if (!labelBounds) throw new Error("连线标签未显示");
      expect(labelBounds.x).toBeGreaterThanOrEqual(0);
      expect(labelBounds.y).toBeGreaterThanOrEqual(0);
      expect(labelBounds.x + labelBounds.width).toBeLessThanOrEqual(width);
      expect(labelBounds.y + labelBounds.height).toBeLessThanOrEqual(900);
      await page.screenshot({ path: `output/playwright/edge-focus/label-${width}-${id}.png` });
      await page.keyboard.press("Escape");
      await expect(edgeLabel).toHaveCount(0);
      // 密集交叉处偏移 1px 可能进入另一条线；原位置移动验证同一条线不会重新弹出。
      await page.mouse.move(point.x, point.y);
      await expect(edgeLabel).toHaveCount(0);
      await page.mouse.move(0, 0);
      await page.mouse.move(point.x, point.y);
      await expect(edgeLabel).toHaveText(label);
      await page.mouse.move(0, 0);
      await expect(edgeLabel).toHaveCount(0);
    }
    if (width === 1280) {
      // 淡出并未关闭命中区域：仍能直接选择旁支连线。
      await page.getByRole("group", { name: "设计节点 分支方案 2", exact: true }).locator("strong").first().click();
      await selectWire(page, "output-0");
      await expect(wire("output-0")).toHaveAttribute("data-selected", "true");
      await expect(edgeLabel).toHaveCount(0);
      await expect.poll(() => lineOpacity("output-0")).toBe(1);
    }
  });
}

for (const width of [1280, 375]) {
  test(`作品工作台 ${width}：方案成组、过程归入说明、引用与原始路径可达`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    const mocked = await mockWorkflow(page, "workbench");
    mocked.getGraph().nodes.push(node("image-ref", "asset", "reference_image", "廓形参考", 0, 700, { imageUrl: "/api/design-assets/asset-a/thumbnail" }));
    mocked.getGraph().nodes.push(node("color-ref", "asset", "swatch", "藏蓝色", 0, 900, { color: "#26384c" }));
    const saved = JSON.stringify(mocked.getGraph());
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/${PROJECT_ID}`);
    const work = page.getByRole("region", { name: "设计作品工作台", exact: true });
    await expect(work).toBeVisible();
    await expect(work.getByRole("region", { name: "方案组 1", exact: true })).toBeVisible();
    await expect(work.getByRole("button", { name: /^打开方案/ })).toHaveCount(2);
    await expect(page.locator("[data-workflow-edge]")).toHaveCount(0);
    await expect(page.locator('[data-kind="tool"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "＋ 添加工具", exact: true })).toHaveCount(0);
    await work.getByText("设计说明", { exact: false }).click();
    await expect(work.getByText("候选 A 更符合目标", { exact: true })).toBeVisible();
    await expect(work.getByText("藏蓝色与宽松 H 型廓形", { exact: true })).toBeVisible();
    await work.getByRole("button", { name: "查看完整评估", exact: true }).click();
    const details = page.getByRole("region", { name: "节点详情工作区", exact: true });
    await expect(details).toBeVisible();
    await details.getByRole("button", { name: /返回画布/ }).click();
    await work.evaluate((element) => { element.scrollTop = 0; });
    await mkdir("output/playwright/design-workbench", { recursive: true });
    await page.screenshot({ path: `output/playwright/design-workbench/designs-${width}.png` });
    await work.getByRole("region", { name: "参考素材", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/design-workbench/materials-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await work.getByRole("button", { name: "引用素材 廓形参考", exact: true }).click();
    await expect(page.getByRole("button", { name: "移除引用 廓形参考", exact: true })).toBeVisible();
    expect(mocked.workflowRequests).toHaveLength(0);
    if (width < 768) await page.getByRole("button", { name: "画布", exact: true }).click();
    await page.getByRole("button", { name: "流程画布", exact: true }).click();
    await expect(page.locator('[data-kind="tool"]')).toHaveCount(3);
    await page.reload();
    await expect(page.getByRole("button", { name: "流程画布", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-kind="tool"]')).toHaveCount(3);
    await page.getByRole("button", { name: "设计工作台", exact: true }).click();
    await expect(work).toBeVisible();
    expect(JSON.stringify(mocked.getGraph())).toBe(saved);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(errors).toEqual([]);
  });
}

test("作品工作台：空项目直接开始，失败任务可恢复且默认不渲染流程图", async ({ page }) => {
  const mocked = await mockWorkflow(page, "workbench");
  mocked.getGraph().nodes.splice(0);
  mocked.getGraph().edges.splice(0);
  await page.goto(`/${PROJECT_ID}`);
  const work = page.getByRole("region", { name: "设计作品工作台", exact: true });
  await work.getByRole("button", { name: "开始设计", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeFocused();
  const failed = node("failed-gen", "tool", "generate_design", "风衣方案生成", 0, 0, { params: { prompt: "藏蓝风衣", count: 2 } });
  failed.status = "failed";
  mocked.getGraph().nodes.push(failed);
  mocked.getGraph().revision++;
  await page.reload();
  await expect(work.getByText("未完成", { exact: true })).toBeVisible();
  await work.getByRole("button", { name: "查看原因与重试", exact: true }).click();
  const details = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await expect(details.getByRole("button", { name: "重试执行", exact: true })).toBeVisible();
  expect(mocked.getExecuteCount()).toBe(0);
});

test("作品工作台：方案详情返回恢复焦点，导出可转入完整流程", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const mocked = await mockWorkflow(page, "workbench");
  await page.goto(`/${PROJECT_ID}`);
  const work = page.getByRole("region", { name: "设计作品工作台", exact: true });
  await work.getByRole("button", { name: "打开方案 候选 A", exact: true }).click();
  const details = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: /返回画布/ }).click();
  await expect(work.getByRole("group", { name: "服装方案 候选 A", exact: true })).toBeFocused();
  await page.getByText("资料与更多", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出画布 PNG", exact: true }).click();
  expect((await download).suggestedFilename()).toContain(".png");
  await expect(page.locator('[data-kind="tool"]')).toHaveCount(3);
  expect(mocked.getExecuteCount()).toBe(0);
  expect(errors).toEqual([]);
});

async function mockWorkflow(page: Page, view: "workflow" | "workbench" = "workflow") {
  await page.addInitScript((view) => {
    if (sessionStorage.getItem("fashion:e2e-workflow-view-seeded")) return;
    sessionStorage.setItem("fashion:e2e-workflow-view-seeded", "1");
    if (view === "workflow") sessionStorage.setItem("fashion:canvas-view", view);
    else sessionStorage.removeItem("fashion:canvas-view");
  }, view);
  const graph = sampleGraph();
  let proposal: Record<string, unknown> | null = null;
  let executeCount = 0;
  let rejectNextSketch = false;
  let rejectNextRole = false;
  let inferRoleCount = 0;
  let failNextMessage = false;
  let agentVersion = 2;
  let currentPlan: Record<string, unknown> | null = null;
  const executionRequests: Array<Record<string, unknown>> = [];
  const rejectionRequests: Array<Record<string, unknown>> = [];
  const workflowRequests: Array<{ clientRequestId: string; content: string; referencedNodeIds: string[]; focusNodeIds?: string[]; respondingToProposalId?: string }> = [];
  const proposalRequests: Array<{ content: string; referencedNodeIds: string[] }> = [];
  const chatRequests: Array<{ content: string; fileAssetIds: string[]; shapeIds: string[] }> = [];
  const conversations = [
    { id: "workflow-current", mode: "workflow", projectId: PROJECT_ID, title: "通勤风衣协作", createdAt: NOW, updatedAt: NOW, archivedAt: null },
    { id: "chat-old", mode: "legacy", projectId: PROJECT_ID, title: "历史会话", createdAt: NOW, updatedAt: NOW, archivedAt: null },
  ];
  const workflowMessages = new Map<string, Array<Record<string, unknown>>>();
  const contextPatches: Array<Record<string, unknown>> = [];
  const storedPreferences = [{ id: "prefer-matte", text: "偏好哑光面料", status: "active", origin: "inferred", scope: "project", sourceQuote: "上次否决了强反光方案", branchNodeIds: [] as string[], sourceNodeIds: [] as string[] }];
  const context = {
    revision: 1, summaryRevision: 0, currentObjective: "秋冬通勤风衣", currentTask: "比较已有候选", focusNodeIds: [] as string[],
    requirements: [{ id: "must-navy", text: "保留藏蓝色", status: "active", origin: "explicit", sourceQuote: "藏蓝色、宽松廓形", scope: "project" }],
    preferences: storedPreferences.slice(), state: { preferences: storedPreferences },
    scopedMemory: [] as Array<{ id: string; branchNodeIds: string[]; applicable: boolean }>,
    nodes: graph.nodes.map(({ id, title, type, kind }) => ({ id, title, type, kind })),
    visualCoverage: { total: 2, ready: 1, pending: 1, failed: 0, attachedNodeIds: ["candidate-a"] },
  };
  const projectContext = () => {
    const related = new Set(context.focusNodeIds);
    for (const direction of ["upstream", "downstream"]) {
      const seen = new Set(context.focusNodeIds);
      const pending = [...context.focusNodeIds];
      while (pending.length) {
        const id = pending.pop();
        for (const connection of graph.edges) {
          const next = direction === "upstream" ? connection.targetNodeId === id ? connection.sourceNodeId : null : connection.sourceNodeId === id ? connection.targetNodeId : null;
          if (next && !seen.has(next)) { seen.add(next); related.add(next); pending.push(next); }
        }
      }
    }
    const applicable = (item: (typeof storedPreferences)[number]) => item.status === "active" && (item.scope === "project" || item.branchNodeIds.some((id) => related.has(id)));
    context.preferences = storedPreferences.filter(applicable);
    context.scopedMemory = storedPreferences.filter((item) => item.status === "active" && item.scope === "branch").map((item) => ({ id: item.id, branchNodeIds: item.branchNodeIds, applicable: applicable(item) }));
    return context;
  };

  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: "e2e-user", authId: "auth-e2e", email: "workflow@example.com", name: "Workflow E2E", avatar: null, createdAt: NOW, deletedAt: null },
    credits: { limit: 600, remaining: 500, used: 100 },
  } }));
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) => route.fulfill({ json: {
    id: PROJECT_ID, name: "秋冬通勤风衣", archived: false, createdAt: NOW, updatedAt: NOW,
    assetCount: 2, coverAssetId: null, coverUrl: null,
  } }));
  await page.route("**/api/design-assets/asset-*/thumbnail", (route) => route.fulfill({
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400'><rect width='300' height='400' fill='#e9e5df'/><path d='M100 60 150 35 200 60 235 130 190 145 185 345 115 345 110 145 65 130Z' fill='#263950'/></svg>",
    contentType: "image/svg+xml",
  }));
  await page.route("**/api/design-assets/asset-*/content", (route) => route.fulfill({
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400'><rect width='300' height='400' fill='#e9e5df'/><path d='M100 60 150 35 200 60 235 130 190 145 185 345 115 345 110 145 65 130Z' fill='#263950'/></svg>",
    contentType: "image/svg+xml",
  }));
  await page.route("**/api/design-assets/asset-*/versions?*", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/design-assets/asset-*/path", (route) => route.fulfill({ json: { steps: [], decisions: [], incomplete: false } }));
  await page.route("**/api/files/sign-upload", (route) => route.fulfill({ json: {
    file: { id: "sketch-file", status: "READY", thumbnail1024Url: "/api/files/sketch-file/thumbnail/1024", thumbnail256Url: null },
    upload: null,
  } }));
  await page.route("**/api/files/sketch-file/thumbnail/1024", (route) => route.fulfill({
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><path d='M120 40 170 40 225 245 70 245Z' fill='#40536d'/></svg>",
    contentType: "image/svg+xml",
  }));
  await page.route(`**/api/projects/${PROJECT_ID}/board`, (route) => route.fulfill({ json: { elements: [], revision: 0, snapshot: null } }));
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill({ json: graph });
    const body = route.request().postDataJSON() as {
      mode: "semantic" | "layout";
      operations?: Operation[];
      positions?: Array<{ nodeId: string; x: number; y: number }>;
    };
    if (body.mode === "semantic" && rejectNextSketch && body.operations?.some((item) => item.type === "add_node" && item.node.type === "sketch")) {
      rejectNextSketch = false;
      return route.fulfill({ json: { message: "图修订冲突，请重试" }, status: 409 });
    }
    if (body.mode === "semantic") {
      for (const operation of body.operations ?? []) {
        if (operation.type === "add_node") graph.nodes.push({ ...operation.node, status: "ready", createdAt: NOW, updatedAt: NOW });
        if (operation.type === "update_node") {
          const target = graph.nodes.find((item) => item.id === operation.nodeId);
          if (target) {
            if (operation.title !== undefined) target.title = operation.title;
            if (operation.payload !== undefined) target.payload = operation.payload;
            target.updatedAt = new Date().toISOString();
          }
        }
        if (operation.type === "link_collection") {
          const target = graph.nodes.find((item) => item.id === operation.nodeId);
          if (target) target.payload = { ...target.payload, collectionId: operation.collectionId };
        }
        if (operation.type === "add_edge") graph.edges.push(operation.edge);
        if (operation.type === "remove_node") {
          graph.nodes = graph.nodes.filter((item) => item.id !== operation.nodeId);
          graph.edges = graph.edges.filter((item) => item.sourceNodeId !== operation.nodeId && item.targetNodeId !== operation.nodeId);
        }
        if (operation.type === "remove_edge") graph.edges = graph.edges.filter((item) => item.id !== operation.edgeId);
      }
      graph.revision += 1;
    } else {
      for (const position of body.positions ?? []) {
        const target = graph.nodes.find((item) => item.id === position.nodeId);
        if (target) { target.x = position.x; target.y = position.y; }
      }
      graph.layoutRevision += 1;
    }
    return route.fulfill({ json: graph });
  });
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/tools")) return route.fulfill({ json: { agentVersion, tools: [] } });
    if (path.endsWith("/agent-settings")) { agentVersion = route.request().postDataJSON().version; return route.fulfill({ json: { version: agentVersion } }); }
    if (path.endsWith("/sync")) return route.fulfill({ json: { ...graph, proposals: proposal ? [proposal] : [] } });
    if (path.endsWith("/proposals")) {
      const body = route.request().postDataJSON() as { content: string; referencedNodeIds: string[] };
      proposalRequests.push(body);
      const added = node("edit-proposed", "tool", "edit_design", "局部修改 A", 740, 690, {
        toolKey: "edit_design", toolVersion: "1", params: { prompt: body.content },
      });
      proposal = {
        id: "proposal-1", baseRevision: graph.revision, status: "pending", content: body.content,
        referencedNodeIds: body.referencedNodeIds, rationale: "保留候选 A 主体，单独调整袖型。",
        toolNodeId: added.id, createdAt: NOW,
        operations: [
          { type: "add_node", node: { id: added.id, kind: added.kind, type: added.type, title: added.title, payload: added.payload, x: added.x, y: added.y } },
          { type: "add_edge", edge: edge("edit-source", "candidate-a", added.id, "source") },
        ],
      };
      return route.fulfill({ json: proposal, status: 201 });
    }
    if (path.endsWith("/accept") && proposal) {
      const accepted = proposal as { operations: Operation[] };
      for (const operation of accepted.operations) {
        if (operation.type === "add_node") graph.nodes.push({ ...operation.node, status: "ready", createdAt: NOW, updatedAt: NOW });
        if (operation.type === "add_edge") graph.edges.push(operation.edge);
        if (operation.type === "remove_edge") graph.edges = graph.edges.filter((item) => item.id !== operation.edgeId);
        if (operation.type === "update_node") { const target = graph.nodes.find((item) => item.id === operation.nodeId); if (target) { if (operation.title) target.title = operation.title; if (operation.payload) target.payload = operation.payload; target.updatedAt = new Date().toISOString(); } }
      }
      graph.revision += 1;
      proposal.status = "accepted";
      proposal = null;
      return route.fulfill({ json: graph });
    }
    if (path.endsWith("/reject")) {
      rejectionRequests.push(route.request().postDataJSON());
      if (proposal) proposal.status = "rejected";
      proposal = null;
      return route.fulfill({ json: { ...graph, proposals: [] } });
    }
    if (path.endsWith("/execute")) {
      executeCount += 1;
      executionRequests.push(route.request().postDataJSON());
      const target = graph.nodes.find((item) => item.id === path.split("/").at(-2));
      if (target) target.status = "running";
      return route.fulfill({ json: graph });
    }
    if (path.endsWith("/infer-role")) {
      inferRoleCount += 1;
      if (rejectNextRole) {
        rejectNextRole = false;
        return route.fulfill({ status: 503, json: { message: "角色识别暂不可用" } });
      }
      const nodeId = path.split("/").at(-2);
      const target = graph.nodes.find((item) => item.id === nodeId);
      if (target) {
        target.payload = { ...target.payload, role: target.type === "sketch" ? "silhouette_ref" : "detail_ref", roleSource: "inferred", roleInferenceState: "ready", roleLabel: target.type === "sketch" ? "廓形草图" : "细节参考" };
        target.updatedAt = new Date().toISOString();
        graph.revision += 1;
      }
      return route.fulfill({ json: graph });
    }
    if (path.endsWith("/history")) return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 404 });
  });
  await page.route(`**/api/projects/${PROJECT_ID}/agent-conversations*`, (route) => {
    if (route.request().method() === "POST") {
      const created = { id: "chat-new", mode: "workflow", projectId: PROJECT_ID, title: "新会话", createdAt: NOW, updatedAt: NOW, archivedAt: null };
      conversations.unshift(created);
      return route.fulfill({ json: created, status: 201 });
    }
    return route.fulfill({ json: { items: conversations, nextCursor: null } });
  });
  await page.route("**/api/agent-conversations/*/messages*", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { content: string; fileAssetIds: string[]; shapeIds: string[] };
      chatRequests.push(body);
      return route.fulfill({ json: {
        userMessage: { id: "new-user", content: body.content, role: "user", status: "completed" },
        assistantMessage: { id: "new-assistant", content: "已收到，继续设计。", role: "assistant", status: "completed" },
        taskId: null,
      }, status: 201 });
    }
    const id = path.split("/").at(-2) ?? "";
    return route.fulfill({ json: { items: path.includes("chat-old") ? [{ id: "old-message", content: "历史消息", role: "user", status: "completed" }] : workflowMessages.get(id) ?? [], nextCursor: null } });
  });
  await page.route("**/api/agent-conversations/*/context", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      contextPatches.push(body);
      if (body.currentObjective !== undefined) context.currentObjective = body.currentObjective;
      if (body.focusNodeIds !== undefined) { context.focusNodeIds = body.focusNodeIds; context.summaryRevision += 1; }
      for (const id of body.disabledPreferenceIds ?? []) {
        const preference = storedPreferences.find((item) => item.id === id);
        if (preference) preference.status = "inactive";
      }
      for (const update of body.updatedItems ?? []) {
        const item = [...context.requirements, ...storedPreferences].find((entry) => entry.id === update.id);
        if (item && update.text) item.text = update.text;
        if (item && update.scope) item.scope = update.scope;
        if (item && update.confirm) item.origin = "explicit";
      }
      context.revision += 1;
    }
    return route.fulfill({ json: projectContext() });
  });
  await page.route("**/api/agent-conversations/*/plan", (route) => route.fulfill({ json: { revision: 1, plan: currentPlan } }));
  await page.route("**/api/agent-conversations/*/workflow-messages", (route) => {
    const body = route.request().postDataJSON() as { clientRequestId: string; content: string; referencedNodeIds: string[]; focusNodeIds?: string[]; respondingToProposalId?: string };
    workflowRequests.push(body);
    const conversationId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    const history = workflowMessages.get(conversationId) ?? [];
    if (body.respondingToProposalId) for (const message of history) {
      const prior = message.proposal as { id?: string; status?: string } | null;
      if (prior?.id === body.respondingToProposalId) prior.status = "superseded";
    }
    const previous = history.findIndex((message) => message.clientRequestId === body.clientRequestId);
    const ordinal = previous >= 0 ? previous : history.length;
    const failed = failNextMessage;
    failNextMessage = false;
    if (!failed && body.focusNodeIds !== undefined) { context.focusNodeIds = body.focusNodeIds; context.summaryRevision += 1; }
    const isReply = body.content.includes("比较两张风衣图");
    if (!isReply) {
      proposalRequests.push(body);
      const added = node(`edit-proposed-${ordinal}`, "tool", "edit_design", "局部修改 A", 740, 690, { toolKey: "edit_design", toolVersion: "1", params: { prompt: body.content } });
      proposal = { id: `proposal-${ordinal}`, baseRevision: graph.revision, status: "pending", content: body.content, referencedNodeIds: body.referencedNodeIds, rationale: "保留候选 A 主体，单独调整袖型。", toolNodeId: added.id, createdAt: NOW, operations: [
        { type: "add_node", node: { id: added.id, kind: added.kind, type: added.type, title: added.title, payload: added.payload, x: added.x, y: added.y } },
        { type: "add_edge", edge: edge("edit-source", "candidate-a", added.id, "source") },
      ] };
    }
    const userMessage = { id: `user-${ordinal}`, clientRequestId: body.clientRequestId, content: body.content, role: "user", status: "completed", context: { referencedNodeIds: body.referencedNodeIds, focusNodeIds: body.focusNodeIds ?? null, respondingToProposalId: body.respondingToProposalId ?? null } };
    const assistantMessage = { id: `assistant-${ordinal}`, replyToId: userMessage.id, content: failed ? "本轮分析未完成，请重试。" : isReply ? "已收到，继续设计。" : "可以保留主体，单独调整袖型。", role: "assistant", status: failed ? "failed" : "completed", kind: isReply ? "reply" : "propose", proposal: isReply ? null : proposal, context: projectContext(), error: failed ? { code: "WORKFLOW_ASSISTANT_FAILED", message: "设计助手暂时无法完成请求，可以重试" } : null };
    if (previous >= 0) history.splice(previous, 2, userMessage, assistantMessage);
    else history.push(userMessage, assistantMessage);
    workflowMessages.set(conversationId, history);
    return route.fulfill({ status: 201, json: { userMessage, assistantMessage } });
  });
  return { getGraph: () => graph, getExecuteCount: () => executeCount, getInferRoleCount: () => inferRoleCount, rejectSketchOnce: () => { rejectNextSketch = true; }, rejectRoleOnce: () => { rejectNextRole = true; }, failMessageOnce: () => { failNextMessage = true; }, setPendingProposal: (value: Record<string, unknown>) => { proposal = value; }, proposalRequests, chatRequests, workflowRequests, contextPatches, executionRequests, rejectionRequests, getContext: () => context, setPlan: (value: Record<string, unknown>) => { currentPlan = value; }, setMessages: (items: Array<Record<string, unknown>>) => workflowMessages.set("workflow-current", items), appendMessage: (value: Record<string, unknown>) => { const items = workflowMessages.get("workflow-current") ?? []; items.push(value); workflowMessages.set("workflow-current", items); }, clearConversations: () => { conversations.length = 0; } };
}

test("方案确认显示数量与保留项，一次确认更新原节点并执行", async ({ page }) => {
  // Keep artifact capture independent of optional external canvas fonts.
  await page.route(/\.(?:woff2?|ttf|otf)(?:\?.*)?$/u, (route) => route.abort());
  const mocked = await mockWorkflow(page);
  const draft = node("fig8-draft", "tool", "generate_design", "待执行生成", 1080, 1050, { params: { prompt: "原方案", count: 2 } });
  draft.status = "ready";
  mocked.getGraph().nodes.push(draft);
  mocked.getGraph().edges.push(edge("fig8-old-input", "constraint", draft.id, "constraint"));
  const proposal = { id: "fig8-configure", schemaVersion: 2, baseRevision: 1, status: "pending", rationale: "只修改候选数量", content: "生成四张", toolNodeId: draft.id, referencedNodeIds: ["constraint"], createdAt: NOW,
    action: { type: "configure_tool", toolKey: "generate_design", toolVersion: "1", targetNodeId: draft.id, targetNodeVersionId: "version-1", title: "四个风衣方案", parameters: { prompt: "保留藏蓝和肩线", count: 4 }, inputs: [{ nodeId: "constraint", port: "constraint" }] }, preserve: ["藏蓝色", "肩线"], preview: { before: { parameters: { count: 2 } }, after: { parameters: { count: 4 } }, effect: "更新原工具，保留版本" },
    operations: [{ type: "update_node", nodeId: draft.id, title: "四个风衣方案", payload: { params: { prompt: "保留藏蓝和肩线", count: 4 } } }] };
  mocked.setPendingProposal(proposal);
  mocked.setMessages([{ id: "fig8-reply", role: "assistant", status: "completed", content: "可以按四个候选比较。", proposal, context: null }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('[data-kind="tool"]')).toHaveCount(4);
  await expect(page.locator('[data-type="generate_design"][data-status="proposed"]')).toHaveCount(1);
  await expect(page.getByRole("region", { name: "方案确认" })).toContainText("4 张方案");
  expect(mocked.getExecuteCount()).toBe(0);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/fig8-collaboration-review.png" });
  await page.getByRole("button", { name: "修改要求", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消修改", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认并生成", exact: true }).click();
  await expect.poll(() => draft.payload.params).toMatchObject({ count: 4 });
  expect(mocked.getGraph().nodes).toHaveLength(10);
  expect({ x: draft.x, y: draft.y }).toEqual({ x: 1080, y: 1050 });
  await expect.poll(() => mocked.getExecuteCount()).toBe(1);
  await expect(page.getByRole("button", { name: "取消修改", exact: true })).toHaveCount(0);
});

test("修改要求复用输入框与引用，关联原提案并覆盖旧引用", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("请修改 @候选 A 的袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await page.getByRole("button", { name: "修改要求", exact: true }).click();
  await page.getByRole("button", { name: "移除引用 候选 A", exact: true }).click();
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("保留藏蓝和立领，只调整 @候选 B 的袖型，生成3张");
  await page.getByRole("button", { name: "更新方案 ↑", exact: true }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(2);
  expect(mocked.workflowRequests[1]).toMatchObject({ respondingToProposalId: "proposal-0", referencedNodeIds: ["candidate-b"] });
  expect(mocked.workflowRequests[1]?.content).toContain("生成3张");
  expect(mocked.workflowRequests[1]?.referencedNodeIds).not.toContain("candidate-a");
  expect(mocked.getExecuteCount()).toBe(0);
});

test("后台结果持续恢复，移除重复工作计划后不再轮询计划", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  let planRequests = 0;
  page.on("request", (request) => { if (/\/agent-conversations\/[^/]+\/plan$/u.test(request.url())) planRequests++; });
  mocked.setPlan({ goal: "改进通勤风衣", milestones: [{ id: "inspect", title: "比较实际候选", status: "active", completionCriteria: ["确认肩线和袖型"], evidenceRefs: ["candidate-a"] }], activeMilestoneId: "inspect", nextGoal: "确定修改范围", completionCriteria: ["设计师选定方案"] });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByLabel("工作计划", { exact: true })).toHaveCount(0);
  mocked.appendMessage({ id: "result-1", role: "assistant", status: "completed", content: "已完成本次执行，共两个候选。", origin: "execution_result", executionId: "execution-1", sourceEventId: "event-1" });
  mocked.appendMessage({ id: "analysis-1", role: "assistant", status: "pending", content: "正在比较两个候选的肩线。", origin: "background_analysis", executionId: "execution-1" });
  await expect(page.getByText("已完成本次执行，共两个候选。", { exact: true })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("比较两张风衣图，先保留现有方案");
  await expect(page.getByRole("button", { name: "发送 ↑" })).toBeEnabled();
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByText("已完成本次执行，共两个候选。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("工作计划", { exact: true })).toHaveCount(0);
  expect(planRequests).toBe(0);
});

test("Fig8 调整提案失败后重试保留原提案关联和精确输入", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("请修改 @候选 A 的袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await page.getByRole("button", { name: "修改要求", exact: true }).click();
  await page.getByRole("button", { name: "移除引用 候选 A", exact: true }).click();
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("保留藏蓝和立领，只调整 @候选 B 的袖型，生成3张");
  mocked.failMessageOnce();
  await page.getByRole("button", { name: "更新方案 ↑", exact: true }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "重试这条回复" }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(3);
  expect(mocked.workflowRequests[2]).toEqual(mocked.workflowRequests[1]);
  expect(mocked.workflowRequests[2]).toMatchObject({ respondingToProposalId: "proposal-0", referencedNodeIds: ["candidate-b"], focusNodeIds: ["candidate-b"] });
  await expect(page.locator('[data-role="user"]')).toHaveCount(2);
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(2);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("Fig8 逐条纠正有来源的要求，暂停协作后历史保留并可重新启用", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await openDesignRequirements(page);
  await page.getByRole("button", { name: "更正这条要求", exact: true }).click();
  await page.getByRole("textbox", { name: "更正内容", exact: true }).fill("保留深藏蓝色，避免纯黑");
  await page.getByRole("button", { name: "保存更正", exact: true }).click();
  await expect.poll(() => mocked.contextPatches.length).toBe(1);
  expect(mocked.contextPatches[0]).toMatchObject({ updatedItems: [{ id: "must-navy", text: "保留深藏蓝色，避免纯黑", scope: "project", confirm: true }] });
  await page.getByRole("button", { name: "关闭设计要求与偏好" }).click();
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "暂停设计协作", exact: true }).click();
  await expect(page.getByText("设计协作已暂停。历史消息和已有执行仍保留，可在“更多”中重新启用。", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByText("设计协作已暂停。历史消息和已有执行仍保留，可在“更多”中重新启用。", { exact: true })).toBeVisible();
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "启用设计协作", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeEnabled();
});

test("Fig8 手动参数遵循统一契约，执行前创建会话并绑定执行归属", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.clearConversations();
  const draft = node("fig8-manual", "tool", "generate_design", "手动生成", 1080, 1050, { toolKey: "generate_design", toolVersion: "1", params: { prompt: "保持通勤风衣要求" } });
  draft.status = "ready";
  const reference = node("fig8-ref", "asset", "reference_image", "肩线参考", 740, 1050, { fileAssetId: "sketch-file", role: "detail_ref", roleSource: "manual" });
  mocked.getGraph().nodes.push(draft, reference);
  mocked.getGraph().edges.push(edge("fig8-constraint", "constraint", draft.id, "constraint"), edge("fig8-reference", reference.id, draft.id, "reference"));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('[data-kind="tool"]')).toHaveCount(4);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fashion-workflow:node-details", { detail: "fig8-manual" })));
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "候选数量", exact: true }).fill("4");
  await page.getByRole("combobox", { name: "图像质量", exact: true }).selectOption("auto");
  await page.getByRole("spinbutton", { name: "参考强度 肩线参考", exact: true }).fill("0.4");
  await page.getByRole("button", { name: "保存工具参数", exact: true }).click();
  await expect.poll(() => draft.payload.params).toMatchObject({ count: 4, quality: "auto", referenceInputs: [{ nodeId: reference.id, role: "detail_ref", weight: 0.4 }] });
  await page.getByRole("button", { name: "确认并执行", exact: true }).click();
  await expect.poll(() => mocked.executionRequests.length).toBe(1);
  expect(mocked.executionRequests[0]).toMatchObject({ conversationId: "chat-new" });
});

test("一次跳过建议，不再出现重复确认表单且不触发执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("请优化袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await expect.poll(() => mocked.rejectionRequests.length).toBe(1);
  expect(mocked.rejectionRequests[0]).not.toHaveProperty("reason");
  await expect(page.getByRole("textbox", { name: "跳过理由" })).toHaveCount(0);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("主画布完整显示设计路径，节点保存与拖拽可在刷新后恢复", async ({ page }) => {
  test.setTimeout(60_000);
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  const canvas = page.getByRole("region", { name: "设计工作流画布" });
  const report = canvas.locator('[data-type="evaluation"]');
  await expect(report).toBeVisible();
  await expect(canvas.locator('[data-type="candidate"]')).toHaveCount(2);
  const reportBox = await report.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(reportBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect((reportBox?.x ?? Infinity) + (reportBox?.width ?? Infinity)).toBeLessThan((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0));
  const menuBox = await page.getByRole("button", { name: "＋ 添加素材" }).boundingBox();
  expect((reportBox?.y ?? Infinity) + (reportBox?.height ?? Infinity)).toBeLessThan(menuBox?.y ?? 0);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/workflow-canvas-1440-verified.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.waitForTimeout(250);
  await page.screenshot({ path: "output/playwright/workflow-canvas-1920-verified.png" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "＋ 添加工具" }).click();
  await page.getByRole("button", { name: /局部修改 候选/ }).click();
  await expect(canvas.locator('[data-type="edit_design"]')).toHaveCount(1);
  const newNode = mocked.getGraph().nodes.find((item) => item.type === "edit_design");
  expect(newNode).toBeDefined();
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(canvas.locator('[data-type="edit_design"]')).toHaveCount(1);

  const shape = canvas.locator('[data-type="brief"]');
  await shape.hover();
  const before = await shape.boundingBox();
  expect(before).not.toBeNull();
  const x = (before?.x ?? 0) + (before?.width ?? 0) / 2;
  const y = (before?.y ?? 0) + (before?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => mocked.getGraph().layoutRevision).toBeGreaterThan(0);
  const savedPosition = mocked.getGraph().nodes.find((item) => item.id === "brief");
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  expect(mocked.getGraph().nodes.find((item) => item.id === "brief")?.x).toBe(savedPosition?.x);
});

test("从面料库加入的图片使用素材布局且名称只显示一次", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.route("**/api/fabrics?*", (route) => route.fulfill({ json: { items: [
    { id: "fabric-cotton", tags: ["棉麻", "斜纹"], mainImageUrl: "/api/files/sketch-file/thumbnail/1024" },
  ] } }));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: /面料库/ }).click();
  await page.getByRole("region", { name: "选择面料" }).getByRole("button", { name: "棉麻 · 斜纹" }).click();
  const fabric = page.locator('[data-type="fabric"]');
  await expect(fabric).toHaveAttribute("data-image", "true");
  await expect(fabric.getByText("棉麻 · 斜纹", { exact: true })).toHaveCount(1);
  await expect(fabric.locator("p")).toHaveCount(0);
  await expect(fabric.locator("img")).toHaveCSS("object-fit", "contain");
  expect(mocked.getGraph().nodes.find((item) => item.type === "fabric")?.payload).toMatchObject({ fabricId: "fabric-cotton", text: "" });
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(fabric).toHaveAttribute("data-image", "true");
  await expect(fabric.getByText("棉麻 · 斜纹", { exact: true })).toHaveCount(1);
  await expect(fabric.locator("p")).toHaveCount(0);
});

for (const { imageType, width, height, metadata } of [
  { imageType: "reference_image", width: 1600, height: 900, metadata: false },
  { imageType: "sketch", width: 600, height: 900, metadata: true },
  { imageType: "candidate", width: 1200, height: 1200, metadata: false },
  { imageType: "reference_image", width: 2400, height: 400, metadata: true },
  { imageType: "candidate", width: 400, height: 2400, metadata: true },
  { imageType: "fabric", width: 1600, height: 900, metadata: false },
  { imageType: "fabric", width: 600, height: 900, metadata: true },
  { imageType: "fabric", width: 900, height: 900, metadata: false },
] as const) {
  test(`${imageType} ${width}×${height} 图片完整贴合节点，连线随尺寸同步且刷新后保持`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    const graph = mocked.getGraph();
    graph.nodes = [
      node("ratio-image", "asset", imageType, "自适应图片", 40, 120, { imageUrl: "/api/ratio-image", ...(imageType === "fabric" ? { text: "自适应图片" } : {}), ...(metadata ? { width, height } : {}) }),
      node("ratio-target", "tool", "evaluate_design", "服装评估", 540, 120),
    ];
    graph.edges = [edge("ratio-edge", "ratio-image", "ratio-target", imageType === "candidate" ? "candidate" : "reference")];
    await page.route("**/api/ratio-image", (route) => route.fulfill({
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#a5b9b0"/><path d="M0 0L${width} ${height}M${width} 0L0 ${height}" stroke="#40544e" stroke-width="8"/></svg>`,
      contentType: "image/svg+xml",
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    const image = page.locator(`[data-type="${imageType}"] img`);
    const expectFittedImage = async () => {
      await expect.poll(() => image.evaluate((element) => {
        const img = element as HTMLImageElement;
        if (!img.complete || !img.naturalWidth) return Infinity;
        const box = img.getBoundingClientRect();
        const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
        return Math.max(Math.abs(box.width - img.naturalWidth * scale), Math.abs(box.height - img.naturalHeight * scale));
      })).toBeLessThan(1);
      const title = page.locator(`[data-type="${imageType}"] header`);
      await expect(title).toBeVisible();
      await expect(page.locator(`[data-type="${imageType}"]`).getByText("自适应图片", { exact: true })).toHaveCount(1);
      await expect(image).toHaveCSS("object-fit", "contain");
      await expect.poll(() => image.evaluate((element) => {
        const imageBox = element.getBoundingClientRect();
        const titleBox = element.closest('[data-image="true"]')?.querySelector("header")?.getBoundingClientRect();
        return titleBox ? Math.abs(imageBox.bottom - titleBox.top) : Infinity;
      })).toBeLessThan(1);
      await expect.poll(() => page.locator('[data-workflow-edge="ratio-edge"] path').first().evaluate((element) => {
        const origin = (element as SVGPathElement).getScreenCTM();
        const port = document.querySelector('[data-node-id="ratio-image"][data-workflow-port="output"]')?.getBoundingClientRect();
        return origin && port ? Math.hypot(origin.e - port.x - port.width / 2, origin.f - port.y - port.height / 2) : Infinity;
      })).toBeLessThan(2);
    };
    await expect(image).toBeVisible();
    await expectFittedImage();
    if (width === 1600 || width === 400) {
      await mkdir("output/playwright", { recursive: true });
      await page.screenshot({ path: `output/playwright/workflow-${imageType}-${width === 1600 ? "landscape" : "portrait"}-fitted.png` });
    }
    await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await expect(image).toBeVisible();
    await expectFittedImage();
  });
}

for (const imageType of ["reference_image", "sketch", "candidate"] as const) {
  test(`${imageType} 图片区域可连续拖动、缩放拖动并在刷新后恢复`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    const graph = mocked.getGraph();
    const draggedNode = node("dragged-image", "asset", imageType, "图片拖动回归", 40, 120, { imageUrl: "/api/design-assets/asset-a/thumbnail" });
    graph.nodes = [
      draggedNode,
      node("target", "tool", "evaluate_design", "服装评估", 440, 120),
    ];
    graph.edges = [edge("image-output", "dragged-image", "target", imageType === "candidate" ? "candidate" : "reference")];
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    const shape = page.locator(`[data-type="${imageType}"]`);
    const image = shape.locator("img");
    await expect(image).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
    await shape.evaluate(async (element) => {
      const animations: Animation[] = [];
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) animations.push(...ancestor.getAnimations());
      await Promise.all(animations.filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished));
    });
    const events = await page.evaluateHandle(() => {
      const events: string[] = [];
      const canvas = document.querySelector('.tl-container');
      if (!canvas) throw new Error("画布未挂载");
      for (const type of ["dragstart", "pointercancel"]) {
        canvas.addEventListener(type, () => events.push(type), true);
      }
      return events;
    });
    const pointerEvents = await page.evaluateHandle(() => {
      const points: Array<{ type: string; x: number; y: number }> = [];
      for (const type of ["pointerdown", "pointermove", "pointerup"]) {
        document.addEventListener(type, (event) => {
          const pointer = event as PointerEvent;
          const point = { type, x: pointer.clientX, y: pointer.clientY };
          if (type === "pointermove" && points.at(-1)?.type === type) points[points.length - 1] = point;
          else points.push(point);
        }, true);
      }
      return points;
    });
    const wire = page.locator('[data-workflow-edge="image-output"] path').first();
    const expectWireAttached = async () => {
      await expect.poll(async () => {
        const start = await wire.evaluate((element) => {
          const path = element as SVGPathElement;
          const transform = path.getScreenCTM();
          if (!transform) throw new Error("连接未投影到屏幕");
          const point = path.getPointAtLength(0).matrixTransform(transform);
          return { x: point.x, y: point.y };
        });
        const bounds = await shape.boundingBox();
        return bounds ? Math.abs(start.x - bounds.x - bounds.width) + Math.abs(start.y - bounds.y - bounds.height / 2) : Infinity;
      }).toBeLessThan(2);
    };
    const dragImage = async (dx: number, dy: number) => {
      // 等待相机动画结束后测量，避免把缩放位移误当作拖动位移。
      await expect.poll(async () => {
        const before = await shape.boundingBox();
        await page.waitForTimeout(80);
        const after = await shape.boundingBox();
        return before && after ? Math.abs(after.x - before.x) + Math.abs(after.y - before.y) + Math.abs(after.width - before.width) : Infinity;
      }).toBeLessThan(0.1);
      const before = await shape.boundingBox();
      const imageBounds = await image.boundingBox();
      if (!before || !imageBounds) throw new Error("图片素材未显示");
      const initial = { x: draggedNode.x, y: draggedNode.y };
      const zoom = before.width / await shape.evaluate((element) => Number.parseFloat(getComputedStyle(element).width));
      const x = Math.round(imageBounds.x + imageBounds.width / 2);
      const y = Math.round(imageBounds.y + imageBounds.height / 2);
      const layoutRevision = graph.layoutRevision;
      const expectDraggedToDestination = () => expect.poll(async () => {
        const after = await shape.boundingBox();
        return after ? Math.abs(after.x - before.x - dx) + Math.abs(after.y - before.y - dy) : Infinity;
      }).toBeLessThan(2);
      try {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await expect(shape).toHaveAttribute("data-highlighted", "true");
        await page.mouse.move(x + dx, y + dy, { steps: 12 });
        // 连线与节点可能同时停在上一帧，必须先确认移动到终点再松开鼠标。
        await expectDraggedToDestination();
        await expectWireAttached();
        await page.mouse.up();
        expect(await events.jsonValue()).toEqual([]);
        await expectDraggedToDestination();
        await expect.poll(() => graph.layoutRevision).toBeGreaterThan(layoutRevision);
        expect(draggedNode.x - initial.x).toBeCloseTo(dx / zoom, 0);
        expect(draggedNode.y - initial.y).toBeCloseTo(dy / zoom, 0);
      } catch (error) {
        console.log("drag-coordinate-diagnostic", JSON.stringify({ before, after: await shape.boundingBox(), initial, saved: { x: draggedNode.x, y: draggedNode.y }, zoom, points: await pointerEvents.jsonValue() }));
        throw error;
      }
    };
    // 模拟入场动画移动视口但未触发尺寸变化，首个拖动也必须使用最新屏幕边界。
    await page.locator(".tl-container").evaluate((element) => { (element as HTMLElement).style.translate = "14px 8px"; });
    await dragImage(60, 30);
    await dragImage(-40, 25);
    const originalBounds = await shape.boundingBox();
    if (!originalBounds) throw new Error("图片素材未显示");
    await page.getByRole("button", { name: "缩小画布", exact: true }).click();
    await expect.poll(async () => (await shape.boundingBox())?.width ?? Infinity).toBeLessThan(originalBounds.width - 1);
    await dragImage(35, -30);
    const saved = { x: draggedNode.x, y: draggedNode.y };
    await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await expect(image).toBeVisible();
    await expectWireAttached();
    await expect.poll(async () => {
      const imageBounds = await shape.boundingBox();
      const targetBounds = await page.locator('[data-kind="tool"]').boundingBox();
      if (!imageBounds || !targetBounds) return Infinity;
      const zoom = imageBounds.width / await shape.evaluate((element) => Number.parseFloat(getComputedStyle(element).width));
      return Math.abs((imageBounds.x - targetBounds.x) / zoom - (saved.x - 440)) + Math.abs((imageBounds.y - targetBounds.y) / zoom - (saved.y - 120));
    }).toBeLessThan(1);
  });
}

test("@节点提案先以虚线预览，确认后保留分支并直接执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByText("保持藏蓝与宽松廓形，给我两种通勤风衣方案。")).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("请修改 @候选");
  await page.getByRole("option", { name: /候选 A/ }).click();
  await expect(composer).toHaveValue("请修改 @候选 A ");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.locator('[data-role="user"]').getByText("请修改 @候选 A", { exact: false })).toBeVisible();
  await expect(page.locator('[data-type="edit_design"][data-status="proposed"]')).toBeVisible();
  expect(mocked.proposalRequests[0]?.referencedNodeIds).toEqual(["candidate-a"]);
  expect(mocked.getExecuteCount()).toBe(0);
  await page.getByRole("button", { name: "确认并生成", exact: true }).click();
  await expect(page.locator('[data-type="edit_design"][data-status="running"]')).toBeVisible();
  expect(mocked.getGraph().edges.some((item) => item.id === "edit-source")).toBe(true);
  await expect.poll(() => mocked.getExecuteCount()).toBe(1);
});

const port = (page: Page, id: string, side: "input" | "output") => page.locator(`[data-workflow-port="${side}"][data-node-id="${id}"]`);

async function wirePoint(page: Page, id: string) {
  const path = page.locator(`[data-workflow-edge="${id}"] path`).first();
  await path.waitFor();
  // Camera fit is animated; wait for the projected curve to settle before measuring it.
  await expect.poll(async () => {
    const a = await path.boundingBox();
    await page.waitForTimeout(80);
    const b = await path.boundingBox();
    return a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) : Infinity;
  }).toBeLessThan(0.1);
  // 连线可能从节点背后穿过：沿曲线采样，取第一个真正能命中连线自身的点。
  const point = await path.evaluate((element) => {
    const curve = element as SVGPathElement;
    const transform = curve.getScreenCTM();
    if (!transform) throw new Error("连接未投影到屏幕");
    const toScreen = (length: number) => {
      const local = curve.getPointAtLength(length);
      return { x: local.x * transform.a + local.y * transform.c + transform.e, y: local.x * transform.b + local.y * transform.d + transform.f };
    };
    const total = curve.getTotalLength();
    for (const ratio of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const candidate = toScreen(total * ratio);
      const hit = document.elementFromPoint(candidate.x, candidate.y);
      if (hit === curve || (hit instanceof SVGElement && hit.parentElement?.closest("[data-workflow-edge]") === curve.closest("[data-workflow-edge]"))) return candidate;
    }
    return toScreen(total * 0.55);
  });
  return point;
}

async function selectWire(page: Page, id: string) {
  const point = await wirePoint(page, id);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel("连接操作")).toBeVisible();
}

test("上传图片直接作为修改原图，已有参考连线可切换用途", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getGraph().nodes = [
    { ...node("upload", "asset", "reference_image", "上传服装", 80, 100, { fileAssetId: "uploaded-file", role: "style_ref", roleSource: "manual" }), status: "ready" },
    { ...node("detail", "asset", "reference_image", "袖口参考", 80, 470, { fileAssetId: "detail-file", role: "detail_ref", roleSource: "manual" }), status: "ready" },
    { ...node("edit", "tool", "edit_design", "修改上传服装", 480, 100, { toolKey: "edit_design", toolVersion: "1", params: { prompt: "只收窄袖口" } }), status: "ready" },
  ];
  mocked.getGraph().edges = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await port(page, "upload", "output").click();
  await port(page, "edit", "input").click();
  await expect.poll(() => mocked.getGraph().edges.find((item) => item.sourceNodeId === "upload")?.targetPort).toBe("source");
  const mother = mocked.getGraph().edges[0];
  if (!mother) throw new Error("原图连线未保存");
  await selectWire(page, mother.id);
  await page.getByRole("button", { name: "用作参考素材", exact: true }).click();
  await expect.poll(() => mocked.getGraph().edges[0]?.targetPort).toBe("reference");
  const reference = mocked.getGraph().edges[0];
  if (!reference) throw new Error("参考连线未保存");
  await selectWire(page, reference.id);
  await page.getByRole("button", { name: "用作原图", exact: true }).click();
  await expect.poll(() => mocked.getGraph().edges[0]?.targetPort).toBe("source");
  await port(page, "detail", "output").click();
  await port(page, "edit", "input").click();
  await expect.poll(() => mocked.getGraph().edges.find((item) => item.sourceNodeId === "detail")?.targetPort).toBe("reference");
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator("[data-workflow-edge]")).toHaveCount(2);
  expect(mocked.getGraph().edges.filter((item) => item.targetPort === "source")).toHaveLength(1);
  expect(mocked.getExecuteCount()).toBe(0);
  await page.locator('[data-type="edit_design"]').dblclick();
  const details = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await details.getByText("来源与路径", { exact: true }).click();
  await expect(details.getByText("原图 · 上传服装", { exact: true })).toBeVisible();
  await details.getByRole("button", { name: "确认并执行", exact: true }).click();
  await expect.poll(() => mocked.getExecuteCount()).toBe(1);
});

test("直接拖线、点击连线、键盘连接与断开可刷新恢复", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const evaluate = mocked.getGraph().nodes.find((item) => item.id === "evaluate");
  if (evaluate) evaluate.status = "ready";
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await port(page, "reference", "output").hover();
  await port(page, "reference", "output").dragTo(port(page, "evaluate", "input"));
  await expect.poll(() => mocked.getGraph().edges.some((item) => item.sourceNodeId === "reference" && item.targetNodeId === "evaluate")).toBe(true);
  const added = mocked.getGraph().edges.find((item) => item.sourceNodeId === "reference" && item.targetNodeId === "evaluate");
  if (!added) throw new Error("连线未保存");
  await selectWire(page, added.id);
  await page.getByRole("button", { name: "断开连接", exact: true }).click();
  await expect.poll(() => mocked.getGraph().edges.some((item) => item.id === added.id)).toBe(false);
  await port(page, "reference", "output").focus();
  await page.keyboard.press("Enter");
  await port(page, "evaluate", "input").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => mocked.getGraph().edges.length).toBe(12);
  await port(page, "brief", "output").click();
  await port(page, "evaluate", "input").click();
  await expect(page.getByRole("status").filter({ hasText: "这类素材不能" })).toBeVisible();
  expect(mocked.getGraph().edges.length).toBe(12);
  await port(page, "reference", "output").click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("选择另一端的节点 · Esc 取消")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator("[data-workflow-edge]")).toHaveCount(12);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("已运行工具改输入建立独立分支，系统结果来源保持只读", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const originalEdges = structuredClone(mocked.getGraph().edges);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await port(page, "candidate-a", "output").hover();
  await port(page, "candidate-a", "output").click();
  await port(page, "generate", "input").click();
  await expect.poll(() => mocked.getGraph().nodes.length).toBe(10);
  const branch = mocked.getGraph().nodes.find((item) => item.title === "方案生成 · 分支");
  expect(branch).toMatchObject({ status: "ready", type: "generate_design" });
  expect(mocked.getGraph().edges.filter((item) => originalEdges.some((old) => old.id === item.id))).toEqual(originalEdges);
  expect(mocked.getGraph().edges.filter((item) => item.targetNodeId === branch?.id)).toHaveLength(3);
  expect(mocked.getGraph().edges.some((item) => item.sourceNodeId === branch?.id)).toBe(false);
  expect(mocked.getExecuteCount()).toBe(0);
  await expect(page.getByText("已建立新分支", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-workflow-edge="e6"]').waitFor();
  await selectWire(page, "e6");
  await expect(page.getByText("由工具执行维护")).toBeVisible();
  await expect(page.getByRole("button", { name: "断开连接", exact: true })).toHaveCount(0);
});

test("单击保留对话，详情返回恢复草稿，引用需显式加入", async ({ page }) => {
  test.setTimeout(60_000);
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  const appearance = (control: Locator) => control.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, borderColor: style.borderTopColor, borderWidth: Number.parseFloat(style.borderTopWidth) };
  });
  const menu = page.getByLabel("对话操作", { exact: true });
  await menu.focus();
  await menu.press("ArrowDown");
  await page.getByRole("button", { name: "设计要求与偏好", exact: true }).press("Enter");
  const drawer = page.getByRole("dialog", { name: "设计要求与偏好", exact: true });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await composer.fill("保留这段输入草稿");
  await page.locator('[data-type="candidate"]').first().click();
  await expect(composer).toBeVisible();
  await expect(page.getByLabel("正在讨论", { exact: true })).toContainText("整个项目");
  expect(mocked.contextPatches).toHaveLength(0);
  const reference = page.getByRole("button", { name: /引用「候选 A」/ });
  const referenceStyle = await appearance(reference);
  expect(referenceStyle.borderWidth).toBeGreaterThan(0);
  expect(referenceStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await expect(composer).toBeVisible();
  await page.getByRole("button", { name: "返回画布" }).click();
  await expect(composer).toHaveValue("保留这段输入草稿");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.proposalRequests.length).toBe(1);
  expect(mocked.proposalRequests[0]?.referencedNodeIds).toEqual([]);
  const primaryStyle = await appearance(page.getByRole("button", { name: "确认并生成", exact: true }));
  const secondaryStyle = await appearance(page.getByRole("button", { name: "修改要求", exact: true }));
  const quietStyle = await appearance(page.getByRole("button", { name: "跳过", exact: true }));
  expect(primaryStyle.background).not.toBe(secondaryStyle.background);
  expect(secondaryStyle.borderWidth).toBeGreaterThan(0);
  expect(secondaryStyle.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(quietStyle.background).toBe("rgba(0, 0, 0, 0)");
  expect(quietStyle.borderColor).toBe("rgba(0, 0, 0, 0)");
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/workflow-assistant-actions-desktop.png" });
  await page.getByRole("button", { name: "修改要求", exact: true }).click();
  await expect(composer).toBeFocused();
  await composer.fill("保留领口");
  await expect.poll(async () => (await appearance(page.getByRole("button", { name: "更新方案 ↑", exact: true }))).background).toBe(primaryStyle.background);
  await page.getByRole("button", { name: "取消修改", exact: true }).click();
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认跳过", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /引用「候选 A」/ }).click();
  await composer.fill("修改领口");
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await page.getByRole("button", { name: "展开设计助手", exact: true }).click();
  await expect(composer).toHaveValue("修改领口");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.proposalRequests.length).toBe(2);
  expect(mocked.proposalRequests[1]?.referencedNodeIds).toEqual(["candidate-a"]);
  expect(mocked.getExecuteCount()).toBe(0);
  const longTitle = "秋冬通勤风衣候选方案：保留藏蓝色与宽松廓形，优化袖口细节。".repeat(4);
  const candidate = mocked.getGraph().nodes.find((item) => item.id === "candidate-a");
  if (!candidate) throw new Error("候选节点不存在");
  candidate.title = longTitle;
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="candidate"]').first().click();
  const longReference = page.getByRole("button", { name: `＋ 引用「${longTitle}」`, exact: true });
  await expect(longReference).toBeVisible();
  expect(await longReference.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const panel = element.closest("aside")?.getBoundingClientRect();
    return panel ? bounds.left >= panel.left && bounds.right <= panel.right : false;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("拖动输入线的素材端替换原图并清除旧蒙版，取消拖线不保存", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const edit = node("manual-edit", "tool", "edit_design", "修改袖口", 740, 1050, { toolKey: "edit_design", toolVersion: "1", params: { prompt: "修改袖口", taskType: "inpaint", maskImageUrl: "old-mask", referenceImageUrl: "old-image", parentAssetId: "asset-a" } });
  edit.status = "ready";
  mocked.getGraph().nodes.push(edit);
  mocked.getGraph().edges.push(edge("manual-source", "candidate-a", edit.id, "source"));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await selectWire(page, "manual-source");
  await page.getByLabel("拖动更换输入素材").locator("circle").first().dragTo(port(page, "candidate-b", "output"));
  await expect.poll(() => mocked.getGraph().edges.find((item) => item.targetNodeId === edit.id)?.sourceNodeId).toBe("candidate-b");
  expect(edit.payload.params).toEqual({ prompt: "修改袖口", taskType: "i2i" });
  expect(mocked.getGraph().nodes.length).toBe(10);
  const revision = mocked.getGraph().revision;
  await port(page, "reference", "output").hover();
  const start = await port(page, "reference", "output").boundingBox();
  if (!start) throw new Error("端口不可见");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(200, 650, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("选择另一端的节点 · Esc 取消")).toHaveCount(0);
  expect(mocked.getGraph().revision).toBe(revision);
  expect(mocked.getExecuteCount()).toBe(0);
});

for (const savedTheme of [null, "dark", "system"] as const) {
  test(`固定浅色忽略历史主题 ${savedTheme ?? "未设置"}、系统偏好、刷新及页面切换`, async ({ page }) => {
    test.setTimeout(90_000);
    await mockWorkflow(page);
    await page.route("**/api/trends?*", (route) => route.fulfill({ json: { items: [], total: 0, hasMore: false } }));
    await page.route("**/api/trends/digest/current", (route) => route.fulfill({ json: null }));
    await page.addInitScript((value) => {
      if (value === null) localStorage.removeItem("theme");
      else localStorage.setItem("theme", value);
    }, savedTheme);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);

    const expectLightCanvas = async () => {
      await expect(page.locator("[data-workflow-edge]")).toHaveCount(11);
      await expect(page.getByRole("application", { name: "tldraw" })).toHaveClass(/\btl-theme__light\b/);
      await expect(page.locator(".tl-theme__dark")).toHaveCount(0);
      await expect(page.locator("main")).toHaveCSS("background-color", "rgb(250, 250, 250)");
      await expect(page.locator("main")).toHaveCSS("color", "rgb(24, 24, 24)");
      await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
      await expect(page.locator("[data-theme]")).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(savedTheme);
    };

    await expectLightCanvas();
    await page.emulateMedia({ colorScheme: "light" });
    await expectLightCanvas();
    await page.emulateMedia({ colorScheme: "dark" });
    await expectLightCanvas();
    await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await expectLightCanvas();

    const trendsPath = `/trends?from=board&boardId=${PROJECT_ID}`;
    await page.getByText("资料与更多", { exact: true }).click();
    await expect(page.getByRole("link", { name: "趋势档案", exact: true })).toHaveAttribute("href", trendsPath);
    await page.goto(trendsPath);
    await page.waitForURL(/\/trends\?/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "趋势档案", exact: true })).toBeVisible();
    for (const width of [390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("button", { name: "切换主题" })).toHaveCount(0);
      await expect(page.locator("main")).toHaveCSS("background-color", "rgb(245, 245, 245)");
      await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const back = page.getByRole("link", { name: "返回设计画布", exact: true });
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute("href", `/${PROJECT_ID}`);
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: "趋势档案", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "切换主题" })).toHaveCount(0);
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(245, 245, 245)");
    await page.getByRole("link", { name: "返回设计画布", exact: true }).click();
    await expectLightCanvas();
  });
}

test("固定浅色与三种宽度保持画布布局，PNG 导出包含曲线", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator("[data-workflow-edge]")).toHaveCount(11);
  await mkdir("output/playwright", { recursive: true });
  await expect(page.getByRole("application", { name: "tldraw" })).toHaveClass(/\btl-theme__light\b/);
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await showCanvas(page, width);
    await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await showAssistant(page, width);
    await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeVisible();
    await showCanvas(page, width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: `output/playwright/workflow-light-${width}.png` });
  }
  const download = page.waitForEvent("download");
  await page.getByText("资料与更多", { exact: true }).click();
  await page.getByRole("button", { name: "导出画布 PNG", exact: true }).click();
  const file = await download;
  await file.saveAs("output/playwright/workflow-export-with-curves.png");
  expect(await file.failure()).toBeNull();
  await page.getByRole("button", { name: "放大画布" }).click();
  await page.getByRole("button", { name: "缩小画布" }).click();
  await expect(page.locator("[data-workflow-edge]")).toHaveCount(11);
  // Zoom controls take focus; return it to the canvas before the Space pan shortcut.
  const canvas = page.getByRole("application", { name: "tldraw" });
  await canvas.click({ position: { x: 350, y: 120 } });
  await expect(canvas).toBeFocused();
  const beforePan = await port(page, "brief", "output").boundingBox();
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(420, 210, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(async () => (await port(page, "brief", "output").boundingBox())?.x).not.toBe(beforePan?.x);
  const aligned = await page.locator('[data-workflow-edge="e1"] path').first().evaluate((element) => {
    const origin = (element as SVGPathElement).getScreenCTM();
    const bounds = document.querySelector('[data-node-id="brief"][data-workflow-port="output"]')?.getBoundingClientRect();
    return origin && bounds ? Math.hypot(origin.e - bounds.x - bounds.width / 2, origin.f - bounds.y - bounds.height / 2) : Infinity;
  });
  expect(aligned).toBeLessThan(2);
});

test.describe("触屏连线", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("点击两端无需打开详情即可连接", async ({ page }) => {
    const mocked = await mockWorkflow(page);
    mocked.getGraph().nodes = mocked.getGraph().nodes.filter((item) => item.id === "reference" || item.id === "evaluate").map((item, index) => ({ ...item, status: "ready", x: 40 + index * 380, y: 100 }));
    mocked.getGraph().edges = [];
    await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await port(page, "reference", "output").tap();
    await port(page, "evaluate", "input").tap();
    await expect.poll(() => mocked.getGraph().edges.length).toBe(1);
    await page.getByRole("button", { name: "助手", exact: true }).click();
    await expect(page.getByRole("heading", { name: "设计助手", exact: true })).toBeVisible();
    expect(mocked.getExecuteCount()).toBe(0);
  });
});

test("持续对话保留只读历史与新会话；手机节点列表及菜单无横向溢出", async ({ page }) => {
  test.setTimeout(60_000);
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "助手", exact: true }).click();
  const initialSend = page.getByRole("button", { name: "发送 ↑", exact: true });
  await expect(initialSend).toBeDisabled();
  await expect(initialSend).toBeInViewport({ ratio: 1 });
  const disabledBackground = await initialSend.evaluate((element) => getComputedStyle(element).backgroundColor);
  await initialSend.hover();
  await expect(initialSend).toHaveCSS("background-color", disabledBackground);
  await page.getByRole("button", { name: "节点列表" }).click();
  await expect(page.getByRole("listitem").filter({ has: page.getByText("候选 A", { exact: true }) })).toBeVisible();
  await page.getByRole("button", { name: "＋ 添加工具" }).click();
  await expect.poll(async () => {
    const bounds = await page.getByRole("button", { name: /局部修改 候选/ }).boundingBox();
    return bounds ? bounds.x + bounds.width : Infinity;
  }).toBeLessThanOrEqual(390);
  const menuBox = await page.getByRole("button", { name: /局部修改 候选/ }).boundingBox();
  expect((menuBox?.x ?? -1) >= 0).toBe(true);
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? Infinity)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("button", { name: "关闭菜单" }).click();

  await page.getByRole("button", { name: "助手", exact: true }).click();
  const more = page.getByText("更多", { exact: true });
  const moreMenu = more.locator("..");
  await expect(page.getByText("持续设计协作", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" }).locator("..").getByText("更多", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新对话", exact: true })).toHaveCount(0);
  await more.focus();
  await more.press("Enter");
  await expect(moreMenu).toHaveAttribute("open", "");
  await expect(moreMenu.getByRole("button")).toHaveText(["历史会话", "新建设计对话", "暂停设计协作"]);
  await expect.poll(() => moreMenu.getByRole("button").evaluateAll((buttons) => buttons.every((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
  }))).toBe(true);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/workflow-assistant-menu-mobile.png" });
  await page.getByRole("button", { name: "新建设计对话", exact: true }).click();
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await page.getByRole("combobox", { name: "历史会话" }).selectOption("chat-old");
  await expect(page.getByText("历史消息")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toHaveCount(0);
  await more.click();
  await expect(moreMenu.getByRole("button")).toHaveText(["历史会话", "新建设计对话", "旧设计运行", "暂停设计协作"]);
  await more.press("Space");
  await expect(moreMenu).not.toHaveAttribute("open");
  await page.getByRole("combobox", { name: "历史会话" }).selectOption("chat-new");
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("比较两张风衣图");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.getByText("已收到，继续设计。")).toBeVisible();
  const sendBox = await page.getByRole("button", { name: "发送 ↑" }).boundingBox();
  if (!sendBox) throw new Error("发送按钮未显示");
  expect(sendBox.x).toBeGreaterThanOrEqual(0);
  expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(mocked.chatRequests).toHaveLength(0);
  expect(mocked.proposalRequests).toHaveLength(0);
});

test("候选的大图、版本、局部重绘入口和新草图保存均可从主画布到达", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="candidate"]').first().click();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  const workspace = page.getByRole("region", { name: "候选资产工作台", exact: true });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("button", { name: "单图高清导出" })).toBeVisible();
  await workspace.getByRole("tab", { name: "版本历史" }).click();
  await expect(workspace.getByRole("region", { name: "版本时间线" })).toBeVisible();
  await workspace.getByRole("tab", { name: "局部重绘" }).click();
  await expect(workspace.getByRole("textbox", { name: "局部重绘说明" })).toBeVisible();
  await page.getByRole("button", { name: "返回画布" }).click();

  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true }).click();
  const sketch = page.getByRole("dialog", { name: "绘制廓形草图" });
  await expect(sketch).toBeVisible();
  const sketchCanvas = sketch.locator('canvas[aria-label="廓形草图画布"]');
  const bounds = await sketchCanvas.boundingBox();
  expect(bounds).not.toBeNull();
  const x = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
  const y = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
  await page.mouse.move(x - 25, y - 40);
  await page.mouse.down();
  await page.mouse.move(x + 25, y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(sketch.getByRole("button", { name: "保存到工作流" })).toBeEnabled();
  await sketch.getByRole("button", { name: "保存到工作流" }).click();
  await expect(sketch).toHaveCount(0);
  const created = mocked.getGraph().nodes.find((item) => item.type === "sketch");
  expect(created?.payload.fileAssetId).toBe("sketch-file");
  expect(created?.payload).toMatchObject({ role: "silhouette_ref", roleSource: "inferred", roleInferenceState: "ready" });
  await expect(page.locator('[data-type="sketch"]')).toHaveCount(1);

  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true }).click();
  const retryCanvas = sketch.locator('canvas[aria-label="廓形草图画布"]');
  const retryBounds = await retryCanvas.boundingBox();
  const retryX = (retryBounds?.x ?? 0) + (retryBounds?.width ?? 0) / 2;
  const retryY = (retryBounds?.y ?? 0) + (retryBounds?.height ?? 0) / 2;
  await page.mouse.move(retryX - 20, retryY - 20);
  await page.mouse.down();
  await page.mouse.move(retryX + 20, retryY + 20, { steps: 6 });
  await page.mouse.up();
  mocked.rejectSketchOnce();
  await sketch.getByRole("button", { name: "保存到工作流" }).click();
  await expect(sketch).toBeVisible();
  await expect(sketch.getByRole("alert")).toContainText("图修订冲突");
});

test("未执行工具可保存真实参数；历史显示来源和模型，完成后不再提供执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const generate = mocked.getGraph().nodes.find((item) => item.id === "generate");
  expect(generate).toBeDefined();
  if (!generate) return;
  generate.status = "ready";
  generate.payload = { toolKey: "generate_design", toolVersion: "1", params: { prompt: "原始风衣", count: 2, width: 768, height: 1024 } };
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/nodes/generate/history`, (route) => route.fulfill({ json: { items: [{
    id: "attempt-one", ordinal: 1, status: "completed", generationTaskId: "task-one", error: null, createdAt: NOW,
    request: { model: "test-image-model", prompt: "新版通勤风衣", negativePrompt: "避免亮面", width: 1024, height: 1024, inputNodeIds: ["constraint", "reference"], referenceInputs: [{ role: "style_ref", weight: 0.7 }] },
  }] } }));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="generate_design"]').hover();
  await page.locator('[data-type="generate_design"]').dblclick();
  const details = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await expect(details.getByRole("textbox", { name: "执行指令" })).toHaveValue("原始风衣");
  await details.getByRole("textbox", { name: "执行指令" }).fill("新版通勤风衣");
  await details.getByText("高级设置", { exact: true }).click();
  await details.getByRole("textbox", { name: "排除内容" }).fill("避免亮面");
  await details.getByRole("spinbutton", { name: "候选数量" }).fill("3");
  await details.getByRole("spinbutton", { name: "宽度" }).fill("1024");
  await expect(details.getByRole("button", { name: "确认并执行" })).toBeDisabled();
  await details.getByRole("button", { name: "保存工具参数" }).click();
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.id === "generate")?.payload.params).toMatchObject({ prompt: "新版通勤风衣", negativePrompt: "避免亮面", count: 3, width: 1024, height: 1024 });
  await expect(details.getByRole("button", { name: "确认并执行" })).toBeEnabled();
  await details.getByText("执行记录", { exact: true }).click();
  await details.getByRole("button", { name: "读取尝试记录" }).click();
  await expect(details.getByText("模型：test-image-model")).toBeVisible();
  await expect(details.getByText("来源：设计约束、参考素材")).toBeVisible();
  await details.getByRole("button", { name: "确认并执行" }).click();
  expect(mocked.getExecuteCount()).toBe(1);
  generate.status = "completed";
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="generate_design"]').dblclick();
  await expect(details.getByRole("button", { name: "确认并执行" })).toHaveCount(0);
  await expect(details.getByRole("textbox", { name: "执行指令" })).toBeDisabled();
});

test("同名节点仅引用 @列表里明确选中的那条分支", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getContext().focusNodeIds = ["candidate-a"];
  mocked.getGraph().nodes.push(node("candidate-a-branch", "asset", "candidate", "候选 A", 1770, 390, { assetId: "asset-b" }));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("请修改 @候选 A ");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.getByRole("complementary", { name: "设计助手" }).getByRole("alert")).toContainText("请从 @列表选择准确节点");
  expect(mocked.proposalRequests).toHaveLength(0);
  await composer.fill("请修改 @候选");
  await page.getByRole("option", { name: /候选 A/ }).last().click();
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.proposalRequests.length).toBe(1);
  expect(mocked.proposalRequests[0]?.referencedNodeIds).toEqual(["candidate-a-branch"]);
  expect(mocked.workflowRequests[0]?.focusNodeIds).toEqual(["candidate-a-branch"]);
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(composer).toBeEnabled();
  await page.locator('[data-type="candidate"]').first().click();
  expect(mocked.contextPatches).toHaveLength(0);
  expect(mocked.getContext().focusNodeIds).toEqual(["candidate-a-branch"]);
  await composer.fill("比较两张风衣图，继续说明这个分支的袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(2);
  expect(mocked.workflowRequests[1]?.referencedNodeIds).toEqual([]);
  expect(mocked.workflowRequests[1]?.focusNodeIds).toEqual(["candidate-a-branch"]);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("普通会话可只读查看旧设计运行的简报、尝试和人工决定", async ({ page }) => {
  await mockWorkflow(page);
  await page.route("**/api/agent-conversations/chat-old/plans", (route) => route.fulfill({ json: { items: [{ id: "legacy-run", intent: "秋冬风衣设计", status: "completed", createdAt: NOW }] } }));
  await page.route("**/api/agent-runs/legacy-run", (route) => route.fulfill({ json: {
    id: "legacy-run", projectId: PROJECT_ID, conversationId: "chat-old", intent: "秋冬风衣设计", status: "completed", revision: 4, createdAt: NOW, updatedAt: NOW, error: null,
    intelligence: { brief: { summary: "藏蓝色通勤风衣", constraints: [{ id: "c1", priority: "must", requirement: "保留宽松廓形" }] }, actions: [] },
    steps: [{ id: "step-one", key: "generate", ordinal: 0, title: "方案生成", instruction: "参考挺括面料", prompt: "藏蓝风衣", negativePrompt: "", sourceAssetId: null, sourceStepKey: null, tool: "generate_design", status: "succeeded", generationTaskId: "task-one", selectedAssetId: "asset-a", candidates: [], error: null, attempts: [{ id: "try-one", ordinal: 1, status: "rejected", generationTaskId: "task-old", prompt: "亮面风衣", negativePrompt: "", parentAssetId: null, candidates: [], error: "反光过强", createdAt: NOW }] }],
  } }));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await page.getByRole("combobox", { name: "历史会话" }).selectOption("chat-old");
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "旧设计运行", exact: true }).click();
  const history = page.getByRole("region", { name: "旧设计运行历史" });
  await history.getByRole("button", { name: /秋冬风衣设计/ }).click();
  const detail = history.getByRole("region", { name: "旧运行详情" });
  await expect(detail.getByText("藏蓝色通勤风衣")).toBeVisible();
  await expect(detail.getByText("人工选定：asset-a")).toBeVisible();
  await expect(detail.getByText("否决理由：反光过强")).toBeVisible();
  await expect(detail.getByRole("button", { name: /执行|保存|编辑/ })).toHaveCount(0);
});

test("上传参考图会自动识别角色，失败可重试并可由设计师手动指定", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.rejectRoleOnce();
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: /上传图片/ }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "袖口参考.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lJ8AAAAASUVORK5CYII=", "base64"),
  });
  await expect.poll(() => mocked.getGraph().nodes.filter((item) => item.type === "reference_image").length).toBe(1);
  const uploaded = mocked.getGraph().nodes.find((item) => item.type === "reference_image");
  expect(uploaded?.payload).toMatchObject({ fileAssetId: "sketch-file", role: "style_ref", roleSource: "default", roleInferenceState: "pending" });
  await expect(page.getByRole("complementary", { name: "设计助手" }).getByRole("alert")).toContainText("角色识别暂不可用");
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="reference_image"]').dblclick();
  const details = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await details.getByRole("button", { name: "识别参考角色" }).click();
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.type === "reference_image")?.payload.roleSource).toBe("inferred");
  expect(mocked.getInferRoleCount()).toBe(2);
  await details.getByRole("combobox", { name: "参考图角色" }).selectOption("palette_ref");
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.type === "reference_image")?.payload.roleSource).toBe("manual");
  expect(mocked.getGraph().nodes.find((item) => item.type === "reference_image")?.payload.role).toBe("palette_ref");
  await expect(details.getByRole("button", { name: /识别参考角色/ })).toHaveCount(0);
});

test("候选建立系列后图中保存关联，再打开不会重复创建", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  let createCalls = 0;
  const collection = {
    id: "collection-one", projectId: PROJECT_ID, name: "秋冬风衣系列", createdAt: NOW, updatedAt: NOW,
    sourceGarmentType: null,
    hero: { assetId: "asset-a", url: "/api/design-assets/asset-a/content", thumbnailUrl: "/api/design-assets/asset-a/thumbnail" },
    dna: { extractionStatus: "ready", fabrics: [], locks: { fabrics: false, moodWords: false, palette: false, silhouettes: false }, moodWords: [], palette: [], referenceFileIds: [], signatureDetails: [], silhouettes: [], updatedAt: NOW },
  };
  await page.route("**/api/collections", (route) => {
    createCalls += 1;
    return route.fulfill({ status: 201, json: collection });
  });
  await page.route("**/api/collections/collection-one", (route) => route.fulfill({ json: collection }));
  await page.route("**/api/collections/collection-one/consistency", (route) => route.fulfill({ json: { looks: [], referenceLabel: "参考相似度", similarities: [] } }));
  await page.route("**/api/generations?*", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="candidate"]').filter({ hasText: "候选 A" }).dblclick();
  const details = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await details.getByRole("button", { name: "设为主推款并建立系列" }).click();
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.id === "candidate-a")?.payload.collectionId).toBe("collection-one");
  await page.getByRole("button", { name: "关闭系列抽屉" }).click();
  await expect(details.getByRole("button", { name: "打开关联系列" })).toBeVisible();
  await details.getByRole("button", { name: "打开关联系列" }).click();
  const drawer = page.getByRole("dialog", { name: "系列 DNA" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("tab", { name: "Look 扩展" }).click();
  await expect(drawer.getByRole("combobox", { name: "服装类型", exact: true })).toBeVisible();
  expect(createCalls).toBe(1);
});

test("新会话可查看全部分支偏好，作用范围明确且停用记录刷新后保留", async ({ page }) => {
  test.setTimeout(60_000);
  const mocked = await mockWorkflow(page);
  mocked.getContext().state.preferences.push({ id: "prefer-silver", text: "该分支偏好银灰色", status: "active", origin: "inferred", scope: "branch", sourceQuote: "在候选 B 的两轮修改中保留银灰色", branchNodeIds: ["candidate-b"], sourceNodeIds: ["generate"] });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "新建设计对话", exact: true }).click();
  const context = await openDesignRequirements(page);
  const preference = context.locator("li").filter({ hasText: "该分支偏好银灰色" });
  await expect(preference).toBeVisible();
  await expect(preference).toContainText("当前讨论对象不适用");
  await expect(preference).toContainText("作用分支：候选 B");
  await expect(preference.getByRole("button", { name: "定位 候选 B", exact: true })).toBeVisible();
  expect(mocked.getContext().preferences.some((item) => item.id === "prefer-silver")).toBe(false);
  await page.getByRole("button", { name: "关闭设计要求与偏好" }).click();
  await page.locator('[data-type="candidate"]').filter({ hasText: "候选 B" }).click();
  expect(mocked.contextPatches).toHaveLength(0);
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("比较两张风衣图 @候选 B");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.getContext().focusNodeIds).toEqual(["candidate-b"]);
  await openDesignRequirements(page);
  await expect(preference).toContainText("当前讨论对象适用");
  await preference.getByRole("button", { name: "确认这条理解" }).click();
  await expect(preference).toContainText("明确提出");
  await page.getByRole("button", { name: "关闭设计要求与偏好" }).click();
  await page.getByRole("button", { name: "讨论整个项目" }).click();
  await expect.poll(() => mocked.getContext().focusNodeIds).toEqual([]);
  await openDesignRequirements(page);
  await expect(preference).toContainText("当前讨论对象不适用");
  await preference.getByRole("button", { name: "停用这条偏好" }).click();
  await context.getByText("已停用记录（1）", { exact: true }).click();
  await expect(preference).toBeVisible();
  await expect(preference).toContainText("已停用");
  expect(mocked.contextPatches.at(-1)?.disabledPreferenceIds).toEqual(["prefer-silver"]);
  expect(mocked.getContext().preferences.some((item) => item.id === "prefer-silver")).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await openDesignRequirements(page);
  await context.getByText("已停用记录（1）", { exact: true }).click();
  await expect(preference).toContainText("已停用");
  await expect(preference.getByRole("button", { name: "停用这条偏好" })).toHaveCount(0);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("设计要求抽屉更正失败保留输入，重试后刷新恢复且返回键盘焦点", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  const conversation = page.getByLabel("设计对话", { exact: true });
  const scrollBefore = await conversation.evaluate((element) => element.scrollTop);
  const context = await openDesignRequirements(page);
  await expect(context.getByText("秋冬通勤风衣", { exact: true })).toBeVisible();
  await expect(page.getByLabel("设计上下文", { exact: true })).toHaveCount(0);
  await context.getByRole("button", { name: "停用这条偏好" }).click();
  await expect(context.getByText("已停用记录（1）", { exact: true })).toBeVisible();
  await context.getByRole("button", { name: "更正项目目标" }).click();
  await context.getByRole("textbox", { name: "更正项目目标" }).fill("春季轻量通勤风衣");
  let fail = true;
  await page.route("**/api/agent-conversations/*/context", (route) => {
    if (route.request().method() === "PATCH" && fail) { fail = false; return route.fulfill({ status: 409, json: { message: "项目目标版本已更新，请重试" } }); }
    return route.fallback();
  });
  await context.getByRole("button", { name: "保存目标" }).click();
  await expect(context.getByRole("alert")).toBeVisible();
  await expect(context.getByRole("textbox", { name: "更正项目目标" })).toHaveValue("春季轻量通勤风衣");
  expect(mocked.getContext().currentObjective).toBe("秋冬通勤风衣");
  await context.getByRole("button", { name: "保存目标" }).click();
  await expect(context.getByText("春季轻量通勤风衣", { exact: true })).toBeVisible();
  await mkdir("output/playwright/context", { recursive: true });
  await page.screenshot({ path: "output/playwright/context/requirements-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("对话操作", { exact: true })).toBeFocused();
  expect(await conversation.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  expect(mocked.contextPatches.every((value) => typeof value.baseRevision === "number" && typeof value.mutationId === "string")).toBe(true);
  await page.reload();
  await openDesignRequirements(page);
  await expect(context.getByText("春季轻量通勤风衣", { exact: true })).toBeVisible();
  expect(mocked.getExecuteCount()).toBe(0);
});

test("持续助手刷新后保留消息和待确认提案，不重复或自动执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("请修改 @候选 A 的袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.getByRole("button", { name: "确认并生成", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByRole("button", { name: "确认并生成", exact: true })).toBeVisible();
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  expect(mocked.proposalRequests).toHaveLength(1);
  expect(mocked.getExecuteCount()).toBe(0);
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认并生成", exact: true })).toHaveCount(0);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("项目中其他会话的待确认提案不会自动出现在当前对话和画布预览", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.setPendingProposal({ id: "foreign-proposal", baseRevision: 1, status: "pending", content: "另一段会话的请求", referencedNodeIds: ["candidate-a"], rationale: "另一会话的提案", toolNodeId: "foreign-tool", createdAt: NOW, operations: [
    { type: "add_node", node: { id: "foreign-tool", kind: "tool", type: "edit_design", title: "另一会话修改", payload: {}, x: 740, y: 1050 } },
  ] });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByLabel("对话操作", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeEnabled();
  await expect(page.locator('[data-status="proposed"]')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(page.locator('[data-status="proposed"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认并生成", exact: true })).toHaveCount(0);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("失败的设计回复可用原请求和上下文重试，消息不重复且不自动执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.failMessageOnce();
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("比较两张风衣图 @候选 A");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await page.getByRole("button", { name: "重试这条回复" }).click();
  await expect(page.getByText("已收到，继续设计。", { exact: true })).toBeVisible();
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  expect(mocked.workflowRequests).toHaveLength(2);
  expect(mocked.workflowRequests[1]).toEqual(mocked.workflowRequests[0]);
  expect(mocked.workflowRequests[0]?.referencedNodeIds).toEqual(["candidate-a"]);
  expect(mocked.workflowRequests[0]?.focusNodeIds).toEqual(["candidate-a"]);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("持续对话的待处理回复自动更新为终态且不会重复追加", async ({ page }) => {
  test.setTimeout(60_000);
  await mockWorkflow(page);
  let reads = 0;
  await page.route("**/api/agent-conversations/workflow-current/messages*", (route) => {
    reads += 1;
    return route.fulfill({ json: { items: [
      { id: "user-one", content: "比较两张风衣", role: "user", status: "completed" },
      { id: "assistant-one", content: reads === 1 ? "正在分析…" : "藏蓝方案更贴近通勤需求。", role: "assistant", status: reads === 1 ? "pending" : "completed" },
    ], nextCursor: null } });
  });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByText("正在分析…")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("藏蓝方案更贴近通勤需求。")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  expect(reads).toBeGreaterThanOrEqual(2);
});

test("跨窗口读取到待识别参考图时会同步最终角色", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const reference = node("role-pending", "asset", "reference_image", "待识别袖口图", 40, 700, {
    fileAssetId: "sketch-file", role: "style_ref", roleSource: "default", roleInferenceState: "pending",
  });
  reference.status = "ready";
  mocked.getGraph().nodes.push(reference);
  let reads = 0;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/sync`, (route) => {
    reads += 1;
    if (reads > 1) {
      reference.payload = { ...reference.payload, role: "detail_ref", roleSource: "inferred", roleInferenceState: "ready", roleLabel: "细节参考" };
      mocked.getGraph().revision += 1;
    }
    return route.fulfill({ json: { ...mocked.getGraph(), proposals: [] } });
  });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('[data-type="reference_image"]')).toHaveCount(1);
  await page.locator('[data-type="reference_image"]').dblclick();
  const details = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await expect(details.getByText(/当前标签：细节参考/)).toBeVisible({ timeout: 10_000 });
  await expect(details.getByRole("button", { name: /识别参考角色/ })).toHaveCount(0);
  expect(reads).toBeGreaterThanOrEqual(2);
});

test("较新的语义响应不会把已保存的节点位置回退到旧布局", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getGraph().layoutRevision = 2;
  let reads = 0;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/sync`, async (route) => {
    reads += 1;
    if (reads === 1) return route.fulfill({ json: { ...mocked.getGraph(), proposals: [] } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const stale = {
      ...mocked.getGraph(), revision: 2, layoutRevision: 1,
      nodes: [
        ...mocked.getGraph().nodes.map((item) => item.id === "brief" ? { ...item, x: -700 } : item),
        node("late-reference", "asset", "reference_text", "延迟到达的语义节点", 40, 850, { text: "补充袖口参考" }),
      ],
      proposals: [],
    };
    return route.fulfill({ json: stale });
  });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  const before = await brief.boundingBox();
  expect(before).not.toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(page.locator('[data-type="reference_text"]').filter({ hasText: "延迟到达的语义节点" })).toHaveCount(1);
  const after = await brief.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
});

test("主工作流禁用自由绘图和复制快捷键，不产生图外节点", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  const canvas = page.getByRole("application", { name: "tldraw" });
  await expect(page.locator('[data-type="brief"]')).toBeVisible();
  const shapeCount = await canvas.locator(".tl-shape").count();
  expect(shapeCount).toBeGreaterThan(0);
  const graphCount = mocked.getGraph().nodes.length;
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const x = (bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.35;
  const y = (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.75;
  await page.mouse.click(x, y);
  await page.keyboard.press("r");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y - 65, { steps: 8 });
  await page.mouse.up();
  await page.locator('[data-type="brief"]').click();
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+c");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("图外的粘贴文本"));
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => canvas.locator(".tl-shape").count()).toBe(shapeCount);
  await expect(page.locator('[data-type="brief"]')).toHaveCount(1);
  expect(mocked.getGraph().nodes).toHaveLength(graphCount);
});

test("保存失败保留批次，重试使用同一请求且成功前不显示已保存", async ({ page }) => {
  await mockWorkflow(page);
  let fail = true;
  const requests: unknown[] = [];
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    const body = route.request().postDataJSON();
    if (body?.mode !== "layout") return route.fallback();
    requests.push(body);
    if (fail) return route.fulfill({ status: 503, json: { message: "保存服务暂不可用" } });
    return route.fallback();
  });
  await page.goto(`/${PROJECT_ID}`);
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  const box = await brief.boundingBox();
  if (!box) throw new Error("需求节点不可见");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page.getByText("画布已保存", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "output/playwright/review-save-error-after.png" });
  fail = false;
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.locator("main[data-layout-save-state]")).toHaveAttribute("data-layout-save-state", "saved");
  expect(requests[1]).toEqual(requests[0]);
});

test("布局保存失败阻止站内离开，保存恢复后再进入项目库", async ({ page }) => {
  await mockWorkflow(page);
  let fail = true;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    return fail ? route.fulfill({ status: 503, json: { message: "保存失败" } }) : route.fallback();
  });
  await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: [], total: 0, page: 1, hasMore: false } }));
  await page.goto(`/${PROJECT_ID}`);
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  const box = await brief.boundingBox();
  if (!box) throw new Error("需求节点不可见");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("link", { name: "返回项目库" }).click();
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(PROJECT_ID));
  fail = false;
  await page.getByRole("link", { name: "返回项目库" }).click();
  await expect(page).toHaveURL("/");
});

test("素材弹窗支持 Escape、焦点圈定和关闭后恢复焦点", async ({ page }) => {
  await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const trigger = page.getByRole("button", { name: "＋ 添加素材" });
  await trigger.click();
  const option = page.getByRole("button", { name: "设计需求 目标、场景、必需条件" });
  await option.click();
  const dialog = page.getByRole("dialog", { name: "添加设计需求" });
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index++) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  for (let index = 0; index < 8; index++) await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("默认视图可读，查看全图、100%和窄屏保持可达", async ({ page }) => {
  await mockWorkflow(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/${PROJECT_ID}`);
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  const briefBounds = await brief.boundingBox();
  if (!briefBounds) throw new Error("设计需求节点未显示");
  // 该用例固定在 1366 宽，走标准档（300px）。
  expect(briefBounds.width / 300).toBeGreaterThanOrEqual(0.85);
  await page.screenshot({ path: "output/playwright/review-canvas-after.png" });
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "画布原始比例" }).click();
  for (const width of [1440, 1920, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    // 转入手机时保留已打开的助手；用户可显式回到画布。
    await showCanvas(page, width);
    await expect(page.getByRole("button", { name: "画布原始比例" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("服务器决定节点能否移除，允许移除时先确认关联连线", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const removable = node("removable", "asset", "reference_text", "可移除备注", 40, 800, { text: "尚未执行的参考" });
  removable.status = "ready";
  removable.canDelete = true;
  removable.deleteDisabledReason = null;
  mocked.getGraph().nodes.push(removable);
  mocked.getGraph().edges.push(edge("removable-input", removable.id, "analysis", "reference"));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="brief"]').dblclick();
  await expect(page.getByRole("button", { name: "从工作流移除节点" })).toBeDisabled();
  await page.locator('[data-kind="asset"]').filter({ has: page.getByText("可移除备注", { exact: true }) }).dblclick();
  await page.getByRole("button", { name: "从工作流移除节点" }).click();
  const confirmation = page.getByRole("dialog", { name: "确认移除节点" });
  await expect(confirmation).toContainText("1 条关联连线");
  expect(mocked.getGraph().nodes.some((item) => item.id === removable.id)).toBe(true);
  await confirmation.getByRole("button", { name: "确认移除", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(mocked.getGraph().nodes.some((item) => item.id === removable.id)).toBe(false);
  expect(mocked.getGraph().edges.some((item) => item.id === "removable-input")).toBe(false);
});

test("同账号后台认证与临时服务故障不会清空设计助手草稿", async ({ page }) => {
  await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("保留袖口，下一步比较面料");
  await page.route("**/api/me", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 503, json: { message: "认证服务暂不可用" } });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(composer).toHaveValue("保留袖口，下一步比较面料");
  await page.waitForTimeout(400);
  await expect(composer).toHaveValue("保留袖口，下一步比较面料");
});

for (const deleted of [false, true]) {
  test(`布局 409 后读取新修订，${deleted ? "不重放已删除节点" : "重放本地拖动位置"}`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    const requests: Array<{ mutationId: string; baseLayoutRevision: number; positions: Array<{ nodeId: string; x: number; y: number }> }> = [];
    await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const body = route.request().postDataJSON();
      if (body.mode !== "layout") return route.fallback();
      requests.push(body);
      if (requests.length !== 1) return route.fallback();
      mocked.getGraph().layoutRevision = 7;
      if (deleted) {
        mocked.getGraph().nodes = mocked.getGraph().nodes.filter((item) => item.id !== "brief");
        mocked.getGraph().edges = mocked.getGraph().edges.filter((item) => item.sourceNodeId !== "brief");
        mocked.getGraph().revision += 1;
      }
      return route.fulfill({ status: 409, json: { message: "布局修订冲突" } });
    });
    await page.goto(`/${PROJECT_ID}`);
    const brief = page.locator('[data-type="brief"]');
    await expect(brief).toBeVisible();
    const box = await brief.boundingBox();
    if (!box) throw new Error("需求节点不可见");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 25, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => requests.length).toBe(deleted ? 1 : 2);
    await expect(page.locator("main[data-layout-save-state]")).toHaveAttribute("data-layout-save-state", "saved");
    if (deleted) {
      await expect(brief).toHaveCount(0);
    } else {
      expect(requests[1]?.baseLayoutRevision).toBe(7);
      expect(requests[1]?.mutationId).not.toBe(requests[0]?.mutationId);
      expect(requests[1]?.positions).toEqual(requests[0]?.positions);
      expect(mocked.getGraph().nodes.find((item) => item.id === "brief")?.x).toBe(requests[0]?.positions[0]?.x);
    }
  });
}

async function dragReviewBrief(page: Page, dx = 55) {
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  const box = await brief.boundingBox();
  if (!box) throw new Error("需求节点不可见");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + 15, { steps: 6 });
  await page.mouse.up();
}

test("断网保留待保存数量，恢复后同一批次重试成功", async ({ page, context }) => {
  await mockWorkflow(page);
  let offline = true;
  const requests: unknown[] = [];
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    requests.push(route.request().postDataJSON());
    return offline ? route.abort("internetdisconnected") : route.fallback();
  });
  await page.goto(`/${PROJECT_ID}`);
  await expect(page.locator('[data-type="brief"]')).toBeVisible();
  await context.setOffline(true);
  await dragReviewBrief(page);
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page.getByLabel("待保存节点数")).toContainText("1 个节点");
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await context.setOffline(false);
  offline = false;
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.locator("main[data-layout-save-state]")).toHaveAttribute("data-layout-save-state", "saved");
  await expect(page.getByLabel("待保存节点数")).toHaveCount(0);
  expect(requests[1]).toEqual(requests[0]);
});

for (const action of ["reload", "close"] as const) {
  test(`未保存时 ${action} 触发标准离开提示，取消后保留页面`, async ({ page }) => {
    await mockWorkflow(page);
    await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { message: "保存失败" } }) : route.fallback());
    await page.goto(`/${PROJECT_ID}`);
    await dragReviewBrief(page);
    await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
    const prompt = page.waitForEvent("dialog");
    const navigation = action === "reload" ? page.reload({ timeout: 2000 }).catch(() => undefined) : page.close({ runBeforeUnload: true });
    const dialog = await prompt;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await navigation;
    expect(page.isClosed()).toBe(false);
    await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  });
}

test("保存失败的后退可取消，恢复后前进历史仍然可用", async ({ page }) => {
  await mockWorkflow(page);
  await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: [{ id: PROJECT_ID, name: "历史导航验收", assetCount: 0, coverUrl: null, archived: false, createdAt: NOW, updatedAt: NOW }], total: 1, page: 1, hasMore: false } }));
  let fail = true;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "PATCH" && fail
    ? route.fulfill({ status: 503, json: { message: "保存失败" } }) : route.fallback());
  await page.goto("/");
  await page.getByRole("link", { name: "打开项目 历史导航验收" }).click();
  await dragReviewBrief(page);
  await expect(page.locator("main[data-layout-pending-count]")).not.toHaveAttribute("data-layout-pending-count", "0");
  await page.goBack({ timeout: 1500 }).catch(() => undefined);
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(PROJECT_ID));
  fail = false;
  await page.goBack();
  await expect(page).toHaveURL("/");
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(PROJECT_ID));
  await expect(page.locator("main[data-layout-save-state]")).toHaveAttribute("data-layout-save-state", "saved");
});

test("保存飞行中继续拖动，旧响应不覆盖新位置且串行提交", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  let release!: () => void;
  const bodies: Array<{ positions: Array<{ nodeId: string; x: number }> }> = [];
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) await new Promise<void>((resolve) => { release = resolve; });
    return route.fallback();
  });
  await page.goto(`/${PROJECT_ID}`);
  await dragReviewBrief(page);
  await expect.poll(() => bodies.length).toBe(1);
  await dragReviewBrief(page, 85);
  const afterSecond = await page.locator('[data-type="brief"]').boundingBox();
  release();
  await expect(page.locator("main[data-layout-save-state]")).toHaveAttribute("data-layout-save-state", "saved");
  expect(bodies).toHaveLength(2);
  const afterSave = await page.locator('[data-type="brief"]').boundingBox();
  expect(Math.abs((afterSave?.x ?? 0) - (afterSecond?.x ?? 0))).toBeLessThan(2);
  expect(mocked.getGraph().nodes.find((item) => item.id === "brief")?.x).toBe(bodies[1]?.positions[0]?.x);
});

for (const crossTab of [false, true]) {
  test(`${crossTab ? "真实双标签切换" : "同标签退出重登"}后清除上一账号图片、对话与草稿`, async ({ page, context }) => {
    await context.addCookies([{ name: "review-account", value: "a", url: "http://127.0.0.1:3000" }]);
    await context.route("**/api/auth/logout", (route) => route.fulfill({ json: { ok: true }, headers: { "set-cookie": "review-account=; Path=/; Max-Age=0" } }));
    await context.route("**/api/auth/login", (route) => route.request().postDataJSON()?.action === "verify"
      ? route.fulfill({ json: { projectId: PROJECT_ID }, headers: { "set-cookie": "review-account=b; Path=/; SameSite=Lax" } })
      : route.fulfill({ status: 401, json: { message: "未登录" } }));
    const install = async (target: Page) => {
      const mocked = await mockWorkflow(target);
      const account = (cookie: string) => cookie.includes("review-account=b") ? "b" : cookie.includes("review-account=a") ? "a" : null;
      await target.route("**/api/me", (route) => {
        const id = account(route.request().headers().cookie ?? "");
        return id ? route.fulfill({ json: { user: { id, email: `${id}@example.com`, name: id }, credits: { limit: 600, used: 0, remaining: 600 } } })
          : route.fulfill({ status: 401, json: { message: "未登录" } });
      });
      const graphFor = (cookie: string) => account(cookie) === "b" ? { ...mocked.getGraph(),
        nodes: [node("account-b-brief", "asset", "brief", "B 的设计需求", 40, 120, { text: "账号 B 的独立内容" })], edges: [] } : mocked.getGraph();
      await target.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "GET"
        ? route.fulfill({ json: graphFor(route.request().headers().cookie ?? "") }) : route.fallback());
      await target.route(`**/api/projects/${PROJECT_ID}/workflow/sync`, (route) => route.fulfill({ json: { ...graphFor(route.request().headers().cookie ?? ""), proposals: [] } }));
      await target.route(`**/api/projects/${PROJECT_ID}/agent-conversations*`, (route) => account(route.request().headers().cookie ?? "") === "b"
        ? route.fulfill({ json: { items: [], nextCursor: null } }) : route.fallback());
      await target.route("**/api/agent-conversations/*/messages*", (route) => route.fulfill({ json: { items: [{ id: "private-a-message", role: "assistant", content: "账号 A 的私有对话", status: "completed" }], nextCursor: null } }));
    };
    await install(page);
    await page.goto(`/${PROJECT_ID}`);
    await expect(page.getByText("账号 A 的私有对话", { exact: true })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
    await composer.fill("账号 A 尚未发送的草稿");
    expect(await page.locator('img[src*="asset-a"]').count()).toBeGreaterThan(0);
    if (crossTab) {
      const other = await context.newPage();
      await install(other);
      await other.goto("/auth/confirm?token_hash=review-switch");
      await expect(other.getByText("B 的设计需求", { exact: true })).toBeVisible();
    } else {
      await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: [], total: 0, page: 1, hasMore: false } }));
      await page.getByRole("link", { name: "返回项目库" }).click();
      await expect(page).toHaveURL("/");
      await page.reload();
      await page.getByText("a@example.com", { exact: true }).click();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/auth/confirm?token_hash=review-switch");
    }
    await expect(page.getByText("B 的设计需求", { exact: true })).toBeVisible();
    await expect(page.getByText("账号 A 的私有对话", { exact: true })).toHaveCount(0);
    await expect(page.locator('img[src*="asset-a"]')).toHaveCount(0);
    await expect(composer).toHaveValue("");
  });
}

for (const viewport of REVIEW_VIEWPORTS) {
  test(`画布完整验收 ${viewport.width}×${viewport.height}：初始比例、文字对比度与布局`, async ({ page }) => {
    await mockWorkflow(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(viewport);
    await page.goto(`/${PROJECT_ID}`);
    const brief = page.locator('[data-type="brief"]');
    await expect(brief).toBeVisible();
    const briefBounds = await brief.boundingBox();
    if (!briefBounds) throw new Error("设计需求节点未显示");
    // 窄视口走紧凑档（258px 宽），桌面走标准档（300px 宽）。
    expect(briefBounds.width / (viewport.width < 768 ? 258 : 300)).toBeGreaterThanOrEqual(0.85);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await contrastFailures(page)).toEqual([]);
    expect(await controlFontFailures(page)).toEqual([]);
    await page.screenshot({ path: `output/playwright/review-canvas-${viewport.width}-final.png`, fullPage: true });
    await page.getByRole("button", { name: "＋ 添加素材" }).click();
    await page.getByRole("button", { name: "设计需求 目标、场景、必需条件" }).click();
    await expect(page.getByRole("dialog", { name: "添加设计需求" })).toBeVisible();
    expect(await contrastFailures(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { message: "保存服务暂不可用" } }) : route.fallback());
    await dragReviewBrief(page, 15);
    await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
    await expect(page.locator("main[data-layout-pending-count]")).not.toHaveAttribute("data-layout-pending-count", "0");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await contrastFailures(page)).toEqual([]);
    await page.screenshot({ path: `output/playwright/review-canvas-error-${viewport.width}-final.png`, fullPage: true });
  });
}

test("未保存时前进也会等待保存，失败不破坏前进目标", async ({ page }) => {
  await mockWorkflow(page);
  await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: [], total: 0, page: 1, hasMore: false } }));
  let fail = true;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "PATCH" && fail
    ? route.fulfill({ status: 503, json: { message: "保存失败" } }) : route.fallback());
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("link", { name: "返回项目库" }).click();
  await expect(page).toHaveURL("/");
  await page.goBack();
  await dragReviewBrief(page);
  await expect(page.locator("main[data-layout-pending-count]")).not.toHaveAttribute("data-layout-pending-count", "0");
  await page.goForward({ timeout: 1500 }).catch(() => undefined);
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(PROJECT_ID));
  fail = false;
  await page.goForward();
  await expect(page).toHaveURL("/");
});

test("仅用键盘完成添加、取消、打开详情和删除确认", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const trigger = page.getByRole("button", { name: "＋ 添加素材" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const option = page.getByRole("button", { name: "设计需求 目标、场景、必需条件" });
  await tabTo(page, option);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "添加设计需求" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await tabTo(page, option);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "名称", exact: true })).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("键盘操作验收");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "内容", exact: true })).toBeFocused();
  await page.keyboard.insertText("未执行的设计需求");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const created = mocked.getGraph().nodes.find((item) => item.title === "键盘操作验收");
  if (!created) throw new Error("键盘添加未创建节点");
  created.canDelete = true;
  created.deleteDisabledReason = null;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await tabTo(page, page.getByRole("button", { name: "适合画布" }));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const frame = page.getByRole("group", { name: "设计节点 键盘操作验收", exact: true });
  await tabTo(page, frame);
  await page.keyboard.press("Enter");
  const remove = page.getByRole("button", { name: "从工作流移除节点" });
  await expect(remove).toBeEnabled();
  await tabTo(page, remove);
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "确认移除节点" });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  await tabTo(page, confirmation.getByRole("button", { name: "确认移除", exact: true }));
  await page.keyboard.press("Enter");
  await expect(frame).toHaveCount(0);
});


test.describe("自由白板功能迁移", () => {
  test("草图保存后重开笔画，历史引用另存分支", async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, recordVideo: { dir: testInfo.outputPath("videos") } });
    const page = await context.newPage();
    const mocked = await mockWorkflow(page);
    await page.goto(`/${PROJECT_ID}`);
    await page.getByRole("button", { name: "＋ 添加素材", exact: true }).click();
    await page.getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "绘制廓形草图" });
    const draw = async (container: Locator = dialog) => {
      const bounds = await container.getByLabel("廓形草图画布").boundingBox();
      if (!bounds) throw new Error("草图画布不可见");
      await page.mouse.move(bounds.x + 60, bounds.y + 60);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 180, bounds.y + 180, { steps: 10 });
      await page.mouse.up();
    };
    await draw();
    await dialog.getByRole("button", { name: "撤销", exact: true }).click();
    await dialog.getByRole("button", { name: "重做", exact: true }).click();
    await dialog.getByRole("button", { name: "保存到工作流", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const created = mocked.getGraph().nodes.find(item => item.type === "sketch");
    if (!created) throw new Error("草图没有保存");
    expect(created.payload.sketchDocument).toMatchObject({ version: 1, width: 640, height: 860 });
    const original = JSON.stringify(created.payload.sketchDocument);
    await page.reload();
    await expect(page.getByRole("button", { name: "＋ 添加素材", exact: true })).toBeVisible();
    await page.evaluate(id => window.dispatchEvent(new CustomEvent("fashion-workflow:node-details", { detail: id })), created.id);
    const workspace = page.getByRole("region", { name: "节点详情工作区", exact: true });
    await expect(workspace.getByRole("button", { name: "保存到工作流", exact: true })).toBeEnabled();
    await draw(workspace);
    await mkdir("output/playwright", { recursive: true });
    await page.screenshot({ path: "output/playwright/editable-sketch.png" });
    await workspace.getByRole("button", { name: "保存到工作流", exact: true }).click();
    await expect(workspace).toBeHidden();
    expect(JSON.stringify(created.payload.sketchDocument)).toBe(original);
    expect(mocked.getGraph().nodes.some(item => item.payload.sourceNodeId === created.id)).toBe(true);
    await context.close();
  });
});
