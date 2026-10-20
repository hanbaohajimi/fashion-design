import { prisma, appendWorkflowOutbox } from "@fashion/db";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { TaskDispatchService } from "./task-dispatch.service";

it("repairs an actual lost Redis job from durable PostgreSQL state without replaying canceled work", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { email: `dispatch-${suffix}@example.com`, ownedWorkspaces: { create: { name: "Dispatch integration", projects: { create: { name: "Recovery" } } } } },
    include: { ownedWorkspaces: { include: { projects: true } } } });
  const project = user.ownedWorkspaces[0]?.projects[0];
  if (!project) throw new Error("Missing test project");
  const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const queue = new Queue(`trial-dispatch-${suffix}`, { connection: { host: redis.hostname, port: Number(redis.port || 6379) } });
  const enqueue = async (id: string) => { await queue.add("generate", { taskId: id }, { jobId: id }); };
  const adapter = { enqueue, state: async (id: string) => { const job = await queue.getJob(id); return job ? job.getState() : "missing"; } };
  // Restrict the scan to this test owner, while retaining real SQL, transactions and Redis.
  const database = { $transaction: prisma.$transaction.bind(prisma),
    generationTask: { findMany: (args: Parameters<typeof prisma.generationTask.findMany>[0]) => prisma.generationTask.findMany({ ...args, where: { ...args?.where, userId: user.id } }) },
    exportJob: { findMany: async () => [] } };
  const service = new TaskDispatchService(database as never, adapter as never, adapter as never, { delete: async () => undefined });
  try {
    const task = await prisma.$transaction(async (tx) => {
      const task = await tx.generationTask.create({ data: { id: randomUUID(), userId: user.id, projectId: project.id, taskType: "t2i", input: {} } });
      await appendWorkflowOutbox(tx, { projectId: project.id, eventKey: `generation:${task.id}:dispatch`, eventType: "generation.dispatch", generationTaskId: task.id, payload: { taskId: task.id, userId: user.id } });
      return task;
    });
    expect(await prisma.workflowOutbox.count({ where: { generationTaskId: task.id } })).toBe(1);
    await service.reconcile(); await service.reconcile();
    expect(await queue.getWaitingCount()).toBe(1);
    await (await queue.getJob(task.id))?.remove();
    await service.reconcile();
    expect(await queue.getWaitingCount()).toBe(1);
    await (await queue.getJob(task.id))?.remove();
    await prisma.generationTask.update({ where: { id: task.id }, data: { status: "CANCELED" } });
    await service.reconcile();
    expect(await queue.getJob(task.id)).toBeUndefined();
    expect(await prisma.generationTask.count({ where: { userId: user.id } })).toBe(1);
  } finally {
    await queue.obliterate({ force: true }); // Only this randomly named test queue.
    await queue.close(); await prisma.user.delete({ where: { id: user.id } });
  }
});
