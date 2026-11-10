import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { assistantExecutionFixture } from "./assistant-execution-fixture";
import { canvasAction } from "./canvas-workspace-controls";

test.skip(
  process.env.EXECUTION_PERF !== "1",
  "单独测量真实状态更新期间的输入与白板响应",
);
test.setTimeout(150_000);
test.use({ trace: "off", video: "off" });
async function sample(
  page: Page,
  operation: (until: number) => Promise<void>,
  event: "input" | "pointermove",
) {
  const measured = page.evaluate(
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
          if (now - start < 30000) requestAnimationFrame(step);
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
  await operation(Date.now() + 30000);
  const data = await measured,
    sorted = [...data.responses].sort((a, b) => a - b);
  return {
    fps:
      1000 /
      (data.intervals.reduce((sum, n) => sum + n, 0) / data.intervals.length),
    over33_3Percent:
      (data.intervals.filter((n) => n > 33.3).length / data.intervals.length) *
      100,
    eventToFrameP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
    ...data,
  };
}
test("100对象下执行状态变化期间输入与平移，结束后仍保持响应", async ({
  page,
  browser,
}, info) => {
  const state = await assistantExecutionFixture(page, {
    count: 100,
    legacy: true,
  });
  await state.open();
  await canvasAction(page, "查看全图");
  const updates = () => {
    let counter = 0;
    return setInterval(() => {
      state.progress.status = counter++ % 2 ? "queued" : "running";
      state.progress.counts.queued = state.progress.status === "queued" ? 2 : 1;
      state.progress.counts.running =
        state.progress.status === "running" ? 1 : 0;
      state.update();
    }, 2800);
  };
  const pan = async (until: number) => {
    await page.getByRole("button", { name: "抓手工具", exact: true }).click();
    const box = await page
      .getByLabel("无限白板", { exact: true })
      .boundingBox();
    if (!box) throw new Error("白板未显示");
    const x = box.x + box.width * 0.5,
      y = box.y + box.height * 0.5;
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
  };
  await page.waitForTimeout(1200);
  let updateTimer = updates();
  const input = page.getByRole("textbox", {
    name: "描述设计需求",
    exact: true,
  });
  await input.focus();
  let typing;
  try {
    typing = await sample(
      page,
      async (until) => {
        let count = 0;
        while (Date.now() < until) {
          await input.pressSequentially("保留立领调整袖口");
          if (++count % 12 === 0) await input.fill("保留立领调整袖口");
          await page.waitForTimeout(100);
        }
      },
      "input",
    );
  } finally {
    clearInterval(updateTimer);
  }
  updateTimer = updates();
  let working;
  try {
    working = await sample(page, pan, "pointermove");
  } finally {
    clearInterval(updateTimer);
  }
  state.finish("completed", 2);
  await expect(
    page.getByRole("region", { name: "本次图片结果", exact: true }),
  ).toHaveCount(1);
  await canvasAction(page, "查看全图");
  await page.waitForTimeout(1200);
  const finished = await sample(page, pan, "pointermove");
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      dpr: devicePixelRatio,
      cpuThreads: navigator.hardwareConcurrency,
    })),
    initialObjects: 100,
    expectedMaterialObjects: 100,
    messageReads: state.messageReads,
    durationPerSampleSeconds: 30,
    setup:
      "原生时钟/rAF、单worker、初始100素材对象，按2.8秒改变受控真实状态响应，沿用2.5秒消息刷新；输入/工作平移/完成后平移三组，无模型或付费服务",
    typing,
    working,
    finished,
    passed: [typing, working, finished].every(
      (sample) => sample.fps >= 58 && sample.over33_3Percent < 1,
    ),
  };
  await mkdir("output/playwright/assistant-execution", { recursive: true });
  await writeFile(
    "output/playwright/assistant-execution/performance.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  expect(state.cancelRequests).toEqual([]);
  expect(state.executionRequests).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(
    report.passed,
    JSON.stringify(
      [typing, working, finished].map((sample) => ({
        fps: sample.fps,
        longFrames: sample.over33_3Percent,
      })),
    ),
  ).toBe(true);
});
