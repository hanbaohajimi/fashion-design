import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  assistantImageUploadFixture,
  chatImageBytes,
} from "./assistant-image-upload-fixture";
import { canvasAction } from "./canvas-workspace-controls";

test.skip(
  process.env.REFERENCE_PREVIEW_PERF !== "1",
  "单独测量参考预览与返回画布的响应",
);
test.setTimeout(150_000);
test.use({ trace: "off", video: "off" });
async function sample(
  page: Page,
  action: (until: number) => Promise<void>,
  event: "pointermove" | "wheel",
) {
  const measuring = page.evaluate(
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
  await action(Date.now() + 30_000);
  const values = await measuring,
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

test("100对象白板中缩放参考图片，再返回原画布", async ({
  page,
  browser,
}, info) => {
  const state = await assistantImageUploadFixture(page, {
    count: 100,
    referenceSize: { width: 600, height: 800 },
  });
  await state.open();
  await page
    .getByLabel("选择助手参考图片")
    .setInputFiles({
      name: "外套参考.png",
      mimeType: "image/png",
      buffer: chatImageBytes,
    });
  const chip = page
    .getByLabel("正在讨论", { exact: true })
    .locator("[data-assistant-reference-id]");
  await expect(chip).toHaveCount(1);
  await expect(page.getByLabel("待加入的参考图片")).toHaveCount(0);
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
  await chip.getByRole("button", { name: "外套参考.png", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "参考图片预览",
    exact: true,
  });
  await dialog.getByRole("button", { name: "原始大小", exact: true }).click();
  const box = await dialog.boundingBox();
  if (!box) throw new Error("预览尚未显示");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const preview = await sample(
    page,
    async (until) => {
      let step = 0;
      while (Date.now() < until) {
        await page.mouse.wheel(0, step++ % 2 ? 30 : -30);
        await page.waitForTimeout(80);
      }
    },
    "wheel",
  );
  await dialog.getByRole("button", { name: "关闭预览", exact: true }).click();
  await canvasAction(page, "查看全图");
  await page.waitForTimeout(1200);
  const returned = await sample(page, pan, "pointermove");
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
    durationPerSampleSeconds: 30,
    setup:
      "原生时钟/rAF，单worker，100对象保留挂载；参考不增加画布对象，三组为打开前平移/预览滚轮缩放/关闭后平移；本地受控API，无模型调用",
    baseline,
    preview,
    returned,
    passed: [baseline, preview, returned].every(
      (value) => value.fps >= 58 && value.over33_3Percent < 1,
    ),
  };
  await mkdir("output/playwright/assistant-reference-placement", {
    recursive: true,
  });
  await writeFile(
    "output/playwright/assistant-reference-placement/performance.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  expect(state.placements).toEqual([]);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(
    report.passed,
    JSON.stringify(
      [baseline, preview, returned].map((value) => ({
        fps: value.fps,
        longFrames: value.over33_3Percent,
      })),
    ),
  ).toBe(true);
});
