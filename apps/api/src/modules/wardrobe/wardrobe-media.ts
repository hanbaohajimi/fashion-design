import { BadRequestException } from "@nestjs/common";
import type { WardrobeCategory, WardrobeImageBounds } from "@fashion/shared";
import { inspectMaskedRgbInterior } from "@fashion/ai";
import sharp from "sharp";
import type { S3FileStorage } from "../files/storage.service";

const MAX_BYTES = 20 * 1024 * 1024;
export const CORRECTION_GUIDE_ALGORITHM = "masked-interior-magenta-guide-v1";

/** Spatial reference only: never used as the editable original or as a display candidate. */
export async function createCorrectionSelectionGuide(
  source: Buffer,
  mask: Buffer,
) {
  const decoded = await Promise.all(
    [source, mask].map(async (bytes) => {
      const { data, info } = await sharp(bytes, { limitInputPixels: 4_194_304 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    }),
  );
  const original = decoded[0];
  const selection = decoded[1];
  if (!original || !selection)
    throw new BadRequestException("缺少选区指引来源");
  const { eligible, stats } = inspectMaskedRgbInterior({
    source: original,
    mask: selection,
  });
  if (!stats.editablePixels)
    throw new BadRequestException("所选区域没有可修正的衣料内部像素");
  const rgba = Buffer.from(original.data);
  for (let pixel = 0; pixel < eligible.length; pixel++) {
    if (!eligible[pixel]) continue;
    const offset = pixel * 4;
    const weight = 0.45 * (1 - (selection.data[offset + 3] ?? 255) / 255);
    for (let channel = 0; channel < 3; channel++) {
      const tint = channel === 1 ? 0 : 255;
      rgba[offset + channel] = Math.round(
        (original.data[offset + channel] ?? 0) * (1 - weight) + tint * weight,
      );
    }
  }
  return {
    bytes: await sharp(rgba, {
      raw: { width: original.width, height: original.height, channels: 4 },
    })
      .png()
      .toBuffer(),
    algorithm: CORRECTION_GUIDE_ALGORITHM,
    opacity: 0.45,
    color: "#ff00ff",
    stats,
  };
}
export async function readWardrobeImage(
  storage: S3FileStorage,
  url: string,
): Promise<Buffer> {
  if (!url.startsWith("s3://"))
    throw new BadRequestException("单品素材必须位于项目私有存储中");
  const key = url.slice(5);
  const head = await storage.head(key);
  if (head.contentLength <= 0 || head.contentLength > MAX_BYTES)
    throw new BadRequestException("单品素材大小需在 20 MB 以内");
  const bytes = Buffer.from(await storage.readPrefix(key, head.contentLength));
  if (bytes.length !== head.contentLength)
    throw new BadRequestException("单品素材读取不完整");
  try {
    const metadata = await sharp(bytes, {
      limitInputPixels: 33_554_432,
    }).metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      !["png", "jpeg", "webp"].includes(metadata.format ?? "")
    )
      throw new Error("format");
  } catch {
    throw new BadRequestException(
      "单品素材必须是可读取的 PNG、JPEG 或 WebP 图片",
    );
  }
  return bytes;
}

export async function assertTransparentGarment(
  bytes: Buffer,
): Promise<WardrobeImageBounds> {
  const image = sharp(bytes, { limitInputPixels: 33_554_432 });
  const metadata = await image.metadata();
  const invalid = () =>
    new BadRequestException(
      "陈列素材需保留服装主体和有效透明背景，请先去背景或重新准备候选",
    );
  if (!metadata.hasAlpha) throw invalid();
  // Decode only alpha: do not allocate a full RGBA image or alter the source bytes.
  const { data, info } = await image
    .extractChannel("alpha")
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  let minAlpha = 255;
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[y * info.width + x] ?? 0;
      if (alpha < minAlpha) minAlpha = alpha;
      if (alpha > 16) {
        if (x < left) left = x;
        if (y < top) top = y;
        if (x > right) right = x;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (minAlpha === 255 || right < left || bottom < top) throw invalid();
  return {
    width: info.width,
    height: info.height,
    x: left,
    y: top,
    contentWidth: right - left + 1,
    contentHeight: bottom - top + 1,
  };
}

export async function cropWardrobeImage(
  bytes: Buffer,
  region: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  const rotated = await sharp(bytes).rotate().png().toBuffer();
  const meta = await sharp(rotated).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) throw new BadRequestException("图片缺少可用尺寸");
  const left = Math.min(width - 1, Math.floor(region.x * width));
  const top = Math.min(height - 1, Math.floor(region.y * height));
  return sharp(rotated)
    .extract({
      left,
      top,
      width: Math.max(
        1,
        Math.min(width - left, Math.round(region.width * width)),
      ),
      height: Math.max(
        1,
        Math.min(height - top, Math.round(region.height * height)),
      ),
    })
    .png()
    .toBuffer();
}

export const OUTFIT_REFERENCE_LAYOUT = "body-regions-v1";
const BODY_REGION: Record<WardrobeCategory, number> = {
  hat: 0,
  scarf: 0,
  top: 1,
  outerwear: 1,
  onepiece: 2,
  bottom: 3,
  belt: 3,
  shoes: 4,
  bag: 5,
  accessory: 5,
};

/** Separate, uncropped garments grouped by body region, never a dressed human. */
export async function composeOutfitReference(
  images: { bytes: Buffer; category: WardrobeCategory; layer: number }[],
): Promise<Buffer> {
  if (!images.length || images.length > 12)
    throw new BadRequestException("搭配参考图需要 1 至 12 件已确认单品");
  const columns = Math.min(4, images.length);
  // Head/neck, upper body, full body, waist/legs, feet, then carried/other items.
  // Unknown accessories remain separate rather than guessing where they are worn.
  const groups = Array.from({ length: 6 }, (_, region) =>
    images
      .filter((image) => BODY_REGION[image.category] === region)
      .sort((first, second) => first.layer - second.layer),
  ).filter((group) => group.length);
  const rows = groups.reduce(
    (total, group) => total + Math.ceil(group.length / columns),
    0,
  );
  // Twelve RGBA tiles remain below the realtime adapter's default 5 MiB input cap.
  const size = 320;
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  let rowOffset = 0;
  for (const group of groups) {
    for (const [index, input] of group.entries()) {
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, group.length - row * columns);
      tiles.push({
        input: await sharp(input.bytes)
          .rotate()
          .resize(size - 32, size - 32, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer(),
        left:
          Math.floor(((columns - rowCount) * size) / 2) +
          (index % columns) * size +
          16,
        top: (rowOffset + row) * size + 16,
      });
    }
    rowOffset += Math.ceil(group.length / columns);
  }
  return sharp({
    create: {
      width: columns * size,
      height: rows * size,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite(tiles)
    .png()
    .toBuffer();
}
