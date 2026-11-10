import {
  aiGenerationRequestSchema,
  type AiGenerationRequest,
} from "@fashion/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureGenerationImageSources } from "./generation-image-sources";

const url = "https://storage.example/private/fabric.png?expired=yes";
const request: AiGenerationRequest = {
  taskType: "t2i",
  prompt: "设计外套",
  width: 1024,
  height: 1024,
  referenceImages: [{ url, order: 0, role: "fabric_texture", weight: 0.7 }],
};
const readyFile = {
  id: "file-1",
  ownerId: "user-1",
  status: "READY",
  mimeType: "image/png",
  objectKey: "original.png",
  thumbnail1024Key: "fabric.png",
  fabricMainImages: [],
  trendCovers: [],
};

describe("生成参考的内部文件标识", () => {
  const database = {
    designAsset: { findFirst: vi.fn() },
    fileAsset: { findFirst: vi.fn(), findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
  };
  const access = {
    require: vi.fn(),
    readableWhere: vi.fn().mockReturnValue({}),
  };
  const capture = (input: AiGenerationRequest = request) =>
    captureGenerationImageSources(
      database as never,
      access as never,
      "user-1",
      "project-1",
      input,
    );
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("S3_ENDPOINT", "https://storage.example");
    vi.stubEnv("S3_BUCKET", "private");
    vi.stubEnv("ASSET_CDN_ORIGIN", "https://cdn.example/private");
    database.designAsset.findFirst.mockResolvedValue(null);
    database.fileAsset.findFirst.mockResolvedValue(readyFile);
    database.fileAsset.findUnique.mockResolvedValue(readyFile);
    database.project.findFirst.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("当前项目图片冻结实际私有键，保持原始URL用于匹配任务输入", async () => {
    database.designAsset.findFirst.mockResolvedValue({ id: "asset-1" });
    expect(await capture()).toEqual({
      version: 1,
      entries: [{ url, objectKey: "fabric.png" }],
    });
    expect(database.designAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          archivedAt: null,
        }),
      }),
    );
    expect(database.fileAsset.findFirst).not.toHaveBeenCalled();
  });

  it("缩略图通过原文件归属验证，保留缩略图键而非替换成另一尺寸", async () => {
    expect(await capture()).toEqual({
      version: 1,
      entries: [{ url, objectKey: "fabric.png" }],
    });
    expect(database.fileAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { objectKey: "fabric.png" },
            { thumbnail256Key: "fabric.png" },
            { thumbnail1024Key: "fabric.png" },
          ],
        },
      }),
    );
    expect(database.fileAsset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "file-1" } }),
    );
    expect(access.require).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      "read",
      undefined,
    );
  });

  it("不能凭借他人文件地址取得持久签名权限", async () => {
    const foreign = { ...readyFile, ownerId: "another-user" };
    database.fileAsset.findFirst.mockResolvedValue(foreign);
    database.fileAsset.findUnique.mockResolvedValue(foreign);
    await expect(capture()).rejects.toMatchObject({ status: 403 });
  });

  it("明确共享到可读项目的他人文件可以继续使用", async () => {
    const shared = { ...readyFile, ownerId: "another-user" };
    database.fileAsset.findFirst.mockResolvedValue(shared);
    database.fileAsset.findUnique.mockResolvedValue(shared);
    database.project.findFirst.mockResolvedValue({ id: "project-1" });
    expect(await capture()).toMatchObject({
      entries: [{ objectKey: "fabric.png" }],
    });
  });

  it.each(["fabricMainImages", "trendCovers"] as const)(
    "已公开的%s素材可以作为参考",
    async (relation) => {
      database.fileAsset.findFirst.mockResolvedValue({
        ...readyFile,
        ownerId: "catalog-owner",
        [relation]: [{ id: "published-1" }],
      });
      expect(await capture()).toMatchObject({
        entries: [{ objectKey: "fabric.png" }],
      });
      expect(database.fileAsset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            fabricMainImages: {
              where: { scope: "PRESET", status: "active" },
              select: { id: true },
            },
            trendCovers: {
              where: { status: "published" },
              select: { id: true },
            },
          },
        }),
      );
      expect(database.fileAsset.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { ...readyFile, status: "FAILED" },
    { ...readyFile, mimeType: "text/plain" },
  ])("拒绝不存在、未就绪或非图片文件 %#", async (file) => {
    database.fileAsset.findFirst.mockResolvedValue(file);
    await expect(capture()).rejects.toThrow("生成参考图片不可用");
  });

  it("外部地址和伪装相似域名不获得私有文件签名权限", async () => {
    expect(
      await capture({
        ...request,
        referenceImages: [],
        referenceImageUrls: [
          "https://storage.example.attacker.test/private/fabric.png",
        ],
      }),
    ).toBeUndefined();
    expect(database.fileAsset.findFirst).not.toHaveBeenCalled();
  });

  it("局部重绘原图仍由既有冻结机制处理，额外参考独立留存", async () => {
    expect(
      await capture({
        taskType: "inpaint",
        prompt: "修改",
        width: 1024,
        height: 1024,
        referenceImageUrl: "s3://source.png",
        maskImageUrl: "s3://mask.png",
        referenceImageUrls: ["s3://source.png", url],
      }),
    ).toEqual({ version: 1, entries: [{ url, objectKey: "fabric.png" }] });
  });

  it("外部生成参数不能注入内部文件标识", () => {
    expect(
      aiGenerationRequestSchema.safeParse({
        ...request,
        imageSources: {
          version: 1,
          entries: [{ url, objectKey: "another-user.png" }],
        },
      }).success,
    ).toBe(false);
  });
});
