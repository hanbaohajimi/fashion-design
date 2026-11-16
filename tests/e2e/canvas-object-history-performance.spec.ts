import { openCanvasFunction } from "./canvas-function-navigation";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepareZhiya, loadZhiya, zhiya } from "./zhiya-fixture";
import { canvasAction } from "./canvas-workspace-controls";

test.skip(process.env.OBJECT_HISTORY_PERF !== "1", "单独测量历史浏览与返回白板的响应");
test.setTimeout(150_000);
test.use({ trace: "off", video: "off" });

async function sample(page: Page, target: "canvas" | "history") {
  const list = page.getByRole("dialog", { name: "对象历史" }).locator('[data-object-history-scroll]');
  if (target === "canvas") await page.getByRole("button", { name: "抓手工具", exact: true }).click();
  const box = await (target === "canvas" ? page.getByLabel("无限白板", { exact: true }) : list).boundingBox();
  if (!box) throw new Error("测量区域未就绪");
  const x = box.x + box.width * .6, y = box.y + box.height * .5;
  const measurement = page.evaluate(() => new Promise<{ intervals: number[]; responses: number[] }>(resolve => {
    const intervals: number[] = [], responses: number[] = [];
    let start = 0, previous = 0, done = false;
    const response = () => { const at = performance.now(); requestAnimationFrame(() => { if (!done) responses.push(performance.now() - at); }); };
    window.addEventListener("pointermove", response, true); window.addEventListener("wheel", response, true);
    const step = (now: number) => {
      if (!start) start = now; if (previous) intervals.push(now - previous); previous = now;
      if (now - start < 30_000) requestAnimationFrame(step);
      else { done = true; window.removeEventListener("pointermove", response, true); window.removeEventListener("wheel", response, true); resolve({ intervals, responses }); }
    };
    requestAnimationFrame(step);
  }));
  await page.mouse.move(x, y); if (target === "canvas") await page.mouse.down();
  const start = Date.now(); let step = 0, direction = 1;
  while (Date.now() - start < 30_000) {
    if (target === "canvas") await page.mouse.move(x + Math.sin(step / 12) * 130, y + Math.cos(step / 12) * 70, { steps: 3 });
    else {
      const edge = await list.evaluate(element => ({ top: element.scrollTop, end: element.scrollHeight - element.clientHeight }));
      if (edge.top >= edge.end - 2) direction = -1; else if (edge.top <= 0) direction = 1;
      await page.mouse.wheel(0, 110 * direction);
    }
    await page.waitForTimeout(60); step++;
  }
  if (target === "canvas") await page.mouse.up();
  const result = await measurement, responses = [...result.responses].sort((a, b) => a - b);
  return { fps: 1000 * result.intervals.length / result.intervals.reduce((sum, value) => sum + value, 0),
    over33_3Percent: result.intervals.filter(value => value > 33.3).length / result.intervals.length * 100,
    inputToFrameP95Ms: responses[Math.floor(responses.length * .95)] ?? null, ...result };
}

test("100对象白板与60项图片历史浏览，关闭后恢复平移", async ({ page, browser }, info) => {
  const state = await prepareZhiya(page, { count: 100, realClock: true });
  const versions = Array.from({ length: 60 }, (_, i) => ({ id: i === 0 ? "look-0" : `old-${i}`, operation: i ? "transform" : "generated", createdAt: new Date(Date.UTC(2026, 10, 10) - i * 60_000).toISOString(), url: "/visual-garment.svg", archivedAt: null }));
  await page.route("**/api/design-assets/*/versions?*", route => {
    const start = Number(new URL(route.request().url()).searchParams.get("cursor") ?? 0);
    return route.fulfill({ json: { items: versions.slice(start, start + 10), nextCursor: start + 10 < versions.length ? String(start + 10) : null } });
  });
  await loadZhiya(page); await canvasAction(page, "查看全图"); await page.waitForTimeout(1200);
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  const before = await sample(page, "canvas");
  await openCanvasFunction(page, "画布对象");
  const start = Date.now();
  await page.getByRole("button", { name: "查看 通勤外套 1 的历史", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "对象历史", exact: true });
  await expect(panel.getByRole("listitem")).toHaveCount(10);
  const firstPageMs = Date.now() - start;
  for (const count of [20, 30, 40, 50, 60]) { await panel.getByRole("button", { name: "加载更多版本" }).click(); await expect(panel.getByRole("listitem")).toHaveCount(count); }
  await panel.locator('[data-object-history-scroll]').evaluate(element => { element.scrollTop = 0; });
  await expect(zhiya(page)).toHaveAttribute("data-active", "false"); await page.waitForTimeout(800);
  const history = await sample(page, "history");
  await panel.getByRole("button", { name: "关闭对象历史" }).click();
  await page.getByRole("button", { name: "关闭画布对象" }).click();
  await expect(zhiya(page)).toHaveAttribute("data-active", "true"); await canvasAction(page, "查看全图"); await page.waitForTimeout(1200);
  const after = await sample(page, "canvas");
  const report = { measuredAt: new Date().toISOString(), browser: browser.version(), headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency })),
    canvasObjects: 100, historyRows: 60, secondsPerSample: 30, firstPageMs,
    setup: "原生时钟/rAF、单worker、无trace或录屏及并行检查；100对象平移、60项历史滚动、关闭后平移各30秒；接口与图片为本地夹具",
    before, history, after, passed: [before, history, after].every(result => result.fps >= 58 && result.over33_3Percent < 1) };
  await mkdir("output/playwright/canvas-object-history", { recursive: true });
  await writeFile("output/playwright/canvas-object-history/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
  expect(report.passed, JSON.stringify({ before: [before.fps, before.over33_3Percent], history: [history.fps, history.over33_3Percent], after: [after.fps, after.over33_3Percent] })).toBe(true);
});
