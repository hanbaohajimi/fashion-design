import {
  AssistantDelegationCadence as DbCadence,
  AssistantDelegationStatus as DbStatus,
  Prisma,
  type PrismaClient,
} from "@fashion/db";
import {
  assistantDelegationInputSchema,
  assistantDelegationViewSchema,
  type AssistantDelegationInput,
  type AssistantDelegationView,
} from "@fashion/shared";
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";

import { ProjectAccessPolicy } from "../studio/project-access.policy";
import {
  WorkflowAssistantService,
  workflowMessageSchema,
} from "../workflow-runtime/workflow-assistant.service";
import {
  nextOccurrence,
  scheduleAnchorFor,
} from "./schedule";

export const ASSISTANT_DELEGATIONS_DB = Symbol("ASSISTANT_DELEGATIONS_DB");
const DELEGATION_LIMIT = 24;
const DRAIN_INTERVAL_MS = 15_000;
const LEASE_MS = 20 * 60_000;
const MAX_ERROR_LENGTH = 1_000;

type DelegationRecord = Awaited<
  ReturnType<PrismaClient["assistantDelegation"]["findUniqueOrThrow"]>
>;

function fingerprint(input: AssistantDelegationInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function asView(record: DelegationRecord): AssistantDelegationView {
  return assistantDelegationViewSchema.parse({
    cadence: record.cadence,
    conversationId: record.conversationId,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    lastError: record.lastError,
    lastRunAt: record.lastRunAt?.toISOString() ?? null,
    name: record.name,
    nextRunAt: record.nextRunAt.toISOString(),
    ownerId: record.ownerId,
    projectId: record.projectId,
    prompt: record.prompt,
    runCount: record.runCount,
    status: record.status,
    timeZone: record.timeZone,
    updatedAt: record.updatedAt.toISOString(),
  });
}

@Injectable()
export class AssistantDelegationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantDelegationsService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private drainFlight: Promise<void> | null = null;

  constructor(
    @Inject(ASSISTANT_DELEGATIONS_DB)
    private readonly database: PrismaClient,
    @Inject(ProjectAccessPolicy)
    private readonly access: ProjectAccessPolicy,
    @Inject(WorkflowAssistantService)
    private readonly assistant: WorkflowAssistantService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.drain().catch((error: unknown) => this.logger.error("设计委托调度失败", error));
    }, DRAIN_INTERVAL_MS);
    void this.drain().catch((error: unknown) => this.logger.error("设计委托首次调度失败", error));
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async list(userId: string, projectId: string): Promise<AssistantDelegationView[]> {
    await this.access.require(userId, projectId, "read");
    const rows = await this.database.assistantDelegation.findMany({
      where: { ownerId: userId, projectId },
      orderBy: [{ status: "asc" }, { nextRunAt: "asc" }, { updatedAt: "desc" }],
      take: DELEGATION_LIMIT,
    });
    return rows.map(asView);
  }

  async create(
    userId: string,
    projectId: string,
    raw: AssistantDelegationInput,
    requestKey: string,
  ): Promise<AssistantDelegationView> {
    const input = assistantDelegationInputSchema.parse(raw);
    await this.access.require(userId, projectId, "edit");
    const nextRunAt = new Date(input.nextRunAt);
    if (!Number.isFinite(nextRunAt.getTime()) || nextRunAt <= new Date()) {
      throw new ConflictException({
        code: "ASSISTANT_DELEGATION_TIME_INVALID",
        message: "下一次执行时间必须晚于现在",
      });
    }
    const scheduleAnchor = scheduleAnchorFor(nextRunAt, input.timeZone);
    const conversation = await this.database.agentConversation.findFirst({
      where: {
        archivedAt: null,
        createdById: userId,
        id: input.conversationId,
        mode: "workflow",
        projectId,
      },
    });
    if (!conversation) {
      throw new NotFoundException({
        code: "ASSISTANT_DELEGATION_CONVERSATION_NOT_FOUND",
        message: "请选择当前项目中的持续设计对话",
      });
    }
    const requestFingerprint = fingerprint(input);
    const existing = await this.database.assistantDelegation.findUnique({
      where: { ownerId_requestKey: { ownerId: userId, requestKey } },
    });
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "该请求编号已用于其他设计委托",
        });
      }
      return asView(existing);
    }
    const count = await this.database.assistantDelegation.count({ where: { ownerId: userId } });
    if (count >= DELEGATION_LIMIT) {
      throw new ConflictException({
        code: "ASSISTANT_DELEGATION_LIMIT_REACHED",
        message: `设计委托数量已达到上限 ${DELEGATION_LIMIT}`,
      });
    }
    try {
      const created = await this.database.assistantDelegation.create({
        data: {
          cadence: input.cadence,
          conversationId: conversation.id,
          fingerprint: requestFingerprint,
          name: input.name,
          nextRunAt,
          ownerId: userId,
          projectId,
          prompt: input.prompt,
          requestKey,
          scheduledLocalDayOfMonth: scheduleAnchor.dayOfMonth,
          scheduledLocalHour: scheduleAnchor.hour,
          scheduledLocalMinute: scheduleAnchor.minute,
          scheduledLocalSecond: scheduleAnchor.second,
          timeZone: input.timeZone,
        },
      });
      return asView(created);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const concurrent = await this.database.assistantDelegation.findUniqueOrThrow({
        where: { ownerId_requestKey: { ownerId: userId, requestKey } },
      });
      if (concurrent.fingerprint !== requestFingerprint) {
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "该请求编号已用于其他设计委托",
        });
      }
      return asView(concurrent);
    }
  }

  async updateState(
    userId: string,
    delegationId: string,
    status: "ACTIVE" | "PAUSED",
  ): Promise<AssistantDelegationView> {
    const delegation = await this.owned(userId, delegationId, "edit");
    if (delegation.status === DbStatus.RUNNING) {
      throw new ConflictException({
        code: "ASSISTANT_DELEGATION_RUNNING",
        message: "当前委托正在执行，完成后才能暂停或恢复",
      });
    }
    const now = new Date();
    const updated = await this.database.assistantDelegation.update({
      where: { id: delegation.id },
      data: {
        lastError: status === "ACTIVE" ? null : delegation.lastError,
        nextRunAt: status === "ACTIVE" && delegation.nextRunAt <= now ? now : delegation.nextRunAt,
        status,
      },
    });
    return asView(updated);
  }

  async remove(userId: string, delegationId: string): Promise<{ ok: true }> {
    const delegation = await this.owned(userId, delegationId, "edit");
    if (delegation.status === DbStatus.RUNNING) {
      throw new ConflictException({
        code: "ASSISTANT_DELEGATION_RUNNING",
        message: "当前委托正在执行，完成后才能删除",
      });
    }
    await this.database.assistantDelegation.delete({ where: { id: delegation.id } });
    return { ok: true };
  }

  async runNow(userId: string, delegationId: string): Promise<AssistantDelegationView> {
    const delegation = await this.owned(userId, delegationId, "edit");
    if (delegation.status === DbStatus.RUNNING) return asView(delegation);
    const token = randomUUID();
    const claimed = await this.database.assistantDelegation.updateMany({
      where: {
        id: delegation.id,
        ownerId: userId,
        status: { in: [DbStatus.ACTIVE, DbStatus.PAUSED, DbStatus.FAILED, DbStatus.COMPLETED] },
      },
      data: {
        lastError: null,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        leaseToken: token,
        status: DbStatus.RUNNING,
      },
    });
    if (!claimed.count) return asView(await this.owned(userId, delegationId));
    void this.execute(delegation.id, token).catch((error: unknown) => this.logger.error("设计委托立即执行失败", error));
    return asView(await this.database.assistantDelegation.findUniqueOrThrow({ where: { id: delegation.id } }));
  }

  async drain(): Promise<void> {
    if (this.drainFlight) return this.drainFlight;
    const flight = this.drainDue().finally(() => {
      if (this.drainFlight === flight) this.drainFlight = null;
    });
    this.drainFlight = flight;
    return flight;
  }

  private async drainDue(): Promise<void> {
    const now = new Date();
    const eligible = { OR: [
      { nextRunAt: { lte: now }, status: DbStatus.ACTIVE },
      { leaseExpiresAt: { lte: now }, status: DbStatus.RUNNING },
    ] };
    const due = await this.database.assistantDelegation.findMany({
      where: eligible,
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take: 8,
    });
    await Promise.all(due.map(async (row) => {
      const token = randomUUID();
      const claimed = await this.database.assistantDelegation.updateMany({
        where: { id: row.id, ...eligible },
        data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS), leaseToken: token, status: DbStatus.RUNNING },
      });
      if (claimed.count) await this.execute(row.id, token);
    }));
  }

  private async execute(delegationId: string, token: string): Promise<void> {
    const row = await this.database.assistantDelegation.findUnique({ where: { id: delegationId } });
    if (!row || row.status !== DbStatus.RUNNING || row.leaseToken !== token) return;
    const now = new Date();
    let failedReply = false;
    try {
      const result = await this.assistant.send(row.ownerId, row.conversationId, workflowMessageSchema.parse({
        clientRequestId: `delegation:${row.id}:${row.runCount + 1}`,
        content: row.prompt,
        focusNodeIds: [],
        referencedNodeIds: [],
      }));
      const reply = result.assistantMessage;
      if (reply.status === "failed") {
        failedReply = true;
        throw new Error(reply.error?.message || "助手未能完成本次委托，请回到设计对话重试。");
      }
      const receipt = reply.context.executionReceipt as { status?: string } | undefined;
      if (receipt?.status === "stopped") {
        failedReply = true;
        throw new Error("本次操作未能继续，请回到设计对话查看执行记录。");
      }
      const execution = reply.executionId ? await this.database.workflowExecution.findFirst({
        where: { id: reply.executionId, projectId: row.projectId, conversationId: row.conversationId, userId: row.ownerId },
        select: { status: true },
      }) : null;
      if (execution && ["failed", "partial_failed", "moderation_failed", "not_admitted"].includes(execution.status)) {
        failedReply = true;
        throw new Error("本次设计执行未全部完成，已产生的结果与失败原因保留在设计对话和任务中心。");
      }
      const waiting = reply.status === "canceled" || execution?.status === "canceled"
        ? "本次委托已取消。需要继续时，请先回到设计对话核对。"
        : reply.proposal?.status === "pending" || reply.kind === "clarify"
          ? "这一步需要你在设计对话中补充内容或确认方案，委托已暂停。"
          : reply.status === "completed" && (receipt?.status === "submitted" || reply.executionId) && !execution
            ? "本次执行关联尚未核实，请回到设计对话或任务中心确认。"
            : null;
      if (waiting) {
        await this.database.assistantDelegation.updateMany({
          where: { id: row.id, leaseToken: token, status: DbStatus.RUNNING },
          data: { status: DbStatus.PAUSED, lastError: waiting, lastRunAt: now, runCount: { increment: 1 }, leaseToken: null, leaseExpiresAt: null },
        });
        return;
      }
      if (reply.status !== "completed" || (execution && execution.status !== "completed")) {
        // The existing scheduler re-observes the same idempotent request. It does
        // not submit a new model turn while its reply or actual work is pending.
        await this.database.assistantDelegation.updateMany({
          where: { id: row.id, leaseToken: token, status: DbStatus.RUNNING },
          data: { leaseExpiresAt: new Date(Date.now() + DRAIN_INTERVAL_MS) },
        });
        return;
      }
      const nextRunAt = nextOccurrence(
        row.nextRunAt,
        row.cadence,
        row.timeZone,
        {
          dayOfMonth: row.scheduledLocalDayOfMonth,
          hour: row.scheduledLocalHour,
          minute: row.scheduledLocalMinute,
          second: row.scheduledLocalSecond,
        },
        now,
      );
      await this.database.assistantDelegation.updateMany({
        where: { id: row.id, leaseToken: token, status: DbStatus.RUNNING },
        data: {
          lastError: null,
          lastRunAt: now,
          leaseExpiresAt: null,
          leaseToken: null,
          nextRunAt,
          runCount: { increment: 1 },
          status: row.cadence === DbCadence.ONCE ? DbStatus.COMPLETED : DbStatus.ACTIVE,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "设计委托执行失败";
      const nextRunAt =
        row.cadence === DbCadence.ONCE
          ? row.nextRunAt
          : nextOccurrence(
              row.nextRunAt,
              row.cadence,
              row.timeZone,
              {
                dayOfMonth: row.scheduledLocalDayOfMonth,
                hour: row.scheduledLocalHour,
                minute: row.scheduledLocalMinute,
                second: row.scheduledLocalSecond,
              },
              now,
            );
      await this.database.assistantDelegation.updateMany({
        where: { id: row.id, leaseToken: token, status: DbStatus.RUNNING },
        data: {
          lastError: message.slice(0, MAX_ERROR_LENGTH),
          leaseExpiresAt: null,
          leaseToken: null,
          nextRunAt,
          status: row.cadence === DbCadence.ONCE ? DbStatus.FAILED : DbStatus.ACTIVE,
          ...(failedReply ? { runCount: { increment: 1 }, lastRunAt: now } : {}),
        },
      });
    }
  }

  private async owned(userId: string, delegationId: string, action: "read" | "edit" = "read") {
    const delegation = await this.database.assistantDelegation.findFirst({
      where: { id: delegationId, ownerId: userId },
    });
    if (!delegation) throw new NotFoundException("设计委托不存在");
    await this.access.require(userId, delegation.projectId, action);
    return delegation;
  }
}
