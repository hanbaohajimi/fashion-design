import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { canvasMediaFixture, mediaCard, placeMedia } from "./canvas-media-fixture";
import { loadZhiya } from "./zhiya-fixture";
import { canvasAction } from "./canvas-workspace-controls";
test.skip(process.env.CANVAS_MEDIA_PERF !== "1", "媒体播放与白板响应单独测量");
test.setTimeout(150_000);
test.use({ trace: "off", video: "off" });

async function sample(page: Page) {
  await page.getByRole("button", { name: "抓手工具", exact: true }).click();
  const box = await page.getByLabel("无限白板", { exact: true }).boundingBox(); if (!box) throw new Error("缺少画布");
  const stats = page.evaluate(() => new Promise<{ intervals: number[]; responses: number[] }>(resolve => {
    const intervals: number[] = [], responses: number[] = []; let start = 0, previous = 0, done = false;
    const response = () => { const now = performance.now(); requestAnimationFrame(() => { if (!done) responses.push(performance.now() - now); }); };
    window.addEventListener("pointermove", response, true);
    const frame = (now: number) => {
      if (!start) start = now;
      if (previous) intervals.push(now - previous); previous = now;
      if (now - start < 30_000) requestAnimationFrame(frame);
      else { done = true; window.removeEventListener("pointermove", response, true); resolve({ intervals, responses }); }
    };
    requestAnimationFrame(frame);
  }));
  const x = box.x + box.width * .45, y = box.y + box.height * .4;
  await page.mouse.move(x, y); await page.mouse.down();
  const started = Date.now(); let tick = 0;
  while (Date.now() - started < 30_000) {
    await page.mouse.move(x + Math.sin(tick / 9) * 70, y + Math.cos(tick / 9) * 40, { steps: 3 });
    await page.waitForTimeout(60); tick++;
  }
  await page.mouse.up();
  const result = await stats, ordered = [...result.responses].sort((a,b) => a-b);
  return { fps: result.intervals.length * 1000 / result.intervals.reduce((sum, n) => sum + n, 0), over33_3Percent: result.intervals.filter(n => n > 33.3).length / result.intervals.length * 100, eventToFrameP95Ms: ordered[Math.floor(ordered.length * .95)] ?? null, ...result };
}

test("100对象与2项媒体的静止、实际视频播放、音频播放时白板平移", async ({ page, browser }, info) => {
  const state = await canvasMediaFixture(page, { canvasCount: 100 });
  await loadZhiya(page); await placeMedia(page); await placeMedia(page, "result-4"); await canvasAction(page, "查看全图");
  await page.waitForTimeout(1200);
  const paused = await sample(page);
  const video = mediaCard(page).locator("video"), audio = mediaCard(page, "result-4").locator("audio");
  await video.evaluate((element: HTMLVideoElement) => { element.loop = true; return element.play(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime > 0 && !element.paused)).toBe(true);
  const playingVideo = await sample(page);
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await audio.evaluate((element: HTMLAudioElement) => { element.loop = true; return element.play(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  const playingAudio = await sample(page);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  const report = { measuredAt: new Date().toISOString(), browser: browser.version(), headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency })),
    materialObjects: 100, mediaObjects: 2, durationPerSampleSeconds: 30,
    setup: "原生时钟和rAF，100对象加本机2秒240×160 H.264视频及8kHz WAV循环解码，单worker，不录屏不追踪；静止媒体、视频播放、音频播放三组连续平移",
    paused, playingVideo, playingAudio,
    passed: [paused, playingVideo, playingAudio].every(value => value.fps >= 58 && value.over33_3Percent < 1),
  };
  await mkdir("output/playwright/canvas-media", { recursive: true });
  await writeFile("output/playwright/canvas-media/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.placements).toHaveLength(2); expect(state.errors).toEqual([]);
  expect(report.passed).toBe(true);
});
