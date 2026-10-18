import { HttpStatus } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GenerationMaskService } from "./generation-mask.service";

describe("GenerationMaskService", () => {
  const database = { project: { findUnique: vi.fn() } };
  const storage = {
    createDownloadUrl: vi.fn(),
    createUploadUrl: vi.fn(),
  };
  const service = new GenerationMaskService(
    database as never,
    storage as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    database.project.findUnique.mockResolvedValue({
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });
    storage.createDownloadUrl.mockResolvedValue("https://signed.test/mask");
    storage.createUploadUrl.mockResolvedValue("https://signed.test/upload");
  });

  it("只签临时前缀且不创建 FileAsset 用户资产", async () => {
    const result = await service.sign("user-1", {
      checksumSha256: "ERERERERERERERERERERERERERERERERERERERERERE=",
      height: 1024,
      projectId: "project-1",
      size: 2048,
      width: 768,
    });

    expect(storage.createUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^temporary\/masks\/user-1\/[\da-f-]+\.png$/u),
      "image/png",
      2048,
      "ERERERERERERERERERERERERERERERERERERERERERE=",
    );
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^temporary\/masks\/user-1\//u),
      1800,
    );
    expect(result).toMatchObject({
      maskUrl: "https://signed.test/mask",
      upload: {
        headers: {
          "Content-Type": "image/png",
          "x-amz-checksum-sha256":
            "ERERERERERERERERERERERERERERERERERERERERERE=",
        },
        method: "PUT",
      },
    });
    expect(database).not.toHaveProperty("fileAsset");
  });

  it("其他用户项目返回 403", async () => {
    database.project.findUnique.mockResolvedValue({
      deletedAt: null,
      workspace: { ownerId: "user-2" },
    });

    await expect(
      service.sign("user-1", {
        checksumSha256: "ERERERERERERERERERERERERERERERERERERERERERE=",
        height: 512,
        projectId: "project-1",
        size: 1024,
        width: 512,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });
});
