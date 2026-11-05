import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";

// Diagnostic output only. Never publish, confirm, or overwrite provider input.
// All RGB remains from the original; the API probe proposes alpha in the mask.
const root = resolve(import.meta.dirname, "../..");
const sharp = createRequire(resolve(root, "apps/api/package.json"))("sharp");
const [originalArg, probeArg, maskArg, destinationArg] = process.argv.slice(2);
if (!originalArg || !probeArg || !maskArg || !destinationArg) {
  throw new Error("Usage: node scripts/manual/diagnose-wardrobe-material-alpha.mjs original.png probe.png mask.png output/directory");
}
const destination = resolve(root, destinationArg);
if (!destination.startsWith(`${resolve(root, "output")}/`) && !destination.startsWith(`${resolve(root, "output")}\\`)) {
  throw new Error("Diagnostics must be written under the ignored output directory");
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const inputs = await Promise.all([originalArg, probeArg, maskArg].map(async (arg) => {
  const path = resolve(root, arg);
  const bytes = readFileSync(path);
  const image = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { path, sha256: hash(bytes), ...image };
}));
const [original, probe, mask] = inputs;
const { width, height, channels } = original.info;
if (inputs.some((input) => input.info.width !== width || input.info.height !== height || input.info.channels !== channels)) {
  throw new Error("Source, probe, and mask must have identical RGBA dimensions");
}
if (width !== 1024 || height !== 1536) {
  throw new Error("This unaccepted diagnostic uses the audited 1024x1536 lace sleeve ROI only");
}
mkdirSync(destination, { recursive: true });
const blurred = await sharp(original.data, { raw: original.info }).blur(1).raw().toBuffer();
const luminance = (buffer, offset) => buffer[offset] * 0.2126 + buffer[offset + 1] * 0.7152 + buffer[offset + 2] * 0.0722;
const reports = [];
for (const detailGain of [0, 6, 12, 20]) {
  const output = Buffer.from(original.data);
  let protectedChanged = 0;
  let changed = 0;
  for (let offset = 0; offset < output.length; offset += 4) {
    const editable = 1 - mask.data[offset + 3] / 255;
    if (editable === 0) continue;
    const redBlue = Math.max(probe.data[offset], probe.data[offset + 2]);
    const green = probe.data[offset + 1];
    const estimated = green > redBlue ? redBlue / green : 1;
    // Experimental: preserve only bright high-frequency source threads that
    // a generated key may have erased. This is not an accepted product method.
    const detail = Math.min(1, Math.max(0, luminance(original.data, offset) - luminance(blurred, offset) - 2) * detailGain / 255);
    const alpha = Math.max(estimated, detail) * original.data[offset + 3];
    output[offset + 3] = Math.round(original.data[offset + 3] * (1 - editable) + alpha * editable);
    if (output[offset + 3] !== original.data[offset + 3]) changed++;
  }
  for (let offset = 0; offset < output.length; offset += 4) {
    if (mask.data[offset + 3] === 255 && !output.subarray(offset, offset + 4).equals(original.data.subarray(offset, offset + 4))) protectedChanged++;
  }
  const name = detailGain ? `source-thread-detail-${detailGain}` : "original-rgb-derived-alpha";
  if (inputs.some((input) => input.path === resolve(destination, `${name}.png`))) {
    throw new Error("Diagnostic output cannot overwrite an input image");
  }
  const png = await sharp(output, { raw: original.info }).png().toBuffer();
  writeFileSync(resolve(destination, `${name}.png`), png);
  const tiles = await Promise.all(["#ffffff", "#e5e2e4", "#25292d"].map((background) => sharp(png).flatten({ background }).resize(512, 768, { fit: "contain", background }).png().toBuffer()));
  await sharp({ create: { width: 1536, height: 768, channels: 3, background: "#ffffff" } }).composite(tiles.map((input, index) => ({ input, left: index * 512, top: 0 }))).png().toFile(resolve(destination, `${name}-backgrounds.png`));
  await sharp(png).flatten({ background: "#25292d" }).extract({ left: 130, top: 560, width: 150, height: 260 }).resize(600, 1040).png().toFile(resolve(destination, `${name}-sleeve-detail.png`));
  reports.push({ name, sha256: hash(png), detailGain, changedAlphaPixels: changed, protectedChanged, allOriginalRgbPreserved: true });
}
writeFileSync(resolve(destination, "diagnostic.json"), JSON.stringify({ kind: "algorithm-derived-diagnostic-not-provider-raw", approved: false, method: "masked-green-dominance-original-rgb-with-experimental-source-high-frequency-detail", sourceInputs: inputs.map(({ path, sha256 }) => ({ path: relative(root, path), sha256 })), width, height, reports }, null, 2) + "\n");
console.log(relative(root, dirname(resolve(destination, "diagnostic.json"))));
