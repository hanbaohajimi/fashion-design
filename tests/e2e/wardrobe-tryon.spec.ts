import { expect, test, type Page } from "@playwright/test";
import { PROJECT } from "../visual/fixtures";
import { seedWardrobe } from "./wardrobe-fixture";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 1000 }, video: "on" });

async function open(page: Page, query = "") {
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe${query}`);
  await expect(page.getByRole("region", { name: "项目单品衣架" })).toBeVisible();
}
async function add(page: Page, name: string) {
  await page.getByRole("button", { name: `查看单品：${name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `单品：${name}`, exact: true });
  await dialog.getByRole("button", { name: "加入搭配", exact: true }).click();
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "返回衣架" }).click();
}

test("衣架悬停、连续反向、聚焦与返回只浏览，稳定命中区不移动", async ({ page }) => {
  const fixture = await seedWardrobe(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page);
  const first = page.getByRole("button", { name: "查看单品：测试短上衣", exact: true });
  const second = page.getByRole("button", { name: "查看单品：测试长外套", exact: true });
  const before = await first.boundingBox();
  await first.hover();
  await expect(first).toHaveAttribute("data-active", "true");
  expect(await first.boundingBox()).toEqual(before);
  // Hold the key poses for the review recording, then exercise an interrupted reversal.
  await page.waitForTimeout(600);
  await second.hover(); await page.waitForTimeout(600);
  await first.hover(); await second.hover();
  await expect(second).toHaveAttribute("data-active", "true");
  await page.waitForTimeout(600);
  await page.screenshot({ path: "output/wardrobe-tryon/browser/rack-hover-desktop.png", fullPage: true });
  await second.click();
  await expect(page.getByRole("dialog", { name: "单品：测试长外套" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "下一件单品" }).click();
  await expect(page.getByRole("dialog", { name: "单品：测试裤装" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "output/wardrobe-tryon/browser/focus-bottom.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(first).not.toHaveAttribute("data-active", "true");
  await page.waitForTimeout(600);
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
  expect(fixture.blocked).toEqual([]);
});

test("自由搭配显式保存，移除可撤销，刷新后仍保留已保存版本", async ({ page }) => {
  const fixture = await seedWardrobe(page);
  await open(page);
  await add(page, "测试短上衣");
  await add(page, "测试长外套");
  await add(page, "测试裤装");
  const editor = page.getByRole("region", { name: "搭配编辑" });
  await expect(editor.getByRole("button", { name: "移除测试短上衣", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "移除测试裤装", exact: true }).click();
  await expect(editor.getByRole("button", { name: "移除测试裤装", exact: true })).toHaveCount(0);
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.getByRole("button", { name: "移除测试裤装", exact: true })).toBeVisible();
  expect(fixture.requests.filter(request => request.method !== "GET")).toEqual([]);
  await editor.getByRole("button", { name: "保存搭配", exact: true }).click();
  await expect(editor.getByText("已保存版本 1", { exact: true })).toBeVisible();
  expect(fixture.summary.outfits[0]!.currentSnapshot.items).toHaveLength(3);
  await page.reload();
  await expect(page.getByRole("region", { name: "搭配编辑" }).getByText("已保存版本 1", { exact: true })).toBeVisible();
  expect(fixture.requests.filter(request => request.path.endsWith("/tryon"))).toEqual([]);
  await page.screenshot({ path: "output/wardrobe-tryon/browser/outfit-saved.png", fullPage: true });
});

test("单品搜索和分组不生成，手机与减弱动态保持完整操作", async ({ page }) => {
  const fixture = await seedWardrobe(page, { many: true });
  await open(page);
  await page.getByRole("button", { name: "下一组", exact: true }).click();
  await page.getByLabel("查找单品", { exact: true }).fill("测试手提包");
  await expect(page.getByRole("button", { name: /^查看单品：测试手提包/ }).first()).toBeVisible();
  await page.getByLabel("查找单品", { exact: true }).fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "项目单品衣架" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "查看单品：测试短上衣", exact: true }).click();
  await expect(page.getByRole("button", { name: "加入搭配", exact: true })).toBeVisible();
  await page.screenshot({ path: "output/wardrobe-tryon/browser/focus-mobile.png", fullPage: true });
  await page.keyboard.press("Escape");
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
});

test("只读项目可浏览聚焦但不能加入搭配或修改来源", async ({ page }) => {
  const fixture = await seedWardrobe(page, { readonly: true });
  await open(page);
  await page.getByRole("button", { name: "查看单品：测试短上衣", exact: true }).click();
  await expect(page.getByRole("button", { name: "加入搭配", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "从衣架收起", exact: true })).toBeDisabled();
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
});

test("资产深链进入衣架素材准备，原图没有自动发布", async ({ page }) => {
  const fixture = await seedWardrobe(page, { empty: true });
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe&assetId=asset-front`);
  await expect(page.getByRole("dialog", { name: "准备衣架单品" })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续核对单品", exact: true })).toBeDisabled();
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
  expect(fixture.summary.items).toHaveLength(0);
  await page.screenshot({ path: "output/wardrobe-tryon/browser/prepare-source.png", fullPage: true });
});

test("接口失败提供重试，保留真实错误且不伪造衣架数据", async ({ page }) => {
  const fixture = await seedWardrobe(page, { failed: true });
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe`);
  await expect(page.getByRole("alert").filter({ hasText: /衣架暂时不可用|重试/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^查看单品：/ })).toHaveCount(0);
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
});

test("素材候选需并排核对与确认，准备完成不会自动入架", async ({ page }) => {
  const fixture = await seedWardrobe(page, { empty: true });
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe&assetId=asset-front`);
  const dialog = page.getByRole("dialog", { name: "准备衣架单品" });
  await dialog.getByLabel("单品名称", { exact: true }).fill("核对后的短上衣");
  await dialog.getByRole("button", { name: "继续核对单品", exact: true }).click();
  await expect(dialog.getByAltText("原始服装图片", { exact: true })).toBeVisible();
  await expect(dialog.getByAltText("待确认单品候选", { exact: true })).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "确认单品并挂上衣架", exact: true });
  await expect(confirm).toBeDisabled();
  expect(fixture.summary.items).toHaveLength(0);
  expect(fixture.requests.filter(request => request.path.endsWith("/confirm"))).toHaveLength(0);
  await dialog.getByRole("checkbox").check();
  await confirm.click();
  await expect(page.getByRole("button", { name: "查看单品：核对后的短上衣", exact: true })).toBeVisible();
  expect(fixture.summary.items[0]!.currentRevision.sourceAssetId).toBe("asset-front");
  expect(fixture.requests.filter(request => request.path.endsWith("/tryon"))).toHaveLength(0);
});

test("模特试穿显式提交并绑定快照，改搭配保留旧结果且不会自动生成", async ({ page }) => {
  const fixture = await seedWardrobe(page);
  await open(page);
  await add(page, "测试短上衣");
  const editor = page.getByRole("region", { name: "搭配编辑" });
  await editor.getByRole("button", { name: "保存搭配", exact: true }).click();
  await expect(editor.getByText("已保存版本 1", { exact: true })).toBeVisible();
  const tryOn = page.getByRole("region", { name: "搭配试衣" });
  await tryOn.getByRole("button", { name: "选择图片 4", exact: true }).click();
  expect(fixture.requests.filter(request => request.path.endsWith("/tryon"))).toHaveLength(0);
  await tryOn.getByRole("button", { name: /确认生成模特试衣图|更新试穿/, exact: true }).click();
  await expect(tryOn.getByText("任务进行中，可以继续浏览衣架。", { exact: true })).toBeVisible();
  const first = fixture.summary.tryOns[0]!;
  first.status = "ready";
  first.results = [{ assetId: "result-fixture", url: "/visual-garment.svg" }];
  await add(page, "测试裤装");
  await expect(tryOn.getByText(/搭配已有未保存修改/)).toBeVisible();
  await editor.getByRole("button", { name: "保存搭配新版本", exact: true }).click();
  await expect(tryOn.getByText(/版本 1，与当前编辑内容不同/)).toBeVisible();
  await expect(tryOn.getByAltText("我的搭配模特试衣结果")).toBeVisible();
  expect(fixture.requests.filter(request => request.path.endsWith("/tryon"))).toHaveLength(1);
  expect(first.snapshotId).not.toBe(fixture.summary.outfits[0]!.currentSnapshot.id);
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.getByRole("complementary", { name: "搭配与试衣面板", exact: true }).evaluate(element => { element.scrollTop = element.scrollHeight; });
  await tryOn.getByAltText("我的搭配模特试衣结果").scrollIntoViewIfNeeded();
  await expect(tryOn.getByAltText("我的搭配模特试衣结果")).toBeInViewport();
  await page.screenshot({ path: "output/wardrobe-tryon/browser/previous-result.png" });
});

test("未验收的本人搭配能力保持关闭，不准备参考或自动申请摄像头", async ({ page }) => {
  const fixture = await seedWardrobe(page);
  await page.addInitScript(() => {
    Object.assign(window, { __wardrobeCameraRequests: 0 });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const state = window as unknown as { __wardrobeCameraRequests: number };
      state.__wardrobeCameraRequests += 1;
      throw new DOMException("test requires explicit camera action", "NotAllowedError");
    } });
  });
  await open(page);
  await add(page, "测试短上衣");
  await page.getByRole("region", { name: "搭配试衣" }).getByRole("button", { name: "本人实时试衣", exact: true }).click();
  await expect(page.getByRole("button", { name: "开启摄像头", exact: true })).toBeVisible();
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __wardrobeCameraRequests: number }).__wardrobeCameraRequests)).toBe(0);
  expect(fixture.blocked).toEqual([]);
});

test("手机浏览衣架保持本人预览，收起侧栏返回衣架而非空白", async ({ page }) => {
  await seedWardrobe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const state = { requests: 0, stopped: 0 };
    Object.assign(window, { __wardrobeCamera: state });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      state.requests += 1;
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#dce4dc"; context.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(15);
      for (const track of stream.getTracks()) {
        const original = track.stop.bind(track);
        track.stop = () => { state.stopped += 1; original(); };
      }
      return stream;
    } });
  });
  await open(page);
  await page.getByRole("button", { name: "试穿", exact: true }).click();
  await page.getByRole("button", { name: "本人实时试衣", exact: true }).click();
  await page.getByRole("button", { name: "开启摄像头", exact: true }).click();
  await expect.poll(() => page.getByLabel("原始摄像头画面", { exact: true }).evaluate((video: HTMLVideoElement) => Boolean(video.srcObject))).toBe(true);
  await page.getByRole("button", { name: "衣架", exact: true }).click();
  await expect(page.getByRole("region", { name: "项目单品衣架" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __wardrobeCamera: { stopped: number } }).__wardrobeCamera.stopped)).toBe(0);
  await page.getByRole("button", { name: "试穿", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __wardrobeCamera: { requests: number } }).__wardrobeCamera.requests)).toBe(1);
  await page.getByRole("complementary", { name: "搭配与试衣面板", exact: true }).getByRole("button", { name: "收起", exact: true }).click();
  await expect(page.getByRole("region", { name: "项目单品衣架" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "output/wardrobe-tryon/browser/mobile-return-rack.png", fullPage: true });
  await page.getByRole("button", { name: "试穿", exact: true }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wardrobeCamera: { stopped: number } }).__wardrobeCamera.stopped)).toBeGreaterThan(0);
});
