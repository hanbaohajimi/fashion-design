import { FileStatus, prisma } from "@fashion/db";
import type { ThumbnailJobData } from "@fashion/shared";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { BullThumbnailJobs } from "./thumbnail-queue.service";
import { ThumbnailRecoveryService } from "./thumbnail-recovery.service";

it("从真实上传状态补回丢失的 Redis 任务，保持幂等并跳过终态和未确认上传", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { email: `thumbnail-recovery-${suffix}@example.com` },
  });
  const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const queue = new Queue<ThumbnailJobData>(`thumbnail-recovery-${suffix}`, {
    connection: {
      host: redis.hostname,
      port: Number(redis.port || 6379),
      username: redis.username || undefined,
      password: redis.password || undefined,
    },
  });
  const jobs = new BullThumbnailJobs();
  // Exercise the production adapter against a unique queue, never the user's queue.
  Object.assign(jobs, { queue });
  const database = {
    fileAsset: {
      findMany: (args: Parameters<typeof prisma.fileAsset.findMany>[0]) =>
        prisma.fileAsset.findMany({
          ...args,
          where: { ...args?.where, ownerId: user.id },
        }),
    },
  };
  const service = new ThumbnailRecoveryService(database as never, jobs);
  try {
    const old = new Date(Date.now() - 60_000);
    const statuses = [
      FileStatus.PROCESSING,
      FileStatus.PENDING,
      FileStatus.FAILED,
      FileStatus.READY,
    ];
    const files = await Promise.all(
      statuses.map((status, index) =>
        prisma.fileAsset.create({
          data: {
            ownerId: user.id,
            originalName: `${status}.png`,
            mimeType: "image/png",
            sizeBytes: 10,
            sha256: String(index).padStart(64, "0"),
            objectKey: `recovery-test/${suffix}/${index}`,
            status,
            completedAt: status === FileStatus.PENDING ? null : old,
          },
        }),
      ),
    );
    const file = files[0];
    if (!file) throw new Error("缺少测试上传");
    await service.run();
    await service.run();
    expect(await queue.getWaitingCount()).toBe(1);
    expect((await queue.getJob(file.id))?.data).toEqual({ fileId: file.id });
    for (const skipped of files.slice(1))
      expect(await queue.getJob(skipped.id)).toBeUndefined();
    await (await queue.getJob(file.id))?.remove();
    await service.run();
    expect(await queue.getWaitingCount()).toBe(1);
    await (await queue.getJob(file.id))?.remove();
    await prisma.fileAsset.update({
      where: { id: file.id },
      data: { status: FileStatus.READY },
    });
    await service.run();
    expect(await queue.getWaitingCount()).toBe(0);
    expect(await prisma.fileAsset.count({ where: { ownerId: user.id } })).toBe(
      4,
    );
  } finally {
    await service.onModuleDestroy();
    await queue.obliterate({ force: true });
    await jobs.onModuleDestroy();
    await prisma.user.delete({ where: { id: user.id } });
  }
});
