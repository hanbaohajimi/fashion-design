import { afterEach, describe, expect, it, vi } from "vitest";
import { ThumbnailRecoveryService } from "./thumbnail-recovery.service";

function fixture() {
  const database = { fileAsset: { findMany: vi.fn().mockResolvedValue([]) } };
  const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
  return {
    database,
    jobs,
    service: new ThumbnailRecoveryService(database as never, jobs),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("上传完成后的缩略图恢复", () => {
  it("启动即扫描已确认且超过派发宽限期的上传，不重启失败或未确认的文件", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.database.fileAsset.findMany.mockResolvedValue([{ id: "lost-job" }]);
    f.service.onModuleInit();
    await f.service.run();
    expect(f.database.fileAsset.findMany).toHaveBeenCalledWith({
      where: {
        status: "PROCESSING",
        completedAt: { lte: new Date(Date.now() - 30_000) },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    expect(f.jobs.enqueue).toHaveBeenCalledWith("lost-job");
    await f.service.onModuleDestroy();
  });

  it("单项队列故障不中断后续文件，下一轮仍可恢复", async () => {
    const f = fixture();
    f.database.fileAsset.findMany.mockResolvedValue([
      { id: "first" },
      { id: "second" },
    ]);
    f.jobs.enqueue.mockRejectedValueOnce(new Error("Redis unavailable"));
    await f.service.run();
    await f.service.run();
    expect(f.jobs.enqueue.mock.calls).toEqual([
      ["first"],
      ["second"],
      ["first"],
      ["second"],
    ]);
  });

  it("活动任务占满第一页时继续向后扫描，扫完再从头开始", async () => {
    const f = fixture();
    f.database.fileAsset.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, index) => ({
          id: `file-${String(index).padStart(3, "0")}`,
        })),
      )
      .mockResolvedValueOnce([{ id: "file-100" }]);
    await f.service.run();
    await f.service.run();
    await f.service.run();
    expect(f.database.fileAsset.findMany.mock.calls[1]?.[0].where.id).toEqual({
      gt: "file-099",
    });
    expect(
      f.database.fileAsset.findMany.mock.calls[2]?.[0].where.id,
    ).toBeUndefined();
    expect(f.jobs.enqueue).toHaveBeenCalledTimes(101);
  });

  it("恢复不重叠，关停等待正在执行的任务且不派发下一项", async () => {
    const f = fixture();
    f.database.fileAsset.findMany.mockResolvedValue([
      { id: "first" },
      { id: "second" },
    ]);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.jobs.enqueue.mockImplementationOnce(() => {
      started();
      return gate;
    });
    const flight = f.service.run();
    expect(f.service.run()).toBe(flight);
    await entered;
    let stopped = false;
    const stopping = f.service.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    await f.service.run();
    expect(f.jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(f.database.fileAsset.findMany).toHaveBeenCalledTimes(1);
  });

  it("数据库暂时不可用时释放恢复锁，下一轮能够重新扫描", async () => {
    const f = fixture();
    f.database.fileAsset.findMany.mockRejectedValueOnce(
      new Error("database offline"),
    );
    await expect(f.service.run()).rejects.toThrow("database offline");
    await expect(f.service.run()).resolves.toBeUndefined();
    expect(f.database.fileAsset.findMany).toHaveBeenCalledTimes(2);
  });
});
