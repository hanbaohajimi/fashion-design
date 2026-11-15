import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextCompilerService, compilePaletteColor } from "./context-compiler.service";

function element(id: string, shapeType = "fashion-image", props: Record<string, unknown> = {}) {
  return { id, shapeId: `shape:${id}`, shapeType, fileAssetId: null, fileAsset: null, record: { props }, role: "avoid", roleLabel: "旧用途不应进入新输入" };
}

describe("按本次文字要求编译真实引用", () => {
  const db = {
    project: { findUnique: vi.fn() }, designAsset: { findFirst: vi.fn() }, fabric: { findFirst: vi.fn() }, trendItem: { findFirst: vi.fn() },
  };
  const access = { require: vi.fn() };
  const model = { analyzeImage: vi.fn(), enhancePrompt: vi.fn() };
  const storage = { createDownloadUrl: vi.fn(async (key: string) => `https://signed.example/${key}`) };
  const compiler = new ContextCompilerService(db as never, model, storage, access as never);
  beforeEach(() => {
    vi.clearAllMocks(); access.require.mockResolvedValue({ ownerId: "owner" });
    db.project.findUnique.mockResolvedValue({ deletedAt: null, boardElements: [] });
    db.designAsset.findFirst.mockResolvedValue(null); db.fabric.findFirst.mockResolvedValue(null); db.trendItem.findFirst.mockResolvedValue(null);
  });

  it("没有显式引用时不隐式使用整张白板，也不调用角色识别或提示词增强", async () => {
    const result = await compiler.compile("user", "project", "制作棉质外套");
    expect(result.positivePrompt).toBe("制作棉质外套"); expect(result.mode).toBe("text_only");
    expect(result.orderedReferences).toEqual([]); expect(db.project.findUnique).not.toHaveBeenCalled();
    expect(model.analyzeImage).not.toHaveBeenCalled(); expect(model.enhancePrompt).not.toHaveBeenCalled();
  });

  it("以引用顺序排列原始图片，忽略旧用途和权重，快照只保留身份", async () => {
    const a = { ...element("a"), fileAssetId: "file-a", fileAsset: { objectKey: "original/a.png", status: "READY", thumbnail1024Key: "thumb/a.webp" } };
    const b = { ...element("b", "fashion-image", { role: "silhouette_ref", weight: 0.9 }), fileAssetId: "file-b", fileAsset: { objectKey: "original/b.png", status: "READY", thumbnail1024Key: null } };
    db.project.findUnique.mockResolvedValue({ deletedAt: null, boardElements: [a, b] });
    const result = await compiler.compile("user", "project", "保留图1颜色，修改图2版型", ["shape:b", "shape:a"]);
    expect(result.orderedReferences?.map((ref) => [ref.order, ref.imageUrl])).toEqual([[0, "https://signed.example/original/b.png"], [1, "https://signed.example/original/a.png"]]);
    expect(result.positivePrompt).toBe("保留图1颜色，修改图2版型"); expect(result.negativePrompt).toBe("");
    expect(result.styleReferences).toEqual([]); expect(result.silhouetteReferences).toEqual([]);
    expect(JSON.stringify(result.sources)).not.toMatch(/signed|silhouette|weight|旧用途/u);
    expect(model.analyzeImage).not.toHaveBeenCalled();
  });

  it("同一素材可以按两次不同文字要求使用，不继承上一次用途", async () => {
    const a = { ...element("a"), fileAsset: { objectKey: "a.png", status: "READY", thumbnail1024Key: null } };
    db.project.findUnique.mockResolvedValue({ deletedAt: null, boardElements: [a] });
    const first = await compiler.compile("u", "p", "图1作为色彩参考", ["shape:a"]);
    const second = await compiler.compile("u", "p", "仅提取图1的口袋造型", ["shape:a"]);
    expect(first.positivePrompt).toBe("图1作为色彩参考"); expect(second.positivePrompt).toBe("仅提取图1的口袋造型");
  });

  it("按实际色卡值和文字内容编译，数据修改不影响已编译的快照", async () => {
    const note = element("note", "fashion-note", { title: "要求", text: "保留袖口" });
    const swatch = element("colors", "fashion-swatch", { colors: [{ color: "#ff2200", label: "蓝色" }, { color: "#123456", label: "色2" }] });
    db.project.findUnique.mockResolvedValue({ deletedAt: null, boardElements: [note, swatch] });
    const result = await compiler.compile("u", "p", "更换配色", ["shape:colors", "shape:note"]);
    note.record.props.text = "更改袖口";
    expect(result.palette).toEqual(["#FF2200", "#123456"]); expect(result.positivePrompt).toContain("素材1的色值：#FF2200、#123456");
    expect(result.positivePrompt).toContain("保留袖口"); expect(result.positivePrompt).not.toContain("蓝色");
  });

  it("不接受没有项目归属的任意 URL 或失效图片", async () => {
    db.project.findUnique.mockResolvedValue({ deletedAt: null, boardElements: [element("a", "fashion-image", { url: "https://untrusted.example/a" })] });
    expect((await compiler.compile("u", "p", "要求", ["shape:a"])).orderedReferences).toEqual([]);
    db.project.findUnique.mockResolvedValue({ deletedAt: null, boardElements: [{ ...element("a"), fileAsset: { objectKey: "a", status: "PROCESSING", thumbnail1024Key: null } }] });
    await expect(compiler.compile("u", "p", "要求", ["shape:a"])).rejects.toMatchObject({ status: 400 });
    await expect(compiler.compile("u", "p", "要求", ["shape:missing"])).rejects.toMatchObject({ status: 400 });
  });

  it("生成图片使用项目内资产的真实存储地址", async () => {
    db.project.findUnique.mockResolvedValue({ deletedAt: null, boardElements: [element("a", "fashion-image", { assetId: "asset" })] });
    db.designAsset.findFirst.mockResolvedValue({ url: "s3://private/original.png" });
    const result = await compiler.compile("u", "project", "要求", ["shape:a"]);
    expect(db.designAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "asset", projectId: "project", archivedAt: null } }));
    expect(result.orderedReferences?.[0]?.imageUrl).toBe("https://signed.example/private/original.png");
  });

  it("面料引用读取真实面料图，不把检索关键词变成用途指令", async () => {
    db.project.findUnique.mockResolvedValue({ deletedAt: null, boardElements: [element("fabric", "fashion-fabric", { fabricId: "fabric", fabricTags: ["春夏", "棉麻"] })] });
    db.fabric.findFirst.mockResolvedValue({ tags: ["春夏", "棉麻"], mainFile: { status: "READY", objectKey: "fabric.png" } });
    const result = await compiler.compile("u", "p", "使用图1的纹理", ["shape:fabric"]);
    expect(result.positivePrompt).toBe("使用图1的纹理"); expect(result.orderedReferences?.[0]?.imageUrl).toBe("https://signed.example/fabric.png");
  });

  it("拒绝未完成重新渲染的草图和过长输入，避免悄悄使用旧图或截断要求", async () => {
    db.project.findUnique.mockResolvedValue({ deletedAt: null, boardElements: [{ ...element("a"), record: { props: {}, meta: { fashionSketch: true, sketchDirty: true, sketchStatus: "draft" } } }] });
    await expect(compiler.compile("u", "p", "要求", ["shape:a"])).rejects.toMatchObject({ status: 400 });
    await expect(compiler.compile("u", undefined, "长".repeat(4001))).rejects.toMatchObject({ status: 400 });
  });

  it("权限失败不读取任何图片", async () => {
    access.require.mockRejectedValueOnce(new ForbiddenException());
    await expect(compiler.compile("foreign", "p", "要求", ["shape:a"])).rejects.toMatchObject({ status: 403 });
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });
  it("精确 HEX 优先于显示名称", () => {
    expect(compilePaletteColor("aabbcc", "蓝")).toBe("#AABBCC"); expect(compilePaletteColor("invalid", "墨蓝")).toBe("墨蓝");
  });
});
