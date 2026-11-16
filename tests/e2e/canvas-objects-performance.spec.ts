import { openCanvasFunction } from "./canvas-function-navigation";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { canvasAction } from "./canvas-workspace-controls";
import { loadZhiya, prepareZhiya } from "./zhiya-fixture";

test.skip(process.env.OBJECTS_PERF !== "1", "单独测量对象面板的白板响应");
test.setTimeout(120_000);
test.use({ trace: "off", video: "off" });

async function sample(page: Page) {
  await page.getByRole("button", { name: "抓手工具", exact: true }).click();
  const box = await page.getByLabel("无限白板", { exact: true }).boundingBox();
  if (!box) throw new Error("白板尚未显示");
  const x = box.x + box.width * .6, y = box.y + box.height * .5;
  const measurement = page.evaluate(() => new Promise<{ intervals: number[]; responses: number[] }>(resolve => {
    const intervals: number[] = [], responses: number[] = [];
    let start = 0, previous = 0, done = false;
    const respond = () => {
      const at = performance.now();
      requestAnimationFrame(() => { if (!done) responses.push(performance.now() - at); });
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
  const started = Date.now();
  let step = 0;
  while (Date.now() - started < 30_000) {
    await page.mouse.move(x + Math.sin(step / 12) * 130, y + Math.cos(step / 12) * 70, { steps: 3 });
    await page.waitForTimeout(60); step++;
  }
  await page.mouse.up();
  const result = await measurement;
  const responses = [...result.responses].sort((a, b) => a - b);
  return {
    fps: 1000 / (result.intervals.reduce((sum, n) => sum + n, 0) / result.intervals.length),
    over33_3Percent: result.intervals.filter(n => n > 33.3).length / result.intervals.length * 100,
    pointerToFrameP95Ms: responses[Math.floor(responses.length * .95)] ?? null,
    ...result,
  };
}

test("100 对象白板在对象目录关闭和展开时的原生平移响应", async ({ page, browser }, info) => {
  const state = await prepareZhiya(page, { realClock: true, count: 100 });
  await loadZhiya(page); await canvasAction(page, "查看全图");
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  await page.waitForTimeout(1200);
  const baseline = await sample(page);
  await openCanvasFunction(page, "画布对象");
  const panel = page.getByRole("region", { name: "画布对象", exact: true });
  await expect(panel.locator("[data-canvas-object-id]")).toHaveCount(100);
  await canvasAction(page, "查看全图"); await page.waitForTimeout(1200);
  const objectsOpen = await sample(page);
  const report = {
    measuredAt: new Date().toISOString(), browser: browser.version(), headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency })),
    objectCount: 100, objects: "30 图片、60 便签、10 色卡", durationPerSampleSeconds: 30,
    setup: "原生时钟和 rAF；织芽持续陪伴；对象目录关闭/展开两组，各连续鼠标平移 30 秒；本地受控接口，无模型调用、无 trace/video",
    baseline, objectsOpen,
    passed: [baseline, objectsOpen].every(result => result.fps >= 58 && result.over33_3Percent < 1),
  };
  await mkdir("output/playwright/canvas-objects", { recursive: true });
  await writeFile("output/playwright/canvas-objects/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
  expect(report.passed, JSON.stringify({ baseline: { fps: baseline.fps, longFrames: baseline.over33_3Percent }, objectsOpen: { fps: objectsOpen.fps, longFrames: objectsOpen.over33_3Percent } })).toBe(true);
});
