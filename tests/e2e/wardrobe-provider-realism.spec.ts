import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import type { WardrobeCategory, WardrobeDisplay, WardrobeImageBounds, WardrobePresentation } from "../../packages/shared/src/wardrobe";
import { seedWardrobe } from "./wardrobe-fixture";
import { PROJECT } from "../visual/fixtures";

test.use({ video: "on" });

const CATEGORIES: WardrobeCategory[] = ["top", "outerwear", "bottom", "onepiece", "shoes", "bag", "hat", "scarf", "belt", "accessory"];
type Point = { x: number; y: number };
type Provenance = { provider: string; modelId: string; taskId: string; assetId: string; sourceAssetId: string; preparationId?: string };
type Side = { file: string; imageBounds: WardrobeImageBounds; anchor?: Point; orientation: "left" | "right"; reviewedForDisplay: boolean; sha256?: string; provenance: Provenance };
type Sample = { id: string; name: string; category: WardrobeCategory; display: WardrobeDisplay; file: string; imageBounds: WardrobeImageBounds; anchor: Point; reviewedForDisplay: boolean; sha256?: string; materialTags?: string[]; provenance: Provenance; supportWidthRatio?: number; shelfDepthRatio?: number; sideDisplay?: Side; presentation?: WardrobePresentation };
type Override = { anchor?: Point; sideAnchor?: Point; supportWidthRatio?: number; shelfDepthRatio?: number };
type Input = { samples: Sample[]; manifestPath: string; preview: boolean; overrides: Record<string, Override>; directory: string };

async function loadInput(): Promise<Input> {
  const manifestPath = resolve(process.env.WARDROBE_PROVIDER_MANIFEST ?? "output/wardrobe-provider/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { schemaVersion: number; evidenceKind: string; items: Sample[] };
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.evidenceKind).toBe("provider-generated");
  const preview = process.env.WARDROBE_PROVIDER_PREVIEW_UNREVIEWED === "1";
  const ids = process.env.WARDROBE_PROVIDER_IDS?.split(",").map(id => id.trim()).filter(Boolean);
  const maximum = Math.max(1, Math.min(40, Number(process.env.WARDROBE_PROVIDER_MAX_ITEMS ?? 4)));
  const samples = manifest.items.filter(sample => (!ids || ids.includes(sample.id)) && (preview || sample.reviewedForDisplay)).slice(0, maximum)
    .map(sample => preview && (!sample.reviewedForDisplay || (sample.sideDisplay && !sample.sideDisplay.reviewedForDisplay)) ? { ...sample, name: `未确认预览 · ${sample.name}` } : sample);
  expect(samples.length, "清单须包含已审核样本，或显式开启未审核预览").toBeGreaterThan(0);
  expect(new Set(samples.map(sample => sample.id)).size).toBe(samples.length);
  for (const sample of samples) {
    expect(CATEGORIES).toContain(sample.category);
    expect(sample.provenance.provider).toBeTruthy(); expect(sample.provenance.modelId).toBeTruthy(); expect(sample.provenance.taskId).toBeTruthy();
  }
  const overrides = process.env.WARDROBE_PROVIDER_OVERRIDES ? JSON.parse(await readFile(process.env.WARDROBE_PROVIDER_OVERRIDES, "utf8")) as Record<string, Override> : {};
  return { samples, manifestPath, preview, overrides, directory: process.env.WARDROBE_PROVIDER_OUTPUT ?? "output/wardrobe-provider/browser" };
}

async function png(input: Input, file: string, sha256?: string): Promise<Buffer> {
  const bytes = await readFile(isAbsolute(file) ? file : resolve(dirname(input.manifestPath), file));
  expect(bytes.subarray(0, 8).toString("hex"), "真实供应商 PNG，不能用几何 SVG 代替").toBe("89504e470d0a1a0a");
  if (sha256) expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  return bytes;
}

async function seedSamples(page: Page, input: Input, repeat = 1) {
  const blocked: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) { blocked.push(url.hostname); return route.abort("blockedbyclient"); }
    return route.fallback();
  });
  const fixture = await seedWardrobe(page, { many: true });
  fixture.summary.capabilities.preparationEnabled = false;
  fixture.summary.capabilities.staticTryOnEnabled = false;
  const base = fixture.summary.items[0];
  if (!base) throw new Error("Missing base fixture");
  const content = new Map<string, Buffer>();
  const prepared = await Promise.all(input.samples.map(async sample => {
    const override = input.overrides[sample.id];
    const anchor = override?.anchor ?? sample.anchor;
    expect([anchor.x, anchor.y].every(value => value >= 0 && value <= 1)).toBe(true);
    const url = `/provider-rack/${encodeURIComponent(sample.id)}-front.png`;
    content.set(url, await png(input, sample.file, sample.sha256));
    const side = sample.sideDisplay;
    const sideAnchor = override?.sideAnchor ?? side?.anchor;
    if (side && (side.reviewedForDisplay || input.preview) && !sideAnchor) {
      throw new Error(`Independent side audit requires an explicit anchor: ${sample.id}. Provide a scoped preview override; front projection is not side evidence.`);
    }
    let sideDisplay: WardrobePresentation["sideDisplay"];
    if (side && (side.reviewedForDisplay || input.preview) && sideAnchor) {
      expect([sideAnchor.x, sideAnchor.y].every(value => value >= 0 && value <= 1)).toBe(true);
      const sideUrl = `/provider-rack/${encodeURIComponent(sample.id)}-side.png`;
      content.set(sideUrl, await png(input, side.file, side.sha256));
      sideDisplay = { assetId: side.provenance.assetId, url: sideUrl, imageBounds: side.imageBounds, anchor: sideAnchor, orientation: side.orientation,
        source: "generated", preparationId: side.provenance.preparationId ?? side.provenance.taskId,
        // Explicit unreviewed mode is a local rendering fixture, never an approval or database write.
        reviewed: true };
    }
    const supportWidthRatio = override?.supportWidthRatio ?? sample.presentation?.supportWidthRatio ?? sample.supportWidthRatio;
    const shelfDepthRatio = override?.shelfDepthRatio ?? sample.presentation?.shelfDepthRatio ?? sample.shelfDepthRatio;
    const revision = { ...base.currentRevision, id: `provider-revision-${sample.id}`, itemId: `provider-item-${sample.id}`, assetId: sample.provenance.assetId,
      sourceAssetId: sample.provenance.sourceAssetId, name: sample.name, category: sample.category, display: sample.display, anchor, imageBounds: sample.imageBounds, url,
      presentation: { ...(supportWidthRatio !== undefined ? { supportWidthRatio } : {}), ...(shelfDepthRatio !== undefined ? { shelfDepthRatio } : {}), ...(sideDisplay ? { sideDisplay } : {}) } };
    return { ...base, id: revision.itemId, name: sample.name, currentRevision: revision, revisions: [revision] };
  }));
  fixture.summary.items = Array.from({ length: repeat }, (_, repeatIndex) => prepared.map(item => ({ ...item, id: `${item.id}-${repeatIndex}` }))).flat();
  await page.route("**/provider-rack/*", route => {
    const body = content.get(new URL(route.request().url()).pathname);
    return body ? route.fulfill({ contentType: "image/png", body }) : route.fulfill({ status: 404 });
  });
  const writes: string[] = [];
  await page.route("**/api/**", route => {
    if (!["GET", "HEAD"].includes(route.request().method())) { writes.push(route.request().url()); return route.fulfill({ status: 409, json: { message: "只读渲染验收禁止写入" } }); }
    return route.fallback();
  });
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe`);
  await expect(page.getByRole("region", { name: "项目单品衣架" })).toBeVisible();
  return { fixture, blocked, writes };
}

async function settle(slot: Locator) {
  await expect.poll(() => slot.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
}

async function measure(slot: Locator, sample: Sample, anchor: Point) {
  return slot.evaluate((node, input) => {
    const image = node.querySelector<HTMLImageElement>("[data-image-view=front] img");
    const hardware = node.querySelector<SVGSVGElement>("[data-rack-hardware]");
    const garment = node.querySelector<HTMLElement>("[data-garment]");
    if (!image || !hardware || !garment) throw new Error("Missing mounted garment");
    const box = image.getBoundingClientRect(); const support = hardware.getBoundingClientRect();
    const bounds = input.sample.imageBounds;
    const content = { left: box.left + box.width * bounds.x / bounds.width, top: box.top + box.height * bounds.y / bounds.height,
      width: box.width * bounds.contentWidth / bounds.width, height: box.height * bounds.contentHeight / bounds.height };
    const point = input.sample.display === "hanger" ? { x: 70, y: 26 } : input.sample.display === "hook" ? { x: 80, y: 44 } : { x: 70, y: 48 };
    const mounted = { x: box.left + box.width * input.anchor.x, y: box.top + box.height * input.anchor.y };
    const target = { x: support.left + support.width * point.x / 140, y: support.top + support.height * (point.y + 8) / 84 };
    const name = [...node.children].find(child => child !== garment && child.tagName === "SPAN" && child.children.length === 0)?.getBoundingClientRect();
    return { content, mounted, target, mountError: Math.hypot(mounted.x - target.x, mounted.y - target.y),
      imageRatio: box.width / box.height, naturalRatio: image.naturalWidth / image.naturalHeight,
      labelTop: name?.top ?? null, presentation: garment.dataset.presentation, view: garment.dataset.view, sideState: garment.dataset.sideState };
  }, { sample, anchor });
}

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`真实供应商多品类素材：${viewport.name}陈列、聚焦与轮廓`, async ({ page }) => {
    test.skip(!process.env.WARDROBE_PROVIDER_MANIFEST, "需显式指定真实供应商素材清单，不调用生成接口");
    test.setTimeout(180_000);
    const input = await loadInput();
    const output = resolve(input.directory, viewport.name); await mkdir(output, { recursive: true });
    await page.setViewportSize(viewport);
    const { fixture, blocked, writes } = await seedSamples(page, input);
    const rack = page.getByRole("region", { name: "项目单品衣架" });
    const results: unknown[] = [];
    for (const sample of input.samples) {
      await page.getByRole("searchbox", { name: "查找单品", exact: true }).fill(sample.name);
      const slot = rack.locator(`[data-item-id="provider-item-${sample.id}-0"]`);
      await expect(slot).toBeVisible();
      await expect.poll(() => slot.locator("[data-image-view=front] img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      if (await slot.locator("[data-image-view=side] img").count()) {
        await expect.poll(() => slot.locator("[data-image-view=side] img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
        await expect(slot.locator("[data-garment]")).toHaveAttribute("data-view", "side");
      }
      await page.mouse.move(0, 0); await settle(slot);
      await rack.screenshot({ path: `${output}/${sample.id}-rest.png` });
      const before = await slot.boundingBox();
      await slot.hover(); await settle(slot);
      const after = await slot.boundingBox();
      expect(after?.x).toBeCloseTo(before?.x ?? NaN, 1); expect(after?.width).toBeCloseTo(before?.width ?? NaN, 1);
      const geometry = await measure(slot, sample, input.overrides[sample.id]?.anchor ?? sample.anchor);
      expect(geometry.mountError).toBeLessThan(2);
      expect(geometry.imageRatio).toBeCloseTo(geometry.naturalRatio, 2);
      if (geometry.labelTop !== null) expect(geometry.labelTop).toBeGreaterThanOrEqual(geometry.content.top + geometry.content.height + 8);
      await rack.screenshot({ path: `${output}/${sample.id}-front.png` });
      await slot.click();
      const dialog = page.getByRole("dialog", { name: `单品：${sample.name}`, exact: true });
      await expect(dialog).toBeVisible();
      await settle(dialog);
      await expect(dialog.locator("[data-garment]")).toHaveAttribute("data-view", "front");
      const focusedContent = await dialog.locator("[data-image-view=front] img").evaluate((image, bounds) => {
        const box = image.getBoundingClientRect();
        return { top: box.top + box.height * bounds.y / bounds.height, bottom: box.top + box.height * (bounds.y + bounds.contentHeight) / bounds.height };
      }, sample.imageBounds);
      const dialogBox = await dialog.boundingBox(); if (!dialogBox) throw new Error("Missing focused dialog");
      expect(focusedContent.top).toBeGreaterThanOrEqual(dialogBox.y + 32);
      expect(focusedContent.bottom).toBeLessThanOrEqual(dialogBox.y + dialogBox.height - 80);
      await dialog.screenshot({ path: `${output}/${sample.id}-focus.png` });
      await dialog.getByRole("button", { name: "返回衣架", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      results.push({ id: sample.id, category: sample.category, display: sample.display, provenance: sample.provenance, frontSha256: sample.sha256,
        sideSha256: sample.sideDisplay?.sha256, sideProvenance: sample.sideDisplay?.provenance, materialTags: sample.materialTags ?? [],
        inputReview: sample.reviewedForDisplay ? "reviewed" : "pending-human-review", geometry,
        sideInputReview: sample.sideDisplay?.reviewedForDisplay ? "reviewed" : "pending-human-review", sideRendered: !!fixture.summary.items.find(item => item.name === sample.name)?.currentRevision.presentation?.sideDisplay,
        materialAndDrapeAcceptance: "requires-human-review-of-captures" });
    }
    const missingCategories = CATEGORIES.filter(category => !input.samples.some(sample => sample.category === category));
    await writeFile(`${output}/report.json`, JSON.stringify({ manifest: input.manifestPath, sampleCount: input.samples.length, missingCategories, previewUnreviewed: input.preview, previewOverrides: input.overrides,
      evidence: "真实供应商 PNG + 模拟项目数据的浏览器渲染，不是生产账户端到端验收", assetBytesUnchanged: true, providerRequestsDuringCapture: 0, results, blocked, writes }, null, 2));
    expect(blocked).toEqual([]); expect(writes).toEqual([]); expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
    if (process.env.WARDROBE_PROVIDER_REQUIRE_ALL === "1") expect(missingCategories).toEqual([]);
  });
}

test("真实侧图十槽密度预览及图片失效回退", async ({ page }) => {
  test.skip(process.env.WARDROBE_PROVIDER_DENSITY !== "1", "仅显式密度检查；重复同款不计作十款素材");
  const input = await loadInput();
  const sample = input.samples[0]; if (!sample) throw new Error("Missing density sample");
  const output = resolve(input.directory, "density"); await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { fixture, writes } = await seedSamples(page, { ...input, samples: [sample] }, 10);
  const rack = page.getByRole("region", { name: "项目单品衣架" });
  const slots = rack.locator("[data-item-id]"); await expect(slots).toHaveCount(10);
  await expect(rack.locator("[data-view=side]")).toHaveCount(10);
  await settle(rack); await rack.screenshot({ path: `${output}/ten-slots-rest.png` });
  await slots.nth(4).hover(); await settle(rack); await rack.screenshot({ path: `${output}/ten-slots-hover.png` });
  for (const index of [6, 2, 7, 4]) { await slots.nth(index).hover(); await page.waitForTimeout(120); }
  await settle(rack);
  await rack.screenshot({ path: `${output}/ten-slots-after-reverse.png` });
  await page.route("**/provider-rack/*-side.png", route => route.fulfill({ status: 404 }));
  await page.reload();
  await page.mouse.move(0, 0);
  await expect(rack.locator('[data-view="placeholder"][data-side-state="error"]')).toHaveCount(10);
  await expect(rack.getByRole("status", { name: "侧挂图暂不可用，点击查看正面" })).toHaveCount(10);
  await expect(slots.first().locator("[data-image-view=front] img")).toBeHidden();
  await expect(slots.first().locator("[data-rack-hardware]")).toBeHidden();
  const fallback = await slots.first().locator("[data-garment]").evaluate(node => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return { kind: "explicit-unavailable-placeholder", frontProjection: false, scaleX: matrix.m11, scaleY: matrix.m22 };
  });
  expect(fallback.scaleX).toBe(1); expect(fallback.scaleY).toBe(1);
  await rack.screenshot({ path: `${output}/ten-slots-side-404.png` });
  await slots.nth(4).hover(); await settle(rack);
  await expect(slots.nth(4).locator("[data-garment]")).toHaveAttribute("data-view", "front");
  await expect(slots.nth(4).locator("[data-image-view=front] img")).toBeVisible();
  await expect(rack.locator('[data-view="placeholder"]')).toHaveCount(9);
  await expect(slots.first().locator("[data-side-placeholder]")).toBeHidden();
  await rack.screenshot({ path: `${output}/ten-slots-side-404-hover.png` });
  await slots.nth(4).click();
  const dialog = page.getByRole("dialog", { name: `单品：${sample.name}`, exact: true });
  await expect(dialog).toBeVisible(); await settle(dialog);
  await expect(dialog.locator("[data-image-view=front] img")).toBeVisible();
  await expect(dialog.locator("[data-garment]")).toHaveAttribute("data-view", "front");
  await dialog.screenshot({ path: `${output}/ten-slots-side-404-focus.png` });
  await dialog.getByRole("button", { name: "返回衣架", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload(); await page.mouse.move(0, 0);
  await expect(rack.locator('[data-view="placeholder"][data-side-state="error"]')).toHaveCount(4);
  await expect(rack.getByRole("status", { name: "侧挂图暂不可用，点击查看正面" })).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await rack.screenshot({ path: `${output}/four-slots-side-404-mobile.png` });
  expect(writes).toEqual([]); expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
  await writeFile(`${output}/report.json`, JSON.stringify({ distinctDesigns: 1, repeatedSlots: 10, pendingSideReview: !sample.sideDisplay?.reviewedForDisplay, providerRequestsDuringCapture: 0, fallback }, null, 2));
});

test("真实多款侧挂并排与连续反向浏览", async ({ page }) => {
  test.skip(process.env.WARDROBE_PROVIDER_GROUP !== "1", "仅显式核对多款真实侧挂，不补造缺失侧图");
  const input = await loadInput();
  const output = resolve(input.directory, "group"); await mkdir(output, { recursive: true });
  const { fixture, blocked, writes } = await seedSamples(page, input);
  expect(fixture.summary.items.every(item => item.currentRevision.presentation?.sideDisplay?.reviewed)).toBe(true);
  const rack = page.getByRole("region", { name: "项目单品衣架" });
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.reload(); await page.mouse.move(0, 0);
    const slots = rack.locator("[data-item-id]");
    await expect(slots.first()).toBeVisible();
    await settle(rack);
    const expected = await slots.count();
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThanOrEqual(viewport.name === "mobile" ? 4 : 10);
    await expect(rack.locator('[data-view="side"]')).toHaveCount(expected);
    await settle(rack); await rack.screenshot({ path: `${output}/${viewport.name}-rest.png` });
    for (const index of [0, expected - 1, Math.min(2, expected - 1), 0]) {
      const slot = slots.nth(index); const before = await slot.boundingBox();
      await slot.hover(); await page.waitForTimeout(120);
      const after = await slot.boundingBox();
      expect(after?.x).toBeCloseTo(before?.x ?? NaN, 1); expect(after?.width).toBeCloseTo(before?.width ?? NaN, 1);
    }
    await settle(rack); await rack.screenshot({ path: `${output}/${viewport.name}-after-reverse.png` });
    for (const index of [0, expected - 1]) {
      const sample = input.samples[index]; if (!sample) throw new Error("Missing visible sample");
      const slot = slots.nth(index); await slot.hover(); await settle(rack);
      const geometry = await measure(slot, sample, input.overrides[sample.id]?.anchor ?? sample.anchor);
      const frame = await rack.boundingBox(); if (!frame) throw new Error("Missing rack bounds");
      expect(geometry.content.left).toBeGreaterThanOrEqual(frame.x + 7);
      expect(geometry.content.left + geometry.content.width).toBeLessThanOrEqual(frame.x + frame.width - 7);
      await rack.screenshot({ path: `${output}/${viewport.name}-edge-${index}.png` });
    }
    let seen = expected;
    let group = 1;
    while (await rack.getByRole("button", { name: "下一组", exact: true }).isEnabled()) {
      await rack.getByRole("button", { name: "下一组", exact: true }).click(); await page.mouse.move(0, 0);
      const count = await slots.count();
      expect(count).toBeGreaterThan(0);
      await expect(rack.locator('[data-view="side"]')).toHaveCount(count);
      await settle(rack); await rack.screenshot({ path: `${output}/${viewport.name}-next-group-${group++}.png` });
      seen += count;
    }
    expect(seen).toBe(input.samples.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(blocked).toEqual([]); expect(writes).toEqual([]); expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
  await writeFile(`${output}/report.json`, JSON.stringify({ distinctDesigns: input.samples.map(sample => sample.id), repeatedSlots: false, providerRequestsDuringCapture: 0,
    evidence: "真实PNG并排浏览/连续反向的浏览器渲染，挂具实际接触仍需逐图目视核对", blocked, writes }, null, 2));
});

test("真实侧挂图放大核对挂具接触", async ({ page }) => {
  test.skip(process.env.WARDROBE_PROVIDER_MOUNT !== "1", "仅显式放大挂具检查，保留原始素材");
  test.setTimeout(180_000);
  const input = await loadInput();
  const output = resolve(input.directory, "side-mount"); await mkdir(output, { recursive: true });
  const { fixture, blocked, writes } = await seedSamples(page, input);
  for (const sample of input.samples) {
    await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe`);
    await page.getByRole("searchbox", { name: "查找单品", exact: true }).fill(sample.name);
    await page.getByRole("button", { name: `查看单品：${sample.name}`, exact: true }).click();
    await page.getByRole("button", { name: "准备新修订", exact: true }).click();
    await page.getByRole("button", { name: "准备侧挂图与挂具宽度", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "准备侧挂展示图" });
    await dialog.getByRole("group", { name: "核对展示角度", exact: true }).getByRole("button", { name: "侧挂", exact: true }).click();
    const preview = dialog.getByRole("img", { name: `挂架预览：${sample.name}`, exact: true });
    await expect(preview.locator("[data-garment]")).toHaveAttribute("data-view", "side");
    await preview.scrollIntoViewIfNeeded(); await settle(preview);
    await preview.screenshot({ path: `${output}/${sample.id}.png` });
  }
  expect(blocked).toEqual([]); expect(writes).toEqual([]); expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
});

test("真实侧挂候选三底只读核对", async ({ page }) => {
  test.skip(process.env.WARDROBE_PROVIDER_BACKGROUND !== "1", "仅显式三底核对，未审核素材不会被确认");
  test.setTimeout(180_000);
  const input = await loadInput();
  const { fixture, blocked, writes } = await seedSamples(page, input);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const sample of input.samples) {
    const revision = fixture.summary.items.find(item => item.name === sample.name)?.currentRevision;
    const side = revision?.presentation?.sideDisplay;
    if (!revision || !side) throw new Error(`Missing side preview: ${sample.id}`);
    fixture.summary.preparations = [{ id: `inspection-${sample.id}`, projectId: PROJECT, sourceAssetId: revision.assetId, name: sample.name, category: sample.category,
      sourceKind: "isolated", mode: "complete", status: "ready", taskId: null, error: null, candidates: [{ assetId: side.assetId, url: side.url, imageBounds: side.imageBounds }],
      presentation: { view: "side", revisionId: revision.id, orientation: side.orientation }, createdAt: new Date(0).toISOString() }];
    await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe`);
    await page.getByRole("searchbox", { name: "查找单品", exact: true }).fill(sample.name);
    await page.getByRole("button", { name: `查看单品：${sample.name}`, exact: true }).click();
    await page.getByRole("button", { name: "准备新修订", exact: true }).click();
    await page.getByRole("button", { name: "准备侧挂图与挂具宽度", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "准备侧挂展示图" });
    await dialog.getByRole("button", { name: "核对侧挂候选", exact: true }).click();
    await dialog.getByRole("spinbutton", { name: "侧挂点横向 %", exact: true }).fill(String(side.anchor.x * 100));
    await dialog.getByRole("spinbutton", { name: "侧挂点纵向 %", exact: true }).fill(String(side.anchor.y * 100));
    const output = resolve(input.directory, "background", sample.id); await mkdir(output, { recursive: true });
    const candidate = dialog.getByRole("img", { name: "待核对侧挂候选", exact: true });
    await expect.poll(() => candidate.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    const source = await candidate.getAttribute("src");
    const control = dialog.getByRole("group", { name: "预览底色", exact: true });
    for (const [label, value] of [["白", "white"], ["场景灰", "scene"], ["深灰", "dark"]] as const) {
      await control.getByRole("button", { name: label, exact: true }).click();
      await control.evaluate(node => node.scrollIntoView({ block: "start" }));
      await dialog.screenshot({ path: `${output}/${value}.png` });
      await expect(candidate).toHaveAttribute("src", source ?? "");
    }
    await expect(dialog.getByRole("button", { name: "确认侧挂展示图", exact: true })).toBeDisabled();
    await writeFile(`${output}/capture.json`, JSON.stringify({ id: sample.id, previewUnreviewed: !sample.sideDisplay?.reviewedForDisplay,
      candidateBytesUnchanged: true, providerRequests: 0, writes: 0, materialAcceptance: "requires-independent-human-review" }, null, 2));
  }
  expect(blocked).toEqual([]); expect(writes).toEqual([]); expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
});
