import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { openText, prepareImageText, scanText } from "./image-text-fixture";

test.skip(process.env.IMAGE_TEXT_PERF !== "1", "单独测量文字选区操作的原生帧间隔");
test.setTimeout(150_000);
test.use({ trace: "off", video: "off" });

function sample(page: Page) {
  return page.evaluate(() => new Promise<{ intervals: number[]; responses: number[] }>(resolve => {
    const intervals: number[] = [], responses: number[] = [];
    let start = 0, previous = 0, finished = false;
    const respond = () => {
      const at = performance.now();
      requestAnimationFrame(() => { if (!finished) responses.push(performance.now() - at); });
    };
    window.addEventListener("pointermove", respond, true);
    const step = (time: number) => {
      if (!start) start = time;
      if (previous) intervals.push(time - previous);
      previous = time;
      if (time - start < 30_000) requestAnimationFrame(step);
      else {
        finished = true;
        window.removeEventListener("pointermove", respond, true);
        resolve({ intervals, responses });
      }
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

test("100 个白板对象下文字选区移动与缩放的帧间隔", async ({ page, browser }, info) => {
  const state = await prepareImageText(page, 1440, 900, 100);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await openText(workspace);
  await scanText(workspace);
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  await page.waitForTimeout(1500);
  const still = summarize(await sample(page));
  async function drag(name: string, x: number, y: number) {
    const measured = sample(page);
    const control = await workspace.getByRole("button", { name, exact: true }).boundingBox();
    if (!control) throw new Error("文字区域操作点不可见");
    const center = { x: control.x + control.width / 2, y: control.y + control.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    for (let step = 0; step < 70; step++) {
      await page.mouse.move(center.x + Math.sin(step / 5) * x, center.y + Math.cos(step / 6) * y, { steps: 6 });
      await page.waitForTimeout(300);
    }
    await page.mouse.up();
    return summarize(await measured);
  }
  const moving = await drag("移动文字区域 1", 30, 20);
  const resizing = await drag("调整文字区域 1 大小", 35, 14);
  const samples = { still, moving, resizing };
  const report = {
    measuredAt: new Date().toISOString(), browser: browser.version(),
    headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency })),
    objectCount: 100, objects: "30 图片、60 便签、10 色卡", sourceSize: { width: 600, height: 800 }, durationPerSampleSeconds: 30,
    setup: "本地受控识别接口、原生时钟与 rAF；保留100对象白板，真实鼠标持续调整文字选区，没有生成请求",
    ...samples,
    passed: Object.values(samples).every(value => value.fps >= 58 && value.over33_3Percent < 1),
  };
  await mkdir("output/playwright/image-text", { recursive: true });
  await writeFile("output/playwright/image-text/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.commands).toHaveLength(0);
  expect(state.masks).toHaveLength(0);
  expect(state.errors).toEqual([]);
  expect(report.passed, Object.entries(samples).map(([name, value]) => `${name} ${value.fps.toFixed(2)}fps / 长帧 ${value.over33_3Percent.toFixed(3)}%`).join("；")).toBe(true);
});
