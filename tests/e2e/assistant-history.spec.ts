import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { chooseValue, valueControl } from "./choice-control";
import { loadZhiya, openZhiya, prepareZhiya } from "./zhiya-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

test.use({ video: process.env.HISTORY_DEMO === "1" ? { mode: "on", size: { width: 1440, height: 900 } } : "off" });
test.afterEach(async ({ page }, info) => {
  if (process.env.HISTORY_DEMO !== "1" || info.status !== "passed") return;
  const video = page.video();
  await page.close();
  await video?.saveAs(`output/playwright/assistant-history/reading-${info.title.includes("320px") ? "320" : "1440"}.webm`);
});

const summary = (id: string, title: string) => ({ id, title, projectId: PROJECT, mode: "workflow", createdAt: NOW, updatedAt: NOW, archivedAt: null });
const message = (index: number, conversationId = "visual-chat") => ({
  id: `${conversationId}-message-${index}`, conversationId, role: index % 2 ? "assistant" : "user", status: "completed",
  content: `第 ${index + 1} 轮设计记录。${"保留领口结构，比较袖型与面料。".repeat(10)}`,
  createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(), updatedAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
});

async function setup(page: Page, width = 1440) {
  const state = await prepareZhiya(page, { realClock: true, viewport: { width, height: 900 } });
  const first = Array.from({ length: 50 }, (_, index) => summary(index ? `chat-${index}` : "visual-chat", index ? `通勤外套讨论 ${index}` : "当前通勤设计"));
  const older = summary("older-chat", "旧季风衣回顾");
  await page.route(`**/api/projects/${PROJECT}/agent-conversations?*`, route => route.fulfill({ json: new URL(route.request().url()).searchParams.has("cursor")
    ? { items: [older], nextCursor: null } : { items: first, nextCursor: "chat-49" } }));
  await page.route(`**/api/projects/${PROJECT}/agent-conversations/older-chat`, route => route.fulfill({ json: older }));
  await page.route("**/api/agent-conversations/*/messages*", route => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    if (id !== "visual-chat") return route.fulfill({ json: { items: [message(0, id)], nextCursor: null } });
    const old = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({ json: { items: Array.from({ length: 50 }, (_, i) => message(i + (old ? 0 : 50))), nextCursor: old ? null : "visual-chat-message-50" } });
  });
  return state;
}

for (const width of [1440, 320]) test(`${width}px 第 50 条之后的历史对话仍能读取并切换`, async ({ page }) => {
  const state = await setup(page, width);
  await loadZhiya(page);
  await openZhiya(page);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await page.getByRole("button", { name: "读取更早对话", exact: true }).click();
  await expect(page.getByText("已载入 51 条对话", { exact: true })).toBeVisible();
  await mkdir("output/playwright/assistant-history", { recursive: true });
  await page.screenshot({ path: `output/playwright/assistant-history/catalog-${width}.png` });
  await chooseValue(valueControl(page, "历史对话"), "older-chat");
  await expect(page.locator('[data-message-id="older-chat-message-0"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "读取更早对话", exact: true })).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test("较早会话链接直接打开指定对话，不替换成最近一条", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/${PROJECT}?conversationId=older-chat`);
  await expect(page.locator('[data-message-id="older-chat-message-0"]')).toBeVisible();
  await expect(page.locator('[data-message-id="visual-chat-message-99"]')).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

for (const width of [1440, 320]) test(`${width}px 读取更早消息时可继续编辑草稿，阅读位置与光标保留`, async ({ page }) => {
  const state = await setup(page, width);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route("**/api/agent-conversations/visual-chat/messages?*", async route => {
    if (!new URL(route.request().url()).searchParams.has("cursor")) return route.fallback();
    requested = true;
    await gate;
    return route.fulfill({ json: { items: Array.from({ length: 50 }, (_, i) => ({ ...message(i), ...(i === 1 ? { proposal: {
      id: "historic-proposal", baseRevision: 1, status: "rejected", content: "旧版领口方案", referencedNodeIds: [], rationale: "旧方案", toolNodeId: "historic-tool", createdAt: NOW, operations: [],
    } } : {}) })), nextCursor: null } });
  });
  await loadZhiya(page);
  await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("继续保留领口");
  const conversation = page.getByLabel("设计对话", { exact: true });
  await conversation.hover();
  await page.mouse.wheel(0, -100000);
  await expect.poll(() => conversation.evaluate(node => node.scrollTop)).toBeLessThan(1);
  const anchor = page.locator('[data-message-id="visual-chat-message-50"]');
  const before = (await anchor.boundingBox())?.y;
  try {
    await page.getByRole("button", { name: "读取更早消息", exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(input).toBeEnabled({ timeout: 400 });
    await input.press("End");
    await input.pressSequentially("，袖口再收一点");
    const selection = await input.evaluate((node: HTMLTextAreaElement) => node.selectionStart);
    if (process.env.HISTORY_DEMO) await page.waitForTimeout(1000);
    release();
    await expect(page.locator('[data-message-id="visual-chat-message-0"]')).toHaveCount(1);
    await expect(input).toHaveValue("继续保留领口，袖口再收一点");
    expect(await input.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(selection);
    expect(Math.abs(((await anchor.boundingBox())?.y ?? 0) - (before ?? 0))).toBeLessThan(3);
    await expect(page.getByRole("button", { name: "有新消息 ↓", exact: true })).toHaveCount(0);
    await mkdir("output/playwright/assistant-history", { recursive: true });
    await page.screenshot({ path: `output/playwright/assistant-history/reading-${width}.png` });
    if (process.env.HISTORY_DEMO) await page.waitForTimeout(1500);
    expect(state.errors).toEqual([]);
  } finally { release(); }
});

test("回看已有消息只显示回到最新，确有新回复时才提示新消息", async ({ page }) => {
  await setup(page);
  let fresh = false;
  await page.route("**/api/agent-conversations/visual-chat/messages?*", route => {
    if (new URL(route.request().url()).searchParams.has("cursor")) return route.fallback();
    return route.fulfill({ json: { items: [...Array.from({ length: 50 }, (_, i) => message(i + 50)), ...(fresh ? [message(100)] : [])], nextCursor: "visual-chat-message-50" } });
  });
  await loadZhiya(page);
  await openZhiya(page);
  const conversation = page.getByLabel("设计对话", { exact: true });
  await conversation.hover();
  await page.mouse.wheel(0, -100000);
  await expect(page.getByRole("button", { name: "回到最新 ↓", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "有新消息 ↓", exact: true })).toHaveCount(0);
  const anchor = page.locator('[data-message-id="visual-chat-message-50"]');
  const before = (await anchor.boundingBox())?.y;
  fresh = true;
  await expect(page.getByRole("button", { name: "有新消息 ↓", exact: true })).toBeVisible();
  expect(Math.abs(((await anchor.boundingBox())?.y ?? 0) - (before ?? 0))).toBeLessThan(3);
  await page.getByRole("button", { name: "有新消息 ↓", exact: true }).click();
  await expect(page.locator('[data-message-id="visual-chat-message-100"]')).toBeInViewport();
  await expect(page.getByRole("button", { name: "有新消息 ↓", exact: true })).toHaveCount(0);
});

test("较早的旧版会话链接保持只读", async ({ page }) => {
  const state = await setup(page);
  await page.route(`**/api/projects/${PROJECT}/agent-conversations/older-chat`, route => route.fulfill({ json: { ...summary("older-chat", "旧版风衣讨论"), mode: "legacy" } }));
  await page.goto(`/${PROJECT}?conversationId=older-chat`);
  await expect(page.locator('[data-message-id="older-chat-message-0"]')).toBeVisible();
  await expect(page.getByRole("textbox", { name: "描述设计需求", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送需求", exact: true })).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test("键盘回看和减弱动态保留阅读位置，调整到窄屏后可回到最新", async ({ page }) => {
  const state = await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadZhiya(page);
  await openZhiya(page);
  await expect(page.locator('[data-message-id="visual-chat-message-99"]')).toBeInViewport();
  await expect(page.getByRole("textbox", { name: "描述设计需求", exact: true })).toBeEnabled();
  const conversation = page.getByLabel("设计对话", { exact: true });
  await conversation.focus();
  await expect(conversation).toBeFocused();
  await conversation.press("Home");
  await expect.poll(() => conversation.evaluate(node => node.scrollTop)).toBeLessThan(1);
  await expect(page.getByRole("button", { name: "回到最新 ↓", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.locator('[data-message-id="visual-chat-message-50"]')).toBeInViewport();
  await expect(page.getByRole("button", { name: "有新消息 ↓", exact: true })).toHaveCount(0);
  const latest = page.getByRole("button", { name: "回到最新 ↓", exact: true });
  await latest.focus();
  await latest.press("Enter");
  await expect.poll(() => conversation.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

test("失效会话链接给出可恢复错误，不读取最近对话冒充目标", async ({ page }) => {
  const state = await setup(page);
  await page.route(`**/api/projects/${PROJECT}/agent-conversations/missing-chat`, route => route.fulfill({ status: 404, json: { message: "这段对话已不可用，请从历史对话重新选择。" } }));
  await page.goto(`/${PROJECT}?conversationId=missing-chat`);
  await expect(page.getByRole("alert").filter({ hasText: "这段对话已不可用，请从历史对话重新选择。" })).toBeVisible();
  await expect(page.locator("[data-message-id]")).toHaveCount(0);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await chooseValue(valueControl(page, "历史对话"), "visual-chat");
  await expect(page.locator('[data-message-id="visual-chat-message-99"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp("conversationId=visual-chat"));
  expect(state.mutations).toEqual([]);
});

test("历史列表读取失败可重试，追加去重并保留当前草稿", async ({ page }) => {
  const state = await setup(page);
  let attempts = 0;
  await page.route(`**/api/projects/${PROJECT}/agent-conversations?*`, route => {
    if (!new URL(route.request().url()).searchParams.has("cursor")) return route.fallback();
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 503, json: { message: "历史列表暂不可用" } })
      : route.fulfill({ json: { items: [summary("chat-49", "重复边界"), summary("older-chat", "旧季风衣回顾"), summary("older-chat", "旧季风衣回顾")], nextCursor: null } });
  });
  await loadZhiya(page);
  await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("还未发送的改袖要求");
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await page.getByRole("button", { name: "读取更早对话", exact: true }).click();
  await expect(page.getByText("历史列表暂不可用", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("还未发送的改袖要求");
  await page.getByRole("button", { name: "重试读取对话", exact: true }).click();
  await expect(page.getByText("已载入 51 条对话", { exact: true })).toBeVisible();
  await expect(page.getByText("历史列表暂不可用", { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue("还未发送的改袖要求");
  expect(attempts).toBe(2);
  expect(state.mutations).toEqual([]);
});

test("更早消息失败可重试，回到当前会话保留已展开历史与阅读位置", async ({ page }) => {
  await setup(page);
  let attempts = 0;
  await page.route("**/api/agent-conversations/visual-chat/messages?*", route => {
    if (!new URL(route.request().url()).searchParams.has("cursor")) return route.fallback();
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 503, json: { message: "较早消息暂不可用" } }) : route.fallback();
  });
  await loadZhiya(page);
  await openZhiya(page);
  const conversation = page.getByLabel("设计对话", { exact: true });
  await conversation.hover();
  await page.mouse.wheel(0, -100000);
  await page.getByRole("button", { name: "读取更早消息", exact: true }).click();
  await expect(page.getByText("较早消息暂不可用", { exact: true })).toBeVisible();
  await expect(page.locator("[data-message-id]")).toHaveCount(50);
  await page.getByRole("button", { name: "重试读取消息", exact: true }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(100);
  await conversation.hover();
  await page.mouse.wheel(0, -100000);
  await expect.poll(() => conversation.evaluate(node => node.scrollTop)).toBeLessThan(1);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await chooseValue(valueControl(page, "历史对话"), "chat-1");
  await expect(page.locator('[data-message-id="chat-1-message-0"]')).toBeVisible();
  await chooseValue(valueControl(page, "历史对话"), "visual-chat");
  await expect(page.locator("[data-message-id]")).toHaveCount(100);
  await expect(page.locator('[data-message-id="visual-chat-message-0"]')).toBeInViewport();
  await expect(page.getByRole("button", { name: "有新消息 ↓", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "回到最新 ↓", exact: true }).click();
  await expect.poll(() => conversation.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
  expect(attempts).toBe(2);
});

test("切换会话后迟到的旧历史响应不会混入新会话", async ({ page }) => {
  await setup(page);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route("**/api/agent-conversations/visual-chat/messages?*", async route => {
    if (!new URL(route.request().url()).searchParams.has("cursor")) return route.fallback();
    requested = true;
    await gate;
    await route.fulfill({ json: { items: [message(0)], nextCursor: null } }).catch(() => undefined);
  });
  await loadZhiya(page);
  await openZhiya(page);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  const conversation = page.getByLabel("设计对话", { exact: true });
  await conversation.hover();
  await page.mouse.wheel(0, -100000);
  try {
    await page.getByRole("button", { name: "读取更早消息", exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await chooseValue(valueControl(page, "历史对话"), "chat-1");
    await expect(page.locator('[data-message-id="chat-1-message-0"]')).toBeVisible();
    release();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-message-id]")).toHaveCount(1);
    await expect(page.locator('[data-message-id="visual-chat-message-0"]')).toHaveCount(0);
  } finally { release(); }
});
