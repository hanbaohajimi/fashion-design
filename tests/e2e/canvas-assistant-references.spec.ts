import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { loadZhiya, openZhiya, prepareZhiya } from "./zhiya-fixture";
import { PROJECT, NOW } from "../visual/fixtures";

test.setTimeout(90_000);
test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });
test.afterEach(async ({ page }, info) => {
  if (!process.env.REFERENCE_DEMO || info.status !== "passed") return;
  const video = page.video();
  await page.close();
  await video?.saveAs(`output/playwright/canvas-assistant-references/${info.title.includes("320px") ? "mobile" : "desktop"}.webm`);
});

const composer = (page: Page) =>
  page.getByRole("textbox", { name: "描述设计需求", exact: true });
const discussion = (page: Page) => page.getByLabel("正在讨论", { exact: true });
const shape = (page: Page, index: number) =>
  page.locator(`.tl-shape[data-shape-id="shape:canvas-material-${index}"]`);

async function pick(page: Page, title: string) {
  await page.getByRole("button", { name: "添加引用", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加引用", exact: true });
  await picker.getByRole("checkbox", { name: new RegExp(title) }).check();
  await picker.getByRole("button", { name: "使用所选引用", exact: true }).click();
  await expect(picker).toBeHidden();
}

test("普通选择和取消选择不改变草稿引用，也不自动提交", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  await openZhiya(page);
  await composer(page).fill("先整理想法，保留这一份草稿。");
  await shape(page, 0).click();
  await expect(page.getByRole("button", { name: "引用到助手", exact: true })).toBeEnabled();
  // Cover the selection preparation debounce and its completed save.
  await page.waitForTimeout(700);
  await expect(discussion(page)).toContainText("整个项目");
  await expect(discussion(page).getByRole("button", { name: /移除引用/ })).toHaveCount(0);
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await expect(composer(page)).toHaveValue("先整理想法，保留这一份草稿。");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("连续引用保留原素材顺序与输入光标，快速选择引用使用当次素材", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  await openZhiya(page);
  await pick(page, "通勤外套 1");
  await composer(page).fill("参考两件外套，保留领口。");
  await composer(page).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 6));
  const input = await composer(page).elementHandle();
  await shape(page, 1).click();
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(discussion(page).getByRole("button", { name: /移除引用/ })).toHaveCount(2);
  expect(await discussion(page).getByRole("button", { name: /移除引用/ }).evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).toEqual([
    "移除引用 通勤外套 1", "移除引用 通勤外套 2",
  ]);
  await expect(composer(page)).toHaveValue("参考两件外套，保留领口。");
  expect(await input?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await composer(page).evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([3, 6]);
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(discussion(page).getByRole("button", { name: /移除引用/ })).toHaveCount(2);
  await mkdir("output/playwright/canvas-assistant-references", { recursive: true });
  await page.screenshot({ path: "output/playwright/canvas-assistant-references/desktop.png" });
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("发送结果未知时同一素材可重试，改变引用必须产生新请求身份", async ({ page }) => {
  await prepareZhiya(page, { realClock: true });
  const requests: { clientRequestId: string; content: string; referencedNodeIds: string[] }[] = [];
  await page.route("**/api/agent-conversations/visual-chat/workflow-messages", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { message: "本轮结果尚未确认，请重试。" } });
  });
  await loadZhiya(page);
  await openZhiya(page);
  await pick(page, "通勤外套 1");
  await composer(page).fill("分析这件外套的廓形，不生成图片");
  const send = page.getByRole("button", { name: "发送需求", exact: true });
  await send.click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]?.clientRequestId).toBe(requests[0]?.clientRequestId);
  await expect(send).toBeEnabled();
  await discussion(page).getByRole("button", { name: "移除引用 通勤外套 1", exact: true }).click();
  await pick(page, "通勤外套 2");
  await send.click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]?.referencedNodeIds).toEqual(["material-1"]);
  expect(requests[2]?.clientRequestId).not.toBe(requests[0]?.clientRequestId);
});

test("合并上限计入正文引用，超限保留全部原引用且不截断", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, count: 20 });
  await loadZhiya(page);
  await openZhiya(page);
  await page.getByRole("button", { name: "添加引用", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加引用", exact: true });
  for (let index = 3; index < 18; index++) await picker.getByRole("checkbox").nth(index).check();
  await picker.getByRole("button", { name: "使用所选引用", exact: true }).click();
  await expect(picker).toBeHidden();
  await composer(page).fill("比较 @通勤外套 1，与这些素材的关系。");
  await expect(discussion(page).getByRole("button", { name: /移除引用/ })).toHaveCount(16);
  const before = await discussion(page).locator("[data-assistant-reference-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-assistant-reference-id")));
  await shape(page, 1).click();
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "合并后超过 16 项，原引用已保留。" })).toBeVisible();
  expect(await discussion(page).locator("[data-assistant-reference-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-assistant-reference-id")))).toEqual(before);
  await expect(composer(page)).toHaveValue("比较 @通勤外套 1，与这些素材的关系。");
  expect(state.mutations).toEqual([]);
});

test("保存失败保留旧引用，重试准备时锁定发送并保留点击时的选择", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  await openZhiya(page);
  await pick(page, "通勤外套 1");
  await composer(page).fill("合并两件外套的设计参考");
  let failing = true;
  let release = () => {};
  let delayed = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${PROJECT}/canvas`, async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    if (failing) return route.fulfill({ status: 503, json: { message: "白板保存暂时不可用" } });
    delayed = true;
    await gate;
    return route.fallback();
  });
  await shape(page, 1).click();
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "白板保存暂时不可用" })).toBeVisible();
  await expect(discussion(page).getByRole("button", { name: /移除引用/ })).toHaveCount(1);
  failing = false;
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect.poll(() => delayed).toBe(true);
  await expect(page.getByRole("button", { name: "正在准备引用…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "发送需求", exact: true })).toBeDisabled();
  await shape(page, 0).click();
  release();
  await expect(discussion(page).getByRole("button", { name: /移除引用/ })).toHaveCount(2);
  await expect(discussion(page)).toContainText("通勤外套 2");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("只读设计对话拒绝画布批量引用，不更改现有草稿", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await page.route(`**/api/projects/${PROJECT}/workflow/tools`, route => route.fulfill({ json: { agentVersion: 1, tools: [] } }));
  await loadZhiya(page);
  await shape(page, 1).click();
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "请先打开可编辑的设计对话再引用素材。" })).toBeVisible();
  await expect(discussion(page).getByRole("button", { name: /移除引用/ })).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test("旧素材失效后追加新素材仍保留失效提示并阻止发送", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  await openZhiya(page);
  await pick(page, "通勤外套 1");
  await composer(page).fill("保留尚未发送的设计要求");
  state.graph.nodes = state.graph.nodes.filter(node => node.id !== "material-0");
  state.graph.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(page.getByRole("button", { name: "清除失效引用", exact: true })).toBeVisible();
  await shape(page, 1).click();
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(discussion(page)).toContainText("通勤外套 2");
  await expect(page.getByRole("button", { name: "清除失效引用", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送需求", exact: true })).toBeDisabled();
  await expect(composer(page)).toHaveValue("保留尚未发送的设计要求");
  expect(state.mutations).toEqual([]);
});

for (const width of [1440, 320]) test(`${width}px 同名素材可辨认，刷新保留引用且发送内容一致`, async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, viewport: { width, height: 900 } });
  for (const node of state.graph.nodes.slice(0, 2)) node.title = "同名通勤外套";
  const requests: { clientRequestId: string; content: string; referencedNodeIds: string[]; focusNodeIds: string[] }[] = [];
  const messages: unknown[] = [];
  await page.route("**/api/agent-conversations/visual-chat/messages*", route => route.fulfill({ json: { items: messages, nextCursor: null } }));
  await page.route("**/api/agent-conversations/visual-chat/workflow-messages", route => {
    const input = route.request().postDataJSON();
    requests.push(input);
    const userMessage = { id: `user-${requests.length}`, conversationId: "visual-chat", role: "user", status: "completed", ...input, createdAt: NOW, updatedAt: NOW };
    const assistantMessage = { id: `assistant-${requests.length}`, conversationId: "visual-chat", role: "assistant", status: "completed", content: "已收到两件参考，先比较廓形。", referencedNodeIds: input.referencedNodeIds, createdAt: NOW, updatedAt: NOW };
    messages.push(userMessage, assistantMessage);
    return route.fulfill({ json: { userMessage, assistantMessage } });
  });
  await loadZhiya(page);
  await openZhiya(page);
  await pick(page, "同名通勤外套（2）");
  await composer(page).fill("保留草稿，比较两件同名外套的领口。");
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await shape(page, 0).click();
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(discussion(page).getByRole("button", { name: /移除引用/ })).toHaveCount(2);
  await expect(discussion(page).locator("img")).toHaveCount(2);
  await expect.poll(() => discussion(page).locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  for (const button of await discussion(page).getByRole("button", { name: /移除引用/ }).all()) {
    await expect(button).toBeInViewport({ ratio: 1 });
    expect(((await button.boundingBox())?.width ?? 0) + 0.001).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "发送需求", exact: true })).toBeInViewport({ ratio: 1 });
  await mkdir("output/playwright/canvas-assistant-references", { recursive: true });
  await page.screenshot({ path: `output/playwright/canvas-assistant-references/preview-${width}.png` });
  if (process.env.REFERENCE_DEMO) await page.waitForTimeout(1500);
  await page.waitForTimeout(400);
  await page.reload();
  await expect(composer(page)).toHaveValue("保留草稿，比较两件同名外套的领口。");
  expect(await discussion(page).locator("[data-assistant-reference-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-assistant-reference-id")))).toEqual(["material-1", "material-0"]);
  await page.getByRole("button", { name: "发送需求", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]?.referencedNodeIds).toEqual(["material-1", "material-0"]);
  expect(requests[0]?.focusNodeIds).toEqual(["material-1", "material-0"]);
  await expect(composer(page)).toHaveValue("");
  if (process.env.REFERENCE_DEMO) await page.waitForTimeout(1500);
  expect(state.errors).toEqual([]);
});

test("系统深色偏好的短屏下长名称与图片读取失败仍可辨认和移除引用", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true, viewport: { width: 390, height: 650 } });
  const title = "秋冬通勤长款外套双层翻领与手工面料肌理的完整设计参考";
  if (state.graph.nodes[0]) state.graph.nodes[0].title = title;
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.route("**/visual-garment.svg", route => route.fulfill({ status: 404, body: "missing test image" }));
  await loadZhiya(page);
  await openZhiya(page);
  await pick(page, title);
  await composer(page).fill("保留版型与材质参考");
  const preview = discussion(page).getByRole("button", { name: title, exact: true });
  await expect(preview).toContainText("服装方案");
  await expect(preview.locator("img")).toHaveCount(0);
  const remove = discussion(page).getByRole("button", { name: `移除引用 ${title}`, exact: true });
  await expect(remove).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "发送需求", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "output/playwright/canvas-assistant-references/dark-short.png" });
  await remove.click();
  await expect(discussion(page).locator("[data-assistant-reference-id]")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("保留版型与材质参考");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("对话尚在加载时收到画布引用，恢复旧草稿后再追加", async ({ page }) => {
  await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  await openZhiya(page);
  await pick(page, "通勤外套 1");
  await composer(page).fill("这是刷新前尚未发送的设计要求");
  await page.waitForTimeout(450);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/agent-conversations/visual-chat/messages*", async route => { await gate; return route.fallback(); });
  await page.reload();
  await expect(shape(page, 1)).toBeVisible();
  await shape(page, 1).click();
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  release();
  await expect(composer(page)).toHaveValue("这是刷新前尚未发送的设计要求");
  await expect(discussion(page).locator("[data-assistant-reference-id]")).toHaveCount(2);
  await expect(page.getByText("本机草稿与当前资料存在差异，请核对后继续。", { exact: true })).toHaveCount(0);
});
