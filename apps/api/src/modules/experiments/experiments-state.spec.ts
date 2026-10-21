import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  experimentCreateSchema,
  type ExperimentCreateInput,
} from "@fashion/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentsService } from "./experiments.service";

type StoredItem = {
  id: string;
  status: string;
  attempt: number;
  taskId: string | null;
  dispatchedAt?: string;
  request?: unknown;
  error: string | null;
};
type StoredBatch = {
  id: string;
  userId: string;
  projectId: string;
  sourceAssetId: string;
  fingerprint: string;
  requestKey: string;
  version: number;
  items: { ownerId: string; items: StoredItem[] };
  createdAt: Date;
  updatedAt: Date;
};
function fixture() {
  const batches = new Map<string, StoredBatch>();
  const tasks = new Map<
    string,
    { id: string; status: string; errorMessage: string | null }
  >();
  let signed = 0;
  let allowed = true;
  const access = {
    require: vi.fn(async () => {
      if (!allowed) throw new ForbiddenException();
      return { ownerId: "owner" };
    }),
  };
  const database = {
    studioExperiment: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { userId_requestKey: { userId: string; requestKey: string } };
        }) =>
          [...batches.values()].find(
            (row) =>
              row.userId === where.userId_requestKey.userId &&
              row.requestKey === where.userId_requestKey.requestKey,
          ) ?? null,
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; projectId?: string } }) => {
          const row = batches.get(where.id);
          return row && (!where.projectId || row.projectId === where.projectId)
            ? structuredClone(row)
            : null;
        },
      ),
      upsert: vi.fn(async ({ create }: { create: StoredBatch }) => {
        const row = batches.get(create.id);
        if (row) return structuredClone(row);
        const next = {
          ...create,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        batches.set(next.id, structuredClone(next));
        return structuredClone(next);
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; version: number };
          data: { items: StoredBatch["items"] };
        }) => {
          const row = batches.get(where.id);
          if (!row || row.version !== where.version) return { count: 0 };
          row.items = structuredClone(data.items);
          row.version++;
          row.updatedAt = new Date();
          return { count: 1 };
        },
      ),
      findMany: vi.fn(
        async ({
          where,
        }: { where?: { items?: unknown; projectId?: string } } = {}) =>
          [...batches.values()]
            .filter((row) =>
              where?.items
                ? row.items.items.some((item) => item.status === "dispatching")
                : !where?.projectId || row.projectId === where.projectId,
            )
            .map((row) => structuredClone(row)),
      ),
    },
    designAsset: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; projectId: string } }) =>
          where.id === "source" && where.projectId === "project"
            ? { id: "source", url: "s3://private/source.png" }
            : null,
      ),
      findMany: vi.fn(async () => []),
    },
    fabric: { findMany: vi.fn(async () => []) },
    generationTask: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [...tasks.values()].filter((task) => where.id.in.includes(task.id)),
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          tasks.get(where.id) ?? null,
      ),
    },
  };
  const admit = async (_actor: string, _request: unknown, key: string) => {
    const item = [...batches.values()]
      .flatMap((row) => row.items.items)
      .find((row) => key.endsWith(":" + row.id + ":" + row.attempt));
    if (!item?.taskId) throw new Error("missing admitted task identity");
    tasks.set(item.taskId, {
      id: item.taskId,
      status: "QUEUED",
      errorMessage: null,
    });
    return { taskId: item.taskId };
  };
  const generation = {
    createFromAgent: vi.fn(admit),
    cancel: vi.fn(async (_actor: string, id: string) => {
      const task = tasks.get(id);
      if (!task) throw new NotFoundException();
      task.status = "CANCELED";
    }),
  };
  const storage = {
    createDownloadUrl: vi.fn(
      async (key: string) =>
        "https://private.example/" + key + "?signature=" + ++signed,
    ),
  };
  const service = new ExperimentsService(
    database as never,
    generation as never,
    storage as never,
    access as never,
  );
  const input: ExperimentCreateInput = experimentCreateSchema.parse({
    sourceAssetId: "source",
    mode: "color",
    prompt: "调整颜色",
    preserve: "领口和版型",
    colors: [
      { name: "黑", hex: "#111111" },
      { name: "蓝", hex: "#336699" },
    ],
  });
  return {
    service,
    database,
    access,
    generation,
    storage,
    batches,
    tasks,
    input,
    admit,
    revoke: () => {
      allowed = false;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});

describe("持久化批量任务", () => {
  it("保存草稿不接纳任务，重复创建保持身份并拒绝同键异参", async () => {
    const f = fixture();
    const first = await f.service.create(
      "editor",
      "project",
      f.input,
      "create-key",
    );
    const replay = await f.service.create(
      "editor",
      "project",
      f.input,
      "create-key",
    );
    expect(replay.id).toBe(first.id);
    expect(f.generation.createFromAgent).not.toHaveBeenCalled();
    await expect(
      f.service.create(
        "editor",
        "project",
        { ...f.input, preserve: "另一要求" },
        "create-key",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("并发提交同一单元格只接纳一次，并将原执行者交给生成服务", async () => {
    const f = fixture();
    const batch = await f.service.create(
      "editor",
      "project",
      f.input,
      "create-key",
    );
    const id = batch.items[0]?.id;
    if (!id) throw new Error("missing cell");
    await Promise.all([
      f.service.act("editor", "project", batch.id, [id], "submit"),
      f.service.act("editor", "project", batch.id, [id], "submit"),
    ]);
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(1);
    expect(f.generation.createFromAgent.mock.calls[0]?.[0]).toBe("editor");
    const result = await f.service.list("editor", "project");
    expect(result[0]?.items[0]?.status).toBe("queued");
    expect(result[0]?.items[0]?.taskId).toBe(
      createHash("sha256")
        .update("owner\0editor:experiment:" + batch.id + ":" + id + ":0")
        .digest("hex"),
    );
    expect(JSON.stringify(result)).not.toContain("signature=");
  });
  it("逐项保留接纳结果，重试只创建失败项的新 attempt", async () => {
    const f = fixture();
    const batch = await f.service.create(
      "editor",
      "project",
      f.input,
      "create-key",
    );
    const ids = batch.items.map((item) => item.id);
    f.generation.createFromAgent.mockRejectedValueOnce(
      new Error("QUOTA_EXCEEDED"),
    );
    const submitted = await f.service.act(
      "editor",
      "project",
      batch.id,
      ids,
      "submit",
    );
    expect(submitted.items.map((item) => item.status)).toEqual([
      "not_admitted",
      "queued",
    ]);
    const firstId = ids[0];
    if (!firstId) throw new Error("missing cell");
    const retried = await f.service.act(
      "editor",
      "project",
      batch.id,
      ids,
      "retry",
    );
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(3);
    expect(retried.items.map((item) => item.attempt)).toEqual([1, 0]);
    expect(retried.items[1]?.taskId).toBe(submitted.items[1]?.taskId);
  });
  it("接纳后队列响应丢失仍保留同一任务，不误判为未接纳", async () => {
    const f = fixture();
    const batch = await f.service.create(
      "editor",
      "project",
      f.input,
      "create-key",
    );
    const id = batch.items[0]?.id;
    if (!id) throw new Error("missing cell");
    f.generation.createFromAgent.mockImplementationOnce(
      async (actor, request, key) => {
        await f.admit(actor, request, key);
        throw new Error("queue unavailable");
      },
    );
    const result = await f.service.act(
      "editor",
      "project",
      batch.id,
      [id],
      "submit",
    );
    expect(result.items[0]?.status).toBe("queued");
    await f.service.act("editor", "project", batch.id, [id], "submit");
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(1);
  });
  it("取消草稿不调用模型，运行任务沿用已有取消协议", async () => {
    const f = fixture();
    const batch = await f.service.create(
      "editor",
      "project",
      f.input,
      "create-key",
    );
    const ids = batch.items.map((item) => item.id);
    const first = ids[0];
    const second = ids[1];
    if (!first || !second) throw new Error("missing cells");
    await f.service.act("editor", "project", batch.id, [first], "submit");
    const result = await f.service.act(
      "editor",
      "project",
      batch.id,
      ids,
      "cancel",
    );
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(1);
    expect(f.generation.cancel).toHaveBeenCalledTimes(1);
    expect(result.items.map((item) => item.status)).toEqual([
      "canceled",
      "canceled",
    ]);
  });
  it("恢复仅扫描分发中记录，刷新过期签名并保持任务身份", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const batch = await f.service.create(
      "editor",
      "project",
      f.input,
      "create-key",
    );
    const id = batch.items[0]?.id;
    if (!id) throw new Error("missing cell");
    await f.service.act("editor", "project", batch.id, [id], "submit");
    const record = f.batches.get(batch.id);
    const item = record?.items.items[0];
    if (!item) throw new Error("missing persisted cell");
    const originalId = item.taskId;
    const oldRequest = JSON.stringify(item.request);
    f.tasks.clear();
    item.status = "dispatching";
    item.dispatchedAt = new Date(Date.now() - 2 * 86400_000).toISOString();
    f.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(15_000);
    f.service.onModuleDestroy();
    const current = f.batches.get(batch.id)?.items.items[0];
    expect(current?.taskId).toBe(originalId);
    expect(current?.status).toBe("queued");
    expect(JSON.stringify(current?.request)).not.toBe(oldRequest);
    expect(f.database.studioExperiment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          items: {
            path: ["items"],
            array_contains: [{ status: "dispatching" }],
          },
        },
      }),
    );
  });
  it("撤销原执行者后不能提交或在后台恢复出新任务", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const batch = await f.service.create(
      "editor",
      "project",
      f.input,
      "create-key",
    );
    const id = batch.items[0]?.id;
    if (!id) throw new Error("missing cell");
    await f.service.act("editor", "project", batch.id, [id], "submit");
    const item = f.batches.get(batch.id)?.items.items[0];
    if (!item) throw new Error("missing persisted cell");
    f.tasks.clear();
    item.status = "dispatching";
    item.dispatchedAt = new Date(Date.now() - 60_000).toISOString();
    f.revoke();
    f.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(15_000);
    f.service.onModuleDestroy();
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(1);
    expect(f.batches.get(batch.id)?.items.items[0]?.status).toBe(
      "not_admitted",
    );
    await expect(
      f.service.act("editor", "project", batch.id, [id], "submit"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
