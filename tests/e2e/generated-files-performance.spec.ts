import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { generatedFilesFixture } from "./generated-files-fixture";
import { loadZhiya, zhiya } from "./zhiya-fixture";
import { canvasAction } from "./canvas-workspace-controls";

test.skip(process.env.GENERATED_FILES_PERF !== "1", "单独测量文件浏览和关闭后的白板响应");
test.setTimeout(150_000);
test.use({ trace: "off", video: "off" });

async function sample(page: Page, target: "canvas" | "files") {
  const list = page.getByLabel("生成文件列表", { exact: true });
  if (target === "canvas") await page.getByRole("button", { name: "抓手工具", exact: true }).click();
  const box = await (target === "canvas" ? page.getByLabel("无限白板", { exact: true }) : list).boundingBox();
  if (!box) throw new Error("测量区域尚未显示");
  const x = box.x + box.width * .6, y = box.y + box.height * .5;
  const measurement = page.evaluate(() => new Promise<{ intervals: number[]; responses: number[] }>(resolve => {
    const intervals: number[] = [], responses: number[] = [];
    let start = 0, previous = 0, done = false;
    const response = () => { const now = performance.now(); requestAnimationFrame(() => { if (!done) responses.push(performance.now() - now); }); };
    window.addEventListener("pointermove", response, true); window.addEventListener("wheel", response, true);
    const step = (now: number) => {
      if (!start) start = now;
      if (previous) intervals.push(now - previous); previous = now;
      if (now - start < 30_000) requestAnimationFrame(step);
      else { done = true; window.removeEventListener("pointermove", response, true); window.removeEventListener("wheel", response, true); resolve({ intervals, responses }); }
    };
    requestAnimationFrame(step);
  }));
  await page.mouse.move(x, y); if (target === "canvas") await page.mouse.down();
  const start = Date.now(); let step = 0, direction = 1;
  while (Date.now() - start < 30_000) {
    if (target === "canvas") await page.mouse.move(x + Math.sin(step / 12) * 130, y + Math.cos(step / 12) * 70, { steps: 3 });
    else {
      const edge = await list.evaluate(element => ({ top: element.scrollTop, end: element.scrollHeight - element.clientHeight }));
      if (edge.top >= edge.end - 2) direction = -1; else if (edge.top <= 0) direction = 1;
      await page.mouse.wheel(0, 110 * direction);
    }
    await page.waitForTimeout(60); step++;
  }
  if (target === "canvas") await page.mouse.up();
  const result = await measurement, responses = [...result.responses].sort((a, b) => a - b);
  return { fps: 1000 * result.intervals.length / result.intervals.reduce((sum, n) => sum + n, 0),
    over33_3Percent: result.intervals.filter(n => n > 33.3).length / result.intervals.length * 100,
    inputToFrameP95Ms: responses[Math.floor(responses.length * .95)] ?? null, ...result };
}

test("100对象白板与120项生成文件浏览，关闭后恢复平移", async ({ page, browser }, info) => {
  const state = await generatedFilesFixture(page, { count: 120, canvasCount: 100 });
  await loadZhiya(page); await canvasAction(page, "查看全图"); await page.waitForTimeout(1200);
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  const before = await sample(page, "canvas");
  const begin = Date.now();
  await page.getByRole("button", { name: "项目菜单", exact: true }).click(); await page.getByRole("button", { name: "生成文件", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "生成文件", exact: true });
  await expect(panel.locator("[data-generated-file-id]")).toHaveCount(30);
  const firstPageMs = Date.now() - begin;
  for (const count of [60, 90, 120]) { await panel.getByRole("button", { name: "加载更多文件", exact: true }).click(); await expect(panel.locator("[data-generated-file-id]")).toHaveCount(count); }
  await panel.getByLabel("生成文件列表", { exact: true }).evaluate(element => { element.scrollTop = 0; });
  await page.waitForTimeout(800); await expect(zhiya(page)).toHaveAttribute("data-active", "false");
  const list = await sample(page, "files");
  await panel.getByRole("button", { name: "关闭生成文件", exact: true }).click();
  await expect(panel).toHaveCount(0); await expect(zhiya(page)).toHaveAttribute("data-active", "true");
  await canvasAction(page, "查看全图"); await page.waitForTimeout(1200);
  const after = await sample(page, "canvas");
  const report = { measuredAt: new Date().toISOString(), browser: browser.version(), headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency })),
    canvasObjects: 100, fileRows: 120, secondsPerSample: 30, firstPageMs,
    setup: "原生时钟和rAF，先平移白板、再滚动120项文件、关闭后继续平移，各30秒；单worker，无trace、录屏或并行检查；受控API和图片，无模型调用",
    before, list, after, passed: [before, list, after].every(result => result.fps >= 58 && result.over33_3Percent < 1) };
  await mkdir("output/playwright/generated-files", { recursive: true });
  await writeFile("output/playwright/generated-files/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
  expect(report.passed, JSON.stringify({ before: { fps: before.fps, long: before.over33_3Percent }, list: { fps: list.fps, long: list.over33_3Percent }, after: { fps: after.fps, long: after.over33_3Percent } })).toBe(true);
});
