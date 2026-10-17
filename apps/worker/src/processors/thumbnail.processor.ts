import { FileStatus, type FileAsset, type PrismaClient } from "@fashion/db";
import decodeHeic from "heic-decode";
import sharp, { type SharpOptions } from "sharp";
import type { VisualSummarySource } from "@fashion/shared";

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
  readonly visualSummaryJobs?: { enqueue(source: VisualSummarySource): Promise<void> };
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

  const images = (await decodeHeic.all({
    buffer: input,
  })) as HeicImageHandle[] & {
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

function isReadyWithExpectedThumbnails(
  current: FileAsset | null | undefined,
  completedAt: Date,
  thumbnail256Key: string,
  thumbnail1024Key: string,
): boolean {
  return (
    current?.status === FileStatus.READY &&
    current.completedAt?.getTime() === completedAt.getTime() &&
    current.thumbnail256Key === thumbnail256Key &&
    current.thumbnail1024Key === thumbnail1024Key
  );
}

async function cleanupUnreferencedThumbnails(
  storage: ThumbnailStorage,
  attemptedKeys: readonly string[],
  current: FileAsset | null,
): Promise<void> {
  const referenced = new Set(
    [current?.thumbnail256Key, current?.thumbnail1024Key].filter(
      (key): key is string => Boolean(key),
    ),
  );
  await Promise.allSettled(
    [...new Set(attemptedKeys)]
      .filter((key) => !referenced.has(key))
      .map((key) => storage.delete(key)),
  );
}

export function createThumbnailProcessor({
  database,
  storage,
  visualSummaryJobs,
}: ThumbnailProcessorDependencies) {
  return async (fileId: string): Promise<void> => {
    const file = await database.fileAsset.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      throw new Error(`缩略图文件记录不存在：${fileId}`);
    }
    if (file.status === FileStatus.READY && file.thumbnail1024Key) {
      await visualSummaryJobs?.enqueue({ kind: "file", id: file.id }).catch(() => undefined);
      return;
    }
    if (
      !file.completedAt ||
      (file.status !== FileStatus.PROCESSING &&
        file.status !== FileStatus.FAILED)
    ) {
      return;
    }

    const thumbnail256Key = thumbnailKey(file, 256);
    const thumbnail1024Key = thumbnailKey(file, 1024);
    const attemptedKeys: string[] = [];
    let reconciledCurrent: FileAsset | null | undefined;

    try {
      const original = await storage.get(file.objectKey);
      const prepared = await prepareImage(original, file.mimeType);
      const outputs = new Map<number, string>();

      for (const size of THUMBNAIL_SIZES) {
        const key = thumbnailKey(file, size);
        const thumbnail = await renderThumbnail(prepared, size);
        attemptedKeys.push(key);
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
          thumbnail1024Key: outputs.get(1024) ?? thumbnail1024Key,
          thumbnail256Key: outputs.get(256) ?? thumbnail256Key,
          width: prepared.width,
        },
      });
      if (finalized.count === 0) {
        reconciledCurrent = await database.fileAsset.findUnique({
          where: { id: file.id },
        });
        if (
          isReadyWithExpectedThumbnails(
            reconciledCurrent,
            file.completedAt,
            thumbnail256Key,
            thumbnail1024Key,
          )
        ) {
          await visualSummaryJobs?.enqueue({ kind: "file", id: file.id }).catch(() => undefined);
          return;
        }
        if (
          reconciledCurrent?.completedAt?.getTime() !==
          file.completedAt.getTime()
        ) {
          throw new Error("缩略图任务处理世代已变化");
        }
        throw new Error("缩略图任务状态已发生变化");
      }
      // A failed optional analysis queue must not turn a completed upload into a failed file.
      await visualSummaryJobs?.enqueue({ kind: "file", id: file.id }).catch(() => undefined);
    } catch (error) {
      if (reconciledCurrent === undefined) {
        try {
          reconciledCurrent = await database.fileAsset.findUnique({
            where: { id: file.id },
          });
        } catch {
          // 数据库完成写可能已经提交；无法对账时保留对象比误删已引用对象更安全。
        }
      }
      if (
        isReadyWithExpectedThumbnails(
          reconciledCurrent,
          file.completedAt,
          thumbnail256Key,
          thumbnail1024Key,
        )
      ) {
        await visualSummaryJobs?.enqueue({ kind: "file", id: file.id }).catch(() => undefined);
        return;
      }
      if (reconciledCurrent !== undefined) {
        await cleanupUnreferencedThumbnails(
          storage,
          attemptedKeys,
          reconciledCurrent,
        );
      }
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "未知图片处理错误";
      await database.fileAsset
        .updateMany({
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
        })
        .catch(() => undefined);
      throw error;
    }
  };
}

// Sharp 的默认全局缓存会让压力测试看起来像持续增长；worker 使用受控并发，
// 每个任务只保留当前原图和一个输出缩略图。
sharp.cache(false);
