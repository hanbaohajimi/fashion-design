import { Prisma, appendGenerationTerminalOutbox, type PrismaClient, type WorkflowOutbox } from "@fashion/db";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BullGenerationJobs } from "../generation/generation-queue.service";
import { BullExportJobs } from "../exports/export-queue.service";
import { WORKFLOW_RUNTIME_DB } from "./workflow-runtime.tokens";
import { S3FileStorage } from "../files/storage.service";

const BATCH = 100;
const INTERVAL_MS = 15_000;
const GENERATION_STALE_MS = 60_000;
const finishedQueueState = (state: string) => ["missing", "failed", "completed", "unknown"].includes(state);

/** Dispatch and reconciliation never invoke a model. PostgreSQL survives Redis loss. */
@Injectable()
export class TaskDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskDispatchService.name);
  private timer?: ReturnType<typeof setInterval>;
  private flight: Promise<void> | undefined;
  private generationCursor: string | undefined;
  private exportCursor: string | undefined;
  private stopping = false;

  constructor(@Inject(WORKFLOW_RUNTIME_DB) private readonly database: PrismaClient,
    @Inject(BullGenerationJobs) private readonly generations: BullGenerationJobs,
    @Inject(BullExportJobs) private readonly exports: BullExportJobs,
    @Inject(S3FileStorage) private readonly storage: Pick<S3FileStorage, "delete">) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    const tick = () => { void this.run().catch((error: unknown) => this.logger.warn(error instanceof Error ? error.message : "任务派发等待重试")); };
    this.timer = setInterval(tick, INTERVAL_MS);
    this.timer.unref();
    tick();
  }

  run(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.flight) return this.flight;
    this.flight = this.drain().then(() => this.reconcile()).finally(() => { this.flight = undefined; });
    return this.flight;
  }

  async drain() {
    for (let index = 0; index < BATCH && !this.stopping; index++) {
      const event = await this.database.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM workflow_outbox WHERE event_type IN ('generation.dispatch', 'export.dispatch', 'export.cleanup')
          AND available_at <= NOW() AND (status = 'pending' OR (status = 'processing' AND lease_expires_at < NOW()))
          ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`);
        if (!rows[0]) return null;
        return tx.workflowOutbox.update({ where: { id: rows[0].id }, data: { status: "processing", leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 60_000), attempts: { increment: 1 } } });
      });
      if (!event) return;
      try {
        const payload = event.payload as Record<string, string>;
        if (event.eventType === "generation.dispatch") {
          if (!payload.taskId) throw new Error("生成派发缺少任务编号");
          const task = await this.database.generationTask.findUnique({ where: { id: payload.taskId } });
          if (task?.status === "QUEUED") await this.generations.enqueue(task.id, task.userId);
        } else if (event.eventType === "export.cleanup") {
          if (!payload.exportId || !payload.objectKey) throw new Error("导出清理缺少对象编号");
          const task = await this.database.exportJob.findUnique({ where: { id: payload.exportId } });
          if (task?.objectKey === payload.objectKey && task.expiresAt && task.expiresAt > new Date()) {
            await this.setEvent(event, { status: "pending", availableAt: task.expiresAt });
            continue;
          }
          await this.storage.delete(payload.objectKey);
          await this.database.exportJob.updateMany({ where: { id: payload.exportId, objectKey: payload.objectKey, status: { in: ["SUCCEEDED", "EXPIRED", "FAILED"] } },
            data: { objectKey: null, status: "EXPIRED" } });
        } else {
          if (!payload.exportId) throw new Error("导出派发缺少任务编号");
          const task = await this.database.exportJob.findUnique({ where: { id: payload.exportId } });
          if (task?.status === "QUEUED") await this.exports.enqueue(task.id);
        }
        await this.setEvent(event, { status: "completed", processedAt: new Date(), lastError: null });
      } catch (error) {
        await this.setEvent(event, { status: "pending", availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(event.attempts, 6))),
          lastError: error instanceof Error ? error.message.slice(0, 500) : "队列暂不可用" });
      }
    }
  }

  private setEvent(event: WorkflowOutbox, data: Prisma.WorkflowOutboxUpdateManyMutationInput) {
    return this.database.workflowOutbox.updateMany({ where: { id: event.id, status: "processing", leaseToken: event.leaseToken },
      data: { ...data, leaseToken: null, leaseExpiresAt: null } });
  }

  async reconcile() {
    const now = new Date();
    const tasks = await this.database.generationTask.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] },
      ...(this.generationCursor ? { id: { gt: this.generationCursor } } : {}) }, orderBy: { id: "asc" }, take: BATCH });
    this.generationCursor = tasks.length === BATCH ? tasks.at(-1)?.id : undefined;
    for (const task of tasks) {
      try {
        if (task.status === "RUNNING" && now.getTime() - task.updatedAt.getTime() < GENERATION_STALE_MS) continue;
        if (task.status === "RUNNING" && !task.providerJob) {
          await this.database.$transaction(async (tx) => {
          const ended = await tx.generationTask.updateMany({ where: { id: task.id, status: "RUNNING", updatedAt: task.updatedAt, attemptCount: task.attemptCount },
            data: { status: "FAILED", completedAt: now, errorCode: "GENERATION_INTERRUPTED", errorMessage: "生成执行已中断且无法安全恢复，请重新发起生成" } });
          if (ended.count) await appendGenerationTerminalOutbox(tx, { taskId: task.id, status: "FAILED", errorCode: "GENERATION_INTERRUPTED" });
          });
          continue;
        }
        const state = await this.generations.state(task.id); // Connection failures are never interpreted as missing jobs.
        if (finishedQueueState(state)) await this.generations.enqueue(task.id, task.userId);
      } catch { this.logger.warn(`生成任务 ${task.id} 对账等待重试`); }
    }
    const exports = await this.database.exportJob.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] },
      ...(this.exportCursor ? { id: { gt: this.exportCursor } } : {}) }, orderBy: { id: "asc" }, take: BATCH });
    this.exportCursor = exports.length === BATCH ? exports.at(-1)?.id : undefined;
    for (const task of exports) {
      try {
        if (task.status === "RUNNING" && (task.leaseExpiresAt ? task.leaseExpiresAt > now : now.getTime() - task.updatedAt.getTime() < 60_000)) continue;
        if (task.status === "RUNNING") {
          await this.database.exportJob.updateMany({ where: { id: task.id, status: "RUNNING", leaseToken: task.leaseToken,
            ...(task.leaseExpiresAt ? { leaseExpiresAt: { lte: now } } : { leaseExpiresAt: null, updatedAt: task.updatedAt }) },
            data: { status: "FAILED", errorCode: "EXPORT_TIMEOUT", errorMessage: "导出执行已超时或中断，请重新导出", completedAt: now, leaseToken: null, leaseExpiresAt: null } });
          continue;
        }
        const state = await this.exports.state(task.id);
        if (!finishedQueueState(state)) continue;
        await this.exports.enqueue(task.id);
      } catch { this.logger.warn(`导出任务 ${task.id} 对账等待重试`); }
    }
  }

  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.flight; }
}
