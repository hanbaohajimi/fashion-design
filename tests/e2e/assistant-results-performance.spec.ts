import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { assistantResultsFixture } from "./assistant-results-fixture";
import { canvasAction } from "./canvas-workspace-controls";

test.skip(
  process.env.ASSISTANT_RESULTS_PERF !== "1",
  "单独测量聊天结果滚动、比较和返回画布",
);
test.setTimeout(150_000);
test.use({ trace: "off", video: "off" });
async function sample(
  page: Page,
  operation: (until: number) => Promise<void>,
  event: "wheel" | "pointermove",
) {
  const recording = page.evaluate(
    (event) =>
      new Promise<{ intervals: number[]; responses: number[] }>((resolve) => {
        const intervals: number[] = [],
          responses: number[] = [];
        let start = 0,
          previous = 0,
          done = false;
        const respond = () => {
          const at = performance.now();
          requestAnimationFrame(() => {
            if (!done) responses.push(performance.now() - at);
          });
        };
        window.addEventListener(event, respond, true);
        const step = (now: number) => {
          if (!start) start = now;
          if (previous) intervals.push(now - previous);
          previous = now;
          if (now - start < 30_000) requestAnimationFrame(step);
          else {
            done = true;
            window.removeEventListener(event, respond, true);
            resolve({ intervals, responses });
          }
        };
        requestAnimationFrame(step);
      }),
    event,
  );
  await operation(Date.now() + 30_000);
  const values = await recording,
    sorted = [...values.responses].sort((a, b) => a - b);
  return {
    fps:
      1000 /
      (values.intervals.reduce((sum, n) => sum + n, 0) /
        values.intervals.length),
    over33_3Percent:
      (values.intervals.filter((n) => n > 33.3).length /
        values.intervals.length) *
      100,
    eventToFrameP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
    ...values,
  };
}
test("100对象与24批结果下滚动、比较和返回画布保持响应", async ({
  page,
  browser,
}, info) => {
  const state = await assistantResultsFixture(page, {
    count: 98,
    receipts: 24,
  });
  await state.open();
  const view = page.getByLabel("设计对话", { exact: true });
  await expect(
    page.getByRole("region", { name: "本次图片结果", exact: true }),
  ).toHaveCount(24);
  await page.waitForTimeout(1200);
  const box = await view.boundingBox();
  if (!box) throw new Error("结果列表未显示");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const scrollPositions: number[] = [];
  const results = await sample(
    page,
    async (until) => {
      while (Date.now() < until) {
        const position = await view.evaluate((element) => ({
          top: element.scrollTop,
          max: element.scrollHeight - element.clientHeight,
        }));
        scrollPositions.push(position.top);
        const direction = Math.floor((Date.now() % 12000) / 6000) ? -1 : 1;
        await page.mouse.wheel(0, direction * 340);
        await page.waitForTimeout(55);
      }
    },
    "wheel",
  );
  await page
    .getByRole("region", { name: "本次图片结果", exact: true })
    .last()
    .getByRole("button", { name: "比较本次结果", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
      name: "生成结果预览",
      exact: true,
    }),
    compareBox = await dialog.boundingBox();
  if (!compareBox) throw new Error("比较视图未显示");
  await page.mouse.move(
    compareBox.x + compareBox.width * 0.72,
    compareBox.y + compareBox.height * 0.5,
  );
  const comparison = await sample(
    page,
    async (until) => {
      let step = 0;
      while (Date.now() < until) {
        await page.mouse.wheel(0, step++ % 2 ? 40 : -40);
        await page.waitForTimeout(80);
      }
    },
    "wheel",
  );
  await dialog
    .getByRole("button", { name: "关闭结果预览", exact: true })
    .click();
  await canvasAction(page, "查看全图");
  await page.getByRole("button", { name: "抓手工具", exact: true }).click();
  await page.waitForTimeout(1200);
  const board = await page
    .getByLabel("无限白板", { exact: true })
    .boundingBox();
  if (!board) throw new Error("白板尚未显示");
  const x = board.x + board.width * 0.5,
    y = board.y + board.height * 0.5;
  const returned = await sample(
    page,
    async (until) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      let step = 0;
      while (Date.now() < until) {
        await page.mouse.move(
          x + Math.sin(step / 12) * 130,
          y + Math.cos(step / 12) * 70,
          { steps: 3 },
        );
        await page.waitForTimeout(60);
        step++;
      }
      await page.mouse.up();
    },
    "pointermove",
  );
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      dpr: devicePixelRatio,
      cpuThreads: navigator.hardwareConcurrency,
    })),
    objectCount: state.getGraph().nodes.length,
    receiptCount: 24,
    imageTiles: 48,
    uniqueImages: 2,
    scrollDistance: Math.max(...scrollPositions) - Math.min(...scrollPositions),
    durationPerSampleSeconds: 30,
    setup:
      "原生时钟/rAF、单worker、本地受控API、真实滚轮/指针；不调用模型，不与trace/录屏或其他检查并行",
    results,
    comparison,
    returned,
    passed: [results, comparison, returned].every(
      (value) => value.fps >= 58 && value.over33_3Percent < 1,
    ),
  };
  await mkdir("output/playwright/assistant-results", { recursive: true });
  await writeFile(
    "output/playwright/assistant-results/performance.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  expect(report.scrollDistance).toBeGreaterThan(1000);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(
    report.passed,
    JSON.stringify(
      [results, comparison, returned].map((value) => ({
        fps: value.fps,
        longFrames: value.over33_3Percent,
      })),
    ),
  ).toBe(true);
});
