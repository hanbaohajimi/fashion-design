import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { WardrobeImageBounds, WardrobeItemView, WardrobeRevisionView } from "../../packages/shared/src/wardrobe";
import { seedWardrobe } from "./wardrobe-fixture";
import { PROJECT } from "../visual/fixtures";

// These are 29 different designs. Paging never fills a rack with repeated garments.
const GROUPS = {
  A: ["top-green-sweatshirt", "top-cotton-print", "top-cable-knit", "outer-long-pile-fauxfur", "outer-leather-biker", "top-poplin-shirt", "top-tailored-vest", "top-satin-blouse", "top-sheer-lace", "outer-denim-jacket", "outer-down-puffer"],
  B: ["outer-long-wool", "bottom-denim-pants", "bottom-pleated-skirt", "onepiece-satin-gown", "onepiece-linen-jumpsuit", "onepiece-strapless-structured", "onepiece-brocade-qipao", "onepiece-sequin-dress", "bottom-cargo-shorts"],
  C: ["shoes-mesh-sneakers", "bag-structured-leather", "hat-felt-brim", "scarf-silk-fringe", "belt-leather-buckle", "accessory-translucent-glasses", "shoes-leather-boots", "bag-soft-canvas", "hat-rib-knit"],
} as const;

type Group = keyof typeof GROUPS;
type ManifestSample = {
  id: string; file: string; sha256: string; reviewedForDisplay: boolean;
  anchor: { x: number; y: number }; imageBounds: WardrobeImageBounds;
  supportWidthRatio?: number; shelfDepthRatio?: number;
  provenance: { itemId: string; revisionId: string; assetId: string };
  sideDisplay?: { file: string; sha256: string; reviewedForDisplay: boolean; anchor: { x: number; y: number }; imageBounds: WardrobeImageBounds; provenance: { assetId: string } };
};
type SavedSample = { id: string; item: WardrobeItemView; receipt: string; receiptSha256: string; frontSha256: string; sideSha256: string; images: Map<string, Buffer> };
type Captures = { id: string; hover: string; focus: string; returned: string };
const recordings = new Map<string, string>();
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test.use({ contextOptions: { reducedMotion: "no-preference" }, video: { mode: "on", size: { width: 1440, height: 1000 } } });

async function readInputs(group: Group) {
  expect(process.env.WARDROBE_PROVIDER_PREVIEW_UNREVIEWED, "完整混排验收只接受已确认侧图").not.toBe("1");
  expect(process.env.WARDROBE_PROVIDER_OVERRIDES, "使用真实保存的挂点，禁止渲染覆盖值").toBeUndefined();
  const manifestFile = resolve(process.env.WARDROBE_PROVIDER_MANIFEST ?? "output/wardrobe-provider/manifest.json");
  const manifestBytes = await readFile(manifestFile);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as { schemaVersion: number; evidenceKind: string; items: ManifestSample[] };
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.evidenceKind).toBe("provider-generated");
  const expectedIds = Object.values(GROUPS).flat();
  expect(new Set(expectedIds).size).toBe(29);
  expect(manifest.items.map(value => value.id).sort()).toEqual([...expectedIds].sort());
  expect(manifest.items.every(value => value.reviewedForDisplay && value.sideDisplay?.reviewedForDisplay), "先完成全部真实侧图审核和保存，再运行混排").toBe(true);
  const samples: SavedSample[] = [];
  for (const id of GROUPS[group]) {
    const sample = manifest.items.find(value => value.id === id);
    if (!sample?.sideDisplay) throw new Error(`Missing confirmed sample: ${id}`);
    const receipt = resolve(dirname(manifestFile), id, "current-confirmed.json");
    const receiptBytes = await readFile(receipt);
    const saved = JSON.parse(receiptBytes.toString("utf8")) as WardrobeItemView | { item: WardrobeItemView };
    const item = "item" in saved ? saved.item : saved;
    const revision = item.currentRevision;
    const side = revision.presentation?.sideDisplay;
    if (!side) throw new Error(`Missing saved side: ${id}`);
    expect(item.archived).toBe(false);
    expect(item.id).toBe(sample.provenance.itemId);
    expect(revision.id).toBe(sample.provenance.revisionId);
    expect(revision.assetId).toBe(sample.provenance.assetId);
    expect(revision.reviewed).toBe(true);
    expect(side.reviewed).toBe(true);
    expect(side.assetId).toBe(sample.sideDisplay.provenance.assetId);
    expect(revision.anchor).toEqual(sample.anchor);
    expect(revision.imageBounds).toEqual(sample.imageBounds);
    expect(side.anchor).toEqual(sample.sideDisplay.anchor);
    expect(side.imageBounds).toEqual(sample.sideDisplay.imageBounds);
    expect(revision.presentation?.supportWidthRatio).toBe(sample.supportWidthRatio);
    expect(revision.presentation?.shelfDepthRatio).toBe(sample.shelfDepthRatio);
    const images = new Map<string, Buffer>();
    for (const [assetId, filename, expectedSha] of [[revision.assetId, sample.file, sample.sha256], [side.assetId, sample.sideDisplay.file, sample.sideDisplay.sha256]]) {
      if (!assetId || !filename || !expectedSha) throw new Error(`Incomplete image evidence: ${id}`);
      const bytes = await readFile(isAbsolute(filename) ? filename : resolve(dirname(manifestFile), filename));
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(sha(bytes)).toBe(expectedSha);
      images.set(assetId, bytes);
    }
    samples.push({ id, item, receipt, receiptSha256: sha(receiptBytes), frontSha256: sample.sha256, sideSha256: sample.sideDisplay.sha256, images });
  }
  return { samples, manifestFile, manifestSha256: sha(manifestBytes) };
}

async function settle(node: Locator) {
  await expect.poll(() => node.evaluate(element => element.getAnimations({ subtree: true }).filter(value => value.playState === "running").length)).toBe(0);
}

async function loadImages(rack: Locator) {
  await expect.poll(() => rack.locator("[data-item-id] img").evaluateAll(images => images.length > 0 && images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  await settle(rack);
}

async function rackHitbox(slot: Locator) {
  return slot.evaluate(node => {
    const stage = node.parentElement?.parentElement;
    if (!stage) throw new Error("Missing rack stage");
    const box = node.getBoundingClientRect(), frame = stage.getBoundingClientRect();
    return { x: box.x - frame.x, y: box.y - frame.y, width: box.width, height: box.height };
  });
}

async function checkRailMounts(rack: Locator) {
  const mounts = await rack.locator("[data-hardware-frame]").evaluateAll(nodes => nodes.map(node => {
    const rail = node.closest("[data-item-id]")?.parentElement?.parentElement?.querySelector("[data-rack-rail]");
    if (!rail) throw new Error("Missing rack rail");
    const bar = rail.getBoundingClientRect();
    const hook = node.getBoundingClientRect();
    const x = hook.left + hook.width / 2;
    return { left: x - bar.left, right: bar.right - x };
  }));
  for (const mount of mounts) {
    expect(mount.left, "挂点不能越过横杆左端").toBeGreaterThanOrEqual(7.5);
    expect(mount.right, "挂点不能越过横杆右端").toBeGreaterThanOrEqual(7.5);
  }
}

async function paintedHardwareBounds(container: Locator) {
  return container.locator("svg[data-rack-hardware]").evaluate(node => {
    const svg = node as SVGSVGElement;
    const box = svg.getBoundingClientRect(), painted = svg.getBBox(), viewBox = svg.viewBox.baseVal;
    const scaleY = box.height / viewBox.height;
    const stroke = Math.max(0, ...[...svg.querySelectorAll("path,rect,circle,ellipse")].filter(shape => !shape.closest("defs")).map(shape => {
      const style = getComputedStyle(shape);
      return style.stroke === "none" ? 0 : Number.parseFloat(style.strokeWidth) || 0;
    }));
    // getBBox excludes strokes and CSS drop shadows; include both independently of production extent math.
    const safety = stroke / 2 + 3;
    return { bottom: box.top + (painted.y + painted.height - viewBox.y + safety) * scaleY,
      left: box.left + (painted.x - viewBox.x - safety) * box.width / viewBox.width,
      right: box.left + (painted.x + painted.width - viewBox.x + safety) * box.width / viewBox.width };
  });
}

async function measure(slot: Locator, revision: WardrobeRevisionView, view: "front" | "side") {
  const source = view === "side" ? revision.presentation?.sideDisplay : revision;
  if (!source?.imageBounds) throw new Error("Missing authoritative image bounds");
  const result = await slot.evaluate((node, input) => {
    const image = node.querySelector<HTMLImageElement>(`[data-image-view="${input.view}"] img`);
    const support = node.querySelector<HTMLElement>("[data-hardware-frame]");
    const stage = node.parentElement?.parentElement;
    const label = [...node.children].find(value => value.tagName === "SPAN" && value.children.length === 0);
    if (!image || !support || !stage || !label) throw new Error("Incomplete rack DOM");
    const imageBox = image.getBoundingClientRect(), supportBox = support.getBoundingClientRect(), stageBox = stage.getBoundingClientRect();
    const bounds = input.bounds;
    const content = { left: imageBox.left + imageBox.width * bounds.x / bounds.width, top: imageBox.top + imageBox.height * bounds.y / bounds.height,
      right: imageBox.left + imageBox.width * (bounds.x + bounds.contentWidth) / bounds.width, bottom: imageBox.top + imageBox.height * (bounds.y + bounds.contentHeight) / bounds.height };
    const point = input.display === "hanger" ? { x: 70, y: 26 } : input.display === "hook" ? { x: 80, y: 44 } : { x: 70, y: 48 };
    const mounted = { x: imageBox.left + imageBox.width * input.anchor.x, y: imageBox.top + imageBox.height * input.anchor.y };
    const target = { x: supportBox.left + supportBox.width * point.x / 140, y: supportBox.top + supportBox.width * (point.y + 8) / 140 };
    const labelBox = label.getBoundingClientRect();
    return { view: input.view, content, stage: { left: stageBox.left, right: stageBox.right, top: stageBox.top, bottom: stageBox.bottom },
      mountError: Math.hypot(mounted.x - target.x, mounted.y - target.y), mounted, target,
      ratio: imageBox.width / imageBox.height, naturalRatio: image.naturalWidth / image.naturalHeight,
      label: { top: labelBox.top, bottom: labelBox.bottom }, railWidth: stage.firstElementChild?.getBoundingClientRect().width ?? null };
  }, { view, bounds: source.imageBounds, anchor: source.anchor, display: revision.display });
  return { ...result, hardwareBottom: (await paintedHardwareBounds(slot)).bottom };
}

function checkGeometry(value: Awaited<ReturnType<typeof measure>>, active: boolean) {
  expect(value.ratio).toBeCloseTo(value.naturalRatio, 2);
  expect(value.mountError).toBeLessThan(2);
  expect(value.content.top).toBeGreaterThanOrEqual(value.stage.top - 1);
  expect(value.content.bottom).toBeLessThanOrEqual(value.stage.bottom + 1);
  expect(value.content.left).toBeGreaterThanOrEqual(value.stage.left + 6);
  expect(value.content.right).toBeLessThanOrEqual(value.stage.right - 6);
  if (active) expect(value.label.top).toBeGreaterThanOrEqual(Math.max(value.content.bottom, value.hardwareBottom) + 8);
}

async function contactSheets(page: Page, directory: string, pageNumber: number, captures: Captures[]) {
  const outputs: string[] = [];
  for (let offset = 0; offset < captures.length; offset += 4) {
    const selected = captures.slice(offset, offset + 4);
    const rows = await Promise.all(selected.map(async row => ({ id: row.id, images: await Promise.all([row.hover, row.focus, row.returned].map(async file => `data:image/png;base64,${(await readFile(file)).toString("base64")}`)) })));
    const png = await page.evaluate(async input => {
      const width = 1200, rowHeight = 280;
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = input.length * rowHeight + 34;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#222"; context.font = "16px sans-serif";
      ["悬停正面 / 邻接", "聚焦 / 完整轮廓", "关闭并移出 / 侧挂回位"].forEach((label, index) => context.fillText(label, index * 400 + 12, 23));
      for (let row = 0; row < input.length; row++) {
        const entry = input[row]; if (!entry) continue;
        context.fillStyle = "#222"; context.font = "14px sans-serif"; context.fillText(entry.id, 12, row * rowHeight + 54);
        for (let column = 0; column < entry.images.length; column++) {
          const url = entry.images[column]; if (!url) continue;
          const image = new Image(); image.src = url; await image.decode();
          const scale = Math.min(392 / image.naturalWidth, 250 / image.naturalHeight);
          const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
          context.drawImage(image, column * 400 + (400 - w) / 2, row * rowHeight + 60, w, h);
        }
      }
      return canvas.toDataURL("image/png").split(",")[1];
    }, rows);
    if (!png) throw new Error("Empty contact sheet");
    const file = `${directory}/page-${pageNumber}-contact-${offset / 4 + 1}.png`;
    await writeFile(file, Buffer.from(png, "base64")); outputs.push(file);
  }
  return outputs;
}

test.afterEach(async ({ page }, info) => {
  const directory = recordings.get(info.testId);
  if (!directory) return;
  const video = page.video();
  await page.context().close();
  if (!video) throw new Error("Normal-motion recording is required for this audit");
  const file = `${directory}/continuous.webm`;
  await video.saveAs(file);
  await writeFile(`${directory}/recording.json`, JSON.stringify({ file, sha256: sha(await readFile(file)), testStatus: info.status,
    motion: "normal; continuous page visit, resting, sweep/reverse, per-item focus/close and return", observed: false,
    observationRequired: "Watch this recording; a passing test or a file hash is not a visual review." }, null, 2));
});

async function auditGroup(page: Page, info: TestInfo, group: Group, viewport: { name: string; width: number; height: number }) {
  const input = await readInputs(group);
  const directory = resolve(process.env.WARDROBE_PROVIDER_FULL_OUTPUT ?? "output/wardrobe-provider/inspection/full-groups", group, viewport.name);
  const withinOutput = relative(resolve("output"), directory);
  if (isAbsolute(withinOutput) || withinOutput.startsWith("..")) throw new Error("Evidence output must remain within output/");
  try { await access(directory); throw new Error(`Evidence directory already exists; choose a new run directory: ${directory}`); } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  await mkdir(directory, { recursive: true }); recordings.set(info.testId, directory);
  await page.setViewportSize(viewport);
  const fixture = await seedWardrobe(page, { readonly: true });
  // The visual fixture defaults to reduced motion; this recording verifies live transitions.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  fixture.summary.items = input.samples.map(value => value.item);
  fixture.summary.capabilities.preparationEnabled = false; fixture.summary.capabilities.staticTryOnEnabled = false;
  const blocked: string[] = [], writes: string[] = [];
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) { blocked.push(url.hostname); return route.abort("blockedbyclient"); }
    if (!["GET", "HEAD"].includes(request.method())) { writes.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 409 }); }
    return route.fallback();
  });
  const images = new Map(input.samples.flatMap(value => [...value.images.entries()]));
  await page.route("**/api/design-assets/*/content", route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    const bytes = images.get(id);
    return bytes ? route.fulfill({ contentType: "image/png", body: bytes }) : route.fulfill({ status: 404 });
  });
  await page.goto(`/${PROJECT}/studio?tab=presentation&mode=wardrobe`);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(false);
  const rack = page.getByRole("region", { name: "项目单品衣架" });
  await expect(rack).toBeVisible();
  const byItemId = new Map(input.samples.map(value => [value.item.id, value]));
  const covered = new Set<string>();
  const pages: unknown[] = [];
  const timeline: { phase: string; millisecondsFromNavigation: number; pageNumber: number; caseId?: string }[] = [];
  let pageNumber = 1;
  const mark = async (phase: string, caseId?: string) => {
    timeline.push({ phase, pageNumber, millisecondsFromNavigation: await page.evaluate(() => performance.now()), ...(caseId ? { caseId } : {}) });
  };
  for (;;) {
    await page.getByRole("searchbox", { name: "查找单品", exact: true }).focus();
    await page.mouse.move(0, 0); await loadImages(rack);
    const slots = rack.locator("[data-item-id]");
    const ids = await slots.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-item-id") ?? ""));
    expect(ids.length).toBeGreaterThan(0);
    await expect(rack.locator('[data-view="side"]')).toHaveCount(ids.length);
    await checkRailMounts(rack);
    const baseline = await Promise.all(ids.map(id => rackHitbox(rack.locator(`[data-item-id="${id}"]`))));
    await mark("rest");
    const restFile = `${directory}/page-${pageNumber}-rest.png`; await rack.screenshot({ path: restFile });
    // Interrupt transitions in both directions; do not wait for each sweep to finish.
    const sequence = [...ids, ...ids.slice().reverse()];
    await mark("sweep-forward-and-reverse");
    for (const id of sequence) {
      await rack.locator(`[data-item-id="${id}"]`).hover();
      await page.waitForTimeout(120);
      await checkRailMounts(rack);
    }
    await settle(rack);
    const reverseFile = `${directory}/page-${pageNumber}-after-reverse.png`; await rack.screenshot({ path: reverseFile });
    const captures: Captures[] = [], rows: unknown[] = [];
    let focusNavigation: unknown = null;
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index] ?? "", sample = byItemId.get(id);
      if (!sample) throw new Error(`Unexpected item on page: ${id}`);
      expect(covered.has(sample.id)).toBe(false); covered.add(sample.id);
      const slot = rack.locator(`[data-item-id="${id}"]`);
      await page.getByRole("searchbox", { name: "查找单品", exact: true }).focus(); await page.mouse.move(0, 0); await settle(rack);
      const sideGeometry = await measure(slot, sample.item.currentRevision, "side"); checkGeometry(sideGeometry, false);
      await slot.hover(); await settle(rack); await expect(slot.locator("[data-garment]")).toHaveAttribute("data-view", "front");
      await checkRailMounts(rack);
      const frontGeometry = await measure(slot, sample.item.currentRevision, "front"); checkGeometry(frontGeometry, true);
      const hitbox = await rackHitbox(slot), initial = baseline[index];
      expect(hitbox?.x).toBeCloseTo(initial?.x ?? NaN, 1); expect(hitbox?.width).toBeCloseTo(initial?.width ?? NaN, 1);
      const prefix = `${directory}/page-${pageNumber}-${sample.id}`;
      await mark("hover-front", sample.id);
      const hover = `${prefix}-hover.png`; await rack.screenshot({ path: hover });
      const scrollBeforeFocus = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
      await slot.click();
      await mark("focus-open", sample.id);
      const dialog = page.getByRole("dialog", { name: `单品：${sample.item.name}`, exact: true });
      await expect(dialog).toBeVisible(); await settle(dialog);
      if (index === 0) {
        const sourceIndex = input.samples.findIndex(value => value.id === sample.id);
        const delta = sourceIndex < input.samples.length - 1 ? 1 : -1;
        const target = input.samples[sourceIndex + delta];
        if (!target) throw new Error("A mixed group must have a focus navigation neighbor");
        await expect(dialog.locator("header")).toContainText(`${sourceIndex + 1} / ${input.samples.length}`);
        await dialog.getByRole("button", { name: delta === 1 ? "下一件单品" : "上一件单品", exact: true }).click();
        const neighborDialog = page.getByRole("dialog", { name: `单品：${target.item.name}`, exact: true });
        await expect(neighborDialog).toBeVisible(); await settle(neighborDialog);
        await expect(neighborDialog.getByRole("heading", { name: target.item.name, exact: true })).toBeVisible();
        await expect(neighborDialog.locator("header")).toContainText(`${sourceIndex + delta + 1} / ${input.samples.length}`);
        expect(await neighborDialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
        const navigationFile = `${prefix}-focus-navigation.png`; await neighborDialog.screenshot({ path: navigationFile });
        await mark("focus-neighbor", target.id);
        await neighborDialog.getByRole("button", { name: delta === 1 ? "上一件单品" : "下一件单品", exact: true }).click();
        await expect(dialog).toBeVisible(); await settle(dialog);
        await expect(dialog.locator("header")).toContainText(`${sourceIndex + 1} / ${input.samples.length}`);
        expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
        focusNavigation = { order: [sample.id, target.id, sample.id], direction: delta === 1 ? "next-previous" : "previous-next", focusContained: true, file: navigationFile };
      }
      const imageBounds = sample.item.currentRevision.imageBounds;
      if (!imageBounds) throw new Error("Missing confirmed front bounds");
      const focusBounds = await dialog.locator('[data-image-view="front"] img').evaluate((image, bounds) => {
        const box = image.getBoundingClientRect();
        return { top: box.top + box.height * bounds.y / bounds.height, bottom: box.top + box.height * (bounds.y + bounds.contentHeight) / bounds.height };
      }, imageBounds);
      const dialogBox = await dialog.boundingBox(); if (!dialogBox) throw new Error("Missing focus dialog");
      expect(focusBounds.top).toBeGreaterThanOrEqual(dialogBox.y + 24); expect(focusBounds.bottom).toBeLessThanOrEqual(dialogBox.y + dialogBox.height - 64);
      const hardwareBounds = await paintedHardwareBounds(dialog);
      const hardwareBottom = hardwareBounds.bottom;
      const titleBox = await dialog.getByRole("heading", { name: sample.item.name, exact: true }).boundingBox();
      if (!titleBox) throw new Error("Missing focus title");
      expect(titleBox.y, "聚焦标题必须在实际挂具及服装下方，并保留可读间隔").toBeGreaterThanOrEqual(Math.max(hardwareBottom, focusBounds.bottom) + 16);
      expect(hardwareBounds.left, "聚焦挂具左侧完整保留").toBeGreaterThanOrEqual(dialogBox.x + 16);
      expect(hardwareBounds.right, "聚焦挂具右侧完整保留").toBeLessThanOrEqual(dialogBox.x + dialogBox.width - 16);
      const focusClearance = { hardwareBounds, titleTop: titleBox.y, garmentBottom: focusBounds.bottom, minimumGap: titleBox.y - Math.max(hardwareBottom, focusBounds.bottom) };
      const focus = `${prefix}-focus.png`; await dialog.screenshot({ path: focus });
      await dialog.getByRole("button", { name: "返回衣架", exact: true }).click(); await expect(dialog).toHaveCount(0); await settle(rack);
      await mark("focus-closed", sample.id);
      await expect(slot).toBeFocused();
      const scrollAfterClose = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
      expect(scrollAfterClose.x).toBeCloseTo(scrollBeforeFocus.x, 0); expect(scrollAfterClose.y).toBeCloseTo(scrollBeforeFocus.y, 0);
      const focusedReturn = `${prefix}-closed-focused.png`; await rack.screenshot({ path: focusedReturn });
      await page.getByRole("searchbox", { name: "查找单品", exact: true }).focus(); await page.mouse.move(0, 0); await settle(rack);
      await expect(rack.locator('[data-view="side"]')).toHaveCount(ids.length);
      const returnedBox = await rackHitbox(slot);
      expect(returnedBox?.x).toBeCloseTo(initial?.x ?? NaN, 1); expect(returnedBox?.y).toBeCloseTo(initial?.y ?? NaN, 1);
      expect(await slots.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-item-id")))).toEqual(ids);
      const returned = `${prefix}-returned-side.png`; await rack.screenshot({ path: returned });
      await mark("returned-side", sample.id);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      captures.push({ id: sample.id, hover, focus, returned });
      rows.push({ id: sample.id, itemId: id, revisionId: sample.item.currentRevision.id,
        leftNeighbor: byItemId.get(ids[index - 1] ?? "")?.id ?? null,
        rightNeighbor: byItemId.get(ids[index + 1] ?? "")?.id ?? null,
        boundary: index === 0 && index === ids.length - 1 ? "single-page-both-edges" : index === 0 ? "left-page-edge" : index === ids.length - 1 ? "right-page-edge" : "both-neighbors",
        sideGeometry, frontGeometry, focusBounds, focusClearance, stableHitbox: true, pageAndFocusRestored: true, scrollBeforeFocus, scrollAfterClose,
        captures: { hover, focus, focusedReturn, returned }, visualDecision: "pending-actual-observation" });
    }
    const sheets = await contactSheets(page, directory, pageNumber, captures);
    pages.push({ pageNumber, visible: ids.map(id => byItemId.get(id)?.id), restFile, reverseFile, interruptedSweepOrder: sequence.map(id => byItemId.get(id)?.id), focusNavigation, contactSheets: sheets, items: rows });
    if (!(await rack.getByRole("button", { name: "下一组", exact: true }).isEnabled())) break;
    await rack.getByRole("button", { name: "下一组", exact: true }).click(); pageNumber++;
  }
  expect([...covered].sort()).toEqual([...GROUPS[group]].sort());
  expect(blocked).toEqual([]); expect(writes).toEqual([]); expect(fixture.requests.every(value => value.method === "GET")).toBe(true);
  const captures = await Promise.all((await readdir(directory)).filter(file => file.endsWith(".png")).sort().map(async filename => {
    const file = `${directory}/${filename}`;
    return { file, sha256: sha(await readFile(file)), visualDecision: "pending-actual-observation" };
  }));
  const report = { schemaVersion: 1, capturedAt: new Date().toISOString(), group, viewport, manifest: input.manifestFile, manifestSha256: input.manifestSha256,
    evidence: "Actual saved revisions and exact real PNGs rendered by production components in a read-only mocked project shell; no supplier or database writes.",
    inputs: input.samples.map(value => ({ id: value.id, itemId: value.item.id, revisionId: value.item.currentRevision.id,
      receipt: value.receipt, receiptSha256: value.receiptSha256, frontSha256: value.frontSha256, sideSha256: value.sideSha256,
      anchor: value.item.currentRevision.anchor, presentation: value.item.currentRevision.presentation })),
    coveredIds: [...covered], duplicateDesigns: 0, pages, captures, timeline,
    timelineOrigin: "Browser performance.now() since navigation. Recording begins earlier during context setup, so these are approximate navigation-relative review cues, not exact video frame timestamps.",
    blocked, writes, aiRequestsCreated: 0, providerCalls: 0,
    interactionMode: "Mouse state audit; 390px viewport covers narrow layout. True touch/no-hover interaction is covered separately by wardrobe-touch.spec.ts.",
    motion: "normal", recording: `${directory}/continuous.webm`, visualAcceptance: "pending independent observation of captures and recording" };
  await writeFile(`${directory}/coverage.json`, JSON.stringify(report, null, 2));
}

for (const group of Object.keys(GROUPS) as Group[]) {
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
    test.describe(`真实全矩阵混排 ${group} ${viewport.name}`, () => {
      test.use({ viewport });
      test("逐件邻接、反向、聚焦前后和返回", async ({ page }, info) => {
        test.skip(process.env.WARDROBE_PROVIDER_FULL_GROUPS !== "1", "只在29款已确认、显式启用完整混排验收时运行");
        test.setTimeout(600_000);
        await auditGroup(page, info, group, viewport);
      });
    });
  }
}
