import { openCanvasFunction } from "./canvas-function-navigation";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { canvasMediaFixture, mediaCard, mediaPanel, openMediaFiles, placeMedia } from "./canvas-media-fixture";
import { loadZhiya, openZhiya } from "./zhiya-fixture";
import { canvasAction } from "./canvas-workspace-controls";

test.setTimeout(60_000);
test.beforeEach(async () => { await mkdir("output/playwright/canvas-media", { recursive: true }); });

for (const width of [1440, 320]) test(`${width}px 视频放回白板可点击播放，刷新保留同一摆放且不会自动播放`, async ({ page }) => {
  const state = await canvasMediaFixture(page, { width }); await loadZhiya(page); await placeMedia(page);
  const card = mediaCard(page), video = card.locator("video");
  await expect(video).toBeVisible();
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await card.getByRole("button", { name: "播放 秋冬服装秀成片", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused && element.currentTime > 0)).toBe(true);
  await page.screenshot({ path: `output/playwright/canvas-media/video-${width}.png` });
  expect(state.placements).toHaveLength(1);
  await page.reload(); await expect(card).toBeVisible();
  await expect(card.locator("video")).toBeVisible();
  expect(await card.locator("video").evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  expect(state.getGraph().nodes.filter(node => node.type === "media")).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("音频与视频一次只播放一项，打开功能界面和离开视野都停止播放", async ({ page }) => {
  const state = await canvasMediaFixture(page); await loadZhiya(page); await placeMedia(page); await placeMedia(page, "result-4");
  await canvasAction(page, "查看全图");
  const video = mediaCard(page).locator("video"), audio = mediaCard(page, "result-4").locator("audio");
  await video.evaluate((element: HTMLVideoElement) => { element.loop = true; });
  await mediaCard(page).getByRole("button", { name: "播放 秋冬服装秀成片", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await mediaCard(page, "result-4").getByRole("button", { name: "播放 系列配乐", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  const videoNode = await video.elementHandle();
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  await video.evaluate((element: HTMLVideoElement) => element.play());
  const canvas = await page.getByLabel("无限白板", { exact: true }).boundingBox(); if (!canvas) throw new Error("缺少画布");
  await page.mouse.click(canvas.x + 200, canvas.y + 200); await page.keyboard.down("Space");
  await page.mouse.move(canvas.x + 200, canvas.y + 200); await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width + 1600, canvas.y + 200, { steps: 20 }); await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(() => videoNode?.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await canvasAction(page, "查看全图");
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  const handle = await audio.elementHandle();
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  await expect.poll(() => handle?.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  expect(state.placements).toHaveLength(2); expect(state.errors).toEqual([]);
});

test("白板隐藏媒体后停止播放，移动和刷新只更新摆放", async ({ page }) => {
  const state = await canvasMediaFixture(page); await loadZhiya(page); await placeMedia(page);
  const card = mediaCard(page), header = card.locator("header"), before = await header.boundingBox(); if (!before) throw new Error("缺少媒体位置");
  await page.mouse.move(before.x + 90, before.y + 20); await page.mouse.down(); await page.mouse.move(before.x + 160, before.y + 80, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => state.saved.length).toBeGreaterThan(1);
  const moved = await header.boundingBox(); expect(moved?.x).not.toBe(before.x);
  await card.getByRole("button", { name: "播放 秋冬服装秀成片", exact: true }).click();
  const video = await card.locator("video").elementHandle();
  await openCanvasFunction(page, "画布对象");
  const objects = page.getByRole("region", { name: "画布对象", exact: true });
  await objects.getByRole("button", { name: "隐藏 秋冬服装秀成片", exact: true }).click();
  await expect.poll(() => video?.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await objects.getByRole("button", { name: "显示 秋冬服装秀成片", exact: true }).click();
  await objects.getByRole("button", { name: "关闭画布对象" }).click();
  await expect(card).toBeVisible();
  await page.reload(); await expect(card).toBeVisible();
  expect((await header.boundingBox())?.x).toBeCloseTo(moved?.x ?? 0, 0);
  expect(state.placements).toHaveLength(1); expect(state.errors).toEqual([]);
});

test("未知放置响应刷新不自动提交，明确续办复用同一编号", async ({ page }) => {
  const state = await canvasMediaFixture(page); state.loseResponse = true; await loadZhiya(page); await openMediaFiles(page);
  await mediaPanel(page).locator('[data-generated-file-id="runway:result-3"]').getByRole("button", { name: "放入画布", exact: true }).click();
  await expect(mediaPanel(page).getByRole("button", { name: "继续确认放置", exact: true })).toBeVisible();
  const first = state.placements[0]; await page.reload(); await openMediaFiles(page);
  expect(state.placements).toHaveLength(1);
  await mediaPanel(page).getByRole("button", { name: "继续确认放置", exact: true }).click();
  await expect(mediaPanel(page).getByRole("button", { name: "查看已放入的媒体", exact: true })).toBeVisible();
  expect(state.placements).toEqual([first, first]); expect(state.getGraph().nodes.filter(node => node.type === "media")).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("播放失败可重载，下载沿用原文件；静态画布导出明确阻止遗漏媒体", async ({ page }) => {
  const state = await canvasMediaFixture(page); await loadZhiya(page); state.failContent = true; await placeMedia(page);
  await expect(mediaCard(page).getByRole("alert")).toContainText("媒体暂时无法播放");
  state.failContent = false;
  await mediaCard(page).getByRole("button", { name: "重新加载媒体" }).click();
  await expect(mediaCard(page).locator("video")).toBeVisible();
  state.failContent = true;
  await mediaCard(page).getByRole("button", { name: "原文件", exact: true }).click();
  await expect(mediaCard(page).getByRole("status")).toContainText("原文件暂不可用");
  state.failContent = false;
  const download = page.waitForEvent("download"); await mediaCard(page).getByRole("button", { name: "原文件", exact: true }).click(); expect((await download).suggestedFilename()).toBe("video.mp4");
   await openCanvasFunction(page, "导出画布 PNG");
  await expect(page.getByRole("alert").filter({ hasText: "不能导出为静态图片" })).toBeVisible();
  expect(state.placements).toHaveLength(1); expect(state.errors).toEqual([]);
});

test("只读时仍可播放既有媒体，文件列表不出现新增放置操作", async ({ page }) => {
  const state = await canvasMediaFixture(page); await loadZhiya(page); await placeMedia(page); state.setReadOnly();
  await page.reload(); await expect(mediaCard(page)).toBeVisible();
  await mediaCard(page).getByRole("button", { name: "播放 秋冬服装秀成片", exact: true }).click();
  await expect.poll(() => mediaCard(page).locator("video").evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await openMediaFiles(page);
  await expect(mediaPanel(page).getByRole("button", { name: "放入画布", exact: true })).toHaveCount(0);
  expect(state.placements).toHaveLength(1); expect(state.errors).toEqual([]);
});

test("打开媒体文件和放回过程保留同一聊天草稿与输入实例", async ({ page }) => {
  const state = await canvasMediaFixture(page); await loadZhiya(page); await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true }); await input.fill("保留系列的设计要求"); const instance = await input.elementHandle();
  await openMediaFiles(page); await mediaPanel(page).locator('[data-generated-file-id="runway:result-4"]').getByRole("button", { name: "放入画布", exact: true }).click();
  await mediaPanel(page).getByRole("button", { name: "关闭生成文件", exact: true }).click();
  await expect(input).toHaveValue("保留系列的设计要求"); expect(await instance?.evaluate(element => element.isConnected)).toBe(true);
  expect(state.placements).toHaveLength(1); expect(state.errors).toEqual([]);
});
