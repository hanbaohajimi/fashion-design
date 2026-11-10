import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { canvasAction } from "./canvas-workspace-controls";
import {
  assistantImageUploadFixture,
  chatImageBytes,
} from "./assistant-image-upload-fixture";

test.skip(
  process.env.ASSISTANT_UPLOAD_PERF !== "1",
  "单独测量聊天参考图片准备时的输入与白板响应",
);
test.setTimeout(150_000);
test.use({ trace: "off", video: "off" });

async function sample(
  page: Page,
  operation: (until: number) => Promise<void>,
  event: "pointermove" | "input",
) {
  const frames = page.evaluate(
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
  const values = await frames,
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

test("100对象白板在准备图片期间输入，完成引用后继续平移", async ({
  page,
  browser,
}, info) => {
  const state = await assistantImageUploadFixture(page, { count: 100 });
  await state.open();
  await canvasAction(page, "查看全图");
  const pan = async (until: number) => {
    await page.getByRole("button", { name: "抓手工具", exact: true }).click();
    const box = await page
      .getByLabel("无限白板", { exact: true })
      .boundingBox();
    if (!box) throw new Error("白板尚未显示");
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
  const baseline = await sample(page, pan, "pointermove");
  let release!: () => void;
  state.holdSign = new Promise((resolve) => {
    release = resolve;
  });
  await page
    .getByLabel("选择助手参考图片")
    .setInputFiles({
      name: "设计参考.png",
      mimeType: "image/png",
      buffer: chatImageBytes,
    });
  await expect.poll(() => state.sign.length).toBe(1);
  const input = page.getByRole("textbox", {
    name: "描述设计需求",
    exact: true,
  });
  await input.focus();
  const preparing = await sample(
    page,
    async (until) => {
      let count = 0;
      while (Date.now() < until) {
        await input.pressSequentially("参考领型保留设计细节");
        if (++count % 12 === 0) await input.fill("参考领型保留设计细节");
        await page.waitForTimeout(100);
      }
    },
    "input",
  );
  release();
  state.holdSign = null;
  await expect(
    page
      .getByLabel("正在讨论", { exact: true })
      .locator("[data-assistant-reference-id]"),
  ).toHaveCount(1);
  await expect(page.getByLabel("待加入的参考图片")).toHaveCount(0);
  await canvasAction(page, "查看全图");
  await page.waitForTimeout(1200);
  const ready = await sample(page, pan, "pointermove");
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      dpr: devicePixelRatio,
      cpuThreads: navigator.hardwareConcurrency,
    })),
    initialObjectCount: 100,
    durationPerSampleSeconds: 30,
    setup:
      "原生时钟/rAF，单worker；聊天已停靠，准备前平移/等待签名期间真实输入/引用完成后平移三组；受控本地API，不测实际网络吞吐或模型质量",
    baseline,
    preparing,
    ready,
    passed: [baseline, preparing, ready].every(
      (value) => value.fps >= 58 && value.over33_3Percent < 1,
    ),
  };
  await mkdir("output/playwright/assistant-image-uploads", { recursive: true });
  await writeFile(
    "output/playwright/assistant-image-uploads/performance.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(
    report.passed,
    JSON.stringify(
      [baseline, preparing, ready].map((value) => ({
        fps: value.fps,
        longFrames: value.over33_3Percent,
      })),
    ),
  ).toBe(true);
});
