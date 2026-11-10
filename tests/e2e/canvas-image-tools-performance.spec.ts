import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepareImageOrientation } from "./image-orientation-fixture";
import { canvasAction } from "./canvas-workspace-controls";

test.skip(process.env.IMAGE_TOOLS_PERF !== "1", "单独测量图片快捷入口与编辑往返");
test.setTimeout(160_000);
test.use({ trace: "off", video: "off" });
function startSample(page: Page) {
  return page.evaluate(() => new Promise<{ intervals: number[]; responses: number[] }>(resolve => {
    const intervals: number[] = [], responses: number[] = [];
    let start = 0, prior = 0, done = false;
    const input = () => { const at = performance.now(); requestAnimationFrame(() => { if (!done) responses.push(performance.now() - at); }); };
    for (const event of ["pointermove", "pointerdown", "keydown", "input"]) window.addEventListener(event, input, true);
    const frame = (time: number) => {
      if (!start) start = time; if (prior) intervals.push(time - prior); prior = time;
      if (time - start < 30_000) requestAnimationFrame(frame);
      else { done = true; for (const event of ["pointermove", "pointerdown", "keydown", "input"]) window.removeEventListener(event, input, true); resolve({ intervals, responses }); }
    }; requestAnimationFrame(frame);
  }));
}
function summarize(result: { intervals: number[]; responses: number[] }) {
  const sorted = [...result.responses].sort((a, b) => a - b);
  return { fps: result.intervals.length * 1000 / result.intervals.reduce((sum, ms) => sum + ms, 0),
    over33_3Percent: result.intervals.filter(ms => ms > 33.3).length * 100 / result.intervals.length,
    inputToFrameP95Ms: sorted[Math.floor(sorted.length * .95)] ?? null, ...result };
}

test("100对象下反复打开图片工具、旋转预览及返回画布", async ({ page, browser }, info) => {
  const state = await prepareImageOrientation(page, 1440, 900, 100);
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  await canvasAction(page, "查看全图");
  await page.getByRole("button", { name: "画布对象", exact: true }).click();
  const objects = page.getByRole("region", { name: "画布对象", exact: true });
  await objects.getByRole("searchbox").fill("藏蓝通勤外套");
  await objects.getByRole("button", { name: "选择 藏蓝通勤外套", exact: true }).click();
  await objects.getByRole("button", { name: "关闭画布对象" }).click();
  const trigger = page.getByRole("button", { name: "图片工具", exact: true });
  await trigger.click(); await page.keyboard.press("Escape"); await page.waitForTimeout(1000);
  const menuSample = startSample(page); const menuStart = Date.now(); let openings = 0;
  while (Date.now() - menuStart < 30_000) {
    await trigger.click(); await page.waitForTimeout(450);
    await page.keyboard.press("Escape"); await page.waitForTimeout(450); openings++;
  }
  const menu = summarize(await menuSample);
  await trigger.click(); const started = Date.now();
  await page.getByRole("group", { name: "图片工具选项", exact: true }).getByRole("button", { name: "旋转与翻转", exact: true }).click();
  const workspace = page.getByRole("dialog", { name: "图片工作区", exact: true });
  const slider = workspace.getByLabel("拖动调整旋转角度");
  await expect(slider).toBeEnabled(); const entryReadyMs = Date.now() - started;
  await page.waitForTimeout(1200); const rotateSample = startSample(page);
  const box = await slider.boundingBox(); if (!box) throw new Error("旋转工具尚未显示");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  const rotateStart = Date.now(); let tick = 0;
  while (Date.now() - rotateStart < 30_000) { await page.mouse.move(box.x + box.width * (.5 + .35 * Math.sin(tick / 7)), box.y + box.height / 2, { steps: 4 }); await page.waitForTimeout(90); tick++; }
  await page.mouse.up(); const rotate = summarize(await rotateSample);
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click(); await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "抓手工具", exact: true }).click(); await page.waitForTimeout(1000);
  const afterSample = startSample(page), area = await page.getByLabel("无限白板", { exact: true }).boundingBox(); if (!area) throw new Error("画布尚未显示");
  const x = area.x + area.width * .65, y = area.y + area.height * .55;
  await page.mouse.move(x, y); await page.mouse.down(); const afterStart = Date.now(); tick = 0;
  while (Date.now() - afterStart < 30_000) { await page.mouse.move(x + Math.sin(tick / 12) * 130, y + Math.cos(tick / 12) * 70, { steps: 3 }); await page.waitForTimeout(60); tick++; }
  await page.mouse.up(); const after = summarize(await afterSample);
  const report = { measuredAt: new Date().toISOString(), browser: browser.version(), headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency })),
    objectCount: 100, secondsPerSample: 30, openings, entryReadyMs,
    setup: "原生时钟/rAF，重复开合图片菜单、旋转预览、返回平移各30秒；单worker无trace/录屏/并行检查；受控本地接口及600x800图片",
    menu, rotate, after, passed: [menu, rotate, after].every(value => value.fps >= 58 && value.over33_3Percent < 1) };
  await mkdir("output/playwright/canvas-image-tools", { recursive: true });
  await writeFile("output/playwright/canvas-image-tools/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
  expect(report.passed, JSON.stringify({ menu: [menu.fps, menu.over33_3Percent], rotate: [rotate.fps, rotate.over33_3Percent], after: [after.fps, after.over33_3Percent] })).toBe(true);
});
