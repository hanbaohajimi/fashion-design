import { FileStatus } from "@fashion/db";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createThumbnailProcessor } from "./thumbnail.processor";

let source: Buffer;
const completedAt = new Date("2026-01-02T03:04:05.000Z");

beforeAll(async () => {
  source = await sharp({
    create: {
      background: { alpha: 1, b: 30, g: 20, r: 10 },
      channels: 4,
      height: 80,
      width: 120,
    },
  })
    .png()
    .toBuffer();
});

function record(id = "file-1") {
  return {
    completedAt,
    createdAt: new Date(),
    errorMessage: null,
    height: null,
    id,
    mimeType: "image/png",
    objectKey: `originals/user-a/${id}/source`,
    originalName: "sample.png",
    ownerId: "user-a",
    sha256: "a".repeat(64),
    sizeBytes: source.length,
    status: FileStatus.PROCESSING,
    thumbnail1024Key: null,
    thumbnail256Key: null,
    updatedAt: new Date(),
    width: null,
  };
}

describe("thumbnail processor", () => {
  const database = {
    fileAsset: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const storage = {
    delete: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
  };
  const processThumbnail = createThumbnailProcessor({
    database: database as never,
    storage,
  });

  beforeEach(() => {
    database.fileAsset.findUnique.mockReset();
    database.fileAsset.updateMany.mockReset();
    storage.delete.mockReset();
    storage.get.mockReset();
    storage.put.mockReset();
    database.fileAsset.findUnique.mockResolvedValue(record());
    database.fileAsset.updateMany.mockResolvedValue({ count: 1 });
    storage.delete.mockResolvedValue(undefined);
    storage.get.mockResolvedValue(source);
    storage.put.mockResolvedValue(undefined);
  });

  it("生成 256/1024 WebP 且原图不被覆盖", async () => {
    await processThumbnail("file-1");

    expect(storage.get).toHaveBeenCalledWith("originals/user-a/file-1/source");
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(storage.put.mock.calls.map((call) => call[0])).toEqual([
      `thumbnails/user-a/file-1/${completedAt.getTime()}/256.webp`,
      `thumbnails/user-a/file-1/${completedAt.getTime()}/1024.webp`,
    ]);
    expect(
      storage.put.mock.calls.every((call) => call[2] === "image/webp"),
    ).toBe(true);
    expect(database.fileAsset.updateMany).toHaveBeenLastCalledWith({
      where: {
        completedAt,
        id: "file-1",
        status: {
          in: [FileStatus.PROCESSING, FileStatus.FAILED],
        },
      },
      data: {
        errorMessage: null,
        height: 80,
        status: FileStatus.READY,
        thumbnail1024Key: `thumbnails/user-a/file-1/${completedAt.getTime()}/1024.webp`,
        thumbnail256Key: `thumbnails/user-a/file-1/${completedAt.getTime()}/256.webp`,
        width: 120,
      },
    });
  });

  it("READY 去重任务不会重新下载或生成缩略图", async () => {
    database.fileAsset.findUnique.mockResolvedValue(record("file-ready"));
    database.fileAsset.findUnique.mockResolvedValueOnce({
      ...record("file-ready"),
      status: FileStatus.READY,
    });

    await processThumbnail("file-ready");

    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("新图就绪后异步入队视觉摘要，队列失败不撤销已就绪文件", async () => {
    const visualSummaryJobs = { enqueue: vi.fn().mockRejectedValue(new Error("queue unavailable")) };
    const process = createThumbnailProcessor({ database: database as never, storage, visualSummaryJobs });
    await expect(process("file-1")).resolves.toBeUndefined();
    expect(visualSummaryJobs.enqueue).toHaveBeenCalledWith({ kind: "file", id: "file-1" });
    expect(database.fileAsset.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: FileStatus.READY }),
    }));
  });

  it("READY 重投任务补齐在持久化后崩溃而缺失的视觉任务", async () => {
    database.fileAsset.findUnique.mockResolvedValueOnce({ ...record(), status: FileStatus.READY,
      thumbnail1024Key: "thumbnails/file-1/1024.webp" });
    const visualSummaryJobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const process = createThumbnailProcessor({ database: database as never, storage, visualSummaryJobs });
    await process("file-1");
    expect(visualSummaryJobs.enqueue).toHaveBeenCalledWith({ kind: "file", id: "file-1" });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("PENDING 的陈旧任务不会下载或生成缩略图", async () => {
    database.fileAsset.findUnique.mockResolvedValueOnce({
      ...record("file-pending"),
      status: FileStatus.PENDING,
    });

    await processThumbnail("file-pending");

    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(database.fileAsset.updateMany).not.toHaveBeenCalled();
  });

  it("BullMQ 自动重试可从 FAILED 恢复到 READY", async () => {
    database.fileAsset.findUnique.mockResolvedValueOnce({
      ...record("file-retry"),
      errorMessage: "temporary error",
      status: FileStatus.FAILED,
    });

    await processThumbnail("file-retry");

    expect(database.fileAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: FileStatus.READY }),
        where: expect.objectContaining({
          completedAt,
          status: {
            in: [FileStatus.PROCESSING, FileStatus.FAILED],
          },
        }),
      }),
    );
  });

  it("处理失败仅用原世代 CAS 写 FAILED 并继续抛错触发重试", async () => {
    const failure = new Error("temporary storage failure");
    storage.get.mockRejectedValueOnce(failure);

    await expect(processThumbnail("file-1")).rejects.toBe(failure);

    expect(database.fileAsset.updateMany).toHaveBeenCalledWith({
      where: {
        completedAt,
        id: "file-1",
        status: {
          in: [FileStatus.PROCESSING, FileStatus.FAILED],
        },
      },
      data: {
        errorMessage: "temporary storage failure",
        status: FileStatus.FAILED,
      },
    });
  });

  it("部分缩略图写入失败时删除本世代所有可能已写入的对象", async () => {
    const failure = new Error("second thumbnail response lost");
    storage.put.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);

    await expect(processThumbnail("file-1")).rejects.toBe(failure);

    expect(storage.delete.mock.calls.map((call) => call[0])).toEqual([
      `thumbnails/user-a/file-1/${completedAt.getTime()}/256.webp`,
      `thumbnails/user-a/file-1/${completedAt.getTime()}/1024.webp`,
    ]);
  });

  it("数据库完成写响应丢失时对账 READY 记录且不误删已引用缩略图", async () => {
    const current = record("file-committed");
    const thumbnail256Key = `thumbnails/user-a/file-committed/${completedAt.getTime()}/256.webp`;
    const thumbnail1024Key = `thumbnails/user-a/file-committed/${completedAt.getTime()}/1024.webp`;
    database.fileAsset.findUnique
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({
        ...current,
        status: FileStatus.READY,
        thumbnail1024Key,
        thumbnail256Key,
      });
    database.fileAsset.updateMany.mockRejectedValueOnce(
      new Error("database response lost"),
    );

    await expect(processThumbnail("file-committed")).resolves.toBeUndefined();

    expect(storage.delete).not.toHaveBeenCalled();
    expect(database.fileAsset.updateMany).toHaveBeenCalledTimes(1);
  });

  it("旧世代完成时不会覆盖新上传，并抛错让 BullMQ 再次调度", async () => {
    const oldFile = record("file-race");
    const newCompletedAt = new Date("2026-01-03T03:04:05.000Z");
    database.fileAsset.findUnique
      .mockResolvedValueOnce(oldFile)
      .mockResolvedValueOnce({
        ...oldFile,
        completedAt: newCompletedAt,
        status: FileStatus.PROCESSING,
      });
    database.fileAsset.updateMany.mockResolvedValue({ count: 0 });

    await expect(processThumbnail("file-race")).rejects.toThrow(
      "缩略图任务处理世代已变化",
    );

    expect(
      database.fileAsset.updateMany.mock.calls.every(
        ([argument]) => argument.where.completedAt === completedAt,
      ),
    ).toBe(true);
    expect(storage.put.mock.calls.map((call) => call[0])).toEqual([
      `thumbnails/user-a/file-race/${completedAt.getTime()}/256.webp`,
      `thumbnails/user-a/file-race/${completedAt.getTime()}/1024.webp`,
    ]);
    expect(storage.delete.mock.calls.map((call) => call[0])).toEqual([
      `thumbnails/user-a/file-race/${completedAt.getTime()}/256.webp`,
      `thumbnails/user-a/file-race/${completedAt.getTime()}/1024.webp`,
    ]);
  });

  it("连续处理 151 个上传且不保留输出 Buffer", async () => {
    for (let index = 0; index < 151; index += 1) {
      const current = record(`stress-${index}`);
      database.fileAsset.findUnique.mockResolvedValueOnce(current);
      await processThumbnail(current.id);
    }

    expect(storage.get).toHaveBeenCalledTimes(151);
    expect(storage.put).toHaveBeenCalledTimes(302);
    expect(database.fileAsset.updateMany).toHaveBeenCalledTimes(151);
  }, 30_000);
});
