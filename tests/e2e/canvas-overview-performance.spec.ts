import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { canvasAction } from "./canvas-workspace-controls";
import { loadZhiya, prepareZhiya } from "./zhiya-fixture";

test.skip(process.env.OVERVIEW_PERF !== "1", "单独测量总览导航响应");
test.setTimeout(150_000);
test.use({ trace: "off", video: "off" });

async function sample(page: Page, target: "canvas" | "overview") {
  if (target === "canvas") await page.getByRole("button", { name: "抓手工具", exact: true }).click();
  const box = await (target === "canvas" ? page.getByLabel("无限白板", { exact: true }) : page.getByRole("application", { name: "画布总览导航", exact: true })).boundingBox();
  if (!box) throw new Error("导航区域尚未显示");
  const x = box.x + box.width * (target === "canvas" ? .6 : .5), y = box.y + box.height * .5;
  const measurement = page.evaluate(() => new Promise<{ intervals: number[]; responses: number[] }>(resolve => {
    const intervals: number[] = [], responses: number[] = [];
    let start = 0, previous = 0, done = false;
    const respond = () => {
      const at = performance.now(); requestAnimationFrame(() => { if (!done) responses.push(performance.now() - at); });
    };
    window.addEventListener("pointermove", respond, true);
    const step = (time: number) => {
      if (!start) start = time;
      if (previous) intervals.push(time - previous);
      previous = time;
      if (time - start < 30_000) requestAnimationFrame(step);
      else { done = true; window.removeEventListener("pointermove", respond, true); resolve({ intervals, responses }); }
    };
    requestAnimationFrame(step);
  }));
  await page.mouse.move(x, y); await page.mouse.down();
  const start = Date.now(); let step = 0;
  while (Date.now() - start < 30_000) {
    await page.mouse.move(x + Math.sin(step / 12) * (target === "canvas" ? 130 : 28), y + Math.cos(step / 12) * (target === "canvas" ? 70 : 18), { steps: 3 });
    await page.waitForTimeout(60); step++;
  }
  await page.mouse.up();
  const result = await measurement;
  const responses = [...result.responses].sort((a, b) => a - b);
  return { fps: 1000 * result.intervals.length / result.intervals.reduce((sum, n) => sum + n, 0),
    over33_3Percent: result.intervals.filter(n => n > 33.3).length / result.intervals.length * 100,
    pointerToFrameP95Ms: responses[Math.floor(responses.length * .95)] ?? null, ...result };
}

test("100对象总览关闭、打开平移及拖动视野框的独立测量", async ({ page, browser }, info) => {
  const state = await prepareZhiya(page, { realClock: true, count: 100 });
  await loadZhiya(page); await canvasAction(page, "查看全图"); await page.waitForTimeout(1200);
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  const closed = await sample(page, "canvas");
  await canvasAction(page, "画布总览");
  await expect(page.getByRole("application", { name: "画布总览导航", exact: true })).toHaveAttribute("data-object-count", "100");
  await canvasAction(page, "查看全图"); await page.waitForTimeout(1200);
  const open = await sample(page, "canvas");
  await canvasAction(page, "查看全图"); await page.waitForTimeout(1200);
  const navigate = await sample(page, "overview");
  const report = { measuredAt: new Date().toISOString(), browser: browser.version(), headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency })),
    count: 100, objects: "30图片、60便签、10色卡，织芽持续陪伴", durationSeconds: 30,
    setup: "原生时钟/rAF，关闭总览后平移、打开总览后平移、拖动总览视野框；各30秒，无trace/录屏/并行检查；受控API，无模型调用",
    closed, open, navigate, passed: [closed, open, navigate].every(result => result.fps >= 58 && result.over33_3Percent < 1) };
  await mkdir("output/playwright/canvas-overview", { recursive: true });
  await writeFile("output/playwright/canvas-overview/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
  expect(report.passed, JSON.stringify({ closed: { fps: closed.fps, long: closed.over33_3Percent }, open: { fps: open.fps, long: open.over33_3Percent }, navigate: { fps: navigate.fps, long: navigate.over33_3Percent } })).toBe(true);
});
