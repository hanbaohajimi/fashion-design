import { expect, test } from "@playwright/test";
import { PROJECT } from "../visual/fixtures";
import { elementBox, emptyActivity, hit, loadZhiya, openZhiya, prepareZhiya, zhiya } from "./zhiya-fixture";

test.setTimeout(90_000);

test("正式毛绒入口与右侧同一聊天：首访、草稿光标、阅读位置与白板中心", async ({ page }) => {
  const state = await prepareZhiya(page, { history: true });
  await loadZhiya(page);
  expect(state.oldModelRequests).toBe(0);
  await expect(page.getByRole("textbox", { name: "描述设计需求" })).toBeHidden();
  expect((await page.locator('#assistant[data-panel]').boundingBox())?.width ?? 0).toBeLessThan(1);
  const artwork = page.getByRole("group", { name: "通勤外套 1", exact: true });
  // Finish the existing material-drop scale before using its box as a zoom baseline.
  await artwork.evaluate(async node => {
    const animations: Animation[] = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      animations.push(...element.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)));
    }
    await Promise.allSettled(animations.map(animation => animation.finished));
  });
  const relativeArtwork = async () => {
    return artwork.evaluate(element => {
      // Read both rectangles in the same frame while resize observers settle.
      const board = element.closest('[aria-label="无限白板"]')?.getBoundingClientRect();
      const art = element.getBoundingClientRect();
      if (!board) throw new Error("白板几何信息缺失");
      return { x: art.x + art.width / 2 - board.x - board.width / 2, y: art.y + art.height / 2 - board.y - board.height / 2, width: art.width };
    });
  };
  const before = await relativeArtwork();
  await page.screenshot({ path: "output/playwright/zhiya/whiteboard-idle.png" });
  await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await expect(input).toBeFocused();
  const after = await relativeArtwork();
  expect(Math.abs(after.x - before.x)).toBeLessThan(3);
  expect(Math.abs(after.y - before.y)).toBeLessThan(3);
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  const sidebar = page.getByRole("complementary", { name: "设计助手", exact: true });
  expect(Math.abs((await elementBox(sidebar)).width - 400)).toBeLessThan(3);
  await input.fill("下一轮的中文设计草稿，先不要发送");
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(4, 8));
  const original = await input.elementHandle();
  const transcript = page.getByLabel("设计对话", { exact: true });
  await transcript.hover();
  await page.mouse.wheel(0, -10000);
  await expect.poll(() => transcript.evaluate(node => node.scrollTop)).toBeLessThan(500);
  const reading = await transcript.evaluate(node => node.scrollTop);
  const close = page.getByRole("button", { name: "收起设计助手", exact: true });
  await close.click();
  await expect(zhiya(page)).toBeVisible();
  expect(await original?.evaluate(node => node.isConnected)).toBe(true);
  await hit(page).focus(); await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("下一轮的中文设计草稿，先不要发送");
  expect(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([4, 8]);
  await expect.poll(() => transcript.evaluate(node => node.scrollTop)).toBeCloseTo(reading, -1);
  await expect.poll(async () => Math.abs((await relativeArtwork()).x - before.x)).toBeLessThan(3);
  const separator = page.getByRole("separator", { name: "调整侧栏宽度" });
  await page.getByRole("button", { name: "停靠到右侧", exact: true }).click();
  const divider = await separator.boundingBox();
  if (!divider) throw new Error("侧栏分隔条缺失");
  const beforeResize = await relativeArtwork();
  await page.mouse.move(divider.x + 3, divider.y + 180); await page.mouse.down();
  await page.mouse.move(divider.x - 57, divider.y + 180, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(430);
  await expect.poll(async () => Math.abs((await relativeArtwork()).x - beforeResize.x)).toBeLessThan(3);
  const resized = await relativeArtwork();
  expect(Math.abs(resized.x - beforeResize.x)).toBeLessThan(3);
  expect(Math.abs(resized.width - beforeResize.width)).toBeLessThan(1);
  await page.screenshot({ path: "output/playwright/zhiya/docked-same-chat.png" });
  await close.click();
  await page.reload(); await expect(zhiya(page)).toBeVisible();
  await openZhiya(page); await expect(input).toHaveValue("下一轮的中文设计草稿，先不要发送");
  expect((await elementBox(sidebar)).width).toBeGreaterThan(430);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(state.saves.every(save => !JSON.stringify(save.snapshot).includes("zhiya"))).toBe(true);
});

test("长按提起、提前移动取消、落定与 Escape 恢复，透明区域穿透", async ({ page }) => {
  const state = await prepareZhiya(page);
  await loadZhiya(page);
  const position = () => zhiya(page).locator(".pp-position").evaluate(node => node.style.transform);
  const box = await hit(page).boundingBox();
  if (!box) throw new Error("角色未出现");
  expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("[data-zhiya]")), { x: box.x + 1, y: box.y + 1 })).toBe(false);
  const start = { x: box.x + 48, y: box.y + 80 };
  const original = await position();
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x - 10, start.y, { steps: 2 });
  await page.waitForTimeout(450);
  await expect(zhiya(page)).toHaveAttribute("data-held", "false");
  await page.mouse.up();
  expect(await position()).toBe(original);
  await expect(page.getByRole("textbox", { name: "描述设计需求" })).toBeHidden();
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await expect(zhiya(page)).toHaveAttribute("data-held", "true");
  await page.mouse.move(start.x - 150, start.y - 90, { steps: 8 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect(await position()).toBe(original);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await expect(zhiya(page)).toHaveAttribute("data-held", "true");
  await page.mouse.move(start.x - 140, start.y - 80, { steps: 8 }); await page.mouse.up();
  await expect(zhiya(page)).toHaveAttribute("data-action", "land");
  await expect(zhiya(page)).toHaveAttribute("data-held", "false");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fashion:zhiya:visual-designer:atelier-visual"))).not.toBeNull();
  await page.waitForTimeout(1000);
  const saved = await position();
  await page.reload(); await expect(zhiya(page)).toBeVisible();
  expect(await position()).toBe(saved);
  const moved = await hit(page).boundingBox();
  if (!moved) throw new Error("拖动后角色缺失");
  await page.mouse.move(moved.x + 48, moved.y + 80); await page.mouse.down();
  await expect(zhiya(page)).toHaveAttribute("data-held", "true");
  await page.mouse.move(0, 0, { steps: 6 }); await page.mouse.up();
  const limit = await elementBox(hit(page)), board = await elementBox(zhiya(page));
  expect(limit.x).toBeGreaterThanOrEqual(board.x);
  expect(limit.y).toBeGreaterThanOrEqual(board.y);
  await page.mouse.move(limit.x + 48, limit.y + 80); await page.mouse.down();
  await expect(zhiya(page)).toHaveAttribute("data-held", "true");
  await page.mouse.move(board.x + board.width, board.y + board.height, { steps: 8 }); await page.mouse.up();
  await expect(zhiya(page)).toHaveAttribute("data-action", "idle");
  await expect(zhiya(page).locator(".pp-label")).toBeHidden();
  const label = await elementBox(hit(page));
  const tools = await elementBox(page.getByRole("complementary", { name: "工具条", exact: true }));
  expect(label.y + label.height).toBeLessThan(tools.y - 8);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("引用明确展开聊天，会话链接覆盖收起偏好", async ({ page }) => {
  const state = await prepareZhiya(page);
  await loadZhiya(page);
  const art = await page.getByRole("group", { name: "通勤外套 1", exact: true }).boundingBox();
  if (!art) throw new Error("作品未出现");
  await page.mouse.click(art.x + art.width / 2, art.y + art.height / 2);
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "描述设计需求" })).toBeVisible();
  await expect(page.getByLabel("正在讨论", { exact: true })).toContainText("通勤外套 1");
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(zhiya(page)).toBeVisible();
  await page.goto(`/${PROJECT}?conversationId=visual-chat`);
  await expect(page.getByRole("textbox", { name: "描述设计需求" })).toBeVisible();
  await expect(zhiya(page)).toBeHidden();
  expect(state.mutations).toEqual([]);
});

test("真实状态联动：排队、创作、确认、完成与历史恢复", async ({ page }) => {
  const state = await prepareZhiya(page, { activity: { ...emptyActivity(), preparing: 1, queued: 1 } });
  await loadZhiya(page);
  await expect(zhiya(page).locator(".pp-caption")).toHaveText("排队中");
  await expect(zhiya(page).locator(".pp-thought-mark")).toHaveCount(3);
  state.activity = { ...emptyActivity(), executing: 1 };
  await expect(zhiya(page)).toHaveAttribute("data-scene", "working");
  await expect.poll(() => zhiya(page).locator(".pp-work-kit").evaluate(node => Number(getComputedStyle(node).opacity))).toBeGreaterThan(.95);
  await page.screenshot({ path: "output/playwright/zhiya/working.png" });
  state.activity = { ...state.activity, awaitingUser: 1, waiting: { input: 0, confirmation: 1, resume: 0 } };
  await expect(zhiya(page)).toHaveAttribute("data-scene", "needs_attention");
  await expect(zhiya(page).locator(".pp-caption")).toHaveText("等你确认");
  state.activity = { ...emptyActivity(), executing: 1, recent: [{ id: "workflow:first", domain: "workflow", outcome: "completed", updatedAt: "2026-11-08T12:01:00Z" }] };
  await expect(zhiya(page)).toHaveAttribute("data-action", "success");
  state.activity = { ...state.activity, executing: 2 };
  await expect(zhiya(page)).toHaveAttribute("data-action", "working");
  await openZhiya(page);
  state.activity = { ...emptyActivity(), executing: 1, recent: [{ id: "workflow:hidden", domain: "workflow", outcome: "completed", updatedAt: "2026-11-08T12:02:00Z" }] };
  const count = state.queries.length;
  await expect.poll(() => state.queries.length).toBeGreaterThan(count);
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(zhiya(page)).toHaveAttribute("data-action", "working");
  const resumed = state.queries.length;
  await expect.poll(() => state.queries.length).toBeGreaterThan(resumed);
  await expect(zhiya(page)).toHaveAttribute("data-action", "working");
  state.activity = { ...state.activity, recent: [{ id: "workflow:failure", domain: "workflow", outcome: "failed", updatedAt: "2026-11-08T12:03:00Z" }] };
  await expect(zhiya(page)).toHaveAttribute("data-action", "failure");
  await expect(zhiya(page)).toHaveAttribute("data-action", "working");
  state.failTasks = true;
  await page.waitForTimeout(4000);
  await expect(zhiya(page)).toHaveAttribute("data-scene", "working");
  expect(state.mutations).toEqual([]);
});

test.describe("触屏与窄屏", () => {
  test.use({ hasTouch: true });
  test("320 px 触屏打开不抢输入焦点，系统深色偏好、减弱动态和草稿保持可用", async ({ page }) => {
    const state = await prepareZhiya(page, { viewport: { width: 320, height: 760 }, activity: { ...emptyActivity(), executing: 1 } });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadZhiya(page);
    expect(Math.round((await elementBox(hit(page))).width)).toBe(72);
    await expect(zhiya(page)).toHaveAttribute("data-rendering", "false");
    expect(await zhiya(page).evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
    await hit(page).tap({ position: { x: 36, y: 58 } });
    const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
    await expect(input).toBeVisible(); await expect(input).not.toBeFocused();
    await input.tap(); await input.fill("手机里的设计草稿");
    await page.getByRole("button", { name: "返回画布", exact: true }).tap();
    await expect(zhiya(page)).toBeVisible();
    await expect(zhiya(page)).toHaveAttribute("data-rendering", "false");
    // Deeply nested contents must appear with the shell, without inherited visibility transitions.
    expect(await zhiya(page).locator(".pp-rig, .pp-body-mesh").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).visibility))).toEqual(["visible", "visible"]);
    await expect(zhiya(page).locator(".pp-body-mesh")).toBeVisible();
    await expect(page.getByRole("group", { name: "通勤外套 1", exact: true }).locator("img")).toBeVisible();
    const label = await elementBox(zhiya(page).locator(".pp-label"));
    const tools = await elementBox(page.getByRole("complementary", { name: "工具条", exact: true }));
    expect(label.y + label.height).toBeLessThan(tools.y - 8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "output/playwright/zhiya/mobile-system-dark.png" });
    await hit(page).tap({ position: { x: 36, y: 58 } });
    await expect(input).toHaveValue("手机里的设计草稿");
    await expect(input).not.toBeFocused();
    expect(state.mutations).toEqual([]);
  });
});

test("初始无 WebGL 仍能使用毛绒原图；平板抽屉保留触屏输入选择", async ({ page }) => {
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof native>) {
      if (String(args[0]).startsWith("webgl") && this.classList.contains("pp-body-mesh")) return null;
      return native.apply(this, args);
    } as typeof native;
  });
  const state = await prepareZhiya(page, { viewport: { width: 850, height: 900 } });
  await loadZhiya(page);
  await expect(zhiya(page).locator(".pp-body-fallback")).toHaveCSS("opacity", "1");
  await openZhiya(page);
  await expect(page.getByRole("dialog", { name: "设计助手面板" })).toBeVisible();
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await expect(input).toBeFocused();
  await input.fill("抽屉中的草稿");
  await page.keyboard.press("Escape");
  await expect(zhiya(page)).toBeVisible();
  await openZhiya(page);
  await expect(input).toHaveValue("抽屉中的草稿");
  expect(state.mutations).toEqual([]);
});

test("中文组合输入与停止回复仍属于现有聊天，收起期间回复继续同步", async ({ page }) => {
  const state = await prepareZhiya(page);
  let responseStatus = "pending";
  let sends = 0, stops = 0;
  const userMessage = { id: "live-user", conversationId: "visual-chat", role: "user", status: "completed", content: "继续讨论", clientRequestId: "request-live", referencedNodeIds: [], createdAt: "2026-11-08T12:00:00Z", updatedAt: "2026-11-08T12:00:00Z" };
  const reply = () => ({ id: "live-reply", conversationId: "visual-chat", role: "assistant", status: responseStatus, origin: "conversation", replyToId: "live-user", content: responseStatus === "pending" ? "正在比较廓形" : "保留柔和廓形与自然织物肌理。", referencedNodeIds: [], createdAt: "2026-11-08T12:00:00Z", updatedAt: "2026-11-08T12:00:01Z" });
  await page.route("**/api/agent-conversations/visual-chat/messages*", route => {
    if (route.request().method() === "POST") { sends++; return route.fulfill({ json: { userMessage, assistantMessage: reply() } }); }
    return route.fulfill({ json: { items: [userMessage, reply()], nextCursor: null } });
  });
  await page.route("**/api/agent-conversations/visual-chat/message-streams/request-live/cancel", route => { stops++; responseStatus = "canceled"; return route.fulfill({ json: { status: "canceled", messageId: "live-reply", canceled: true, providerStopped: null, scope: "assistant_reply" } }); });
  await loadZhiya(page);
  await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("下一条草稿");
  await page.getByRole("button", { name: "停止回复", exact: true }).click();
  expect(stops).toBe(1);
  await expect(page.getByRole("button", { name: "停止回复", exact: true })).toBeHidden();
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await input.dispatchEvent("compositionend");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter" });
  expect(sends).toBe(0);
  await expect(input).toHaveValue("下一条草稿");
  responseStatus = "pending";
  // A separate reply has its own identity; a stopped reply must never be revived.
  await page.route("**/api/agent-conversations/visual-chat/messages*", route => route.fulfill({ json: { items: [userMessage, { ...reply(), id: "second-reply" }], nextCursor: null } }));
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect(zhiya(page)).toHaveAttribute("data-scene", "thinking");
  responseStatus = "completed";
  await expect(zhiya(page)).toHaveAttribute("data-scene", "idle");
  await openZhiya(page);
  await expect(page.getByLabel("设计对话", { exact: true })).toContainText("保留柔和廓形与自然织物肌理。");
  await expect(input).toHaveValue("下一条草稿");
  expect(sends).toBe(0);
  expect(state.mutations).toEqual(["POST /api/agent-conversations/visual-chat/message-streams/request-live/cancel"]);
});

test("WebGL 丢失和恢复沿用原图，渲染失败仍保留普通聊天入口", async ({ page }) => {
  await prepareZhiya(page);
  await loadZhiya(page);
  await expect(zhiya(page)).toHaveAttribute("data-body-surface", "mesh");
  await zhiya(page).locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const extension = canvas.getContext("webgl")?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("测试环境没有上下文丢失扩展");
    (window as unknown as { restoreZhiya: () => void }).restoreZhiya = () => extension.restoreContext();
    extension.loseContext();
  });
  await expect(zhiya(page)).toHaveAttribute("data-body-surface", "image");
  await expect(zhiya(page).locator(".pp-body-fallback")).toHaveCSS("opacity", "1");
  await page.evaluate(() => (window as unknown as { restoreZhiya: () => void }).restoreZhiya());
  await expect(zhiya(page)).toHaveAttribute("data-body-surface", "mesh");
  await zhiya(page).locator("img").first().evaluate(node => node.dispatchEvent(new Event("error", { bubbles: true })));
  await expect(zhiya(page)).toHaveCount(0);
  await page.getByRole("button", { name: "展开设计助手", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "描述设计需求" })).toBeFocused();
});

test("连续开合后消息正文与下一条草稿保留，不展示引用记录", async ({ page }) => {
  const state = await prepareZhiya(page);
  await page.route("**/api/agent-conversations/visual-chat/messages*", route => route.fulfill({ json: {
    items: [{ id: "result-receipt", conversationId: "visual-chat", role: "assistant", status: "completed", origin: "execution_result", content: "这一轮已完成，可以回到白板继续查看。", referencedNodeIds: [], context: { focusNodeIds: ["material-2"] }, createdAt: "2026-11-08T12:00:00Z", updatedAt: "2026-11-08T12:00:00Z" }], nextCursor: null,
  } }));
  await loadZhiya(page);
  await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("下一轮再调整袖口");
  for (let count = 0; count < 2; count++) {
    await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
    await openZhiya(page);
  }
  await expect(page.getByText("这一轮已完成，可以回到白板继续查看。", { exact: true })).toBeVisible();
  await expect(page.getByText("查看引用记录", { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue("下一轮再调整袖口");
  expect(state.mutations).toEqual([]);
});
