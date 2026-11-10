import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepareImageOrientation } from "./image-orientation-fixture";

test.skip(process.env.IMAGE_ADJUSTMENTS_PERF !== "1", "单独测量色彩预览的原生帧间隔");
test.setTimeout(120_000);
test.use({ trace: "off", video: "off" });

async function sample(page: Page) {
  return page.evaluate(() => new Promise<{ intervals: number[]; responses: number[] }>(resolve => {
    const intervals: number[] = [], responses: number[] = [];
    let start = 0, previous = 0, finished = false;
    const respond = () => {
      const at = performance.now();
      requestAnimationFrame(() => { if (!finished) responses.push(performance.now() - at); });
    };
    window.addEventListener("input", respond, true);
    const step = (time: number) => {
      if (!start) start = time;
      if (previous) intervals.push(time - previous);
      previous = time;
      if (time - start < 30_000) requestAnimationFrame(step);
      else { finished = true; window.removeEventListener("input", respond, true); resolve({ intervals, responses }); }
    };
    requestAnimationFrame(step);
  }));
}
function summarize(value: { intervals: number[]; responses: number[] }) {
  const sorted = [...value.responses].sort((a, b) => a - b);
  return {
    fps: 1000 / (value.intervals.reduce((sum, n) => sum + n, 0) / value.intervals.length),
    over33_3Percent: value.intervals.filter(n => n > 33.3).length / value.intervals.length * 100,
    inputToFrameP95Ms: sorted[Math.floor(sorted.length * .95)] ?? null,
    ...value,
  };
}

test("100 个白板对象下直接调色的帧间隔", async ({ page, browser }, info) => {
  const state = await prepareImageOrientation(page, 1440, 900, 100);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace.getByRole("button", { name: "色彩与明暗", exact: true }).click();
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  await page.waitForTimeout(1500);
  const still = summarize(await sample(page));
  const measured = sample(page);
  const slider = await workspace.getByLabel("拖动调整饱和度").boundingBox();
  if (!slider) throw new Error("调色滑块不可见");
  await page.mouse.move(slider.x + slider.width / 2, slider.y + slider.height / 2);
  await page.mouse.down();
  for (let step = 0; step < 70; step++) {
    await page.mouse.move(slider.x + slider.width * (.5 + Math.sin(step / 5) * .35), slider.y + slider.height / 2, { steps: 6 });
    await page.waitForTimeout(300);
  }
  await page.mouse.up();
  const moving = summarize(await measured);
  const report = {
    measuredAt: new Date().toISOString(), browser: browser.version(), headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency })),
    objectCount: 100, objects: "30 图片、60 便签、10 色卡", durationPerSampleSeconds: 30,
    sourceSize: { width: 600, height: 800 },
    setup: "本地受控接口、原生时钟与 rAF；图片工作区覆盖已挂载的 100 对象白板，真实鼠标拖动饱和度，期间没有提交生成或变换请求",
    still, moving, passed: moving.fps >= 58 && moving.over33_3Percent < 1,
  };
  await mkdir("output/playwright/image-adjustments", { recursive: true });
  await writeFile("output/playwright/image-adjustments/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
  expect(report.passed, `FPS ${moving.fps.toFixed(2)}，长帧 ${moving.over33_3Percent.toFixed(2)}%`).toBe(true);
});
