import { FileStatus, type PrismaClient } from "@fashion/db";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { FILES_DB, FILE_STORAGE } from "./files.service";
import type { FileStorage } from "./storage.service";

const CLEANED = "EXPIRED_UPLOAD_CLEANED";
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export async function cleanupExpiredUploads(database: PrismaClient, storage: Pick<FileStorage, "delete">, now = new Date(), ageHours = 24): Promise<number> {
  if (!Number.isFinite(ageHours) || ageHours < 1) throw new Error("上传清理期限至少为 1 小时");
  const cutoff = new Date(now.getTime() - ageHours * 60 * 60 * 1000);
  const candidates = await database.fileAsset.findMany({
    where: { status: { in: [FileStatus.PENDING, FileStatus.FAILED] }, updatedAt: { lt: cutoff },
      OR: [{ errorMessage: null }, { errorMessage: { not: CLEANED } }] },
    orderBy: { updatedAt: "asc" }, take: 100,
  });
  let count = 0;
  for (const file of candidates) {
    const cleaned = await database.$transaction(async (tx) => {
      // This update holds the row lock through deletion; a retry cannot reset the same key mid-cleanup.
      const claimed = await tx.fileAsset.updateMany({
        where: { id: file.id, updatedAt: file.updatedAt, status: file.status },
        data: { status: FileStatus.FAILED, errorMessage: CLEANED },
      });
      if (!claimed.count) return false;
      for (const key of new Set([file.objectKey, file.thumbnail256Key, file.thumbnail1024Key].filter((value): value is string => Boolean(value)))) await storage.delete(key);
      return true;
    }, { timeout: 45_000 });
    if (cleaned) count += 1;
  }
  return count;
}

@Injectable()
export class UploadsCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  constructor(@Inject(FILES_DB) private readonly database: PrismaClient, @Inject(FILE_STORAGE) private readonly storage: FileStorage) {}
  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      const age = Number(process.env.UPLOAD_CLEANUP_AGE_HOURS ?? 24);
      void cleanupExpiredUploads(this.database, this.storage, new Date(), age)
        .catch(() => Logger.error("过期上传清理失败，将在下一轮重试", "UploadsCleanup"))
        .finally(() => { this.running = false; });
    }, CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
}
