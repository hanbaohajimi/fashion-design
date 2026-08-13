import { FileStatus } from "@fashion/db";
import { HttpStatus, Logger } from "@nestjs/common";
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
    fabric: {
      findMany: vi.fn(),
    },
    trendItem: {
      findMany: vi.fn(),
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
    database.fabric.findMany.mockResolvedValue([]);
    database.trendItem.findMany.mockResolvedValue([]);
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

  it("多色色卡会把每个颜色都写入生成上下文", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        element("palette-multi", "palette", {
          color: "#C8AB84",
          colors: [
            { color: "#C8AB84", id: "oat", label: "OAT" },
            { color: "#708090", id: "slate", label: "SLATE" },
            { color: "#1C1C1C", id: "ink", label: "INK" },
          ],
          label: "OAT",
        }),
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });

    const result = await service.compile(
      "user-1",
      "project-1",
      "three-tone tailored coat",
      ["palette-multi"],
    );

    expect(result.palette).toEqual(["OAT", "SLATE", "INK"]);
    expect(result.positivePrompt).toContain("palette: OAT, SLATE, INK");
  });

  it("图片色卡与图片备注都进入编译上下文且保留视觉参考", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        element(
          "palette-image",
          "palette",
          { url: "https://cdn.example/palette.webp" },
          "burgundy, ivory, black",
        ),
        element("note-image", "note", {
          roleLabel: "门襟保持隐藏式结构",
          url: "https://cdn.example/note.webp",
        }),
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });

    const result = await service.compile("user-1", "project-1", "coat");

    expect(result.palette).toContain("burgundy, ivory, black");
    expect(result.notes).toContain("门襟保持隐藏式结构");
    expect(result.paletteReferences).toEqual([
      {
        elementId: "palette-image",
        imageUrl: "https://cdn.example/palette.webp",
        labels: ["burgundy, ivory, black"],
      },
    ]);
    expect(result.positivePrompt).toContain("palette: burgundy, ivory, black");
    expect(result.positivePrompt).toContain("design notes: 门襟保持隐藏式结构");
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

  it("结构化面料元素使用 FabricChannel 注入标签且不重复调用 VLM", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        {
          ...element("fabric-element-1", "fabric_ref", {
            fabricId: "fabric-1",
          }),
          shapeType: "fashion-fabric",
        },
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });
    database.fabric.findMany.mockResolvedValue([
      {
        id: "fabric-1",
        mainFile: {
          objectKey: "users/user-1/fabric.webp",
          status: FileStatus.READY,
          thumbnail1024Key: "users/user-1/fabric-1024.webp",
        },
        tags: ["cotton blend", "plain", "matte"],
      },
    ]);

    const result = await service.compile("user-1", "project-1", "dress");

    expect(result.positivePrompt).toContain(
      "fabric tags: cotton blend, plain, matte",
    );
    expect(result.fabricReferences[0]).toMatchObject({
      fabricId: "fabric-1",
      role: "fabric_texture",
      weight: 0.7,
    });
    expect(result.fabricInputs).toEqual([
      expect.objectContaining({
        boardElementId: "fabric-element-1",
        fabricId: "fabric-1",
        tags: ["cotton blend", "plain", "matte"],
      }),
    ]);
    expect(model.analyzeImage).not.toHaveBeenCalled();
  });

  it("趋势通道把精确色值、趋势语义和 0.5 风格参考注入主编译结果", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        {
          ...element("trend-swatch", "palette", { color: "#FF6B9D" }),
          record: {
            meta: { trendItemId: "trend-1" },
            props: { color: "#FF6B9D" },
          },
          shapeType: "fashion-swatch",
        },
        {
          ...element("trend-image", "style_ref", {
            url: "/api/boards/trend-assets/trend-1",
          }),
          record: {
            meta: { trendItemId: "trend-1" },
            props: { url: "/api/boards/trend-assets/trend-1" },
          },
          shapeType: "fashion-image",
        },
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });
    database.trendItem.findMany.mockResolvedValue([
      {
        coverFile: {
          objectKey: "trends/trend-1.webp",
          status: FileStatus.READY,
          thumbnail1024Key: null,
        },
        extracted: {
          keywords: ["dopamine dressing"],
          silhouettes: ["cocoon"],
        },
        id: "trend-1",
      },
    ]);

    const result = await service.compile("user-1", "project-1", "dress");

    expect(result.positivePrompt).toContain("color palette: #FF6B9D");
    expect(result.positivePrompt).toContain(
      "trend keywords: dopamine dressing",
    );
    expect(result.positivePrompt).toContain("silhouette: cocoon");
    expect(result.styleReferences).toEqual([
      expect.objectContaining({
        elementId: "trend-image",
        imageUrl: "https://signed.example/trends/trend-1.webp",
        role: "style_ref",
        trendItemId: "trend-1",
        weight: 0.5,
      }),
    ]);
    expect(model.analyzeImage).not.toHaveBeenCalled();
  });

  it("style 和 garment 只保留 URL 引用，silhouette 映射为边缘参考且拒绝 base64", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        element("style-1", "style_ref", {
          url: "https://cdn.example/style.webp",
        }),
        element("style-inline", "style_ref", {
          url: "data:image/png;base64,AAAA",
        }),
        element("garment-1", "garment_ref", {
          url: "https://cdn.example/garment.webp",
        }),
        element("reference-garment-1", "reference_garment", {
          url: "https://cdn.example/reference-garment.webp",
        }),
        element("silhouette-1", "silhouette_ref", {
          url: "https://cdn.example/edge.webp",
        }),
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });

    const result = await service.compile("user-1", "project-1", "dress");

    expect(result.styleReferences).toHaveLength(3);
    expect(result.styleReferences[0]?.imageUrl).toBe(
      "https://cdn.example/style.webp",
    );
    expect(result.styleReferences[1]?.imageUrl).toBe(
      "https://cdn.example/garment.webp",
    );
    expect(result.styleReferences[2]?.imageUrl).toBe(
      "https://cdn.example/reference-garment.webp",
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

  it("把草图 frame 绑定的派生文件编译为廓形边缘参考", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        {
          ...element("shape:fashion-sketch", "silhouette_ref", {}),
          fileAsset: {
            objectKey: "users/user-1/sketch/source.png",
            ownerId: "user-1",
            status: "READY",
            thumbnail1024Key: "users/user-1/sketch/edge-1024.png",
          },
          shapeType: "frame",
        },
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });

    const result = await service.compile("user-1", "project-1", "短款夹克");

    expect(result.silhouetteReferences).toEqual([
      {
        edgeImageUrl:
          "https://signed.example/users/user-1/sketch/edge-1024.png",
        elementId: "shape:fashion-sketch",
      },
    ]);
  });

  it("把完成后的整张草图图片作为唯一廓形参考进行生成与修改", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        {
          ...element("shape:fashion-sketch-image", "silhouette_ref", {
            fileId: "file-sketch",
            role: "silhouette_ref",
            roleLabel: "fashion_sketch",
          }),
          fileAsset: {
            objectKey: "users/user-1/sketch/source.png",
            ownerId: "user-1",
            status: "READY",
            thumbnail1024Key: "users/user-1/sketch/whole-sketch-1024.png",
          },
          record: {
            meta: {
              fashionSketch: true,
              fashionSketchImage: true,
              sketchDirty: false,
              sketchStatus: "ready",
            },
            props: {
              fileId: "file-sketch",
              role: "silhouette_ref",
              roleLabel: "fashion_sketch",
            },
          },
          roleLabel: "fashion_sketch",
          shapeType: "fashion-image",
        },
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });

    const result = await service.compile("user-1", "project-1", "修改衣领");

    expect(result.silhouetteReferences).toEqual([
      {
        edgeImageUrl:
          "https://signed.example/users/user-1/sketch/whole-sketch-1024.png",
        elementId: "shape:fashion-sketch-image",
      },
    ]);
    expect(result.styleReferences).toEqual([]);
  });

  it("草图修改后会暂停使用过期的 AI 廓形引用", async () => {
    database.project.findUnique.mockResolvedValue({
      boardElements: [
        {
          ...element("shape:fashion-sketch", "silhouette_ref", {}),
          fileAsset: {
            objectKey: "users/user-1/sketch/source.png",
            ownerId: "user-1",
            status: "READY",
            thumbnail1024Key: "users/user-1/sketch/edge-1024.png",
          },
          record: {
            meta: {
              fashionSketch: true,
              sketchDirty: true,
              sketchStatus: "draft",
            },
            props: {},
          },
          roleLabel: "fashion_sketch",
          shapeType: "frame",
        },
      ],
      deletedAt: null,
      workspace: { ownerId: "user-1" },
    });

    const result = await service.compile("user-1", "project-1", "短款夹克");

    expect(result.silhouetteReferences).toEqual([]);
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

  it("LLM 回退只记录脱敏原因，不记录用户提示词或上游响应", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {
      // 测试中抑制预期的回退日志。
    });
    vi.mocked(model.enhancePrompt).mockRejectedValue(
      new Error("Amux Claude 请求失败（HTTP 503）：敏感上游内容"),
    );

    try {
      const result = await service.compile(
        "user-1",
        undefined,
        "private user prompt",
      );

      expect(result.enhancement).toBe("keywords");
      expect(warn).toHaveBeenCalledWith(
        "提示词增强失败，已回退为关键词编译；reason=upstream_http_503",
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        "private user prompt",
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain("敏感上游内容");
    } finally {
      warn.mockRestore();
    }
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
              shapeType: { not: "fashion-connector" },
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
