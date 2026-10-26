import type { PrismaClient } from "@fashion/db";
import { runwayActionSchema, runwayDraftSchema } from "@fashion/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectAccessPolicy } from "../studio/project-access.policy";
import { normalizedRange } from "./runway.controller";
import type { RunwayStorage } from "./runway-storage.service";
import { RunwayService } from "./runway.service";

const draft = {
  prompt: "亚麻夏季服装秀",
  modelCount: 2,
  withMusic: true,
  inputs: [],
};
function fixture() {
  vi.stubEnv("RUNWAY_ENABLED", "true");
  const now = new Date("2026-10-26T00:00:00Z");
  const run = {
    id: "run-a",
    showId: "show-a",
    projectId: "project-a",
    userId: "owner-a",
    status: "WAITING_INPUT",
    stage: "prepare",
    inputSnapshot: draft,
    modelSnapshot: {},
    state: { mediaByStage: { model: ["model-a"], cloth: ["cloth-a"] } },
    pendingInput: {
      interruptId: "interrupt-a",
      kind: "confirm",
      stage: "prepare",
      message: "请确认图片",
      mediaIds: ["model-a"],
    },
    version: 3,
    eventSequence: 4,
    parentRunId: null,
    parentStage: null,
    cancelRequestedAt: null as Date | null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    media: [],
    attempts: [],
  };
  let command: { kind: string; payload: unknown } | null = null;
  const database = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
    runwayRun: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(run)),
      update: vi.fn().mockImplementation(({ data }) => {
        if (data.status) run.status = data.status;
        if (data.version) run.version++;
        if (data.cancelRequestedAt)
          run.cancelRequestedAt = data.cancelRequestedAt;
        if (data.eventSequence) run.eventSequence++;
        return Promise.resolve(run);
      }),
    },
    runwayCommand: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve(command)),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(({ data }) => {
        command = data;
        return Promise.resolve(data);
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    runwayMedia: {
      findFirst: vi.fn().mockResolvedValue({
        id: "model-a",
        kind: "model",
        runId: "run-a",
        mimeType: "image/png",
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    runwayEvent: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    runwayWorkerHeartbeat: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  database.$transaction.mockImplementation((callback) => callback(database));
  const access = {
    require: vi.fn().mockResolvedValue({
      role: "EDITOR",
      capabilities: { edit: true },
      archived: false,
    }),
  };
  const storage = { copy: vi.fn(), get: vi.fn(), delete: vi.fn() };
  const service = new RunwayService(
    database as unknown as PrismaClient,
    access as unknown as ProjectAccessPolicy,
    storage as unknown as RunwayStorage,
  );
  return { service, database, access, run };
}
afterEach(() => vi.unstubAllEnvs());

describe("服装秀操作契约", () => {
  it("API 切换为真实模式后，旧模拟执行器不能冒充当前就绪能力", async () => {
    const { service, database } = fixture();
    vi.stubEnv("RUNWAY_PROVIDER_MODE", " LIVE ");
    const mockWorker = {
      mode: "mock",
      capabilities: { image: true, video: true, music: true },
    };
    database.runwayWorkerHeartbeat.findFirst.mockImplementation(
      async (query: { where: { mode: string } }) =>
        query.where.mode === mockWorker.mode ? mockWorker : null,
    );
    await expect(
      service.capabilities("owner-a", "project-a"),
    ).resolves.toMatchObject({
      mode: "live",
      workerOnline: false,
      capabilities: {},
    });
    expect(database.runwayWorkerHeartbeat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mode: "live" }),
      }),
    );
  });
  it("只使用与 API 当前模式匹配的执行器心跳", async () => {
    const { service, database } = fixture();
    vi.stubEnv("RUNWAY_PROVIDER_MODE", "mock");
    const liveWorker = { mode: "live", capabilities: { video: true } };
    database.runwayWorkerHeartbeat.findFirst.mockImplementation(
      async (query: { where: { mode: string } }) =>
        query.where.mode === liveWorker.mode ? liveWorker : null,
    );
    await expect(
      service.capabilities("owner-a", "project-a"),
    ).resolves.toMatchObject({
      mode: "mock",
      workerOnline: false,
      capabilities: {},
    });
  });
  it("拒绝不完整配对和空白修改，草稿默认启用配乐", () => {
    expect(
      runwayActionSchema.safeParse({
        kind: "edit",
        requestKey: "key",
        expectedVersion: 1,
        instruction: " ",
      }).success,
    ).toBe(false);
    expect(
      runwayActionSchema.safeParse({
        kind: "pair",
        requestKey: "key",
        expectedVersion: 1,
      }).success,
    ).toBe(false);
    expect(runwayDraftSchema.parse({ prompt: "走秀" })).toMatchObject({
      modelCount: 6,
      withMusic: true,
      inputs: [],
    });
  });
  it("拒绝过期确认，且不创建命令", async () => {
    const { service, database } = fixture();
    await expect(
      service.action("editor-a", "project-a", "run-a", {
        kind: "confirm",
        requestKey: "confirm-a",
        expectedVersion: 3,
        interruptId: "old",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.runwayCommand.create).not.toHaveBeenCalled();
  });
  it("相同动作幂等，并记录实际操作者；不同请求不能复用编号", async () => {
    const { service, database } = fixture();
    const action = {
      kind: "confirm",
      requestKey: "confirm-a",
      expectedVersion: 3,
      interruptId: "interrupt-a",
    };
    await service.action("editor-a", "project-a", "run-a", action);
    await service.action("editor-a", "project-a", "run-a", action);
    expect(database.runwayCommand.create).toHaveBeenCalledTimes(1);
    expect(database.runwayCommand.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: { ...action, actorUserId: "editor-a" },
        }),
      }),
    );
    await expect(
      service.action("editor-a", "project-a", "run-a", {
        ...action,
        kind: "continue",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("不能通过改动版本或编辑无关图片绕过待确认状态", async () => {
    const { service, database } = fixture();
    await expect(
      service.action("editor-a", "project-a", "run-a", {
        kind: "confirm",
        requestKey: "key",
        expectedVersion: 2,
        interruptId: "interrupt-a",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    database.runwayMedia.findFirst.mockResolvedValueOnce({
      id: "other-image",
      mimeType: "image/png",
    });
    await expect(
      service.action("editor-a", "project-a", "run-a", {
        kind: "edit",
        mediaId: "other-image",
        instruction: "改蓝色",
        requestKey: "key",
        expectedVersion: 3,
        interruptId: "interrupt-a",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it("执行中取消立即保存意图，不虚构远端取消成功", async () => {
    const { service, database, run } = fixture();
    run.status = "RUNNING";
    database.runwayCommand.count.mockResolvedValueOnce(1);
    await service.cancel("editor-a", "project-a", "run-a", {
      requestKey: "cancel-a",
      expectedVersion: 3,
    });
    expect(run.cancelRequestedAt).toBeInstanceOf(Date);
    expect(run.status).toBe("RUNNING");
    expect(database.runwayEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "cancel_requested",
          data: { remoteCancellationConfirmed: false },
        }),
      }),
    );
  });
  it("只读、归档和关闭功能均不能接纳新任务", async () => {
    const { service, access } = fixture();
    access.require.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.create("viewer", "project-a", {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    access.require.mockResolvedValueOnce({
      role: "EDITOR",
      capabilities: { edit: true },
      archived: true,
    });
    await expect(
      service.create("editor", "project-a", {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    vi.stubEnv("RUNWAY_ENABLED", "false");
    await expect(
      service.create("owner", "project-a", {}),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it("事件读取重新检查项目权限，以便撤权后断开订阅", async () => {
    const { service, access, database } = fixture();
    access.require.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.events("viewer", "project-a", "run-a", 10),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.runwayEvent.findMany).not.toHaveBeenCalled();
  });
});

describe("私有媒体 Range", () => {
  it("接受完整、开放结尾和后缀范围，超出结尾自动裁剪", () => {
    expect(normalizedRange(undefined, 100)).toBeUndefined();
    expect(normalizedRange("bytes=10-20", 100)).toBe("bytes=10-20");
    expect(normalizedRange("bytes=90-", 100)).toBe("bytes=90-99");
    expect(normalizedRange("bytes=-200", 100)).toBe("bytes=0-99");
    expect(normalizedRange("bytes=90-200", 100)).toBe("bytes=90-99");
  });
  it("拒绝多范围、倒置、空文件和越界范围", () => {
    for (const range of [
      "bytes=100-",
      "bytes=50-20",
      "bytes=0-1,4-5",
      "bytes=-0",
      "bytes=-",
    ])
      expect(normalizedRange(range, 100)).toBeNull();
    expect(normalizedRange("bytes=0-", 0)).toBeNull();
  });
});

describe("输入素材私有快照", () => {
  function sources(kind: "file" | "asset" | "style_revision") {
    vi.stubEnv("RUNWAY_ENABLED", "true");
    const now = new Date();
    const source = { kind: "cloth", sourceType: kind, sourceId: "source-a" };
    const show = {
      id: "show-a",
      projectId: "project-a",
      archived: false,
      version: 1,
      draft: { ...draft, inputs: [source] },
    };
    const database = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      runwayShow: {
        findFirst: vi.fn().mockResolvedValue(show),
        findUnique: vi.fn().mockResolvedValue(show),
      },
      runwayRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({ eventSequence: 1 }),
        findFirst: vi.fn(),
      },
      runwayMedia: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      runwayCommand: { create: vi.fn().mockResolvedValue({}) },
      runwayEvent: { create: vi.fn().mockResolvedValue({}) },
      fileAsset: {
        findUnique: vi.fn().mockResolvedValue({
          id: "source-a",
          ownerId: "owner-a",
          status: "READY",
          mimeType: "image/png",
          objectKey: "uploads/original.png",
          originalName: "夏装.png",
          sha256: "a".repeat(64),
          width: 100,
          height: 200,
          fabricMainImages: [],
        }),
      },
      designAsset: {
        findFirst: vi.fn().mockResolvedValue({
          id: "asset-a",
          projectId: "project-a",
          url: "s3://generated/look.png",
          sourceFile: null,
          width: 256,
          height: 512,
        }),
      },
      styleRevision: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "source-a", sourceAssetId: "asset-a" }),
      },
    };
    database.$transaction.mockImplementation((callback) => callback(database));
    const access = {
      require: vi
        .fn()
        .mockResolvedValue({ capabilities: { edit: true }, archived: false }),
    };
    const storage = {
      copy: vi.fn().mockResolvedValue({
        sizeBytes: 123,
        mimeType: "image/png",
        sha256: "b".repeat(64),
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new RunwayService(
      database as unknown as PrismaClient,
      access as unknown as ProjectAccessPolicy,
      storage as unknown as RunwayStorage,
    );
    vi.spyOn(service, "run").mockResolvedValue({
      id: "created-run",
      createdAt: now.toISOString(),
    } as Awaited<ReturnType<RunwayService["run"]>>);
    return { service, database, storage, access };
  }
  it.each(["file", "asset", "style_revision"] as const)(
    "%s 输入复制到运行私有目录并保留来源，生成图可没有 sourceFile",
    async (kind) => {
      const { service, storage, database } = sources(kind);
      await service.start("owner-a", "project-a", "show-a", {
        requestKey: "start",
        expectedVersion: 1,
      });
      expect(storage.copy).toHaveBeenCalledWith(
        kind === "file" ? "uploads/original.png" : "generated/look.png",
        expect.stringMatching(/^runway\/project-a\/[^/]+\/inputs\//),
        true,
      );
      expect(database.runwayMedia.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            kind: "cloth",
            sha256: "b".repeat(64),
            source: {
              input: true,
              kind: "cloth",
              sourceType: kind,
              sourceId: "source-a",
            },
          }),
        ],
      });
      expect(database.runwayCommand.create).toHaveBeenCalledTimes(1);
    },
  );
  it("拒绝其他项目或已归档款式的素材，且不接纳命令", async () => {
    const { service, database, storage } = sources("asset");
    database.designAsset.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.start("owner-a", "project-a", "show-a", {
        requestKey: "start",
        expectedVersion: 1,
      }),
    ).rejects.toThrow();
    expect(database.designAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "source-a", projectId: "project-a", archivedAt: null },
      }),
    );
    expect(storage.copy).not.toHaveBeenCalled();
    expect(database.runwayCommand.create).not.toHaveBeenCalled();
  });
  it("素材复制后项目被归档会清理未被接纳的快照", async () => {
    const { service, access, storage, database } = sources("file");
    access.require.mockImplementation(
      async (_user: string, _project: string, action: string) => ({
        capabilities: { edit: true },
        archived: action === "edit" && storage.copy.mock.calls.length > 0,
      }),
    );
    await expect(
      service.start("owner-a", "project-a", "show-a", {
        requestKey: "start",
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(database.runwayCommand.create).not.toHaveBeenCalled();
  });
});

describe("按镜头建立历史分支", () => {
  function history() {
    vi.stubEnv("RUNWAY_ENABLED", " YeS ");
    const now = new Date("2026-10-26T00:00:00Z");
    const byStage: Record<string, string[]> = {
      model: ["model-a", "model-b"],
      cloth: ["cloth-a", "cloth-b"],
      background: ["background"],
      tryon: ["tryon-a", "tryon-b"],
      storyboard: ["storyboard-a", "storyboard-b"],
      video: ["video-a", "video-b"],
      silent_video: ["silent"],
      music: ["music"],
      final_video: ["final"],
      poster: ["poster"],
    };
    const media = Object.entries(byStage).flatMap(([kind, values]) =>
      values.map((id) => ({
        id,
        runId: "parent",
        projectId: "project-a",
        kind,
        objectKey: `old/${id}`,
        mimeType: kind === "video" ? "video/mp4" : "image/png",
        originalName: `${id}.png`,
        sizeBytes: 100,
        sha256: "a".repeat(64),
        width: 100,
        height: 200,
        durationMs: null,
        source: {},
        createdAt: now,
      })),
    );
    const source = {
      id: "parent",
      showId: "show-a",
      projectId: "project-a",
      userId: "owner-a",
      status: "SUCCEEDED",
      stage: "finished",
      version: 12,
      inputSnapshot: draft,
      modelSnapshot: { mode: "mock" },
      state: {
        mediaByStage: byStage,
        improvedPrompt: "summer runway",
        approvedStages: ["prepare", "tryon", "storyboard"],
        pairings: [
          { modelMediaId: "model-a", clothMediaId: "cloth-a" },
          { modelMediaId: "model-b", clothMediaId: "cloth-b" },
        ],
      },
      media,
    };
    const database = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      runwayRun: {
        findFirst: vi.fn().mockResolvedValue(source),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({ eventSequence: 1 }),
      },
      runwayMedia: { createMany: vi.fn().mockResolvedValue({}) },
      runwayCommand: { create: vi.fn().mockResolvedValue({}) },
      runwayEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    database.$transaction.mockImplementation((callback) => callback(database));
    const access = {
      require: vi
        .fn()
        .mockResolvedValue({ archived: false, capabilities: { edit: true } }),
    };
    const storage = {
      copy: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new RunwayService(
      database as unknown as PrismaClient,
      access as unknown as ProjectAccessPolicy,
      storage as unknown as RunwayStorage,
    );
    vi.spyOn(service, "run").mockResolvedValue({ id: "fork" } as Awaited<
      ReturnType<RunwayService["run"]>
    >);
    return { service, database, storage, source };
  }
  it("重做第一个分镜保留第二个分镜和视频，映射新媒体编号并清除合成成果", async () => {
    const { service, database, storage, source } = history();
    await service.fork("editor-a", "project-a", "parent", {
      requestKey: "shot-a",
      expectedVersion: 12,
      stage: "storyboard",
      mediaId: "storyboard-a",
    });
    const created = database.runwayRun.create.mock.calls[0]?.[0] as {
      data: {
        state: {
          mediaByStage: Record<string, (string | null)[]>;
          pairings: unknown[];
          forkMediaId: string;
          forkIndex: number;
        };
      };
    };
    const copies = database.runwayMedia.createMany.mock.calls[0]?.[0] as {
      data: {
        id: string;
        kind: string;
        objectKey: string;
        source: { parentMediaId: string };
      }[];
    };
    const mapped = (oldId: string) =>
      copies.data.find((media) => media.source.parentMediaId === oldId)?.id;
    expect(created.data.state.mediaByStage.storyboard).toEqual([
      null,
      mapped("storyboard-b"),
    ]);
    expect(created.data.state.mediaByStage.video).toEqual([
      null,
      mapped("video-b"),
    ]);
    expect(created.data.state.mediaByStage.tryon).toEqual([
      mapped("tryon-a"),
      mapped("tryon-b"),
    ]);
    expect(created.data.state).toMatchObject({
      forkMediaId: "storyboard-a",
      forkIndex: 0,
    });
    for (const kind of ["silent_video", "music", "final_video", "poster"])
      expect(created.data.state.mediaByStage[kind]).toBeUndefined();
    expect(
      copies.data.some(
        (media) =>
          media.source.parentMediaId === "storyboard-a" ||
          media.source.parentMediaId === "video-a",
      ),
    ).toBe(false);
    expect(storage.copy).toHaveBeenCalledWith(
      "old/storyboard-b",
      expect.stringMatching(/^runway\/project-a\//),
    );
    expect(source.state.mediaByStage.storyboard).toEqual([
      "storyboard-a",
      "storyboard-b",
    ]);
  });
  it("不指定镜头时继续执行整阶段重跑", async () => {
    const { service, database } = history();
    await service.fork("editor-a", "project-a", "parent", {
      requestKey: "stage",
      expectedVersion: 12,
      stage: "storyboard",
    });
    const created = database.runwayRun.create.mock.calls[0]?.[0] as {
      data: { state: { mediaByStage: Record<string, unknown> } };
    };
    expect(created.data.state.mediaByStage.storyboard).toBeUndefined();
    expect(created.data.state.mediaByStage.video).toBeUndefined();
    expect(created.data.state.mediaByStage.tryon).toHaveLength(2);
  });
  it("拒绝阶段不匹配或已不在当前镜头列表中的历史媒体", async () => {
    const { service, source, storage } = history();
    await expect(
      service.fork("editor-a", "project-a", "parent", {
        requestKey: "wrong",
        expectedVersion: 12,
        stage: "storyboard",
        mediaId: "video-a",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    source.state.mediaByStage.storyboard = ["storyboard-b"];
    await expect(
      service.fork("editor-a", "project-a", "parent", {
        requestKey: "old",
        expectedVersion: 12,
        stage: "storyboard",
        mediaId: "storyboard-a",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.copy).not.toHaveBeenCalled();
  });
});
