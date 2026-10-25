import type { AiGenerationRequest } from "@fashion/ai";
import { imageAnnotationsSvg } from "@fashion/shared";
import sharp from "sharp";
import type { ThumbnailStorage } from "../storage";

export async function prepareImageEdit(
  request: AiGenerationRequest,
  source: Buffer,
  taskId: string,
  storage: ThumbnailStorage,
): Promise<AiGenerationRequest> {
  if (!request.imageEdit || !storage.downloadUrl)
    throw new Error("图片编辑存储未配置");
  const outpaint = request.imageEdit.outpaint;
  let image: Buffer;
  const sourcePng = await sharp(source).rotate().png().toBuffer();
  const size = await sharp(sourcePng).metadata();
  const width = size.width;
  const height = size.height;
  if (!width || !height) throw new Error("无法读取图片尺寸");
  const prefix = `image-edit/${taskId}`;
  if (request.imageEdit.intent === "outpaint" && outpaint) {
    if (
      outpaint.left + width > outpaint.width ||
      outpaint.top + height > outpaint.height ||
      (width === outpaint.width && height === outpaint.height)
    )
      throw new Error("扩展画布必须完整包含原图并增加画面区域");
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
    await storage.put(`${prefix}/mask.png`, mask, "image/png");
    await storage.put(`${prefix}/input.png`, image, "image/png");
    return {
      ...request,
      taskType: "inpaint",
      referenceImageUrl: await storage.downloadUrl(`${prefix}/input.png`),
      maskImageUrl: await storage.downloadUrl(`${prefix}/mask.png`),
      width: outpaint.width,
      height: outpaint.height,
    };
  }
  image = await sharp(sourcePng)
    .composite([
      {
        input: Buffer.from(
          imageAnnotationsSvg(
            request.imageEdit.annotations ?? [],
            width,
            height,
          ),
        ),
      },
    ])
    .png()
    .toBuffer();
  await storage.put(`${prefix}/annotations.png`, image, "image/png");
  if (request.taskType !== "i2i") throw new Error("意见修改必须使用图片编辑");
  return {
    ...request,
    referenceImageUrls: [
      request.referenceImageUrl,
      await storage.downloadUrl(`${prefix}/annotations.png`),
    ],
    referenceImages: undefined,
  };
}

export async function finishImageEdit(
  bytes: Buffer,
  request: AiGenerationRequest,
  source?: Buffer,
): Promise<Buffer> {
  if (request.imageEdit?.intent === "remove_background") {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.hasAlpha) throw new Error("模型未返回透明背景，请重试");
    const stats = await sharp(bytes).ensureAlpha().stats();
    const alpha = stats.channels.at(-1);
    if (!alpha || alpha.min >= 255 || alpha.max <= 0)
      throw new Error("去背景结果缺少有效透明区域或主体，请重试");
  }
  const frame = request.imageEdit?.outpaint;
  if (request.imageEdit?.intent === "outpaint" && frame && source) {
    return sharp(bytes)
      .resize(frame.width, frame.height, { fit: "fill" })
      .composite([
        {
          input: await sharp(source).rotate().png().toBuffer(),
          left: frame.left,
          top: frame.top,
        },
      ])
      .png()
      .toBuffer();
  }
  return bytes;
}
