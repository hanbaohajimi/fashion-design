import { Prisma, type PrismaClient, type WorkflowOutbox } from "@fashion/db";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { HiddenIntentMiner } from "../design-context/hidden-intent-miner.service";
import { WorkflowAssistantService } from "./workflow-assistant.service";
import { WorkflowRuntimeService } from "./workflow-runtime.service";
import { WORKFLOW_RUNTIME_DB } from "./workflow-runtime.tokens";

const OBSERVATION_QUEUE = "workflow-observation-wakeup";
const LEASE_MS = 15 * 60_000;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** PostgreSQL is authoritative. Redis wakes the consumer; polling repairs lost wakeups. */
@Injectable()
export class WorkflowOutboxConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowOutboxConsumer.name);
  private timer?: ReturnType<typeof setInterval>;
  private queue?: Queue;
  private worker?: Worker;
  private factsBusy = false;
  private observationsBusy = false;
  private miningBusy = false;
  private stopping = false;
  private lastReconcile = 0;

  constructor(
    @Inject(WORKFLOW_RUNTIME_DB) private readonly database: PrismaClient,
    @Inject(WorkflowRuntimeService) private readonly runtime: WorkflowRuntimeService,
    @Inject(WorkflowAssistantService) private readonly assistant: WorkflowAssistantService,
    @Inject(HiddenIntentMiner) private readonly miner: HiddenIntentMiner,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    const connection = { host: redis.hostname, port: Number(redis.port || 6379),
      ...(redis.password ? { password: redis.password } : {}), ...(redis.username ? { username: redis.username } : {}) };
    this.queue = new Queue(OBSERVATION_QUEUE, { connection });
    this.worker = new Worker(OBSERVATION_QUEUE, () => this.drainObservations(), { connection, concurrency: 1 });
    this.queue.on("error", () => undefined);
    this.worker.on("error", () => undefined);
    this.timer = setInterval(() => { void this.tick(); }, 2_000);
    this.timer.unref();
    void this.tick();
  }

  private async tick() {
    if (this.stopping) return;
    await this.drainFacts().catch(() => this.logger.warn("工作流事实回执暂未同步，将从持久化事件重试"));
    // Model latency never holds up graph projection or new user requests.
    void this.drainObservations().catch(() => this.logger.warn("后台设计观察暂未完成，执行事实已保留"));
    void this.drainMining().catch(() => this.logger.warn("偏好挖掘未完成，原始设计变更已保留"));
    if (Date.now() - this.lastReconcile > 15_000) {
      this.lastReconcile = Date.now();
      void this.reconcile().catch(() => this.logger.warn("执行恢复扫描未完成，下轮继续"));
    }
    if (this.queue) void this.queue.add("wake", {}, { jobId: `wake-${Math.floor(Date.now() / 10_000)}`,
      removeOnComplete: true, removeOnFail: true }).catch(() => undefined);
  }

  private async claim(lane: "facts" | "observation" | "mining"): Promise<WorkflowOutbox | null> {
    const token = randomUUID();
    return this.database.$transaction(async (tx) => {
      const filter = lane === "observation" ? Prisma.sql`"event_type" = 'execution.terminal'`
        : lane === "mining" ? Prisma.sql`"event_type" = 'workflow.semantic_changed'`
          : Prisma.sql`"event_type" NOT IN ('execution.terminal', 'workflow.semantic_changed')`;
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "workflow_outbox"
        WHERE ${filter} AND "available_at" <= NOW()
          AND ("status" = 'pending' OR ("status" = 'processing' AND "lease_expires_at" < NOW()))
        ORDER BY "created_at", "id" FOR UPDATE SKIP LOCKED LIMIT 1`);
      const id = rows[0]?.id;
      if (!id) return null;
      return tx.workflowOutbox.update({ where: { id }, data: { status: "processing", leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } } });
    });
  }

  async drainFacts(limit = 20) {
    if (this.factsBusy || this.stopping) return;
    this.factsBusy = true;
    try {
      for (let index = 0; index < limit; index++) {
        const event = await this.claim("facts");
        if (!event) break;
        try {
          const project = await this.database.project.findUnique({ where: { id: event.projectId }, include: { workspace: { select: { ownerId: true } } } });
          if (project && !project.deletedAt) {
            if (event.eventType === "generation.terminal") await this.runtime.sync(project.workspace.ownerId, event.projectId);
          }
          await this.finish(event);
        } catch (error) { await this.fail(event, error, 8); }
      }
    } finally { this.factsBusy = false; }
  }

  async drainObservations(limit = 4) {
    if (this.observationsBusy || this.stopping) return;
    this.observationsBusy = true;
    try {
      for (let index = 0; index < limit; index++) {
        const event = await this.claim("observation");
        if (!event) break;
        try {
          const result = await this.assistant.observeExecution(event.id);
          if (result === "deferred") {
            await this.database.workflowOutbox.updateMany({ where: { id: event.id, leaseToken: event.leaseToken }, data: {
              status: "pending", attempts: { decrement: 1 }, availableAt: new Date(Date.now() + 2_000), leaseToken: null, leaseExpiresAt: null } });
          } else await this.finish(event);
        } catch (error) {
          // A failed analysis never rolls back assets or its already durable fact receipt.
          await this.fail(event, error, 1);
        }
      }
    } finally { this.observationsBusy = false; }
  }

  async drainMining(limit = 2) {
    if (this.miningBusy || this.stopping) return;
    this.miningBusy = true;
    try {
      for (let index = 0; index < limit; index++) {
        const event = await this.claim("mining");
        if (!event) break;
        try {
          const project = await this.database.project.findUnique({ where: { id: event.projectId }, include: { workspace: { select: { ownerId: true } } } });
          const origin = object(event.payload).origin;
          if (project && !project.deletedAt && !project.archived && project.workflowAgentVersion === 2 && (origin === "user" || origin === "proposal"))
            await this.miner.processChanges(project.workspace.ownerId, event.projectId, { eventId: event.id });
          await this.finish(event);
        } catch (error) { await this.fail(event, error, 1); }
      }
    } finally { this.miningBusy = false; }
  }

  private async finish(event: WorkflowOutbox) {
    await this.database.workflowOutbox.updateMany({ where: { id: event.id, status: "processing", leaseToken: event.leaseToken },
      data: { status: "completed", processedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: null } });
  }

  private async fail(event: WorkflowOutbox, error: unknown, maxAttempts: number) {
    await this.database.workflowOutbox.updateMany({ where: { id: event.id, status: "processing", leaseToken: event.leaseToken }, data: {
      status: event.attempts >= maxAttempts ? "failed" : "pending", availableAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** event.attempts)),
      leaseToken: null, leaseExpiresAt: null, lastError: error instanceof Error ? error.message.slice(0, 1_000) : "处理失败" } });
  }

  /** Startup/periodic recovery also covers terminal tasks committed before attempt linking. */
  async reconcile() {
    const attempts = await this.database.workflowAttempt.findMany({ where: { status: { in: ["submitting", "running"] } },
      select: { projectId: true }, distinct: ["projectId"], take: 100 });
    const executions = await this.database.workflowExecution.findMany({ where: { status: { in: ["queued", "running"] } },
      select: { projectId: true }, distinct: ["projectId"], take: 100 });
    for (const projectId of new Set([...attempts, ...executions].map((item) => item.projectId))) {
      const project = await this.database.project.findUnique({ where: { id: projectId }, include: { workspace: { select: { ownerId: true } } } });
      if (!project || project.deletedAt) continue;
      try { await this.runtime.sync(project.workspace.ownerId, projectId); }
      catch { this.logger.warn(`工作流 ${projectId} 的执行恢复将在下一轮重试`); }
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
  }
}
