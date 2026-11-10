import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { canvasAction } from "./canvas-workspace-controls";
import { emptyActivity, loadZhiya, prepareZhiya, zhiya } from "./zhiya-fixture";

test.skip(process.env.ZHIYA_PERF !== "1", "通过 ZHIYA_PERF=1 单独进行实际帧间隔测量");
test.setTimeout(180_000);
test.use({ trace: "off" });
const sampleSeconds = Math.min(60, Math.max(10, Number(process.env.ZHIYA_PERF_SECONDS) || 30));

async function sample(page: Page, onStep?: (index: number) => Promise<void>) {
  const measurement = page.evaluate(async (seconds) => {
    const intervals: number[] = [], responses: number[] = [];
    const longFrames: unknown[] = [];
    const observer = PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")
      ? new PerformanceObserver(list => { longFrames.push(...list.getEntries().map(entry => entry.toJSON())); }) : null;
    observer?.observe({ type: "long-animation-frame" });
    let previous = 0, start = 0, done = false;
    const respond = () => {
      const at = performance.now();
      requestAnimationFrame(() => { if (!done) responses.push(performance.now() - at); });
    };
    window.addEventListener("pointermove", respond, { capture: true });
    return new Promise<{ intervals: number[]; responses: number[]; longFrames: unknown[] }>(resolve => {
      const frame = (time: number) => {
        if (!start) start = time;
        if (previous) intervals.push(time - previous);
        previous = time;
        if (time - start < seconds * 1000) requestAnimationFrame(frame);
        else {
          done = true; window.removeEventListener("pointermove", respond, true);
          longFrames.push(...(observer?.takeRecords().map(entry => entry.toJSON()) ?? [])); observer?.disconnect();
          resolve({ intervals, responses, longFrames });
        }
      };
      requestAnimationFrame(frame);
    });
  }, sampleSeconds);
  const box = await page.getByLabel("无限白板", { exact: true }).boundingBox();
  if (!box) throw new Error("白板不可见");
  await page.getByRole("button", { name: "抓手工具", exact: true }).click();
  const x = box.x + box.width * .45, y = box.y + box.height * .45;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let index = 0; index < sampleSeconds * 2; index++) {
    if (onStep && index % 16 === 0) {
      await page.mouse.up();
      await onStep(index);
      await page.mouse.move(x, y); await page.mouse.down();
    }
    await page.mouse.move(x + Math.sin(index / 4) * 160, y + Math.cos(index / 4) * 60, { steps: 4 });
    await page.waitForTimeout(180);
  }
  await page.mouse.up();
  const samples = await measurement;
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * .95)] ?? 0;
  return { frames: samples.intervals.length, fps: 1000 / average(samples.intervals), meanFrameMs: average(samples.intervals), frameP95Ms: p95(samples.intervals), over33_3Percent: samples.intervals.filter(value => value > 33.3).length / samples.intervals.length * 100,
    pointerSamples: samples.responses.length, pointerToFrameMeanMs: average(samples.responses), pointerToFrameP95Ms: p95(samples.responses), ...samples };
}

test("100 个对象的白板：织芽暂停与创作时的实际帧间隔及操作响应", async ({ page, browser }, testInfo) => {
  const state = await prepareZhiya(page, { count: 100, activity: { ...emptyActivity(), executing: 1 }, realClock: true });
  await loadZhiya(page);
  // Playwright Clock replaces rAF as well as Date; never use it for performance evidence.
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  await expect(zhiya(page)).toHaveAttribute("data-scene", "working");
  await canvasAction(page, "查看全图");
  await page.waitForTimeout(1800);
  await zhiya(page).evaluate(node => { node.hidden = true; });
  await expect(zhiya(page)).toHaveAttribute("data-active", "false");
  const paused = await sample(page);
  await canvasAction(page, "查看全图");
  await zhiya(page).evaluate(node => { node.hidden = false; });
  await expect(zhiya(page)).toHaveAttribute("data-active", "true");
  await page.waitForTimeout(1000);
  const working = await sample(page);
  await canvasAction(page, "查看全图");
  const chrome = await sample(page, async index => {
    const open = page.getByRole("button", { name: "展开工作区目录", exact: true });
    if (await open.isVisible()) await open.click();
    else await page.getByRole("button", { name: "收起工作区目录", exact: true }).click();
    state.activity = index % 32 === 0 ? { ...emptyActivity(), preparing: 1, queued: 1 } : { ...emptyActivity(), executing: 1 };
  });
  await canvasAction(page, "查看全图");
  await page.screenshot({ path: "output/playwright/zhiya/100-object-working.png" });
  const environment = await zhiya(page).locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext("webgl"), debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return { userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency, webglRenderer: gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null };
  });
  let clipping: unknown = null;
  if (process.env.ZHIYA_CLIP_AUDIT) {
    const audit = await readFile(process.env.ZHIYA_CLIP_AUDIT, "utf8");
    clipping = await page.evaluate(`(${audit})({ root: '[data-zhiya]', tol: 1 })`);
  }
  const report = { measuredAt: new Date().toISOString(), browser: browser.version(), browserMode: testInfo.project.use.headless === false ? "headed" : "headless", environment, objectCount: 100, objects: "30 图片、60 文本便签、10 色卡", durationPerSampleSeconds: sampleSeconds, setup: "本机 Next 开发服务；浏览器原生 rAF、performance.now 与指针平移，未安装模拟时钟；业务 API 为本地受控数据；暂停与创作保持白板尺寸一致；第三组加入四次目录开合和真实状态变更产生的话语", paused, working, chrome, clipping, targets: { fps: 58, over33_3PercentBelow: 1 }, passed: [working, chrome].every(result => result.fps >= 58 && result.over33_3Percent < 1) };
  await mkdir("output/playwright/zhiya", { recursive: true });
  await writeFile("output/playwright/zhiya/performance.json", JSON.stringify(report, null, 2), "utf8");
  await testInfo.attach("实际帧间隔与操作响应", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  expect(report.passed, `创作 FPS ${working.fps.toFixed(2)}，长帧 ${working.over33_3Percent.toFixed(2)}%；目录/话语 FPS ${chrome.fps.toFixed(2)}，长帧 ${chrome.over33_3Percent.toFixed(2)}%`).toBe(true);
});
