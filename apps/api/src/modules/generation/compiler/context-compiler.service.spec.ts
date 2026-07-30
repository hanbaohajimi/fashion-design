import { HttpStatus } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextModelGateway } from "./compiler.types";
import { ContextCompilerService } from "./context-compiler.service";
import { compilePaletteColor } from "./palette-channel";

function element(
  id: string,
  role: string,
  props: Record<string, unknown> = {},
  roleLabel: string | null = null,
) {
  return {
    fileAsset: null,
    id,
    record: { props },
    role,
    roleLabel,
  };
}

describe("ContextCompilerService", () => {
  const database = {
    designAsset: {
      findFirst: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
  };
  const model: ContextModelGateway = {
    analyzeImage: vi.fn(),
    enhancePrompt: vi.fn(),
  };
  const storage = {
    createDownloadUrl: vi.fn(),
  };
  const service = new ContextCompilerService(
    database as never,
    model,
    storage as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    database.designAsset.findFirst.mockResolvedValue(null);
    database.project.findUnique.mockResolvedValue({
      boardElements: [],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });
    vi.mocked(model.analyzeImage).mockResolvedValue([]);
    vi.mocked(model.enhancePrompt).mockRejectedValue(
      new Error("model unavailable"),
    );
    storage.createDownloadUrl.mockImplementation(
      async (objectKey: string) => `https://signed.example/${objectKey}`,
    );
  });

  it("调色板通道把色卡名称和近似色词写入正向 prompt", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        element("palette-1", "palette", {
          color: "#C02030",
          label: "crimson red",
        }),
        element("palette-2", "palette", { color: "#081B4B" }),
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });

    const result = await service.compile(
      "user-1",
      "project-1",
      "tailored evening dress",
    );

    expect(result.palette).toEqual([
      "crimson red",
      expect.stringContaining("navy"),
    ]);
    expect(result.positivePrompt).toContain("palette: crimson red");
    expect(result.enhancement).toBe("keywords");
  });

  it("avoid 通道优先使用已入库的结构化标签并写入负向 prompt", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        element(
          "avoid-1",
          "avoid",
          { url: "https://cdn.example/avoid.webp" },
          "oversized shoulder",
        ),
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });

    const result = await service.compile("user-1", "project-1", "dress");

    expect(result.avoidLabels).toContain("oversized shoulder");
    expect(result.negativePrompt).toContain("oversized shoulder");
    expect(model.analyzeImage).not.toHaveBeenCalled();
  });

  it("fabric/detail 通过 VLM 取标签，pattern 从面料标签中独立归通道", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        element("fabric-1", "fabric_ref", {
          url: "https://cdn.example/fabric.webp",
        }),
        element("detail-1", "detail_ref", {
          url: "https://cdn.example/detail.webp",
        }),
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });
    vi.mocked(model.analyzeImage).mockImplementation(async ({ channel }) =>
      channel === "fabric" ? ["silk", "botanical pattern"] : ["bound seam"],
    );

    const result = await service.compile("user-1", "project-1", "dress");

    expect(result.fabricReferences[0]?.labels).toContain("silk");
    expect(result.patternReferences[0]?.labels).toContain("botanical pattern");
    expect(result.detailReferences[0]?.labels).toContain("bound seam");
    expect(result.positivePrompt).toContain("fabric: silk");
    expect(result.positivePrompt).toContain("pattern: botanical pattern");
  });

  it("style 只保留 URL 引用，silhouette 映射为边缘参考且拒绝 base64", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        element("style-1", "style_ref", {
          url: "https://cdn.example/style.webp",
        }),
        element("style-inline", "style_ref", {
          url: "data:image/png;base64,AAAA",
        }),
        element("silhouette-1", "silhouette_ref", {
          url: "https://cdn.example/edge.webp",
        }),
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });

    const result = await service.compile("user-1", "project-1", "dress");

    expect(result.styleReferences).toHaveLength(1);
    expect(result.styleReferences[0]?.imageUrl).toBe(
      "https://cdn.example/style.webp",
    );
    expect(result.silhouetteReferences).toEqual([
      {
        edgeImageUrl: "https://cdn.example/edge.webp",
        elementId: "silhouette-1",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("base64");
  });

  it("把上传文件与生成资产的相对鉴权 URL 解析为短期签名引用", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        {
          ...element("style-upload", "style_ref", {
            fileId: "file-1",
            url: "/api/files/file-1/thumbnail/1024",
          }),
          fileAsset: {
            objectKey: "users/user-1/original.webp",
            ownerId: "user-1",
            status: "READY",
            thumbnail1024Key: "users/user-1/thumb-1024.webp",
          },
        },
        element("silhouette-generated", "silhouette_ref", {
          assetId: "asset-1",
          url: "/api/design-assets/asset-1/content",
        }),
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });
    database.designAsset.findFirst.mockResolvedValue({
      url: "s3://users/user-1/generated/asset-1.png",
    });

    const result = await service.compile("user-1", "project-1", "dress");

    expect(result.styleReferences[0]?.imageUrl).toBe(
      "https://signed.example/users/user-1/thumb-1024.webp",
    );
    expect(result.silhouetteReferences[0]?.edgeImageUrl).toBe(
      "https://signed.example/users/user-1/generated/asset-1.png",
    );
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(
      "users/user-1/thumb-1024.webp",
      86_400,
    );
    expect(database.designAsset.findFirst).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        id: "asset-1",
        projectId: "project-1",
        project: { workspace: { ownerId: "user-1" } },
      },
      select: { url: true },
    });
  });

  it("无 style_ref 不注入默认风格，空白板走纯文生图", async () => {
    const result = await service.compile(
      "user-1",
      "project-1",
      "minimal dress",
    );

    expect(result.mode).toBe("text_only");
    expect(result.styleReferences).toEqual([]);
    expect(result.positivePrompt).toBe("minimal dress");
  });

  it("LLM 成功时采用规范化术语，失败时不阻断", async () => {
    vi.mocked(model.enhancePrompt).mockResolvedValue({
      positivePrompt: "bias-cut silk evening gown",
      negativePrompt: "watermark, malformed seams",
    });

    const result = await service.compile("user-1", undefined, "silk dress");

    expect(result).toMatchObject({
      enhancement: "llm",
      mode: "text_only",
      positivePrompt: "bias-cut silk evening gown",
    });
    expect(model.enhancePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ userRequest: "silk dress" }),
    );
  });

  it("项目归属不匹配返回 403", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [],
      deletedAt: null,
      workspace: { ownerId: "user-2" },
    });

    await expect(
      service.compile("user-1", "project-1", "dress"),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it("框选生成时只查询选中的 shape id", async () => {
    await service.compile("user-1", "project-1", "dress", [
      "shape-1",
      "shape-2",
    ]);

    expect(database.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          boardElements: expect.objectContaining({
            where: {
              deletedAt: null,
              shapeId: { in: ["shape-1", "shape-2"] },
            },
          }),
        }),
      }),
    );
  });
});

describe("compilePaletteColor", () => {
  it("只在调色板映射中把 hex 转为受控颜色词", () => {
    expect(compilePaletteColor("#FF0000", null)).toContain("red");
    expect(compilePaletteColor("not-a-color", null)).toBeNull();
  });
});
