import type { AiGenerationRequest } from "@fashion/ai";
import { imageAnnotationsSvg, imageOutpaintSchema } from "@fashion/shared";
import sharp from "sharp";
import type { ThumbnailStorage } from "../storage";

const IMAGE_DECODE_OPTIONS = {
  failOn: "error",
  limitInputPixels: 40_000_000,
} as const;

export class ImageEditValidationError extends Error {
  constructor(
    readonly code: "IMAGE_EDIT_INVALID_INPUT" | "IMAGE_EDIT_INVALID_RESULT",
    message: string,
  ) {
    super(message);
    this.name = "ImageEditValidationError";
  }
}

/** Source and selection are aligned in upright source coordinates, before submission. */
export async function prepareInpaintInputs(source: Buffer, mask: Buffer) {
  try {
    const original = await sharp(source, IMAGE_DECODE_OPTIONS).rotate().toColourspace("srgb").ensureAlpha().png().toBuffer();
    const selection = await sharp(mask, IMAGE_DECODE_OPTIONS).metadata();
    if (!selection.hasAlpha) throw new Error("蒙版需要透明通道，透明区域才会重绘");
    const normalizedMask = await sharp(mask, IMAGE_DECODE_OPTIONS).rotate().toColourspace("srgb").ensureAlpha().png().toBuffer();
    const [size, maskSize, stats] = await Promise.all([
      sharp(original).metadata(), sharp(normalizedMask).metadata(), sharp(normalizedMask).stats(),
    ]);
    if (size.width !== maskSize.width || size.height !== maskSize.height)
      throw new Error("蒙版尺寸与原图不一致，请重新选择修改区域");
    if ((stats.channels.at(-1)?.min ?? 255) === 255)
      throw new Error("还没有选择需要修改的区域");
    if (normalizedMask.length >= 4 * 1024 * 1024) throw new Error("局部编辑蒙版超过 4MB，请缩小选择范围");
    return { source: original, mask: normalizedMask };
  } catch (error) {
    const authored = error instanceof Error && /^(蒙版|还没有|局部编辑)/u.test(error.message);
    throw new ImageEditValidationError("IMAGE_EDIT_INVALID_INPUT", authored ? error.message : "无法读取局部编辑原图或蒙版，请重新选择图片");
  }
}

export function imageEditTemporaryKeys(taskId: string, request: AiGenerationRequest): string[] {
  const prefix = `image-edit/${taskId}`;
  if (request.imageEdit?.intent === "outpaint") return [`${prefix}/mask.png`, `${prefix}/input.png`];
  if (request.taskType === "inpaint") return [`${prefix}/inpaint-source.png`, `${prefix}/inpaint-mask.png`];
  if (request.imageEdit?.intent === "feedback") return [`${prefix}/annotations.png`];
  return [];
}

function outpaintFrame(
  request: AiGenerationRequest,
  width: number,
  height: number,
) {
  const parsed = imageOutpaintSchema.safeParse(request.imageEdit?.outpaint);
  if (!parsed.success)
    throw new ImageEditValidationError(
      "IMAGE_EDIT_INVALID_INPUT",
      "扩图范围无效，请重新选择画布尺寸",
    );
  const frame = parsed.data;
  if (
    frame.left + width > frame.width ||
    frame.top + height > frame.height ||
    (width === frame.width && height === frame.height)
  )
    throw new ImageEditValidationError(
      "IMAGE_EDIT_INVALID_INPUT",
      "扩展画布必须完整包含原图并增加画面区域",
    );
  return frame;
}

export async function prepareImageEdit(
  request: AiGenerationRequest,
  source: Buffer,
  taskId: string,
  storage: ThumbnailStorage,
  beforeWrite: () => Promise<void> = async () => {},
): Promise<AiGenerationRequest> {
  if (!request.imageEdit || !storage.downloadUrl)
    throw new Error("图片编辑存储未配置");
  let image: Buffer;
  const sourcePng = await sharp(source, IMAGE_DECODE_OPTIONS)
    .rotate()
    .png()
    .toBuffer();
  const size = await sharp(sourcePng).metadata();
  const width = size.width;
  const height = size.height;
  if (!width || !height) throw new Error("无法读取图片尺寸");
  const prefix = `image-edit/${taskId}`;
  if (request.imageEdit.intent === "outpaint") {
    const outpaint = outpaintFrame(request, width, height);
    image = await sharp({
      create: {
        width: outpaint.width,
        height: outpaint.height,
        channels: 4,
        background: "#ffffff",
      },
    })
      .composite([{ input: sourcePng, left: outpaint.left, top: outpaint.top }])
      .png()
      .toBuffer();
    const protectedRegion = await sharp({
      create: { width, height, channels: 4, background: "#000000" },
    })
      .png()
      .toBuffer();
    const mask = await sharp({
      create: {
        width: outpaint.width,
        height: outpaint.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: protectedRegion, left: outpaint.left, top: outpaint.top },
      ])
      .png()
      .toBuffer();
    if (mask.length >= 4 * 1024 * 1024) throw new Error("扩图蒙版超过 4MB");
    await beforeWrite();
    await storage.put(`${prefix}/mask.png`, mask, "image/png");
    await beforeWrite();
    await storage.put(`${prefix}/input.png`, image, "image/png");
    const expandedSourceUrl = await storage.downloadUrl(`${prefix}/input.png`);
    return {
      ...request,
      taskType: "inpaint",
      referenceImageUrl: expandedSourceUrl,
      ...(request.referenceImageUrls ? {
        referenceImageUrls: [expandedSourceUrl, ...request.referenceImageUrls.filter(url => url !== request.referenceImageUrl)],
      } : {}),
      ...(request.referenceImages ? {
        referenceImages: request.referenceImages.map(reference => reference.url === request.referenceImageUrl
          ? { ...reference, url: expandedSourceUrl } : reference),
      } : {}),
      maskImageUrl: await storage.downloadUrl(`${prefix}/mask.png`),
      width: outpaint.width,
      height: outpaint.height,
    };
  }
  if (request.taskType !== "i2i") throw new Error("意见修改必须使用图片编辑");
  const references = request.referenceImages?.length
    ? [...request.referenceImages].sort((a, b) => a.order - b.order).filter(item => item.url !== request.referenceImageUrl)
    : (request.referenceImageUrls ?? []).filter(url => url !== request.referenceImageUrl).map((url, order) => ({ url, order, role: "style_ref" as const, weight: 1 }));
  if (references.length > 14) throw new ImageEditValidationError("IMAGE_EDIT_INVALID_INPUT", "意见修改最多附加 14 张参考图，请减少参考后重试");
  image = await sharp(sourcePng)
    .composite([
      {
        input: Buffer.from(
          imageAnnotationsSvg(
            request.imageEdit.annotations ?? [],
            width,
            height,
            request.imageEdit.markers ?? [],
          ),
        ),
      },
    ])
    .png()
    .toBuffer();
  await beforeWrite();
  await storage.put(`${prefix}/annotations.png`, image, "image/png");
  const markedUrl = await storage.downloadUrl(`${prefix}/annotations.png`);
  return {
    ...request,
    referenceImageUrls: [
      request.referenceImageUrl,
      markedUrl,
      ...references.map(reference => reference.url),
    ],
    referenceImages: references.length ? [
      { url: request.referenceImageUrl, order: 0, role: "style_ref", weight: 1 },
      { url: markedUrl, order: 1, role: "detail_ref", weight: 1 },
      ...references.map((reference, index) => ({ ...reference, order: index + 2 })),
    ] : undefined,
  };
}

export async function finishImageEdit(
  bytes: Buffer,
  request: AiGenerationRequest,
  source?: Buffer,
  mask?: Buffer,
): Promise<Buffer> {
  if (request.imageEdit?.intent === "remove_background") {
    const metadata = await sharp(bytes, IMAGE_DECODE_OPTIONS).metadata();
    if (!metadata.hasAlpha)
      throw new ImageEditValidationError(
        "IMAGE_EDIT_INVALID_RESULT",
        "模型未返回透明背景，请重试",
      );
    const stats = await sharp(bytes, IMAGE_DECODE_OPTIONS)
      .ensureAlpha()
      .stats();
    const alpha = stats.channels.at(-1);
    if (!alpha || alpha.min >= 255 || alpha.max <= 0)
      throw new ImageEditValidationError(
        "IMAGE_EDIT_INVALID_RESULT",
        "去背景结果缺少有效透明区域或主体，请重试",
      );
  }
  if (request.imageEdit?.intent === "outpaint") {
    if (!source)
      throw new ImageEditValidationError(
        "IMAGE_EDIT_INVALID_INPUT",
        "扩图结果缺少原图，无法保护原始画面",
      );
    const original = await sharp(source, IMAGE_DECODE_OPTIONS)
      .rotate()
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const frame = outpaintFrame(
      request,
      original.info.width,
      original.info.height,
    );
    const expanded = await sharp(bytes, IMAGE_DECODE_OPTIONS)
      .rotate()
      .resize(frame.width, frame.height, { fit: "fill" })
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer();
    // Alpha compositing blends generated pixels into translucent source pixels.
    // Replace whole RGBA rows so even transparent source regions stay unchanged.
    const rowBytes = original.info.width * 4;
    for (let row = 0; row < original.info.height; row += 1) {
      original.data.copy(
        expanded,
        ((frame.top + row) * frame.width + frame.left) * 4,
        row * rowBytes,
        (row + 1) * rowBytes,
      );
    }
    return sharp(expanded, {
      raw: { width: frame.width, height: frame.height, channels: 4 },
    })
      .png()
      .toBuffer();
  }
  if (request.taskType === "inpaint") {
    if (!source || !mask) throw new ImageEditValidationError("IMAGE_EDIT_INVALID_INPUT", "局部编辑缺少原图或蒙版，无法保护未选区域");
    const normalized = await prepareInpaintInputs(source, mask);
    const original = await sharp(normalized.source).raw().toBuffer({ resolveWithObject: true });
    const selection = await sharp(normalized.mask).raw().toBuffer();
    let generated: Buffer;
    try {
      generated = await sharp(bytes, IMAGE_DECODE_OPTIONS).rotate()
        .resize(original.info.width, original.info.height, { fit: "fill" })
        .toColourspace("srgb").ensureAlpha().raw().toBuffer();
    } catch {
      throw new ImageEditValidationError("IMAGE_EDIT_INVALID_RESULT", "局部编辑结果无法读取，请保留原图后重试");
    }
    for (let offset = 0; offset < original.data.length; offset += 4) {
      const protection = (selection[offset + 3] ?? 255) / 255;
      if (protection === 1) {
        original.data.copy(generated, offset, offset, offset + 4);
        continue;
      }
      if (protection === 0) continue;
      const sourceAlpha = (original.data[offset + 3] ?? 0) * protection;
      const resultAlpha = (generated[offset + 3] ?? 0) * (1 - protection);
      const alpha = sourceAlpha + resultAlpha;
      // Premultiplied blending keeps feathered edges free of dark colour fringes.
      for (let channel = 0; channel < 3; channel++) {
        generated[offset + channel] = Math.round(alpha
          ? ((original.data[offset + channel] ?? 0) * sourceAlpha + (generated[offset + channel] ?? 0) * resultAlpha) / alpha
          : (original.data[offset + channel] ?? 0) * protection + (generated[offset + channel] ?? 0) * (1 - protection));
      }
      generated[offset + 3] = Math.round(alpha);
    }
    return sharp(generated, { raw: { width: original.info.width, height: original.info.height, channels: 4 } }).png().toBuffer();
  }
  return bytes;
}
