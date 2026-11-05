import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Inspection only: original provider bytes and approved project assets are never modified.
const root = resolve(import.meta.dirname, "../..");
const sharp = createRequire(resolve(root, "apps/api/package.json"))("sharp");
const manifestFile = resolve(process.argv[2] ?? "output/wardrobe-provider/manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const views = manifest.items.flatMap(item => [item, ...(item.sideDisplay?.file ? [{ ...item, id: `${item.id}/side`, file: item.sideDisplay.file }] : [])]);
for (const item of views) {
  const original = readFileSync(item.file);
  const meta = await sharp(original).metadata();
  const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = { transparent: 0, faint: 0, translucent: 0, opaque: 0 };
  for (let offset = 3; offset < data.length; offset += 4) {
    const alpha = data[offset];
    counts[alpha === 0 ? "transparent" : alpha <= 16 ? "faint" : alpha < 250 ? "translucent" : "opaque"]++;
  }
  const target = resolve(dirname(manifestFile), "inspection", item.id);
  mkdirSync(target, { recursive: true });
  const tiles = await Promise.all(["#ffffff", "#e5e2e4", "#252525"].map(background => sharp(original).flatten({ background }).resize(512, 768, { fit: "contain", background }).png().toBuffer()));
  await sharp({ create: { width: 1536, height: 768, channels: 3, background: "#ffffff" } })
    .composite(tiles.map((input, index) => ({ input, left: index * 512, top: 0 }))).png().toFile(resolve(target, "backgrounds.png"));
  await sharp(original).ensureAlpha().extractChannel("alpha").resize(512, 768, { fit: "contain", background: "#000000" }).png().toFile(resolve(target, "alpha.png"));
  writeFileSync(resolve(target, "pixels.json"), JSON.stringify({ source: item.file, originalUnchanged: true, width: meta.width, height: meta.height, pixels: info.width * info.height, counts }, null, 2) + "\n", "utf8");
  console.log(`${item.id}: ${target}`);
}
