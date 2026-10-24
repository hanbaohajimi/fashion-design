import { DesignAssetOperation, Prisma, prisma } from "@fashion/db";
import { experimentCreateSchema } from "@fashion/shared";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { ExperimentsService } from "./experiments.service";

it("真实 JSON 状态扫描保留撤权前已接纳任务，并恢复重启前的取消意图", async () => {
  const owner = await prisma.user.create({
    data: {
      email: `experiment-recovery-${randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "Recovery",
          projects: { create: { name: "Recovery" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const project = owner.ownedWorkspaces[0]?.projects[0];
  if (!project) throw new Error("缺少测试项目");
  const policy = new ProjectAccessPolicy(prisma);
  let allowed = true;
  const access = {
    require: async (...args: Parameters<ProjectAccessPolicy["require"]>) => {
      if (!allowed) throw new ForbiddenException();
      return policy.require(...args);
    },
  };
  const generation = {
    createFromAgent: vi.fn(),
    cancel: vi.fn(async (_actor: string, id: string) => {
      const task = await prisma.generationTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException();
      return prisma.generationTask.update({
        where: { id },
        data: { status: "CANCELED" },
      });
    }),
  };
  const database = {
    ...prisma,
    studioExperiment: {
      ...prisma.studioExperiment,
      findMany: (
        args: Parameters<typeof prisma.studioExperiment.findMany>[0],
      ) =>
        prisma.studioExperiment.findMany({
          ...args,
          where: { ...args?.where, projectId: project.id },
        }),
    },
  };
  const service = new ExperimentsService(
    database as never,
    generation as never,
    { createDownloadUrl: vi.fn() } as never,
    access as never,
  );
  try {
    const sourceId = randomUUID();
    await prisma.designAsset.create({
      data: {
        id: sourceId,
        rootAssetId: sourceId,
        projectId: project.id,
        operation: DesignAssetOperation.IMPORTED,
        url: "s3://recovery-test/source.png",
      },
    });
    const batch = await service.create(
      owner.id,
      project.id,
      experimentCreateSchema.parse({
        sourceAssetId: sourceId,
        mode: "color",
        prompt: "调整颜色",
        preserve: "版型",
        colors: [
          { name: "黑", hex: "#111111" },
          { name: "蓝", hex: "#336699" },
        ],
      }),
      randomUUID(),
    );
    const taskId = randomUUID();
    const lateTaskId = randomUUID();
    await prisma.generationTask.create({
      data: {
        id: taskId,
        userId: owner.id,
        projectId: project.id,
        taskType: "i2i",
        input: {},
      },
    });
    const stored = await prisma.studioExperiment.findUniqueOrThrow({
      where: { id: batch.id },
    });
    const data = stored.items as {
      items: Array<Record<string, Prisma.JsonValue>>;
    };
    if (!data.items[0] || !data.items[1]) throw new Error("缺少测试实验项");
    Object.assign(data.items[0], {
      status: "dispatching",
      taskId,
      dispatchedAt: new Date(0).toISOString(),
    });
    Object.assign(data.items[1], {
      status: "canceled",
      taskId: lateTaskId,
      cancelRequested: true,
    });
    await prisma.studioExperiment.update({
      where: { id: batch.id },
      data: { items: data },
    });
    allowed = false;
    await service["recover"]();
    let restored = await prisma.studioExperiment.findUniqueOrThrow({
      where: { id: batch.id },
    });
    let items = (restored.items as typeof data).items;
    expect(items[0]).toMatchObject({ status: "queued", taskId });
    expect(items[1]).toMatchObject({
      status: "canceled",
      taskId: lateTaskId,
      cancelRequested: true,
    });
    // Only the outstanding cancellation now matches the real JSON filter.
    await prisma.generationTask.create({
      data: {
        id: lateTaskId,
        userId: owner.id,
        projectId: project.id,
        taskType: "i2i",
        input: {},
      },
    });
    await service["recover"]();
    restored = await prisma.studioExperiment.findUniqueOrThrow({
      where: { id: batch.id },
    });
    items = (restored.items as typeof data).items;
    expect(items[1]).toBeDefined();
    expect(items[1]?.cancelRequested).toBeUndefined();
    expect(
      (
        await prisma.generationTask.findUniqueOrThrow({
          where: { id: lateTaskId },
        })
      ).status,
    ).toBe("CANCELED");
    expect(generation.createFromAgent).not.toHaveBeenCalled();
    expect(
      await prisma.generationTask.count({ where: { projectId: project.id } }),
    ).toBe(2);
  } finally {
    await service.onModuleDestroy();
    await prisma.user.delete({ where: { id: owner.id } });
  }
});
