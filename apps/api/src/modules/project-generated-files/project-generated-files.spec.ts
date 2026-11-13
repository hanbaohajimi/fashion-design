import { BadRequestException, ForbiddenException, GoneException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ProjectGeneratedFilesService } from "./project-generated-files.service";
import { ProjectGeneratedFilesController } from "./project-generated-files.controller";
import { decodeGeneratedFileCursor, fileView, generatedFileBoundary, mergeGeneratedFiles } from "./generated-file-query";

const input = { kind: "all" as const, q: "", limit: 2 };
const at = new Date("2026-11-09T01:00:00.000Z");
function setup() {
  const table = () => ({ findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() });
  const db = { designAsset: table(), runwayMedia: table(), exportJob: table(), workflowNode: table(), studioDocument: table() };
  const access = { require: vi.fn().mockResolvedValue({ capabilities: { edit: false } }) };
  const storage = { head: vi.fn().mockResolvedValue({ contentType: "image/webp", contentLength: 1234 }), createDownloadUrl: vi.fn().mockResolvedValue("https://storage.example/signed") };
  return { db, access, storage, service: new ProjectGeneratedFilesService(db as never, access as never, storage as never) };
}

describe("项目生成文件", () => {
  it("媒体行定位原节点，图片筛选包含已支持的WEBP导出", async () => {
    const { db, service } = setup();
    db.runwayMedia.findMany.mockResolvedValue([{ id: "video", kind: "FINAL_VIDEO", mimeType: "video/mp4", createdAt: at, width: 240, height: 160, durationMs: 2000, sizeBytes: 100, originalName: "demo.mp4", runId: "run", run: { showId: "show", show: { title: "秋冬成片", archived: false } } }]);
    db.workflowNode.findMany.mockResolvedValue([{ id: "media-node", payload: { mediaId: "video" } }]);
    const page = await service.list("user", "project", { ...input, kind: "video" });
    expect(page.items[0]).toMatchObject({ domain: "runway", kind: "video", nodeId: "media-node" });
    await service.list("user", "project", { ...input, kind: "image" });
    expect(db.exportJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([{ format: { in: ["PNG", "JPG", "WEBP"] } }]) }) }));
  });
  it("读取权限在查询和签名前核验，不泄露跨项目结果", async () => {
    const { db, access, storage, service } = setup(); access.require.mockRejectedValue(new ForbiddenException());
    await expect(service.list("outsider", "project", input)).rejects.toThrow(ForbiddenException);
    await expect(service.download("outsider", "project", "asset", "id")).rejects.toThrow(ForbiddenException);
    expect(db.designAsset.findMany).not.toHaveBeenCalled(); expect(db.designAsset.findFirst).not.toHaveBeenCalled(); expect(storage.head).not.toHaveBeenCalled();
  });
  it("同时间跨领域合并稳定；游标限定项目、类型和搜索词", () => {
    const rows = [fileView("asset", "z", at), fileView("runway", "a", at), fileView("export", "a", at)];
    const page = mergeGeneratedFiles(rows, "project", input);
    expect(page.items.map(row => row.id)).toEqual(["runway:a", "export:a"]);
    const cursor = decodeGeneratedFileCursor(page.nextCursor ?? undefined, "project", input);
    expect(generatedFileBoundary(cursor, "asset")).toEqual({ OR: [{ createdAt: { lt: at } }, { createdAt: at }] });
    expect(generatedFileBoundary(cursor, "runway")).toEqual({ OR: [{ createdAt: { lt: at } }] });
    expect(generatedFileBoundary(cursor, "export")).toEqual({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "a" } }] });
    for (const [project, query] of [["other", input], ["project", { ...input, kind: "image" as const }], ["project", { ...input, q: "changed" }]] as const) expect(() => decodeGeneratedFileCursor(page.nextCursor ?? undefined, project, query)).toThrow(BadRequestException);
    for (const value of ["invalid", Buffer.from(JSON.stringify({ project: "project", kind: "all", q: "", domain: "asset", date: "2026-01-01", id: "x" })).toString("base64url")]) expect(() => decodeGeneratedFileCursor(value, "project", input)).toThrow(BadRequestException);
  });
  it("列表读取已有产物，分类型不查无关领域，过期状态只投影不写入", async () => {
    const { db, service, access } = setup();
    db.exportJob.findMany.mockResolvedValue([{ id: "pdf", createdAt: at, status: "SUCCEEDED", expiresAt: at, fileName: "秋冬.pdf", format: "PDF", objectKey: "private/pdf", sizeBytes: 180, studioRevisionId: "doc-rev" }]);
    db.studioDocument.findMany.mockResolvedValue([{ id: "doc-rev", type: "TECH_PACK", documentId: "tech-1", styleRevisionId: "style-2" }]);
    const page = await service.list("viewer", "p", { kind: "document", q: "秋冬", limit: 1 });
    expect(access.require).toHaveBeenCalledWith("viewer", "p", "read");
    expect(db.designAsset.findMany).not.toHaveBeenCalled(); expect(db.runwayMedia.findMany).not.toHaveBeenCalled();
    expect(page.items[0]).toMatchObject({ kind: "document", status: "expired", contentUrl: null, sourceHref: "/p/studio?tab=tech&documentId=tech-1&documentRevisionId=doc-rev&styleRevisionId=style-2" });
    expect(db.exportJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, where: expect.objectContaining({ projectId: "p", status: { in: ["SUCCEEDED", "EXPIRED"] } }) }));
  });
  it("下载重新读取原文件类型，正确命名并限制签名时长", async () => {
    const { db, storage, service } = setup(); db.designAsset.findFirst.mockResolvedValue({ id: "id", operation: "GENERATED", url: "s3://private/original" });
    expect(await service.download("u", "p", "asset", "id")).toEqual({ url: "https://storage.example/signed", fileName: "生成设计-id.webp" });
    expect(storage.createDownloadUrl).toHaveBeenCalledWith("private/original", 60, "生成设计-id.webp");
    expect(db.designAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: expect.arrayContaining([expect.objectContaining({ projectId: "p" }), { id: "id", operation: { not: "IMPORTED" } }]) } }));
  });
  it("来源已删除的导出保留记录，不跳转到无关展示稿", async () => {
    const { db, service } = setup();
    db.exportJob.findMany.mockResolvedValue([{ id: "orphan", createdAt: at, status: "EXPIRED", expiresAt: at, fileName: "旧稿.pdf", format: "PDF", studioRevisionId: "deleted-revision" }]);
    const page = await service.list("viewer", "project", input);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ resourceId: "orphan", status: "expired", sourceHref: null });
  });
  it("过期、输入媒体、外部历史地址和缺失文件不签名", async () => {
    const { db, storage, service } = setup();
    db.exportJob.findFirst.mockResolvedValue({ status: "SUCCEEDED", expiresAt: at });
    await expect(service.download("u", "p", "export", "e")).rejects.toThrow(GoneException);
    db.runwayMedia.findFirst.mockResolvedValue({ source: { input: true }, objectKey: "private/input" });
    await expect(service.download("u", "p", "runway", "r")).rejects.toThrow("不存在");
    db.designAsset.findFirst.mockResolvedValue({ url: "https://example.org/old.png" });
    await expect(service.download("u", "p", "asset", "a")).rejects.toThrow("外部图片");
    db.designAsset.findFirst.mockResolvedValue({ url: "s3://missing" }); storage.head.mockRejectedValue(new Error("NoSuchKey"));
    await expect(service.download("u", "p", "asset", "a")).rejects.toThrow("记录仍已保留");
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });
  it("拒绝错误分页、类型和超长搜索，不把参数传到查询", () => {
    const files = { list: vi.fn(), download: vi.fn() }, controller = new ProjectGeneratedFilesController(files as never);
    controller.list({ userId: "u" } as never, "p", {});
    expect(files.list).toHaveBeenCalledWith("u", "p", { kind: "all", q: "", limit: 30 });
    for (const query of [{ kind: "unknown" }, { limit: "0" }, { limit: "61" }, { q: "x".repeat(121) }, { cursor: ["a", "b"] }, { extra: "1" }]) expect(() => controller.list({ userId: "u" } as never, "p", query)).toThrow(BadRequestException);
    expect(() => controller.download({ userId: "u" } as never, "p", "file", "x")).toThrow(BadRequestException);
  });
});
