import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { canvasAction } from "./canvas-workspace-controls";
import { loadZhiya, openZhiya, prepareZhiya } from "./zhiya-fixture";

test.skip(process.env.REFERENCE_PERF !== "1", "单独测量多素材引用时的白板响应");
test.setTimeout(120_000);
test.use({ trace: "off", video: "off" });

async function sample(page: Page) {
  await page.getByRole("button", { name: "抓手工具", exact: true }).click();
  const box = await page.getByLabel("无限白板", { exact: true }).boundingBox();
  if (!box) throw new Error("白板尚未显示");
  const x = box.x + box.width * .5, y = box.y + box.height * .5;
  const measured = page.evaluate(() => new Promise<{ intervals: number[]; responses: number[] }>(resolve => {
    const intervals: number[] = [], responses: number[] = [];
    let start = 0, previous = 0, done = false;
    const respond = () => {
      const at = performance.now();
      requestAnimationFrame(() => { if (!done) responses.push(performance.now() - at); });
    };
    window.addEventListener("pointermove", respond, true);
    const step = (time: number) => {
      if (!start) start = time;
      if (previous) intervals.push(time - previous);
      previous = time;
      if (time - start < 30_000) requestAnimationFrame(step);
      else { done = true; window.removeEventListener("pointermove", respond, true); resolve({ intervals, responses }); }
    };
    requestAnimationFrame(step);
  }));
  await page.mouse.move(x, y);
  await page.mouse.down();
  const start = Date.now();
  let step = 0;
  while (Date.now() - start < 30_000) {
    await page.mouse.move(x + Math.sin(step / 12) * 130, y + Math.cos(step / 12) * 70, { steps: 3 });
    await page.waitForTimeout(60);
    step++;
  }
  await page.mouse.up();
  const result = await measured;
  const responses = [...result.responses].sort((a, b) => a - b);
  return {
    fps: 1000 / (result.intervals.reduce((sum, n) => sum + n, 0) / result.intervals.length),
    over33_3Percent: result.intervals.filter(n => n > 33.3).length / result.intervals.length * 100,
    pointerToFrameP95Ms: responses[Math.floor(responses.length * .95)] ?? null,
    ...result,
  };
}

test("100 对象白板在无引用和 16 项引用时的实际平移响应", async ({ page, browser }, info) => {
  const state = await prepareZhiya(page, { realClock: true, count: 100 });
  await loadZhiya(page);
  await openZhiya(page);
  await canvasAction(page, "查看全图");
  expect(await page.evaluate(() => Boolean((Date as DateConstructor & { isFake?: boolean }).isFake))).toBe(false);
  await page.waitForTimeout(1200);
  const baseline = await sample(page);
  await page.getByRole("button", { name: "添加引用", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加引用", exact: true });
  for (let i = 0; i < 16; i++) await picker.getByRole("checkbox").nth(i).check();
  await picker.getByRole("button", { name: "使用所选引用", exact: true }).click();
  await expect(page.getByLabel("正在讨论", { exact: true }).locator("[data-assistant-reference-id]")).toHaveCount(16);
  await canvasAction(page, "查看全图");
  await page.waitForTimeout(1200);
  const references = await sample(page);
  const report = {
    measuredAt: new Date().toISOString(), browser: browser.version(), headless: info.project.use.headless !== false,
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, cpuThreads: navigator.hardwareConcurrency })),
    objectCount: 100, objects: "30 图片、60 便签、10 色卡", durationPerSampleSeconds: 30,
    setup: "原生时钟和 rAF；同一停靠聊天，无引用/16 项引用两组，各连续鼠标平移 30 秒；本地受控接口，无模型调用",
    baseline, references, passed: references.fps >= 58 && references.over33_3Percent < 1,
  };
  await mkdir("output/playwright/canvas-assistant-references", { recursive: true });
  await writeFile("output/playwright/canvas-assistant-references/performance.json", JSON.stringify(report, null, 2), "utf8");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(report.passed, `FPS ${references.fps.toFixed(2)}，长帧 ${references.over33_3Percent.toFixed(2)}%`).toBe(true);
});
