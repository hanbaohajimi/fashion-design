import { mkdir } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { PROJECT, seedVisualApp } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";
import { contrastFailures } from "./review-accessibility";

test("流式正文逐字呈现、输入响应与立即显示", async ({ page }) => {
  await seedVisualApp(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const text = "亚麻适合夏季服装，保留立领与宽松廓形。".repeat(50);
  let submissions = 0;
  await page.route("**/api/agent-conversations/visual-chat/workflow-messages", async (route) => {
    submissions++;
    const input = route.request().postDataJSON(); const now = new Date().toISOString();
    const base = { context: { fileAssetIds: [], shapeIds: [], referencedNodeIds: [], focusNodeIds: [] }, createdAt: now, updatedAt: now, error: null, generationTaskId: null, kind: "reply", proposal: null };
    const userMessage = { ...base, id: "stream-ui-user", role: "user", status: "completed", clientRequestId: input.clientRequestId, content: input.content, replyToId: null };
    const assistantMessage = { ...base, id: "stream-ui-assistant", role: "assistant", status: "pending", clientRequestId: null, content: "", replyToId: userMessage.id };
    const common = { attemptId: "stream-ui-attempt", messageId: assistantMessage.id };
    const events = [
      { ...common, eventId: "1-0", type: "accepted", turn: { userMessage, assistantMessage } },
      { ...common, eventId: "2-0", type: "message.delta", text },
      { ...common, eventId: "3-0", type: "message.completed", turn: { userMessage, assistantMessage: { ...assistantMessage, status: "completed", content: text } } },
    ];
    await route.fulfill({ contentType: "text/event-stream", body: events.map((event) => `id: ${event.eventId}\nevent: assistant\ndata: ${JSON.stringify(event)}\n\n`).join("") });
  });
  await page.goto(`/${PROJECT}`);
  const input = page.getByRole("textbox", { name: "描述设计需求" });
  await input.fill("请说明面料与廓形");
  await page.getByRole("button", { name: "发送需求", exact: true }).click();
  const reply = page.locator('[data-message-id="stream-ui-assistant"] [data-stream-body]');
  await expect.poll(async () => (await reply.textContent())?.length ?? 0).toBeGreaterThan(0);
  expect((await reply.textContent())?.length ?? 0).toBeLessThan(text.length);
  const start = Date.now(); await input.fill("下一轮保留立领"); expect(Date.now() - start).toBeLessThan(1000);
  expect(await reply.locator('[class*="character"]').count()).toBeLessThanOrEqual(8);
  await page.getByRole("button", { name: "立即显示已收到内容" }).click();
  await expect(reply).toHaveText(text);
  await expect(input).toHaveValue("下一轮保留立领");
  expect(submissions).toBe(1);
});

for (const width of [320, 390, 768, 1280, 1440]) {
  test(`四层背景、输入焦点与Grid折叠 ${width}`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedVisualApp(page);
    await page.route(`**/api/projects/${PROJECT}/studio`, (route) => route.fulfill({ json: workspaceFixture() }));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`/${PROJECT}/studio?tab=trends`);
    const field = page.getByLabel("设计任务", { exact: true });
    await expect(field).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await field.scrollIntoViewIfNeeded();
    const before = await field.boundingBox(); await field.focus();
    await expect.poll(() => field.evaluate((element) => Number([...getComputedStyle(element).boxShadow.matchAll(/0px 0px 0px ([\d.]+)px/gu)].at(-1)?.[1] ?? 0))).toBeGreaterThan(4.99);
    const focus = await field.evaluate((element) => ({ outline: getComputedStyle(element).outlineStyle, shadow: getComputedStyle(element).boxShadow, numerals: getComputedStyle(element).fontVariantNumeric }));
    expect(focus.outline).toBe("none"); expect(focus.shadow).not.toBe("none"); expect(focus.numerals).toContain("tabular-nums");
    const after = await field.boundingBox(); expect(before).not.toBeNull(); expect(after).not.toBeNull();
    expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(.5);
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThan(.5);
    const disclosure = page.locator("details[data-grid-expanded]").first();
    const summary = disclosure.locator(":scope > summary");
    if (await summary.getAttribute("aria-expanded") === "true") await summary.click();
    await expect(disclosure.locator("[inert]").first()).toHaveAttribute("aria-hidden", "true");
    await expect(disclosure).not.toHaveAttribute("open");
    await summary.click(); await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(disclosure).toHaveAttribute("open");
    await expect.poll(async () => disclosure.locator("[data-expanded]").first().getAttribute("data-expanded")).toBe("true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await contrastFailures(page, true)).toEqual([]);
    await field.focus();
    await page.emulateMedia({ forcedColors: "active" });
    expect(await field.evaluate((element) => getComputedStyle(element).borderStyle)).toBe("dashed");
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    await mkdir("output/ui-refinement/screenshots", { recursive: true });
    await page.screenshot({ path: `output/ui-refinement/screenshots/trends-${browserName}-${width}.png`, fullPage: true });
  });
}
