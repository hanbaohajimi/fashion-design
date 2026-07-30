import { FileStatus, type FileAsset, type PrismaClient } from "@fashion/db";
import decodeHeic from "heic-decode";
import sharp, { type SharpOptions } from "sharp";

import type { ThumbnailStorage } from "../storage";

const MAX_INPUT_PIXELS = 100_000_000;
const THUMBNAIL_SIZES = [256, 1024] as const;

type ThumbnailDatabase = Pick<PrismaClient, "fileAsset">;

interface PreparedImage {
  readonly height: number;
  readonly input: Buffer;
  readonly options: SharpOptions;
  readonly shouldAutoOrient: boolean;
  readonly width: number;
}

interface HeicImageHandle {
  readonly height: number;
  readonly width: number;
  decode(): Promise<{
    readonly data: Uint8ClampedArray;
    readonly height: number;
    readonly width: number;
  }>;
}

export interface ThumbnailProcessorDependencies {
  readonly database: ThumbnailDatabase;
  readonly storage: ThumbnailStorage;
}

function isHeic(mimeType: string): boolean {
  return mimeType === "image/heic" || mimeType === "image/heif";
}

async function prepareImage(
  input: Buffer,
  mimeType: string,
): Promise<PreparedImage> {
  try {
    const metadata = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    const oriented = metadata.autoOrient;
    const width = oriented.width ?? metadata.width;
    const height = oriented.height ?? metadata.height;
    if (!width || !height) {
      throw new Error("无法读取图片尺寸");
    }
    return {
      height,
      input,
      options: { limitInputPixels: MAX_INPUT_PIXELS },
      shouldAutoOrient: true,
      width,
    };
  } catch (error) {
    if (!isHeic(mimeType)) {
      throw error;
    }
  }

  const images = (await decodeHeic.all({ buffer: input })) as HeicImageHandle[] & {
    dispose?: () => void;
  };
  const primary = images[0];
  try {
    if (!primary) {
      throw new Error("HEIC 文件没有主图像");
    }
    if (primary.width * primary.height > MAX_INPUT_PIXELS) {
      throw new Error("HEIC 图片像素数量超过处理上限");
    }
    const decoded = await primary.decode();
    return {
      height: decoded.height,
      input: Buffer.from(
        decoded.data.buffer,
        decoded.data.byteOffset,
        decoded.data.byteLength,
      ),
      options: {
        limitInputPixels: MAX_INPUT_PIXELS,
        raw: {
          channels: 4,
          height: decoded.height,
          width: decoded.width,
        },
      },
      shouldAutoOrient: false,
      width: decoded.width,
    };
  } finally {
    images.dispose?.();
  }
}

async function renderThumbnail(
  prepared: PreparedImage,
  size: number,
): Promise<Buffer> {
  let pipeline = sharp(prepared.input, prepared.options);
  if (prepared.shouldAutoOrient) {
    pipeline = pipeline.autoOrient();
  }
  return pipeline
    .resize({
      fit: "inside",
      height: size,
      width: size,
      withoutEnlargement: true,
    })
    .webp({ effort: 4, quality: 82 })
    .toBuffer();
}

function thumbnailKey(file: FileAsset, size: number): string {
  if (!file.completedAt) {
    throw new Error("缩略图任务缺少上传完成时间");
  }
  return `thumbnails/${file.ownerId}/${file.id}/${file.completedAt.getTime()}/${size}.webp`;
}

export function createThumbnailProcessor({
  database,
  storage,
}: ThumbnailProcessorDependencies) {
  return async (fileId: string): Promise<void> => {
    const file = await database.fileAsset.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      throw new Error(`缩略图文件记录不存在：${fileId}`);
    }
    if (
      !file.completedAt ||
      (file.status !== FileStatus.PROCESSING &&
        file.status !== FileStatus.FAILED)
    ) {
      return;
    }

    try {
      const original = await storage.get(file.objectKey);
      const prepared = await prepareImage(original, file.mimeType);
      const outputs = new Map<number, string>();

      for (const size of THUMBNAIL_SIZES) {
        const key = thumbnailKey(file, size);
        const thumbnail = await renderThumbnail(prepared, size);
        await storage.put(key, thumbnail, "image/webp");
        outputs.set(size, key);
      }

      const finalized = await database.fileAsset.updateMany({
        where: {
          completedAt: file.completedAt,
          id: file.id,
          status: {
            in: [FileStatus.PROCESSING, FileStatus.FAILED],
          },
        },
        data: {
          errorMessage: null,
          height: prepared.height,
          status: FileStatus.READY,
          thumbnail1024Key: outputs.get(1024) ?? thumbnailKey(file, 1024),
          thumbnail256Key: outputs.get(256) ?? thumbnailKey(file, 256),
          width: prepared.width,
        },
      });
      if (finalized.count === 0) {
        const current = await database.fileAsset.findUnique({
          where: { id: file.id },
        });
        if (
          current?.completedAt?.getTime() !== file.completedAt.getTime() &&
          (current?.status === FileStatus.PROCESSING ||
            current?.status === FileStatus.FAILED)
        ) {
          throw new Error("缩略图任务处理世代已变化");
        }
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "未知图片处理错误";
      await database.fileAsset.updateMany({
        where: {
          completedAt: file.completedAt,
          id: file.id,
          status: {
            in: [FileStatus.PROCESSING, FileStatus.FAILED],
          },
        },
        data: {
          errorMessage: message,
          status: FileStatus.FAILED,
        },
      });
      throw error;
    }
  };
}

// Sharp 的默认全局缓存会让压力测试看起来像持续增长；worker 使用受控并发，
// 每个任务只保留当前原图和一个输出缩略图。
sharp.cache(false);
