import { FileStatus } from "@fashion/db";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createThumbnailProcessor } from "./thumbnail.processor";

let source: Buffer;

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
    completedAt: new Date(),
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
      update: vi.fn(),
    },
  };
  const storage = {
    get: vi.fn(),
    put: vi.fn(),
  };
  const processThumbnail = createThumbnailProcessor({
    database: database as never,
    storage,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    database.fileAsset.findUnique.mockResolvedValue(record());
    database.fileAsset.update.mockResolvedValue(record());
    storage.get.mockResolvedValue(source);
    storage.put.mockResolvedValue(undefined);
  });

  it("生成 256/1024 WebP 且原图不被覆盖", async () => {
    await processThumbnail("file-1");

    expect(storage.get).toHaveBeenCalledWith("originals/user-a/file-1/source");
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(storage.put.mock.calls.map((call) => call[0])).toEqual([
      "thumbnails/user-a/file-1/256.webp",
      "thumbnails/user-a/file-1/1024.webp",
    ]);
    expect(
      storage.put.mock.calls.every((call) => call[2] === "image/webp"),
    ).toBe(true);
    expect(database.fileAsset.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          height: 80,
          status: FileStatus.READY,
          width: 120,
        }),
      }),
    );
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

  it("连续处理 151 个上传且不保留输出 Buffer", async () => {
    for (let index = 0; index < 151; index += 1) {
      const current = record(`stress-${index}`);
      database.fileAsset.findUnique.mockResolvedValueOnce(current);
      await processThumbnail(current.id);
    }

    expect(storage.get).toHaveBeenCalledTimes(151);
    expect(storage.put).toHaveBeenCalledTimes(302);
    expect(database.fileAsset.update).toHaveBeenCalledTimes(151);
  }, 30_000);
});
