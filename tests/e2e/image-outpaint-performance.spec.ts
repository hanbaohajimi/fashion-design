import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepareImageEditing } from "./image-editing-fixture";

test.skip(
  process.env.IMAGE_OUTPAINT_PERF !== "1",
  "单独测量扩图操作的原生帧间隔",
);
test.setTimeout(120_000);
test.use({ trace: "off", video: "off" });

async function sample(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ intervals: number[]; responses: number[] }>((resolve) => {
        const intervals: number[] = [],
          responses: number[] = [];
        let start = 0,
          previous = 0,
          finished = false;
        const respond = () => {
          const at = performance.now();
          requestAnimationFrame(() => {
            if (!finished) responses.push(performance.now() - at);
          });
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
      }),
  );
}
function summarize(value: { intervals: number[]; responses: number[] }) {
  const sorted = [...value.responses].sort((a, b) => a - b);
  return {
    fps:
      1000 /
      (value.intervals.reduce((sum, n) => sum + n, 0) / value.intervals.length),
    over33_3Percent:
      (value.intervals.filter((n) => n > 33.3).length /
        value.intervals.length) *
      100,
    inputToFrameP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
    ...value,
  };
}
test("100 个白板对象下扩图拖动的帧间隔", async ({ page, browser }, info) => {
  const state = await prepareImageEditing(page, 1440, 900, 100);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "调整大小", exact: true })
    .click();
  await workspace.getByRole("radio", { name: "AI 扩图", exact: true }).click();
  expect(
    await page.evaluate(() =>
      Boolean((Date as DateConstructor & { isFake?: boolean }).isFake),
    ),
  ).toBe(false);
  await page.waitForTimeout(1500);
  const still = summarize(await sample(page));
  const measured = sample(page);
  const source = await workspace
    .getByRole("button", { name: "移动扩图原图" })
    .boundingBox();
  if (!source) throw new Error("原图不可见");
  const center = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let step = 0; step < 70; step++) {
    await page.mouse.move(
      center.x + Math.sin(step / 5) * 40,
      center.y + Math.cos(step / 6) * 35,
      { steps: 6 },
    );
    await page.waitForTimeout(300);
  }
  await page.mouse.up();
  const moving = summarize(await measured);
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      dpr: devicePixelRatio,
      cpuThreads: navigator.hardwareConcurrency,
    })),
    objectCount: 100,
    objects: "30 图片、60 便签、10 色卡",
    durationPerSampleSeconds: 30,
    sourceSize: { width: 600, height: 800 },
    setup:
      "本地受控接口、原生时钟与 rAF；图片工作区覆盖已挂载的100对象白板，真实鼠标拖动原图定位，期间没有生成请求",
    still,
    moving,
    passed: moving.fps >= 58 && moving.over33_3Percent < 1,
  };
  await mkdir("output/playwright/image-outpaint", { recursive: true });
  await writeFile(
    "output/playwright/image-outpaint/performance.json",
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

test("100 个白板对象下扩图边界调整的帧间隔", async ({
  page,
  browser,
}, info) => {
  const state = await prepareImageEditing(page, 1440, 900, 100);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "调整大小", exact: true })
    .click();
  await workspace.getByRole("radio", { name: "AI 扩图", exact: true }).click();
  await page.waitForTimeout(1500);
  const measured = sample(page);
  const handle = await workspace
    .getByRole("button", { name: "拖动扩图边界" })
    .boundingBox();
  if (!handle) throw new Error("扩图控制不可见");
  const center = {
    x: handle.x + handle.width / 2,
    y: handle.y + handle.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let step = 0; step < 70; step++) {
    await page.mouse.move(
      center.x + Math.sin(step / 5) * 30,
      center.y + Math.sin(step / 6) * 20,
      { steps: 6 },
    );
    await page.waitForTimeout(300);
  }
  await page.mouse.up();
  const resizing = summarize(await measured);
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      dpr: devicePixelRatio,
      cpuThreads: navigator.hardwareConcurrency,
    })),
    objectCount: 100,
    sourceSize: { width: 600, height: 800 },
    durationSeconds: 30,
    setup:
      "本地受控接口、原生时钟与 rAF；保留100对象白板，真实鼠标持续改变扩图边界，期间没有生成请求",
    resizing,
    passed: resizing.fps >= 58 && resizing.over33_3Percent < 1,
  };
  await mkdir("output/playwright/image-outpaint", { recursive: true });
  await writeFile(
    "output/playwright/image-outpaint/boundary-performance.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
  expect(
    report.passed,
    `FPS ${resizing.fps.toFixed(2)}，长帧 ${resizing.over33_3Percent.toFixed(2)}%`,
  ).toBe(true);
});
