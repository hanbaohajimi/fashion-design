import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import { inflateSync } from "node:zlib";
import { isAllowedLayerId, productionOptions, readProductionContext } from "./production-context.mjs";

/**
 * Real, lossless RGBA PNG -> layered PSD assembly. Does not draw, rig, export moc3,
 * approve artwork, or create placeholder layers. Lower `order` is farther back.
 *
 * node scripts/manual/forest-spirit/build-production-psd.mjs --stage production-p0
 *   --metadata output/forest-spirit-production-v2/body/metadata.json
 *   --metadata output/forest-spirit-production-v2/face/refinement-v2/metadata.json
 *
 * A head-stage manifest may contain explicitly temporary composite layers; output
 * is named head_stage_DIAGNOSTIC and can never pass the complete production gate.
 */
const { values } = parseArgs({ options: {
  ...productionOptions,
  metadata: { type: "string", multiple: true },
  stage: { type: "string" },
  revision: { type: "string", default: "v2" },
  toolchain: { type: "string", default: "output/live2d-proof-20261105" },
  profile: { type: "string", default: "C:/Windows/System32/spool/drivers/color/sRGB Color Space Profile.icm" },
} });
assert.ok(["head-stage", "production-p0"].includes(values.stage), "Pass --stage head-stage or --stage production-p0 explicitly");
assert.ok(values.metadata?.length, "Pass at least one --metadata <path>");
assert.ok(/^v[1-9][0-9]*$/u.test(values.revision), "Revision must be v1, v2, v3, etc.");
const { repo, specPath, specification, characterId, outputRoot: productionRoot, p0Layers } = await readProductionContext(values);
const psdDirectory = path.join(productionRoot, "psd");
const validationDirectory = path.join(productionRoot, "validation");
await mkdir(psdDirectory, { recursive: true });
await mkdir(validationDirectory, { recursive: true });
for (const directory of [psdDirectory, validationDirectory]) {
  assert.ok((await realpath(directory)).startsWith((await realpath(productionRoot)) + path.sep), "Output path must remain inside the production output directory");
}
const require = createRequire(path.join(path.resolve(repo, values.toolchain), "package.json"));
const { initializeCanvas, readPsd, writePsdBuffer } = require("ag-psd");
const { createCanvas, ImageData } = require("@napi-rs/canvas");
initializeCanvas((width, height) => createCanvas(width, height), (width, height) => new ImageData(width, height));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const stableLayerId = name => Number.parseInt(digest(Buffer.from(name, "utf8")).slice(0, 8), 16) & 0x7fffffff;
const expected = new Map(p0Layers.map(layer => [layer.id, layer]));
const [width, height] = specification.working_canvas;
const manifests = [];
const layers = [];
for (const filename of values.metadata) {
  const absolute = path.resolve(repo, filename);
  const bytes = await readFile(absolute);
  const metadata = JSON.parse(bytes.toString("utf8"));
  assert.equal(metadata.schemaVersion, 1, `${filename}: schemaVersion`);
  assert.equal(metadata.characterId, characterId, `${filename}: characterId`);
  assert.deepEqual(metadata.canvas, { width, height }, `${filename}: aligned canvas must match approved master`);
  assert.ok(Array.isArray(metadata.layers) && metadata.layers.length, `${filename}: no pixel layers`);
  if (values.stage === "production-p0") assert.equal(metadata.stage, "production-p0", `${filename}: diagnostic layers cannot enter production PSD`);
  manifests.push({ path: absolute, sha256: digest(bytes), status: metadata.status ?? "not_provided", stage: metadata.stage });
  for (const layer of metadata.layers) {
    assert.ok(isAllowedLayerId(layer.id, values.stage, layer.temporary), "Use stable ASCII layer IDs; __TEMP_ is diagnostic-only and must be declared temporary");
    assert.ok(typeof layer.group === "string" && layer.group.length, `${layer.id}: group missing`);
    assert.ok(typeof layer.path === "string" && layer.path.endsWith(".png"), `${layer.id}: PNG path missing`);
    assert.ok(Number.isFinite(layer.order), `${layer.id}: explicit numeric back-to-front order required`);
    const visible = layer.visible ?? !/Closed/iu.test(layer.id);
    const opacity = layer.opacity ?? 1;
    assert.equal(typeof visible, "boolean", `${layer.id}: visible must be boolean`);
    assert.ok(typeof opacity === "number" && opacity > 0 && opacity <= 1, `${layer.id}: opacity must be >0 and <=1`);
    if (/Closed/iu.test(layer.id)) assert.equal(visible, false, `${layer.id}: neutral PSD must hide closed-eye layers`);
    if (values.stage === "production-p0") {
      assert.ok(expected.has(layer.id), `${layer.id}: not a P0 production part`);
      if (layer.group !== expected.get(layer.id).group) assert.ok(typeof layer.groupOverrideReason === "string" && layer.groupOverrideReason.trim().length, `${layer.id}: a changed part group requires an explicit occlusion/hierarchy reason`);
      assert.ok(!layer.temporary && !layer.reference && !layer.placeholder, `${layer.id}: temporary/reference/placeholder layer is forbidden`);
    } else if (!expected.has(layer.id)) {
      assert.equal(layer.temporary, true, `${layer.id}: an unplanned diagnostic composite must be explicitly temporary`);
    }
    layers.push({ ...layer, visible, opacity, absolute: path.resolve(path.dirname(absolute), layer.path), metadataPath: absolute });
  }
}
layers.sort((a, b) => a.order - b.order);
assert.equal(new Set(layers.map(layer => layer.id)).size, layers.length, "Duplicate layer IDs across manifests");
assert.equal(new Set(layers.map(layer => layer.order)).size, layers.length, "Duplicate stacking orders across manifests");
if (values.stage === "production-p0") {
  assert.equal(layers.length, expected.size, `Production requires exactly ${expected.size} real P0 layers`);
  assert.deepEqual([...layers.map(layer => layer.id)].sort(), [...expected.keys()].sort(), "Production layer IDs differ from approved specification");
}
const groups = [];
for (const layer of layers) {
  if (groups.at(-1) !== layer.group) {
    assert.ok(!groups.includes(layer.group), `Group ${layer.group} is non-contiguous: cannot preserve stacking with one PSD folder per group`);
    groups.push(layer.group);
  }
}
// The user activated the official PRO trial. Keep semantic grouping/occlusion
// correct; do not force the earlier FREE planning budget onto the actual PSD.

// Decode PNG channels directly. A canvas round-trip would premultiply alpha and
// slightly change original RGB values around fine hair/lace transparency.
function decodeRgbaPng(bytes, name) {
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${name}: invalid PNG signature`);
  let pngWidth, pngHeight;
  const idat = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    assert.ok(offset + length + 12 <= bytes.length, `${name}: truncated PNG chunk`);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      pngWidth = data.readUInt32BE(0); pngHeight = data.readUInt32BE(4);
      assert.equal(data[8], 8, `${name}: require 8-bit PNG`);
      assert.equal(data[9], 6, `${name}: require true RGBA PNG, not indexed or RGB-only`);
      assert.equal(data[10], 0); assert.equal(data[11], 0); assert.equal(data[12], 0, `${name}: interlaced PNG not accepted`);
    } else if (type === "IDAT") idat.push(data);
    offset += length + 12;
    if (type === "IEND") break;
  }
  assert.deepEqual([pngWidth, pngHeight], [width, height], `${name}: part canvas differs from master`);
  const stride = width * 4;
  const inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  assert.equal(inflated.length, (stride + 1) * height, `${name}: wrong scanline data length`);
  const pixels = new Uint8ClampedArray(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const input = y * (stride + 1), output = y * stride, filter = inflated[input];
    assert.ok(filter <= 4, `${name}: invalid PNG filter`);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[output + x - 4] : 0;
      const above = y ? pixels[output + x - stride] : 0;
      const upperLeft = y && x >= 4 ? pixels[output + x - stride - 4] : 0;
      const predictor = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : 0;
      pixels[output + x] = (inflated[input + x + 1] + predictor) & 255;
    }
  }
  return { width, height, data: pixels };
}

const composite = new Uint8ClampedArray(width * height * 4);
const childrenByGroup = new Map(groups.map(group => [group, []]));
const sourceLayers = [];
for (const layer of layers) {
  const bytes = await readFile(layer.absolute);
  const imageData = decodeRgbaPng(bytes, layer.id);
  const pixels = imageData.data;
  let opaquePixels = 0, partialAlphaPixels = 0, left = width, right = -1, top = height, bottom = -1;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (!alpha) continue;
    opaquePixels++; if (alpha < 255) partialAlphaPixels++;
    const position = i / 4, x = position % width, y = Math.floor(position / width);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    if (!layer.visible) continue;
    const sourceAlpha = alpha / 255 * layer.opacity, destinationAlpha = composite[i + 3] / 255;
    const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    for (let channel = 0; channel < 3; channel++) composite[i + channel] = Math.round((pixels[i + channel] * sourceAlpha + composite[i + channel] * destinationAlpha * (1 - sourceAlpha)) / outAlpha);
    composite[i + 3] = Math.round(outAlpha * 255);
  }
  assert.ok(opaquePixels > 0, `${layer.id}: empty/placeholder pixel layer`);
  // Cubism 5.3's actual import interprets serialized layer records back-to-front.
  // ag-psd's README describes children differently; real Editor import is decisive.
  childrenByGroup.get(layer.group).push({ id: stableLayerId(`layer:${layer.id}`), name: layer.id, left: 0, top: 0, opacity: layer.opacity, hidden: !layer.visible, blendMode: "normal", imageData });
  sourceLayers.push({ id: layer.id, group: layer.group, originalPlannedGroup: expected.get(layer.id)?.group ?? null, groupOverrideReason: layer.groupOverrideReason ?? null, order: layer.order, visible: layer.visible, opacity: layer.opacity, temporary: Boolean(layer.temporary), source: layer.absolute, pngSha256: digest(bytes), rgbaSha256: digest(pixels), width, height, nonzeroAlphaPixels: opaquePixels, partialAlphaPixels, alphaBounds: { left, top, right: right + 1, bottom: bottom + 1 }, sourceMetadata: layer.metadataPath, sourceVisiblePath: layer.sourceVisiblePath ?? layer.originalVisiblePath ?? null, separateMaskEvidence: layer.neutralMask ?? null, maskAppliedToPsd: false, artReviewStatus: layer.status ?? "pending_pose_and_visual_review" });
}
const masterPath = path.resolve(path.dirname(specPath), specification.source_master);
const masterBytes = await readFile(masterPath);
if (specification.source_sha256) assert.equal(digest(masterBytes), specification.source_sha256, "Approved master hash differs from specification");
const masterPixels = decodeRgbaPng(masterBytes, "approved master comparison").data;
let changedRgbaPixels = 0, originalVisiblePixels = 0, extraSilhouettePixels = 0, absoluteRgbDifference = 0;
const maximumChannelDifference = [0, 0, 0, 0];
for (let index = 0; index < composite.length; index += 4) {
  let changed = false;
  if (masterPixels[index + 3] > 0) originalVisiblePixels++;
  if (!masterPixels[index + 3] && composite[index + 3]) extraSilhouettePixels++;
  for (let channel = 0; channel < 4; channel++) {
    const difference = Math.abs(masterPixels[index + channel] - composite[index + channel]);
    maximumChannelDifference[channel] = Math.max(maximumChannelDifference[channel], difference);
    if (difference) changed = true;
    if (channel < 3 && masterPixels[index + 3] > 0) absoluteRgbDifference += difference;
  }
  if (changed) changedRgbaPixels++;
}
const neutralDifference = { sourceMaster: masterPath, sourceMasterSha256: digest(masterBytes), comparison: "straight RGBA channels; transparent RGB differences also counted", changedRgbaPixels, totalPixels: width * height, maximumChannelDifferenceRGBA: maximumChannelDifference, meanAbsoluteRgbDifferenceOnOriginalVisiblePixels: absoluteRgbDifference / Math.max(1, originalVisiblePixels * 3), extraNonzeroAlphaPixelsOutsideOriginalSilhouette: extraSilhouettePixels, exactMasterMatch: changedRgbaPixels === 0, visualAcceptance: "pending_human_review_not_inferred_from_metrics" };
const profile = await readFile(path.resolve(values.profile));
const document = {
  width, height, bitsPerChannel: 8, colorMode: 3, channels: 4,
  imageData: { width, height, data: composite },
  imageResources: { iccProfile: new Uint8Array(profile), resolutionInfo: { horizontalResolution: 72, verticalResolution: 72, horizontalResolutionUnit: "PPI", verticalResolutionUnit: "PPI", widthUnit: "Inches", heightUnit: "Inches" } },
  children: groups.map(name => ({ id: stableLayerId(`group:${name}`), name, opened: true, blendMode: "pass through", opacity: 1, children: childrenByGroup.get(name) })),
};
const psdBytes = writePsdBuffer(document, { generateThumbnail: false, trimImageData: false });
const stem = values.stage === "head-stage" ? `forest_spirit_head_stage_DIAGNOSTIC_${values.revision}` : "forest_spirit";
const filenames = values.stage === "head-stage" ? [`${stem}.psd`] : [`${stem}_separation.psd`, `${stem}_import.psd`];
for (const filename of filenames) await writeFile(path.join(psdDirectory, filename), psdBytes);
// Read actual bytes from the delivered file rather than relying on the in-memory PSD object.
const decoded = readPsd(await readFile(path.join(psdDirectory, filenames[0])), { useImageData: true, skipThumbnail: true, skipCompositeImageData: true, throwForMissingFeatures: true });
assert.deepEqual([decoded.width, decoded.height, decoded.bitsPerChannel, decoded.colorMode], [width, height, 8, 3], "PSD document format changed during write/readback");
assert.deepEqual(decoded.children.map(group => group.name), groups, "Serialized PSD group order changed");
const leaves = decoded.children.flatMap(group => group.children.map(layer => ({ group: group.name, layer })));
assert.equal(leaves.length, sourceLayers.length, "PSD leaf layer count changed");
assert.deepEqual(leaves.map(({ layer }) => layer.name), sourceLayers.map(layer => layer.id), "Serialized PSD layer order changed");
const readbackLayers = [];
for (const { group, layer } of leaves) {
  const source = sourceLayers.find(item => item.id === layer.name);
  assert.ok(source, `Unexpected PSD layer ${layer.name}`);
  assert.equal(group, source.group);
  assert.equal(layer.id, stableLayerId(`layer:${source.id}`), `${layer.name}: stable PSD layer ID changed`);
  assert.deepEqual([layer.left, layer.top, layer.imageData?.width, layer.imageData?.height], [0, 0, width, height], `${layer.name}: alignment changed`);
  assert.equal(Boolean(layer.hidden), !source.visible, `${layer.name}: visibility changed`);
  assert.ok(Math.abs(layer.opacity - source.opacity) <= 1 / 255, `${layer.name}: opacity changed`);
  const rgbaSha256 = digest(layer.imageData.data);
  assert.equal(rgbaSha256, source.rgbaSha256, `${layer.name}: pixel data changed during PSD assembly`);
  readbackLayers.push({ id: layer.name, group, rgbaSha256, exactRgbaMatch: true, aligned: true, visibilityMatches: true });
}
assert.equal(digest(decoded.imageResources.iccProfile), digest(profile), "Embedded sRGB profile changed");
const preview = createCanvas(width, height);
preview.getContext("2d").putImageData(new ImageData(composite, width, height), 0, 0);
const previewPath = path.join(validationDirectory, `${stem}_neutral_composite.png`);
await writeFile(previewPath, preview.toBuffer("image/png"));
const report = {
  schemaVersion: 1, characterId, stage: values.stage, specification: specPath,
  status: "real_layered_psd_structural_validation_passed_art_and_rig_review_not_implied",
  generatedAt: new Date().toISOString(), canvas: { width, height }, colorMode: "RGB", bitsPerChannel: 8,
  srgbProfile: { path: path.resolve(values.profile), sha256: digest(profile), embedded: true },
  layerCount: layers.length, folderCount: groups.length, containsTemporaryComposites: layers.some(layer => layer.temporary),
  editorLicenseContext: "User-activated official PRO trial; no artificial folder-count budget applied",
  expectedP0Count: expected.size, allP0PartsPresent: values.stage === "production-p0", noBlankLayers: true,
  serializedStackOrder: "back-to-front to match actual Cubism 5.3 import",
  expectedCubismFrontToBackGroups: [...groups].reverse(),
  expectedCubismFrontToBackLayers: [...layers].reverse().map(layer => layer.id),
  cubismImportVisualOrderConfirmed: false,
  sourceManifests: manifests, layers: sourceLayers, readback: { allExactRgbaMatches: true, layers: readbackLayers },
  files: filenames.map(filename => ({ path: path.join(psdDirectory, filename), bytes: psdBytes.length, sha256: digest(psdBytes) })),
  neutralPreview: previewPath,
  neutralDifference,
  limitations: ["Pixel/structure round-trip validation is not visual or pose acceptance. Actual Cubism import must confirm layer stacking.", "The first historical v2 head-stage PSD passed pixel readback but failed actual Cubism stacking. Serialization was corrected using actual Editor evidence; the failed artifact remains preserved.", "No cmo3/can3/moc3/model3/physics/motion is produced by this script.", "Production separation and import PSD contain identical real patched layer data for different workflow roles; no guide/reference or empty layers are added.", "Source-visible PNGs and neutral masks remain separate audit evidence; masks are not applied to the PSDs. Patched neutral composition can differ from the approved source and must be reviewed.", ...(values.stage === "head-stage" ? [`This head-stage PSD includes only a diagnostic subset and may include declared temporary composites. It is not the full ${expected.size}-part import PSD.`] : [])],
};
await writeFile(path.join(validationDirectory, `${stem}_psd_readback.json`), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ stage: values.stage, layers: layers.length, folders: groups.length, exactRgbaReadback: true, files: report.files, report: path.join(validationDirectory, `${stem}_psd_readback.json`) }, null, 2));
