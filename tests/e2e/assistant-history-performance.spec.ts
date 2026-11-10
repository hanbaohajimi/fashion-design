import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { loadZhiya, openZhiya, prepareZhiya } from "./zhiya-fixture";
import { NOW } from "../visual/fixtures";

test.skip(process.env.HISTORY_PERF !== "1", "单独测量长会话滚动响应");
test.setTimeout(150_000);
test.use({ video: "off", trace: "off" });

async function sample(page: Page) {
  const view = page.getByLabel("设计对话", { exact: true });
  await view.hover();
  const measured = page.evaluate(() => new Promise<{ intervals: number[]; responses: number[]; scrollMin: number; scrollMax: number; wheelEvents: number }>(resolve => {
    const view = document.querySelector('[aria-label="设计对话"]');
    if (!view) throw new Error("对话不可用");
    const intervals: number[] = [], responses: number[] = [];
    let scrollMin = view.scrollTop, scrollMax = view.scrollTop, wheelEvents = 0;
    let start = 0, previous = 0, done = false;
    const respond = () => {
      wheelEvents++;
      const at = performance.now();
      requestAnimationFrame(() => {
        if (done) return;
        responses.push(performance.now() - at);
        scrollMin = Math.min(scrollMin, view.scrollTop);
        scrollMax = Math.max(scrollMax, view.scrollTop);
      });
    };
    view.addEventListener("wheel", respond, { passive: true });
    const frame = (at: number) => {
      if (!start) start = at;
      if (previous) intervals.push(at - previous);
      previous = at;
      if (at - start < 30_000) requestAnimationFrame(frame);
      else { done = true; view.removeEventListener("wheel", respond); resolve({ intervals, responses, scrollMin, scrollMax, wheelEvents }); }
    };
    requestAnimationFrame(frame);
  }));
  const start = Date.now();
  let index = 0;
  while (Date.now() - start < 30_000) {
    await page.mouse.wheel(0, (Math.floor(index / 65) % 2 ? 1 : -1) * 180);
    await page.waitForTimeout(40);
    index++;
  }
  const result = await measured;
  const sorted = [...result.responses].sort((a, b) => a - b);
  return { fps: 1000 * result.intervals.length / result.intervals.reduce((sum, value) => sum + value, 0),
    over33_3Percent: result.intervals.filter(value => value > 33.3).length / result.intervals.length * 100,
    wheelToFrameP95Ms: sorted[Math.floor(sorted.length * .95)] ?? null, ...result };
}

test("100 对象白板中的 50 与 300 条消息实际滚动响应", async ({ page, browser }, info) => {
  const state = await prepareZhiya(page, { realClock: true, count: 100 });
  await page.route("**/api/agent-conversations/visual-chat/messages?*", route => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const end = cursor ? Number(cursor.slice("before-".length)) : 300;
    const start = Math.max(0, end - 50);
    return route.fulfill({ json: { items: Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      return { id: `reading-${index}`, conversationId: "visual-chat", role: index % 2 ? "assistant" : "user", status: "completed",
        content: `第 ${index + 1} 轮设计讨论。${"比较领口、袖型和面料，保留已确认的结构。".repeat(10)}`,
        createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(), updatedAt: NOW };
    }), nextCursor: start ? `before-${start}` : null } });
  });
  await loadZhiya(page);
  await openZhiya(page);
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  await expect(page.locator("[data-message-id]")).toHaveCount(50);
  await page.waitForTimeout(1000);
  const baseline = await sample(page);
  for (let count = 100; count <= 300; count += 50) {
    await page.getByLabel("设计对话", { exact: true }).hover();
    await page.mouse.wheel(0, -100000);
    await page.getByRole("button", { name: "读取更早消息", exact: true }).click();
    await expect(page.locator("[data-message-id]")).toHaveCount(count);
  }
  await page.getByRole("button", { name: "回到最新 ↓", exact: true }).click();
  await page.waitForTimeout(1000);
  const expanded = await sample(page);
  const report = { measuredAt: new Date().toISOString(), browser: browser.version(), headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency, userAgent: navigator.userAgent })),
    objects: 100, messageCounts: [50, 300], secondsPerSample: 30,
    setup: "原生时钟与rAF；相同100对象白板，50条与逐页展开至300条消息，各实际滚轮操作30秒；无模型调用", baseline, expanded,
    passed: expanded.fps >= 58 && expanded.over33_3Percent < 1 };
  await mkdir("output/playwright/assistant-history", { recursive: true });
  await writeFile("output/playwright/assistant-history/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
  expect(baseline.scrollMax - baseline.scrollMin).toBeGreaterThan(1000);
  expect(expanded.scrollMax - expanded.scrollMin).toBeGreaterThan(1000);
  expect(expanded.wheelEvents).toBeGreaterThan(200);
  expect(report.passed, `FPS ${expanded.fps.toFixed(2)}, long frames ${expanded.over33_3Percent.toFixed(2)}%`).toBe(true);
});
