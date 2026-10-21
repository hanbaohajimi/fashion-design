import { FileStatus } from "@fashion/db";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FilesService } from "../files/files.service";
import { CollectionsService } from "../collections/collections.service";
import { WorkflowRuntimeService } from "../workflow-runtime/workflow-runtime.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "./workflows.service";

function setup(role: "EDITOR" | "REVIEWER" | "VIEWER" = "EDITOR") {
  const file = {
    id: "shared-file",
    ownerId: "owner",
    objectKey: "originals/owner/shared-file/source",
    mimeType: "image/png",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
    status: FileStatus.READY,
    thumbnail1024Key: "thumbs/shared.webp",
    thumbnail256Key: "thumbs/shared-small.webp",
    fabricMainImages: [],
    originalName: "参考图.png",
  };
  const database = {
    project: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: "project",
          wsId: "workspace",
          deletedAt: null,
          archived: false,
          workspace: { ownerId: "owner" },
        }),
      findFirst: vi.fn().mockResolvedValue({ id: "project" }),
    },
    workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role }) },
    fileAsset: { findUnique: vi.fn().mockResolvedValue(file), create: vi.fn() },
    workflowProposal: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    workflowAttempt: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    workflowExecution: {
      findUnique: vi.fn().mockResolvedValue({ userId: "original-editor" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    generationTask: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(database),
    ),
    workflowMutation: { findUnique: vi.fn() },
    collection: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: "collection",
          projectId: "project",
          name: "春夏",
          dna: {
            fabrics: [],
            palette: [],
            silhouettes: [],
            moodWords: [],
            signatureDetails: [],
            paletteLocked: false,
          },
          heroAsset: { id: "hero", url: "https://images.test/hero.png" },
        }),
    },
    collectionDna: { update: vi.fn() },
  };
  const access = new ProjectAccessPolicy(database as never);
  const storage = {
    createDownloadUrl: vi.fn().mockResolvedValue("https://private.test/signed"),
    head: vi.fn(),
    createUploadUrl: vi.fn(),
  };
  const generation = {
    createForCollection: vi.fn().mockResolvedValue({ taskId: "task" }),
    createFromAgent: vi.fn(),
    get: vi.fn(),
  };
  const graph = {
    projectId: "project",
    revision: 1,
    layoutRevision: 0,
    nodes: [],
    edges: [],
    legacyAvailable: false,
  };
  const workflows = { get: vi.fn().mockResolvedValue(graph) };
  const files = new FilesService(
    database as never,
    storage as never,
    { enqueue: vi.fn() },
    access,
  );
  const runtime = new WorkflowRuntimeService(
    database as never,
    workflows as never,
    generation as never,
    {} as never,
    storage as never,
    {} as never,
    undefined,
    undefined,
    access,
  );
  return {
    database,
    file,
    access,
    storage,
    generation,
    workflows,
    files,
    runtime,
  };
}

describe("共享项目旧模块权限", () => {
  it.each(["REVIEWER", "VIEWER"] as const)(
    "%s 可以读已有状态，不能通过轮询触发恢复生成",
    async (role) => {
      const { runtime, database, generation } = setup(role);
      expect(await runtime.sync("member", "project")).toMatchObject({
        projectId: "project",
        proposals: [],
      });
      expect(generation.createFromAgent).not.toHaveBeenCalled();
      expect(database.workflowAttempt.findMany).not.toHaveBeenCalled();
      await expect(
        runtime.execute("member", "project", "tool", {} as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        runtime.inferRole("member", "project", "reference", {} as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        runtime.setAgentVersion("member", "project", 2),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it.each(["REVIEWER", "VIEWER"] as const)(
    "%s 不能修改画布、上传文件或修改系列DNA",
    async (role) => {
      const h = setup(role);
      const workflows = new WorkflowsService(h.database as never, h.access);
      await expect(
        workflows.patch("member", "project", {} as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.database.workflowMutation.findUnique).not.toHaveBeenCalled();
      await expect(
        h.files.signUpload("member", { projectId: "project" } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.storage.createUploadUrl).not.toHaveBeenCalled();
      const collections = new CollectionsService(
        h.database as never,
        {} as never,
        h.generation as never,
        h.storage as never,
        h.access,
      );
      await expect(
        collections.updateDna("member", "collection", {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.database.collectionDna.update).not.toHaveBeenCalled();
    },
  );

  it("EDITOR 可用共享系列创建Look，调用保留实际发起人身份", async () => {
    const h = setup("EDITOR");
    const collections = new CollectionsService(
      h.database as never,
      {} as never,
      h.generation as never,
      h.storage as never,
      h.access,
    );
    expect(
      await collections.createLook(
        "member",
        "collection",
        { variationAxis: "color" },
        "new-look",
      ),
    ).toEqual({ taskId: "task" });
    expect(h.generation.createForCollection).toHaveBeenCalledWith(
      "member",
      expect.objectContaining({ projectId: "project", parentAssetId: "hero" }),
      expect.objectContaining({ collectionId: "collection" }),
      "new-look",
    );
  });

  it("成员可读取项目明确引用的缩略图，撤销成员后同一URL重新请求立即拒绝", async () => {
    const h = setup("VIEWER");
    expect(await h.files.thumbnailUrl("member", "shared-file", "1024")).toBe(
      "https://private.test/signed",
    );
    h.database.workspaceMember.findUnique.mockResolvedValue(null);
    await expect(
      h.files.thumbnailUrl("member", "shared-file", "1024"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.storage.createDownloadUrl).toHaveBeenCalledTimes(1);
    await expect(h.runtime.sync("member", "project")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("共享资格不公开同一owner的私人文件，也不授权完成他人上传", async () => {
    const h = setup("EDITOR");
    h.database.project.findFirst.mockResolvedValue(null);
    await expect(
      h.files.get("member", "private-unreferenced"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      h.files.complete("member", "shared-file"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.storage.head).not.toHaveBeenCalled();
    expect(h.storage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it("EDITOR 的上传仍归上传人，项目owner不会变成文件私有库拥有者", async () => {
    const h = setup("EDITOR");
    h.database.fileAsset.findUnique.mockResolvedValue({
      ...h.file,
      ownerId: "member",
    });
    const result = await h.files.signUpload("member", {
      mimeType: "image/png",
      name: "参考图.png",
      projectId: "project",
      sha256: h.file.sha256,
      size: 1024,
    });
    expect(result.deduplicated).toBe(true);
    expect(h.database.fileAsset.findUnique).toHaveBeenCalledWith({
      where: { ownerId_sha256: { ownerId: "member", sha256: h.file.sha256 } },
    });
  });
});

describe("共享工作流的恢复身份", () => {
  const pending = {
    id: "attempt",
    executionId: "execution",
    toolNodeId: "tool",
    executionKey: "frozen-execution-key",
    updatedAt: new Date(),
    requestSnapshot: {
      request: {
        taskType: "t2i",
        projectId: "project",
        prompt: "大衣",
        width: 1024,
        height: 1024,
      },
    },
  };
  it("another editor polling recovers with the original actor and stable generation key", async () => {
    const h = setup("EDITOR");
    h.database.workflowAttempt.findMany.mockResolvedValue([pending]);
    h.generation.createFromAgent.mockResolvedValue({ taskId: "task-original" });
    await h.runtime.sync("second-editor", "project");
    expect(h.generation.createFromAgent).toHaveBeenCalledWith(
      "original-editor",
      expect.objectContaining({ projectId: "project" }),
      "frozen-execution-key",
      "大衣",
    );
    expect(h.database.workflowAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { generationTaskId: "task-original", status: "running" },
      }),
    );
  });
  it("does not restart an unsubmitted attempt after its original actor loses edit access", async () => {
    const h = setup("EDITOR");
    h.database.workspaceMember.findUnique.mockImplementation(
      async (args: { where: { workspaceId_userId: { userId: string } } }) =>
        args.where.workspaceId_userId.userId === "original-editor"
          ? null
          : { role: "EDITOR" },
    );
    h.database.workflowAttempt.findMany.mockResolvedValue([pending]);
    await h.runtime.sync("second-editor", "project");
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
    expect(h.database.workflowAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "attempt",
          generationTaskId: null,
        }),
        data: expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("权限已撤销"),
        }),
      }),
    );
  });
});
