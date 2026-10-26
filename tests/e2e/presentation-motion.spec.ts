import { expect, test, type Page } from "@playwright/test";
import { PROJECT, seedVisualApp } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";
import { studioPresentationSchema } from "../../packages/shared/src/studio";

async function prepare(page: Page, count = 3) {
  await seedVisualApp(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const data = workspaceFixture();
  if (count > data.assets.length) data.assets = Array.from({ length: count }, (_, index) => data.assets[index] ?? { id: `asset-extra-${index}`, url: "/visual-garment.svg", thumbnailUrl: null });
  const document = data.presentationSets[0];
  if (!document) throw new Error("missing presentation fixture");
  document.currentRevision.payload = studioPresentationSchema.parse({
    ...document.currentRevision.payload,
    items: data.assets.map((asset, index) => ({ assetId: asset.id, kind: index === 0 ? "front" : index === 1 ? "back" : "detail", label: `保留的说明 ${index + 1}`, reviewed: true })),
  });
  const writes: { payload: ReturnType<typeof studioPresentationSchema.parse> }[] = [];
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) => route.fulfill({ json: data }));
  await page.route(`**/api/projects/${PROJECT}/studio/documents`, async (route) => {
    const body = route.request().postDataJSON(); writes.push(body);
    document.version += 1;
    document.currentRevision = { ...document.currentRevision, id: `presentation-r${document.version}`, revision: document.version, payload: studioPresentationSchema.parse(body.payload) };
    document.revisions = [document.currentRevision, ...document.revisions];
    await route.fulfill({ json: document });
  });
  return { writes };
}

test("展示顺序键盘调整、撤销与修订重挂载保留真实反馈和图片元数据", async ({ page }) => {
  const { writes } = await prepare(page);
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  const order = page.getByRole("region", { name: "展示图片顺序" });
  const first = order.locator('[data-order-id="asset-front"]').getByRole("button", { name: /调整.*顺序/ });
  await first.focus(); await page.keyboard.press("Space"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Space");
  await expect.poll(() => order.locator("[data-order-id]").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.orderId))).toEqual(["asset-back", "asset-front", "asset-detail"]);
  await first.focus(); await page.keyboard.press("Space"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Escape");
  await expect.poll(() => order.locator("[data-order-id]").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.orderId))).toEqual(["asset-back", "asset-front", "asset-detail"]);
  await page.getByRole("button", { name: "选择图片 2", exact: true }).click();
  await page.getByRole("button", { name: "撤销移出", exact: true }).click();
  await expect.poll(() => order.locator("[data-order-id]").count()).toBe(3);
  const save = page.getByRole("button", { name: "保存修订", exact: true });
  await save.click(); await expect(save).toHaveAttribute("data-feedback", "success");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.payload.items.map((item) => [item.assetId, item.label, item.reviewed])).toEqual([["asset-back", "保留的说明 2", true], ["asset-front", "保留的说明 1", true], ["asset-detail", "保留的说明 3", true]]);
  await page.getByLabel("展示包名称", { exact: true }).fill("再次编辑"); await expect(save).toHaveAttribute("data-feedback", "idle");
});

test("键盘打开原图直接显示并保持缩放键盘操作与焦点返回", async ({ page }) => {
  await prepare(page); await page.goto(`/${PROJECT}/studio?tab=presentation`);
  const trigger = page.getByRole("button", { name: /查看大图：/ }).first();
  await trigger.focus(); await page.keyboard.press("Enter");
  const preview = page.getByRole("dialog", { name: /查看大图：/ });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.getByRole("img").first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await preview.evaluate((element) => element.getAnimations({ subtree: true }).some((animation) => (animation.effect as KeyframeEffect | null)?.getKeyframes().some((frame) => typeof frame.transform === "string" && frame.transform !== "none")))).toBe(false);
  await page.keyboard.press("+"); await expect(preview.getByRole("button", { name: /还原/ })).toContainText("150%");
  await page.emulateMedia({ reducedMotion: "reduce" }); await expect(preview.getByRole("button", { name: /还原/ })).toContainText("100%");
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
});

test("查看器连续下一张与快速反向保留最后一次导航意图", async ({ page }) => {
  await prepare(page); await page.goto(`/${PROJECT}/studio?tab=presentation`);
  await page.getByRole("button", { name: /查看大图：/ }).first().click();
  const preview = page.getByRole("dialog", { name: /查看大图：/ });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "下一张", exact: true }).click();
  await page.waitForTimeout(40);
  await preview.getByRole("button", { name: "下一张", exact: true }).click();
  await expect(preview.getByRole("status")).toContainText("第 3 张");
  await preview.getByRole("button", { name: "上一张", exact: true }).click();
  await page.waitForTimeout(40);
  await preview.getByRole("button", { name: "下一张", exact: true }).click();
  await expect(preview.getByRole("status")).toContainText("第 3 张");
  await preview.evaluate(async (node) => { await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))); });
  await expect(preview.getByRole("status")).toContainText("第 3 张");
});

for (const width of [1440, 1024, 390, 375]) test(`展示排序和查看器在 ${width}px 可达且无水平溢出`, async ({ page }) => {
  await prepare(page); await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  await expect(page.locator('[data-order-id="asset-front"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `output/ui-motion/presentation/order-${width}.png`, fullPage: true });
  const trigger = page.getByRole("button", { name: /查看大图：/ }).first(); await trigger.click();
  const preview = page.getByRole("dialog", { name: /查看大图：/ });
  await expect(preview).toBeVisible(); await expect(preview.getByRole("img").first()).toBeVisible();
  await preview.evaluate(async (node) => { await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))); });
  await page.screenshot({ path: `output/ui-motion/presentation/viewer-${width}.png` });
  await page.keyboard.press("Escape"); await expect(preview).toBeHidden(); await expect(trigger).toBeFocused();
});

test("真实触摸长按排序、双指缩放、横滑与下滑关闭保留选择", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3000", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, recordVideo: { dir: "output/ui-motion/presentation/video", size: { width: 390, height: 844 } } });
  const page = await context.newPage(); await prepare(page);
  const cdp = await context.newCDPSession(page);
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  const handle = page.locator('[data-order-id="asset-front"]').getByRole("button", { name: /调整.*顺序/ });
  await expect(page.getByRole("heading", { name: "夹克商品展示", exact: true })).toBeVisible();
  await expect(handle).toBeVisible();
  await handle.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const box = await handle.boundingBox(); if (!box) throw new Error("missing handle");
  const startX = box.x + box.width / 2, startY = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y: startY, id: 1 }] });
  await page.waitForTimeout(330);
  await expect(page.locator('[data-order-id="asset-front"][data-grabbed="true"]')).toHaveCount(1);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y: startY, id: 1 }, { x: startX + 28, y: startY, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: startX + 28, y: startY, id: 2 }] });
  await expect(page.locator('[data-order-id="asset-front"][data-grabbed="true"]')).toHaveCount(1);
  // 真实主触点保持捕获时，第二触点的抬起/取消不能提前结束主拖排。
  await page.getByRole("region", { name: "展示图片顺序" }).locator('[data-order-id]').first().evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 99, pointerType: "touch" }));
    element.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 99, pointerType: "touch" }));
  });
  await expect(page.locator('[data-order-id="asset-front"][data-grabbed="true"]')).toHaveCount(1);
  for (let step = 1; step <= 8; step++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX + step * 18, y: startY, id: 1 }] }); await page.waitForTimeout(20); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.getByRole("region", { name: "展示图片顺序" }).locator("[data-order-id]").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.orderId))).not.toEqual(["asset-front", "asset-back", "asset-detail"]);
  await page.getByRole("button", { name: /查看大图：/ }).first().click();
  const preview = page.getByRole("dialog", { name: /查看大图：/ }); const stage = preview.locator("[data-picture-stage]");
  await expect(preview).toBeVisible(); const bounds = await stage.boundingBox(); if (!bounds) throw new Error("missing picture stage");
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
  for (let step = 1; step <= 8; step++) { const spread = 30 + step * 7; await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - spread, y, id: 1 }, { x: x + spread, y, id: 2 }] }); await page.waitForTimeout(20); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const zoom = stage.locator('[style*="--picture-scale"]');
  await expect.poll(() => zoom.evaluate((node) => Number((node as HTMLElement).style.getPropertyValue("--picture-scale")))).toBeGreaterThan(2);
  await page.screenshot({ path: "output/ui-motion/presentation/touch-pinch.png" });
  await preview.getByRole("button", { name: /还原/ }).click();
  const doubleTap = async () => {
    for (let tap = 0; tap < 2; tap++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(35);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(60);
    }
  };
  await doubleTap(); await expect(preview.getByRole("button", { name: /还原/ })).toContainText("200%");
  await page.waitForTimeout(320);
  await doubleTap(); await expect(preview.getByRole("button", { name: /还原/ })).toContainText("100%");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x + 100, y, id: 1 }] });
  for (let step = 1; step <= 10; step++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 100 - step * 20, y, id: 1 }] }); await page.waitForTimeout(20); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(preview.getByRole("status")).toContainText("第 2 张");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: bounds.y + 50, id: 1 }] });
  for (let step = 1; step <= 10; step++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: bounds.y + 50 + step * 38, id: 1 }] }); await page.waitForTimeout(20); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(preview).toBeHidden();
  for (const number of [1, 2, 3]) await expect(page.getByRole("button", { name: `选择图片 ${number}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

test("375px十二张展示图片按二维换行排序并在拖拽边缘自动滚动", async ({ page }) => {
  await prepare(page, 12); await page.setViewportSize({ width: 375, height: 844 });
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  const order = page.getByRole("region", { name: "展示图片顺序" });
  const first = order.locator('[data-order-id="asset-front"]');
  const handle = first.getByRole("button", { name: /调整.*顺序/ });
  await expect(handle).toBeVisible(); await handle.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const firstBox = await first.boundingBox(); const thirdBox = await order.locator('[data-order-id="asset-detail"]').boundingBox(); const handleBox = await handle.boundingBox();
  if (!firstBox || !thirdBox || !handleBox) throw new Error("missing reorder positions");
  expect(thirdBox.y).toBeGreaterThan(firstBox.y + firstBox.height / 2);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page.mouse.down();
  await page.mouse.move(thirdBox.x + thirdBox.width / 2, Math.min(790, thirdBox.y + thirdBox.height / 2), { steps: 8 });
  const previousTop = await order.evaluate((element) => element.getBoundingClientRect().top);
  await page.mouse.move(190, 834, { steps: 5 }); await page.waitForTimeout(450);
  await expect.poll(() => order.evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(previousTop);
  await page.mouse.up();
  await expect.poll(() => order.locator("[data-order-id]").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.orderId))).not.toEqual(["asset-front", "asset-back", "asset-detail", ...Array.from({ length: 9 }, (_, index) => `asset-extra-${index + 3}`)]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "output/ui-motion/presentation/order-twelve-375.png", fullPage: true });
});
