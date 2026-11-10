import { ServiceUnavailableException } from "@nestjs/common";
import { privateStorageObjectKey } from "@fashion/shared";
import type { S3FileStorage } from "../files/storage.service";

/** Restoration reuses an original file. Do not report a new version for a missing private image. */
export async function requireRestoreSourceFile(storage: Pick<S3FileStorage, "head">, url: string, failure = { code: "RESTORE_SOURCE_UNAVAILABLE", message: "历史原图暂时无法读取，恢复尚未完成。记录仍保留，请稍后重试原操作。" }): Promise<void> {
  const key = privateStorageObjectKey(url, { endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET, cdnOrigin: process.env.ASSET_CDN_ORIGIN });
  // Legacy external URLs keep their original behavior; never fetch arbitrary hosts here.
  if (!key) return;
  try {
    const head = await storage.head(key);
    if (head.contentLength < 1 || !head.contentType?.toLowerCase().startsWith("image/")) throw new Error("Missing image");
  } catch {
    throw new ServiceUnavailableException(failure);
  }
}
