import { amuxClaudeClientConfigFromEnv, visualSummaryFingerprint } from "@fashion/ai";
import { VISUAL_SUMMARY_SCHEMA_VERSION } from "@fashion/shared";
import { describe, expect, it, vi } from "vitest";

import { VisualContextService } from "./visual-context.service";

const bytes = Buffer.from("RIFF0000WEBPvisible-image");
const summary = { subject: "银色短夹克", silhouette: ["短款宽松"], visibleStructure: ["前中拉链"],
  colors: ["银色"], surfaceTexture: ["反光表面"], uncertainties: ["无法确认纤维成分和尺寸"] };
type Row = { fingerprint: string; sourceKey: string; model: string; schemaVersion: string;
  status: string; summary: unknown; updatedAt: Date };
function setup() {
  const rows = new Map<string, Row>();
  const files = new Map<string, { id: string; ownerId: string; status: string; thumbnail1024Key: string | null }>();
  const database = {
    project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user" } }) },
    fileAsset: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => files.get(where.id) ?? null) },
    designAsset: { findUnique: vi.fn().mockResolvedValue(null) },
    fabric: { findUnique: vi.fn().mockResolvedValue(null) },
    trendItem: { findUnique: vi.fn().mockResolvedValue(null) },
    boardElement: { findUnique: vi.fn().mockResolvedValue(null) },
    imageVisualSummary: {
      findFirst: vi.fn(async ({ where }: { where: { sourceKey: string; model: string; schemaVersion: string } }) =>
        [...rows.values()].find((row) => row.sourceKey === where.sourceKey && row.model === where.model && row.schemaVersion === where.schemaVersion) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { fingerprint: string } }) => rows.get(where.fingerprint) ?? null),
      upsert: vi.fn(async ({ where, create }: { where: { fingerprint: string }; create: Row }) => {
        const row = rows.get(where.fingerprint) ?? { ...create, updatedAt: new Date() };
        rows.set(row.fingerprint, row); return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Partial<Row>; data: Partial<Row> }) => {
        const row = where.fingerprint ? rows.get(where.fingerprint) : undefined;
        if (!row || (where.status && row.status !== where.status) ||
          (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime())) return { count: 0 };
        rows.set(row.fingerprint, { ...row, ...data, updatedAt: new Date() });
        return { count: 1 };
      }),
    },
  };
  const storage = { readPrefix: vi.fn().mockResolvedValue(bytes) };
  const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const service = new VisualContextService(database as unknown as ConstructorParameters<typeof VisualContextService>[0], storage, jobs);
  const addFile = (id: string, status = "READY", ownerId = "user") => files.set(id,
    { id, ownerId, status, thumbnail1024Key: status === "READY" ? `thumbnails/${id}/1024.webp` : null });
  return { service, database, rows, files, addFile, storage, jobs };
}

describe("VisualContextService", () => {
  it("reference_image 缺失文件引用仍计入全图图片覆盖并报告不可用", async () => {
    const { service, storage, jobs } = setup();
    const result = await service.enrich("user", "project", [
      { id: "missing-reference", type: "reference_image", payload: { title: "旧参考图" } },
      { id: "text", type: "reference_text", payload: { text: "参考说明" } },
    ]);
    expect(result.index).toEqual([{ nodeId: "missing-reference", assetId: null, fileAssetId: null,
      status: "unavailable", summary: null, error: "图片缺失、无权访问或没有可信的存储引用" }]);
    expect(result.coverage).toMatchObject({ total: 1, failed: 1, unreadNodeIds: ["missing-reference"] });
    expect(storage.readPrefix).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("先筛选真实图片再限额，焦点优先且不遗漏前八个文本节点之后的图片", async () => {
    const { service, addFile } = setup();
    const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `text-${i}`, type: "requirement", payload: { text: "需求" } }));
    const imageNodes = Array.from({ length: 10 }, (_, i) => {
      addFile(`file-${i}`); return { id: `image-${i}`, type: "reference", payload: { fileAssetId: `file-${i}` } };
    });
    const result = await service.enrich("user", "project", [...nodes, ...imageNodes], ["image-9"]);
    expect(result.index).toHaveLength(10);
    expect(result.images).toHaveLength(8);
    expect(result.imageBindings[0]).toMatchObject({ nodeId: "image-9", imageIndex: 0, fileAssetId: "file-9" });
    expect(result.coverage.unreadNodeIds).toHaveLength(2);
    expect(JSON.stringify(result.index)).not.toContain("thumbnails/");
  });

  it("同一内容去重并使用 model 与摘要版本缓存，不以角色当描述", async () => {
    const { service, addFile, rows, jobs } = setup();
    addFile("a"); addFile("b");
    const fingerprint = visualSummaryFingerprint(bytes, amuxClaudeClientConfigFromEnv().model);
    rows.set(fingerprint, { fingerprint, sourceKey: "thumbnails/a/1024.webp", status: "READY", summary,
      model: amuxClaudeClientConfigFromEnv().model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION, updatedAt: new Date() });
    const result = await service.enrich("user", "project", [
      { id: "a", type: "reference", payload: { fileAssetId: "a", role: "silhouette_ref" } },
      { id: "b", type: "reference", payload: { fileAssetId: "b" } },
    ]);
    expect(result.index.every((entry) => entry.status === "ready" && entry.summary?.subject === "银色短夹克")).toBe(true);
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(visualSummaryFingerprint(bytes, "different-model")).not.toBe(fingerprint);
    expect(visualSummaryFingerprint(bytes, amuxClaudeClientConfigFromEnv().model, `${VISUAL_SUMMARY_SCHEMA_VERSION}/next`)).not.toBe(fingerprint);
  });

  it("明确报告未就绪、缺失、无权访问，且不会读取未授权文件", async () => {
    const { service, addFile, storage } = setup();
    addFile("pending", "PROCESSING"); addFile("foreign", "READY", "other-user");
    const result = await service.enrich("user", "project", ["pending", "missing", "foreign"].map((id) =>
      ({ id, type: "sketch", payload: { fileAssetId: id } })));
    expect(result.index.map((entry) => entry.status)).toEqual(["not_ready", "unavailable", "unavailable"]);
    expect(storage.readPrefix).not.toHaveBeenCalled();
    expect(result.coverage).toMatchObject({ pending: 1, failed: 2, attachedNodeIds: [] });
  });

  it("升级摘要契约后不复用旧版本可能包含成分猜测的摘要", async () => {
    const { service, addFile, rows, jobs } = setup(); addFile("a");
    const model = amuxClaudeClientConfigFromEnv().model;
    const oldVersion = `${VISUAL_SUMMARY_SCHEMA_VERSION}/old`;
    const fingerprint = visualSummaryFingerprint(bytes, model, oldVersion);
    rows.set(fingerprint, { fingerprint, sourceKey: "thumbnails/a/1024.webp", status: "READY",
      summary: { ...summary, surfaceTexture: ["旧版本的成分猜测"] }, model, schemaVersion: oldVersion, updatedAt: new Date() });
    const result = await service.enrich("user", "project", [{ id: "a", type: "reference_image", payload: { fileAssetId: "a" } }]);
    expect(result.index[0]).toMatchObject({ status: "pending", summary: null });
    expect(jobs.enqueue).toHaveBeenCalledWith({ source: { kind: "file", id: "a" }, model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION });
    expect(visualSummaryFingerprint(bytes, model)).not.toBe(fingerprint);
  });

  it("缓存失败不会声称已理解，实际图片仍可绑定本次请求", async () => {
    const { service, addFile, rows, jobs } = setup(); addFile("a");
    const model = amuxClaudeClientConfigFromEnv().model;
    const fingerprint = visualSummaryFingerprint(bytes, model);
    rows.set(fingerprint, { fingerprint, sourceKey: "thumbnails/a/1024.webp", status: "FAILED",
      summary: null, model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION, updatedAt: new Date() });
    const result = await service.enrich("user", "project", [{ id: "a", type: "candidate", payload: { fileAssetId: "a" } }]);
    expect(result.index[0]).toMatchObject({ status: "failed", summary: null });
    expect(result.coverage.attachedNodeIds).toEqual(["a"]);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("失败缓存冷却后只由一个CAS领取者重新投递，再次失败不会每次读取重试", async () => {
    const { service, addFile, rows, jobs, database } = setup(); addFile("a");
    const model = amuxClaudeClientConfigFromEnv().model;
    const fingerprint = visualSummaryFingerprint(bytes, model);
    const oldFailure = { fingerprint, sourceKey: "thumbnails/a/1024.webp", status: "FAILED",
      summary: null, model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION, updatedAt: new Date(Date.now() - 6 * 60_000) };
    rows.set(fingerprint, oldFailure);
    const node = { id: "a", type: "reference_image", payload: { fileAssetId: "a" } };
    const [first, concurrent] = await Promise.all([
      service.enrich("user", "project", [node]), service.enrich("user", "project", [node]),
    ]);
    expect(first.index[0]?.status).toBe("pending");
    expect(concurrent.index[0]?.status).toBe("pending");
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue).toHaveBeenCalledWith({ source: { kind: "file", id: "a" }, model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION });
    expect(database.imageVisualSummary.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { fingerprint, model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION, status: "FAILED", updatedAt: oldFailure.updatedAt },
      data: { status: "PENDING", error: null },
    }));
    rows.set(fingerprint, { ...oldFailure, updatedAt: new Date() });
    for (let i = 0; i < 3; i++) expect((await service.enrich("user", "project", [node])).index[0]?.status).toBe("failed");
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it("队列失败与缩略图读取失败保持明确的失败覆盖", async () => {
    const { service, addFile, jobs } = setup(); addFile("a");
    jobs.enqueue.mockRejectedValue(new Error("queue unavailable"));
    const result = await service.enrich("user", "project", [{ id: "a", type: "reference", payload: { fileAssetId: "a" } }]);
    expect(result.index[0]?.status).toBe("failed");
    expect(result.index[0]?.summary).toBeNull();
  });

  it("重复引用同一文件只入队一次，每个节点都保留自己的绑定", async () => {
    const { service, addFile, jobs, storage } = setup(); addFile("a");
    const result = await service.enrich("user", "project", [
      { id: "branch-a", type: "reference", payload: { fileAssetId: "a" } },
      { id: "branch-b", type: "sketch", payload: { fileAssetId: "a" } },
    ]);
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(storage.readPrefix).toHaveBeenCalledTimes(1);
    expect(result.imageBindings.map((binding) => binding.nodeId)).toEqual(["branch-a", "branch-b"]);
  });

  it("损坏的已完成缓存重新入队，不能当作已读取视觉事实", async () => {
    const { service, addFile, rows, jobs, database } = setup(); addFile("a");
    const model = amuxClaudeClientConfigFromEnv().model;
    const fingerprint = visualSummaryFingerprint(bytes, model);
    rows.set(fingerprint, { fingerprint, sourceKey: "thumbnails/a/1024.webp", status: "READY",
      summary: { role: "fashion_sketch" }, model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION, updatedAt: new Date() });
    const result = await service.enrich("user", "project", [{ id: "a", type: "reference", payload: { fileAssetId: "a" } }]);
    expect(result.index[0]).toMatchObject({ status: "pending", summary: null });
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(database.imageVisualSummary.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PENDING", error: null } }));
  });
});
