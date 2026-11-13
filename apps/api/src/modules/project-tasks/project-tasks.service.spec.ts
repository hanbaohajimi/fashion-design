import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ProjectTasksService } from "./project-tasks.service";

const date = new Date("2026-10-28T00:00:00.000Z");
const row = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  status: "QUEUED",
  createdAt: date,
  updatedAt: date,
  ...fields,
});
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function setup(editable = true) {
  const store = () => ({ findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) });
  const database = {
    generationTask: store(),
    workflowExecution: store(),
    agentRun: store(),
    runwayRun: store(),
    exportJob: store(),
    agentMessage: store(),
    workflowProposal: store(),
    workflowAttempt: store(),
    studioDocument: store(),
    studioReviewRead: store(),
  };
  const access = { require: vi.fn().mockResolvedValue({ capabilities: { edit: editable } }) };
  return { database, access, service: new ProjectTasksService(database as never, access as never) };
}

describe("项目任务聚合", () => {
  it("活动摘要沿用项目权限；权限失败时不查询任何领域", async () => {
    const { database, access, service } = setup();
    access.require.mockRejectedValueOnce(new Error("无权读取项目"));
    await expect(service.list("outsider", "private", { group: "active", limit: 1, activity: true })).rejects.toThrow("无权读取项目");
    expect(database.generationTask.findMany).not.toHaveBeenCalled();
    expect(database.generationTask.groupBy).not.toHaveBeenCalled();
  });

  it("摘要不受分页、分组和游标限制，旧请求不增加字段或摘要查询", async () => {
    const { database, service } = setup(false);
    database.generationTask.findMany.mockImplementation(query => query.orderBy[0].updatedAt
      ? [row("newly-finished", { status: "SUCCEEDED", updatedAt: new Date("2026-11-08T10:00:00Z") })] : []);
    database.generationTask.groupBy.mockResolvedValue([{ status: "SUCCEEDED", _count: { _all: 1 } }]);
    const result = await service.list("viewer", "project-a", { group: "ended", limit: 1, cursor: cursor({ date: date.toISOString(), id: "generation:a" }), activity: true });
    expect(result.items).toEqual([]);
    expect(result.activity?.recent).toMatchObject([{ id: "generation:newly-finished", outcome: "completed" }]);
    expect(database.generationTask.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 20, where: expect.not.objectContaining({ OR: expect.anything() }) }));
    database.generationTask.groupBy.mockClear();
    const legacy = await service.list("viewer", "project-a", { group: "active", limit: 30 });
    expect(legacy).not.toHaveProperty("activity");
    expect(database.generationTask.groupBy).not.toHaveBeenCalled();
  });

  it("按导出来源定位展示稿、技术包和图片，并保留款式修订", async () => {
    const { database, service } = setup();
    database.exportJob.findMany.mockResolvedValue([
      row("presentation", { studioRevisionId: "presentation-document", designAssetId: null, collectionId: null }),
      row("tech", { studioRevisionId: "tech-document", designAssetId: null, collectionId: null }),
      row("image", { studioRevisionId: null, designAssetId: "asset/a", collectionId: null }),
      row("collection", { studioRevisionId: null, designAssetId: null, collectionId: "collection-a" }),
    ]);
    database.studioDocument.findMany.mockResolvedValue([
      { id: "presentation-document", type: "PRESENTATION_SET", styleRevisionId: "style/a" },
      { id: "tech-document", type: "TECH_PACK", styleRevisionId: "style-b" },
    ]);

    const page = await service.list("user-a", "project/a", { group: "active", limit: 30 });
    const byId = new Map(page.items.map(item => [item.id, item]));
    expect(byId.get("export:presentation")?.href).toBe("/project%2Fa/studio?tab=presentation&styleRevisionId=style%2Fa");
    expect(byId.get("export:tech")?.href).toBe("/project%2Fa/studio?tab=tech&styleRevisionId=style-b");
    expect(byId.get("export:image")?.href).toBe("/project%2Fa/studio?tab=styles&assetId=asset%2Fa");
    expect(byId.get("export:collection")?.objectId).toBe("collection-a");
    expect(database.studioDocument.findMany).toHaveBeenCalledTimes(2);
    expect(database.studioDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: "project/a", id: { in: ["presentation-document", "tech-document"] } },
    }));
  });

  it("缺失导出来源时回到项目工作室，不猜测文档类型", async () => {
    const { database, service } = setup();
    database.exportJob.findMany.mockResolvedValue([row("missing", { studioRevisionId: "missing-document" })]);
    const page = await service.list("user-a", "project-a", { group: "active", limit: 30 });
    expect(page.items[0]?.href).toBe("/project-a/studio");
  });

  it("同一时刻的排序与游标使用相同的 ID 比较规则", async () => {
    const { database, service } = setup();
    const tasks = ["z", "a", "A"].map(id => row(id, { generatedAssets: [], parentAssetId: null }));
    database.generationTask.findMany.mockResolvedValue(tasks);
    const ids: string[] = [];
    let next: string | undefined;
    for (let index = 0; index < 4; index += 1) {
      const page = await service.list("user-a", "project-a", { group: "active", limit: 1, cursor: next });
      ids.push(...page.items.map(item => item.id));
      next = page.nextCursor ?? undefined;
      if (!next) break;
    }
    expect(ids).toEqual(["generation:z", "generation:a", "generation:A"]);
  });

  it("等价时区的游标按同一时刻过滤，不漏掉边界任务", async () => {
    const { database, service } = setup();
    database.generationTask.findMany.mockResolvedValue([row("a", { generatedAssets: [], parentAssetId: null })]);
    const page = await service.list("user-a", "project-a", {
      group: "active", limit: 30,
      cursor: cursor({ date: "2026-10-27T20:00:00.000-04:00", id: "generation:z" }),
    });
    expect(page.items.map(item => item.id)).toEqual(["generation:a"]);
  });

  it.each([
    null,
    { date: 0, id: "generation:a" },
    { date: "2026-10-28T00:00:00.000Z", id: "unknown:a" },
    { date: "2026-10-28T00:00:00.000Z", id: "generation:" },
    { date: "not-a-date", id: "generation:a" },
  ])("拒绝结构无效的游标 %j", async value => {
    const { database, service } = setup();
    await expect(service.list("user-a", "project-a", { group: "active", limit: 30, cursor: cursor(value) })).rejects.toBeInstanceOf(BadRequestException);
    expect(database.generationTask.findMany).not.toHaveBeenCalled();
  });

  it("只读成员可定位任务，但不能取消助手回复", async () => {
    const { database, access, service } = setup(false);
    database.agentMessage.findMany.mockResolvedValue([
      row("reply-a", { status: "PENDING", conversationId: "conversation-a", replyTo: { clientRequestId: "request-a" } }),
    ]);
    const page = await service.list("viewer-a", "project-a", { group: "running", limit: 30 });
    expect(access.require).toHaveBeenCalledWith("viewer-a", "project-a", "read");
    expect(page.items[0]).toMatchObject({ group: "running", actions: [], href: "/project-a?conversationId=conversation-a" });
    expect(database.studioDocument.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "project-a", type: "REVIEW", payload: { path: ["decision"], equals: "CHANGES_REQUESTED" }, reviewReads: { none: { userId: "viewer-a" } } } }),
    );
  });

  it("公开评审要求修改会进入待处理，批准记录不会继续占用 attention", async () => {
    const { database, service } = setup();
    database.studioDocument.findMany.mockResolvedValue([
      row("review-change", {
        payload: {
          name: "公开评审",
          targetType: "STYLE",
          targetRevisionId: "style-r3",
          decision: "CHANGES_REQUESTED",
          text: "请重新核对袖口结构",
        },
      }),
      row("review-approved", {
        payload: {
          name: "公开评审",
          targetType: "STYLE",
          targetRevisionId: "style-r2",
          decision: "APPROVED",
          text: "当前版本可以继续交付",
        },
      }),
    ]);

    const page = await service.list("user-a", "project-a", { group: "attention", limit: 30 });

    expect(page.items).toMatchObject([
      {
        id: "review:review-change",
        domain: "review",
        group: "attention",
        href: "/project-a/studio?tab=team&reviewId=review-change",
        objectId: "style-r3",
      },
    ]);
    expect(database.studioDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [expect.objectContaining({ payload: { path: ["decision"], equals: "CHANGES_REQUESTED" }, reviewReads: { none: { userId: "user-a" } } }), {}] },
      take: 31,
    }));
  });
});
