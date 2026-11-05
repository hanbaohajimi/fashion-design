import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { seedWardrobe } from "./wardrobe-fixture";
import { PROJECT } from "../visual/fixtures";

test.use({ viewport: { width: 1440, height: 1000 }, video: "on" });
test("衣架真实材质与挂点视觉核对", async ({ page }) => {
  await seedWardrobe(page);
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe`);
  const garment = page.getByRole("button", { name: "查看单品：测试长外套", exact: true });
  await expect(garment).toBeVisible();
  await garment.hover();
  await page.waitForTimeout(700);
  const geometry = await garment.evaluate(element => Array.from(element.querySelectorAll("span,svg,img")).map(node => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return { tag: node.tagName, class: node.getAttribute("class"), box: box.toJSON(), transform: style.transform, width: style.width, left: style.left, anchor: style.getPropertyValue("--anchor-x") };
  }));
  await mkdir("output/wardrobe-realism", { recursive: true });
  await writeFile("output/wardrobe-realism/geometry.json", JSON.stringify(geometry, null, 2));
  const coordinates = await garment.evaluate(element => {
    const image = element.querySelector("img")!;
    const hardware = element.querySelector<SVGSVGElement>("[data-rack-hardware]")!;
    return { image: image.getBoundingClientRect().toJSON(), hardware: hardware.getBoundingClientRect().toJSON() };
  });
  expect(Math.abs(coordinates.image.x + coordinates.image.width / 2 - coordinates.hardware.x - coordinates.hardware.width / 2)).toBeLessThan(2);
  await page.screenshot({ path: "output/wardrobe-realism/current.png", fullPage: true });
});

test("真实服装透明图的陈列、转正和聚焦对照", async ({ page }) => {
  test.skip(!process.env.WARDROBE_REALISM_MANIFEST, "本地外部照片不随应用分发；手工验证需指定素材清单");
  const manifest = JSON.parse(await readFile(process.env.WARDROBE_REALISM_MANIFEST!, "utf8")) as {
    items: { file: string; name: string; readyForLocalRackReference: boolean; width: number; height: number; alphaBounds16: { x: number; y: number; width: number; height: number } }[];
  };
  const references = manifest.items.filter(item => item.readyForLocalRackReference);
  expect(references.length).toBeGreaterThanOrEqual(3);
  // Repeated references exercise the same ten-slot density as the video; they are not ten distinct designs.
  const photos = Array.from({ length: 10 }, (_, index) => references[index % references.length]!);
  const captureDir = process.env.WARDROBE_REALISM_OUTPUT ?? "output/wardrobe-realism";
  await mkdir(captureDir, { recursive: true });
  const fixture = await seedWardrobe(page, { many: true });
  fixture.summary.items = fixture.summary.items.slice(0, 10).map((item, index) => {
    const photo = photos[index]!;
    const revision = { ...item.currentRevision, name: photo.name, category: "top" as const, display: "hanger" as const, url: `/real-wardrobe-${index}.png`, anchor: { x: .5, y: Math.max(.02, photo.alphaBounds16.y / photo.height) }, imageBounds: { width: photo.width, height: photo.height, x: photo.alphaBounds16.x, y: photo.alphaBounds16.y, contentWidth: photo.alphaBounds16.width, contentHeight: photo.alphaBounds16.height } };
    return { ...item, name: photo.name, currentRevision: revision, revisions: [revision] };
  });
  await page.route("**/real-wardrobe-*.png", async route => {
    const index = Number(/real-wardrobe-(\d+)/u.exec(route.request().url())![1]);
    await route.fulfill({ contentType: "image/png", body: await readFile(photos[index]!.file) });
  });
  const item = fixture.summary.items[0]!;
  fixture.summary.preparations.push({ id: "real-preparation", projectId: PROJECT, name: item.name, sourceAssetId: item.currentRevision.assetId, category: "top", sourceKind: "isolated", mode: "existing", status: "ready", taskId: null, error: null, candidates: [{ assetId: "real-candidate", url: "/real-wardrobe-0.png", imageBounds: item.currentRevision.imageBounds }], createdAt: item.currentRevision.createdAt });
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe`);
  const rack = page.getByRole("region", { name: "项目单品衣架" });
  const slots = rack.getByRole("button", { name: /^查看单品/ });
  await expect(slots).toHaveCount(10);
  await expect.poll(() => rack.locator("[data-garment] img").evaluateAll(images => images.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 300))).toBe(true);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${captureDir}/real-default.png`, fullPage: true });
  await rack.screenshot({ path: `${captureDir}/real-scene-default.png` });
  await slots.nth(4).hover();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${captureDir}/real-hover.png`, fullPage: true });
  await rack.screenshot({ path: `${captureDir}/real-scene-hover.png` });
  await slots.nth(3).hover();
  await expect.poll(() => slots.nth(3).evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
  await page.waitForTimeout(700);
  await rack.screenshot({ path: `${captureDir}/real-scene-black.png` });
  await slots.nth(3).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${captureDir}/real-focus-black.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await slots.nth(5).hover(); await slots.nth(3).hover(); await slots.nth(4).hover();
  await page.waitForTimeout(600);
  await slots.nth(4).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${captureDir}/real-focus.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(slots).toHaveCount(4);
  await slots.nth(1).hover();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${captureDir}/real-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
  await slots.first().click();
  await page.getByRole("button", { name: "准备新修订", exact: true }).click();
  await page.getByRole("button", { name: "查看与继续", exact: true }).click();
  const mount = page.getByRole("img", { name: `挂架预览：${item.name}`, exact: true });
  await mount.scrollIntoViewIfNeeded();
  await page.getByRole("spinbutton", { name: "挂点纵向 %", exact: true }).fill("4");
  await page.waitForTimeout(500);
  await mount.screenshot({ path: `${captureDir}/real-mount-preview.png` });
  expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
  await writeFile(`${captureDir}/references.json`, JSON.stringify({ manifest: process.env.WARDROBE_REALISM_MANIFEST, distinctReferences: references.length, slots: photos.length, garmentAssetsModified: false, providerRequests: 0 }, null, 2));
});
