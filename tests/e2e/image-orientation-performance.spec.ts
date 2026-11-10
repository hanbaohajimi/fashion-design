import { mkdir, writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { prepareImageOrientation } from "./image-orientation-fixture";
import { elementBox } from "./zhiya-fixture";

test.skip(
  process.env.IMAGE_ORIENTATION_PERF !== "1",
  "单独测量图片编辑的原生帧间隔",
);
test.setTimeout(120_000);
test.use({ trace: "off", video: "off" });

async function sample(page: Page) {
  return page.evaluate(async () => {
    const intervals: number[] = [],
      responses: number[] = [];
    let previous = 0,
      start = 0,
      finished = false;
    const respond = () => {
      const now = performance.now();
      requestAnimationFrame(() => {
        if (!finished) responses.push(performance.now() - now);
      });
    };
    window.addEventListener("input", respond, true);
    return new Promise<{ intervals: number[]; responses: number[] }>(
      (resolve) => {
        const step = (time: number) => {
          if (!start) start = time;
          if (previous) intervals.push(time - previous);
          previous = time;
          if (time - start < 30_000) requestAnimationFrame(step);
          else {
            finished = true;
            window.removeEventListener("input", respond, true);
            resolve({ intervals, responses });
          }
        };
        requestAnimationFrame(step);
      },
    );
  });
}
function summarize(values: { intervals: number[]; responses: number[] }) {
  const average = (data: number[]) =>
    data.length ? data.reduce((a, b) => a + b, 0) / data.length : null;
  const p95 = (data: number[]) =>
    [...data].sort((a, b) => a - b)[Math.floor(data.length * 0.95)] ?? null;
  return {
    fps: 1000 / (average(values.intervals) ?? Infinity),
    frameP95Ms: p95(values.intervals),
    over33_3Percent:
      (values.intervals.filter((ms) => ms > 33.3).length /
        values.intervals.length) *
      100,
    inputToFrameP95Ms: p95(values.responses),
    ...values,
  };
}

test("100 个白板对象下图片旋转预览的帧间隔", async ({
  page,
  browser,
}, info) => {
  const state = await prepareImageOrientation(page, 1440, 900, 100);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "旋转与翻转", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      Boolean((Date as DateConstructor & { isFake?: boolean }).isFake),
    ),
  ).toBe(false);
  await page.waitForTimeout(1500);
  const still = summarize(await sample(page));
  const movingSample = sample(page);
  const slider = await elementBox(workspace.getByLabel("拖动调整旋转角度"));
  await page.mouse.move(
    slider.x + slider.width / 2,
    slider.y + slider.height / 2,
  );
  await page.mouse.down();
  for (let index = 0; index < 70; index++) {
    await page.mouse.move(
      slider.x + slider.width * (0.5 + Math.sin(index / 5) * 0.35),
      slider.y + slider.height / 2,
      { steps: 6 },
    );
    await page.waitForTimeout(300);
  }
  await page.mouse.up();
  const moving = summarize(await movingSample);
  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    dpr: devicePixelRatio,
    cpuThreads: navigator.hardwareConcurrency,
  }));
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    headless: info.project.use.headless !== false,
    environment,
    objectCount: 100,
    objects: "30 图片、60 便签、10 色卡",
    durationPerSampleSeconds: 30,
    sourceSize: { width: 600, height: 800 },
    setup:
      "本地受控业务接口，原生时钟与 rAF；真实鼠标拖动角度滑块，图片工作区覆盖已挂载的 100 对象白板；静止与拖动期间没有生成请求",
    still,
    moving,
    passed: moving.fps >= 58 && moving.over33_3Percent < 1,
  };
  await mkdir("output/playwright/image-orientation", { recursive: true });
  await writeFile(
    "output/playwright/image-orientation/performance.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
  expect(
    report.passed,
    `FPS ${moving.fps.toFixed(2)}，长帧 ${moving.over33_3Percent.toFixed(2)}%`,
  ).toBe(true);
});
