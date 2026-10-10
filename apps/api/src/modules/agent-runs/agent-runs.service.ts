import { GenerationTaskStatus, Prisma, type PrismaClient } from "@fashion/db";
import { AGENT_PLAN_MAX_STEPS, type AgentRunCandidate } from "@fashion/shared";
import type {
  AgentPlanStepSpec,
  AgentRunView,
  AgentRunStepView,
} from "@fashion/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { ContextCompilerService } from "../generation/compiler/context-compiler.service";
import type { CompiledGenInput } from "../generation/compiler/compiler.types";
import { GenerationService } from "../generation/generation.service";
import type { GenerationCreateRequest } from "../generation/generation.schemas";
import { agentAttemptTaskId, AGENT_TOOL_REGISTRY } from "./agent-tool.registry";
import {
  agentPlanSchema,
  type ReviewAgentRunInput,
  type UpdateAgentRunStepInput,
  type UpdateAgentRunPlanInput,
  type RejectAgentRunInput,
} from "./agent-runs.schemas";

export const AGENT_RUNS_DB = Symbol("AGENT_RUNS_DB");
const ATTEMPT_LEASE_MS = 2 * 60 * 1000;
const TERMINAL_RUNS = new Set(["completed", "canceled"]);
type RunsDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "agentRun"
  | "agentRunStep"
  | "agentRunStepAttempt"
  | "agentConversation"
  | "designAsset"
  | "designAssetDecision"
  | "generationTask"
>;
const runInclude = {
  steps: {
    orderBy: { ordinal: "asc" as const },
    include: { attempts: { orderBy: { ordinal: "desc" as const } } },
  },
};
type RunRecord = Prisma.AgentRunGetPayload<{ include: typeof runInclude }>;
type StepRecord = RunRecord["steps"][number];
type AttemptRecord = StepRecord["attempts"][number];

export interface ReserveAgentRunInput {
  readonly clientRequestId: string;
  readonly intent: string;
  readonly contextSnapshot: unknown;
}

@Injectable()
export class AgentRunsService {
  constructor(
    @Inject(AGENT_RUNS_DB) private readonly database: RunsDatabase,
    @Inject(GenerationService) private readonly generation: GenerationService,
    @Inject(ContextCompilerService)
    private readonly compiler: ContextCompilerService,
  ) {}

  async findReservation(
    userId: string,
    conversationId: string,
    input: ReserveAgentRunInput,
  ): Promise<AgentRunView | null> {
    await this.ownedConversation(userId, conversationId);
    const run = await this.database.agentRun.findUnique({
      where: {
        conversationId_clientRequestId: {
          conversationId,
          clientRequestId: input.clientRequestId,
        },
      },
      include: runInclude,
    });
    if (!run) return null;
    this.assertSameReservation(run, input);
    return this.toView(await this.reconcile(run));
  }

  async reserve(
    userId: string,
    conversationId: string,
    input: ReserveAgentRunInput,
  ): Promise<{ created: boolean; run: AgentRunView }> {
    const conversation = await this.ownedConversation(userId, conversationId);
    if (conversation.archivedAt)
      throw new BadRequestException({
        code: "AGENT_CONVERSATION_ARCHIVED",
        message: "已归档会话不能创建计划",
      });
    const where = {
      conversationId_clientRequestId: {
        conversationId,
        clientRequestId: input.clientRequestId,
      },
    };
    const existing = await this.database.agentRun.findUnique({
      where,
      include: runInclude,
    });
    if (existing) {
      this.assertSameReservation(existing, input);
      return { created: false, run: await this.toView(existing) };
    }
    try {
      const run = await this.database.agentRun.create({
        data: {
          conversationId,
          projectId: conversation.projectId,
          userId,
          clientRequestId: input.clientRequestId,
          intent: input.intent,
          contextSnapshot: input.contextSnapshot as Prisma.InputJsonValue,
          status: "planning",
        },
        include: runInclude,
      });
      return { created: true, run: await this.toView(run) };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error;
      const run = await this.database.agentRun.findUniqueOrThrow({
        where,
        include: runInclude,
      });
      this.assertSameReservation(run, input);
      return { created: false, run: await this.toView(run) };
    }
  }

  async completePlan(
    userId: string,
    runId: string,
    specs: readonly AgentPlanStepSpec[],
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    if (run.status !== "planning") return this.toView(run);
    const parsed = agentPlanSchema.safeParse(specs);
    if (!parsed.success)
      throw new BadRequestException({
        code: "INVALID_AGENT_PLAN",
        message: parsed.error.issues[0]?.message ?? "设计计划无效",
      });
    const context = objectOf(run.contextSnapshot);
    const selectedAssets = new Set(
      Array.isArray(context.designAssetIds) ? context.designAssetIds : [],
    );
    if (
      parsed.data.some(
        (step) => step.sourceAssetId && !selectedAssets.has(step.sourceAssetId),
      )
    )
      throw new BadRequestException({
        code: "INVALID_AGENT_EDIT_SOURCE",
        message: "计划仅可编辑本次选中的设计资产",
      });
    await Promise.all(
      parsed.data.flatMap((step) =>
        step.sourceAssetId
          ? [this.ownedSource(userId, run.projectId, step.sourceAssetId)]
          : [],
      ),
    );
    await this.database.$transaction(async (transaction) => {
      const changed = await transaction.agentRun.updateMany({
        where: { id: run.id, revision: run.revision, status: "planning" },
        data: { status: "ready", revision: { increment: 1 }, error: null },
      });
      if (!changed.count) return;
      await transaction.agentRunStep.createMany({
        data: parsed.data.map((step, ordinal) => ({
          ...step,
          runId,
          ordinal,
          status: "pending",
        })),
      });
    });
    return this.toView(await this.ownedRun(userId, runId));
  }

  async failPlanning(
    userId: string,
    runId: string,
    error: string,
  ): Promise<AgentRunView> {
    await this.ownedRun(userId, runId);
    await this.database.agentRun.updateMany({
      where: { id: runId, status: "planning" },
      data: {
        status: "failed",
        error: error.slice(0, 1000),
        revision: { increment: 1 },
      },
    });
    return this.toView(await this.ownedRun(userId, runId));
  }

  async list(
    userId: string,
    conversationId: string,
  ): Promise<{ items: AgentRunView[] }> {
    await this.ownedConversation(userId, conversationId);
    const runs = await this.database.agentRun.findMany({
      where: { userId, conversationId },
      include: runInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    });
    const items: AgentRunView[] = [];
    for (const run of runs)
      items.push(await this.toView(await this.reconcile(run)));
    return { items };
  }

  async get(userId: string, runId: string): Promise<AgentRunView> {
    return this.toView(
      await this.reconcile(await this.ownedRun(userId, runId)),
    );
  }

  async updateStep(
    userId: string,
    runId: string,
    stepId: string,
    input: UpdateAgentRunStepInput,
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    this.assertRevision(run, input.revision);
    const step = run.steps.find((item) => item.id === stepId);
    if (!step)
      throw new NotFoundException({
        code: "AGENT_RUN_STEP_NOT_FOUND",
        message: "计划节点不存在",
      });
    if (
      !new Set(["ready", "paused", "failed"]).has(run.status) ||
      !new Set(["pending", "failed"]).has(step.status)
    )
      throw new ConflictException({
        code: "AGENT_RUN_STEP_IMMUTABLE",
        message: "当前节点已执行，不能修改输入",
      });
    // An admitted attempt freezes its inputs, even if queuing failed. A failed terminal task may be replaced with a new attempt.
    const latest = step.attempts[0];
    if (latest && latest.status !== "rejected") {
      const task = await this.taskFor(run, latest);
      if (
        !task ||
        task.status === GenerationTaskStatus.QUEUED ||
        task.status === GenerationTaskStatus.RUNNING ||
        task.status === GenerationTaskStatus.SUCCEEDED
      ) {
        throw new ConflictException({
          code: "AGENT_RUN_STEP_IMMUTABLE",
          message: "当前尝试已保存输入，请重试或新建计划",
        });
      }
    }
    const data = {
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.instruction === undefined
        ? {}
        : { instruction: input.instruction }),
    };
    await this.database.$transaction(async (transaction) => {
      await this.claimRevision(transaction, run, input.revision, {
        error: null,
      });
      await transaction.agentRunStep.update({ where: { id: stepId }, data });
    });
    return this.toView(await this.ownedRun(userId, runId));
  }

  async updatePlan(
    userId: string,
    runId: string,
    input: UpdateAgentRunPlanInput,
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    this.assertRevision(run, input.revision);
    if (!new Set(["ready", "paused", "failed"]).has(run.status))
      throw new ConflictException({
        code: "AGENT_RUN_PLAN_IMMUTABLE",
        message: "请等待当前执行或结果选择完成后再编辑计划",
      });
    const parsed = agentPlanSchema.safeParse(input.steps);
    if (!parsed.success)
      throw new BadRequestException({
        code: "INVALID_AGENT_PLAN",
        message: parsed.error.issues[0]?.message ?? "设计计划无效",
      });
    const immutableKeys = new Set<string>();
    for (const step of run.steps) {
      if (canEditStructure(step)) continue;
      immutableKeys.add(step.key);
      const nextIndex = parsed.data.findIndex((next) => next.key === step.key);
      const next = parsed.data[nextIndex];
      if (
        nextIndex !== step.ordinal ||
        !next ||
        stableJson(next) !== stableJson(stepSpec(step))
      )
        throw new ConflictException({
          code: "AGENT_RUN_STEP_IMMUTABLE",
          message: "已执行节点的内容和位置必须保留，可编辑后续未执行节点",
        });
    }
    const selectedAssets = new Set(sourceAssetIds(run));
    if (
      parsed.data.some(
        (step) => step.sourceAssetId && !selectedAssets.has(step.sourceAssetId),
      )
    )
      throw new BadRequestException({
        code: "INVALID_AGENT_EDIT_SOURCE",
        message: "计划仅可编辑本次选中的设计资产",
      });
    await Promise.all(
      parsed.data.flatMap((step) =>
        step.sourceAssetId && !immutableKeys.has(step.key)
          ? [this.ownedSource(userId, run.projectId, step.sourceAssetId)]
          : [],
      ),
    );
    const nextKeys = parsed.data.map((step) => step.key);
    const currentByKey = new Map(run.steps.map((step) => [step.key, step]));
    const complete = parsed.data.every(
      (step) => currentByKey.get(step.key)?.status === "succeeded",
    );
    await this.database.$transaction(async (transaction) => {
      await this.claimRevision(transaction, run, input.revision, {
        ...(complete ? { status: "completed", error: null } : {}),
      });
      await transaction.agentRunStep.deleteMany({
        where: {
          runId,
          key: { notIn: nextKeys },
          attempt: 0,
          status: "pending",
        },
      });
      // Move editable rows out of the final ordinal range before swapping them under the unique index.
      for (const step of run.steps)
        if (canEditStructure(step) && nextKeys.includes(step.key))
          await transaction.agentRunStep.update({
            where: { id: step.id },
            data: { ordinal: step.ordinal + AGENT_PLAN_MAX_STEPS },
          });
      const additions: Prisma.AgentRunStepCreateManyInput[] = [];
      for (const [ordinal, spec] of parsed.data.entries()) {
        const current = currentByKey.get(spec.key);
        if (current) {
          if (canEditStructure(current))
            await transaction.agentRunStep.update({
              where: { id: current.id },
              data: { ...spec, ordinal },
            });
        } else additions.push({ ...spec, ordinal, runId, status: "pending" });
      }
      if (additions.length)
        await transaction.agentRunStep.createMany({ data: additions });
    });
    return this.toView(await this.ownedRun(userId, runId));
  }

  async execute(
    userId: string,
    runId: string,
    revision: number,
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    this.assertRevision(run, revision);
    if (!new Set(["ready", "paused", "failed", "running"]).has(run.status))
      throw new ConflictException({
        code: "AGENT_RUN_NOT_EXECUTABLE",
        message: "请先完成规划或确认当前结果",
      });
    const step = run.steps.find((item) => item.status !== "succeeded");
    if (!step || !new Set(["pending", "failed", "running"]).has(step.status))
      throw new ConflictException({
        code: "AGENT_RUN_NOT_EXECUTABLE",
        message: "没有可执行节点",
      });
    let previous = step.attempts[0];
    if (previous?.status === "rejected") previous = undefined;
    const previousTask = previous ? await this.taskFor(run, previous) : null;
    if (previousTask?.status === GenerationTaskStatus.SUCCEEDED)
      return this.get(userId, runId);
    if (
      previous &&
      previous.status === "running" &&
      previous.leaseExpiresAt.getTime() > Date.now() &&
      !previousTask
    ) {
      throw new ConflictException({
        code: "AGENT_RUN_BUSY",
        message: "当前节点正在提交，请稍后刷新",
      });
    }
    const terminalFailure =
      previousTask &&
      new Set<GenerationTaskStatus>([
        GenerationTaskStatus.FAILED,
        GenerationTaskStatus.MODERATION_FAILED,
        GenerationTaskStatus.CANCELED,
      ]).has(previousTask.status);
    if (terminalFailure) previous = undefined;
    const request = previous
      ? (previous.requestSnapshot as unknown as GenerationCreateRequest)
      : await this.buildRequest(run, step);
    const ordinal = previous?.ordinal ?? step.attempt + 1;
    const executionKey =
      previous?.executionKey ?? `agent-run:${run.id}:${step.id}:${ordinal}`;
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + ATTEMPT_LEASE_MS);
    const attempt = await this.database.$transaction(async (transaction) => {
      await this.claimRevision(transaction, run, revision, {
        status: "running",
        error: null,
      });
      await transaction.agentRunStep.update({
        where: { id: step.id },
        data: {
          attempt: ordinal,
          status: "running",
          error: null,
          generationTaskId:
            previousTask && !terminalFailure ? previousTask.id : null,
        },
      });
      return previous
        ? transaction.agentRunStepAttempt.update({
            where: { id: previous.id },
            data: {
              status: "running",
              leaseToken,
              leaseExpiresAt,
              error: null,
            },
          })
        : transaction.agentRunStepAttempt.create({
            data: {
              stepId: step.id,
              ordinal,
              executionKey,
              requestSnapshot: request as Prisma.InputJsonValue,
              status: "running",
              leaseToken,
              leaseExpiresAt,
            },
          });
    });
    try {
      let compiled =
        attempt.compiledSnapshot as unknown as CompiledGenInput | null;
      // If submission completed before a process interruption, recover the real task before any compiler or provider work.
      const recoveredTask = await this.taskFor(run, attempt);
      let taskId = recoveredTask?.id;
      if (!taskId || recoveredTask?.status === GenerationTaskStatus.QUEUED) {
        if (!compiled) {
          compiled = await this.compiler.compile(
            userId,
            run.projectId,
            request.prompt,
            request.shapeIds,
            { modelCalls: "skip" },
          );
          const persisted = await this.database.agentRunStepAttempt.updateMany({
            where: {
              id: attempt.id,
              leaseToken,
              status: "running",
              leaseExpiresAt: { gt: new Date() },
            },
            data: {
              compiledSnapshot: compiled as unknown as Prisma.InputJsonValue,
            },
          });
          if (!persisted.count) return this.get(userId, runId);
        }
        const current = await this.ownedRun(userId, runId);
        if (current.status === "canceled" || current.status === "paused") {
          await this.database.agentRunStepAttempt.updateMany({
            where: { id: attempt.id, leaseToken },
            data: { leaseExpiresAt: new Date() },
          });
          return this.toView(current);
        }
        const active = await this.database.agentRunStepAttempt.updateMany({
          where: {
            id: attempt.id,
            leaseToken,
            status: "running",
            leaseExpiresAt: { gt: new Date() },
          },
          data: { leaseExpiresAt: new Date(Date.now() + ATTEMPT_LEASE_MS) },
        });
        if (!active.count) return this.get(userId, runId);
        const result = await this.generation.createFromAgent(
          userId,
          request,
          executionKey,
          step.instruction,
          compiled,
        );
        taskId = result.taskId;
      }
      if (!taskId) throw new Error("节点提交未返回任务编号");
      await this.bindTask(run, step, attempt, leaseToken, taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "节点执行失败";
      const task = await this.taskFor(run, attempt);
      if (
        task?.status === GenerationTaskStatus.RUNNING ||
        task?.status === GenerationTaskStatus.SUCCEEDED
      )
        return this.get(userId, runId);
      await this.database
        .$transaction(async (transaction) => {
          const current = await transaction.agentRun.findUnique({
            where: { id: run.id },
          });
          if (!current || !new Set(["running", "paused"]).has(current.status))
            return;
          const claimed = await transaction.agentRun.updateMany({
            where: {
              id: run.id,
              revision: current.revision,
              status: current.status,
            },
            data: {
              status: current.status === "paused" ? "paused" : "failed",
              error: message.slice(0, 1000),
              revision: { increment: 1 },
            },
          });
          if (!claimed.count) return;
          const changed = await transaction.agentRunStepAttempt.updateMany({
            where: { id: attempt.id, leaseToken, status: "running" },
            data: {
              status: "failed",
              error: message.slice(0, 1000),
              ...(task ? { generationTaskId: task.id } : {}),
            },
          });
          if (!changed.count) throw new SupersededAttemptError();
          await transaction.agentRunStep.update({
            where: { id: step.id },
            data: {
              status: "failed",
              error: message.slice(0, 1000),
              ...(task ? { generationTaskId: task.id } : {}),
            },
          });
        })
        .catch((error) => {
          if (!(error instanceof SupersededAttemptError)) throw error;
        });
      const current = await this.ownedRun(userId, runId);
      if (current.status === "canceled" && task)
        await this.generation.cancel(userId, task.id);
      return this.toView(current);
    }
    return this.get(userId, runId);
  }

  async review(
    userId: string,
    runId: string,
    input: ReviewAgentRunInput,
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    this.assertRevision(run, input.revision);
    const step = run.steps.find((item) => item.status === "waiting_review");
    if (run.status !== "waiting_review" || !step || !step.generationTaskId)
      throw new ConflictException({
        code: "AGENT_RUN_NOT_REVIEWABLE",
        message: "当前没有等待选择的结果",
      });
    const asset = await this.database.designAsset.findFirst({
      where: {
        id: input.assetId,
        projectId: run.projectId,
        generationTaskId: step.generationTaskId,
        archivedAt: null,
      },
    });
    if (!asset)
      throw new BadRequestException({
        code: "INVALID_AGENT_RUN_SELECTION",
        message: "请选择当前节点实际生成的结果",
      });
    const completed = run.steps.every(
      (item) => item.id === step.id || item.status === "succeeded",
    );
    await this.database.$transaction(async (transaction) => {
      await this.claimRevision(transaction, run, input.revision, {
        status: completed ? "completed" : "ready",
        error: null,
      });
      await transaction.agentRunStep.update({
        where: { id: step.id },
        data: { status: "succeeded", selectedAssetId: asset.id, error: null },
      });
      await transaction.designAssetDecision.create({
        data: {
          assetId: asset.id,
          userId,
          kind: "selected",
          reason: input.reason,
          clientRequestId: `agent-run:${run.id}:${step.id}`,
        },
      });
    });
    return this.toView(await this.ownedRun(userId, runId));
  }

  async reject(
    userId: string,
    runId: string,
    input: RejectAgentRunInput,
  ): Promise<AgentRunView> {
    const reason = input.reason.trim();
    if (!reason || reason.length > 1000)
      throw new BadRequestException({
        code: "INVALID_AGENT_RUN_REJECTION",
        message: "请填写 1 到 1000 字的否决理由",
      });
    const run = await this.ownedRun(userId, runId);
    this.assertRevision(run, input.revision);
    const step = run.steps.find((item) => item.status === "waiting_review");
    const attempt = step?.attempts[0];
    if (
      run.status !== "waiting_review" ||
      !step ||
      !attempt ||
      !step.generationTaskId ||
      attempt.generationTaskId !== step.generationTaskId
    )
      throw new ConflictException({
        code: "AGENT_RUN_NOT_REVIEWABLE",
        message: "当前没有等待否决的结果",
      });
    await this.database.$transaction(async (transaction) => {
      await this.claimRevision(transaction, run, input.revision, {
        status: "ready",
        error: null,
      });
      const assets = await transaction.designAsset.findMany({
        where: {
          generationTaskId: step.generationTaskId,
          projectId: run.projectId,
          archivedAt: null,
        },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (!assets.length)
        throw new ConflictException({
          code: "AGENT_RUN_RESULTS_UNAVAILABLE",
          message: "当前结果已不可访问，请刷新后重试",
        });
      for (const asset of assets)
        await transaction.designAssetDecision.create({
          data: {
            assetId: asset.id,
            userId,
            kind: "rejected",
            reason,
            clientRequestId: `agent-attempt:${attempt.id}:reject`,
          },
        });
      await transaction.agentRunStepAttempt.update({
        where: { id: attempt.id },
        data: { status: "rejected", error: reason },
      });
      await transaction.agentRunStep.update({
        where: { id: step.id },
        data: {
          status: "pending",
          generationTaskId: null,
          selectedAssetId: null,
          error: null,
        },
      });
    });
    return this.toView(await this.ownedRun(userId, runId));
  }

  async pause(
    userId: string,
    runId: string,
    revision: number,
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    this.assertRevision(run, revision);
    if (!new Set(["ready", "running", "failed", "paused"]).has(run.status))
      throw new ConflictException({
        code: "AGENT_RUN_NOT_PAUSABLE",
        message: "当前状态无需暂停",
      });
    await this.database.$transaction((transaction) =>
      this.claimRevision(transaction, run, revision, { status: "paused" }),
    );
    return this.toView(await this.ownedRun(userId, runId));
  }

  async cancel(
    userId: string,
    runId: string,
    revision: number,
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    this.assertRevision(run, revision);
    if (TERMINAL_RUNS.has(run.status))
      return this.toView(await this.reconcile(run));
    await this.database.$transaction(async (transaction) => {
      await this.claimRevision(transaction, run, revision, {
        status: "canceled",
        error: null,
      });
      await transaction.agentRunStep.updateMany({
        where: { runId, status: { not: "succeeded" } },
        data: { status: "canceled", error: null },
      });
      await transaction.agentRunStepAttempt.updateMany({
        where: { step: { runId }, status: "running" },
        data: { status: "canceled", error: null },
      });
    });
    return this.toView(
      await this.reconcile(await this.ownedRun(userId, runId)),
    );
  }

  private async buildRequest(
    run: RunRecord,
    step: StepRecord,
  ): Promise<GenerationCreateRequest> {
    const sourceId =
      step.sourceAssetId ??
      (step.sourceStepKey
        ? run.steps.find((item) => item.key === step.sourceStepKey)
            ?.selectedAssetId
        : null);
    const tool = AGENT_TOOL_REGISTRY[step.tool as AgentPlanStepSpec["tool"]];
    if (!tool || (tool.requiresSource && !sourceId))
      throw new BadRequestException({
        code: "AGENT_RUN_SOURCE_UNAVAILABLE",
        message: "请先选定前序节点结果",
      });
    const source = sourceId
      ? await this.ownedSource(run.userId, run.projectId, sourceId)
      : null;
    const context = objectOf(run.contextSnapshot);
    const shapeIds = Array.isArray(context.shapeIds)
      ? context.shapeIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, 100)
      : [];
    const ratio =
      source?.width && source?.height ? source.width / source.height : 1;
    const size =
      ratio > 1
        ? { width: 1024, height: 768 }
        : ratio < 1
          ? { width: 768, height: 1024 }
          : { width: 1024, height: 1024 };
    const base = {
      ...size,
      projectId: run.projectId,
      prompt: step.prompt,
      negativePrompt: step.negativePrompt,
      shapeIds,
      quality: "high" as const,
      outputFormat: "png" as const,
      outputCompression: 90,
      background: "opaque" as const,
    };
    return source
      ? {
          ...base,
          taskType: "i2i",
          parentAssetId: source.id,
          referenceImageUrl: source.url,
        }
      : { ...base, taskType: "t2i" };
  }

  private async bindTask(
    run: RunRecord,
    step: StepRecord,
    attempt: AttemptRecord,
    leaseToken: string,
    taskId: string,
  ) {
    await this.database
      .$transaction(async (transaction) => {
        const current = await transaction.agentRun.findUnique({
          where: { id: run.id },
        });
        if (!current) return;
        if (current.status === "canceled") {
          await transaction.agentRunStepAttempt.updateMany({
            where: { id: attempt.id, leaseToken },
            data: { generationTaskId: taskId },
          });
          return;
        }
        if (!new Set(["running", "paused"]).has(current.status)) return;
        const claimed = await transaction.agentRun.updateMany({
          where: {
            id: run.id,
            revision: current.revision,
            status: current.status,
          },
          data: { revision: { increment: 1 } },
        });
        if (!claimed.count) return;
        const changed = await transaction.agentRunStepAttempt.updateMany({
          where: { id: attempt.id, leaseToken, status: "running" },
          data: { generationTaskId: taskId },
        });
        if (!changed.count) throw new SupersededAttemptError();
        await transaction.agentRunStep.update({
          where: { id: step.id },
          data: { generationTaskId: taskId },
        });
      })
      .catch((error) => {
        if (!(error instanceof SupersededAttemptError)) throw error;
      });
    const current = await this.ownedRun(run.userId, run.id);
    if (current.status === "canceled")
      await this.generation.cancel(run.userId, taskId);
  }

  private async reconcile(run: RunRecord): Promise<RunRecord> {
    if (run.status === "canceled") {
      for (const step of run.steps) {
        const attempt = step.attempts[0];
        if (!attempt) continue;
        const task = await this.taskFor(run, attempt);
        if (!task) continue;
        if (!attempt.generationTaskId)
          await this.database.agentRunStepAttempt.updateMany({
            where: { id: attempt.id, generationTaskId: null },
            data: { generationTaskId: task.id },
          });
        if (
          task.status === GenerationTaskStatus.QUEUED ||
          task.status === GenerationTaskStatus.RUNNING
        )
          await this.generation.cancel(run.userId, task.id);
      }
      return run;
    }
    if (run.status === "completed") return run;
    if (run.status === "planning") {
      if (run.updatedAt.getTime() + 10 * 60 * 1000 > Date.now()) return run;
      await this.database.agentRun.updateMany({
        where: { id: run.id, revision: run.revision, status: "planning" },
        data: {
          status: "failed",
          error: "计划生成已中断，请重新创建计划",
          revision: { increment: 1 },
        },
      });
      return this.ownedRun(run.userId, run.id);
    }
    const step = run.steps.find(
      (item) => item.status === "running" || item.status === "failed",
    );
    const attempt = step?.attempts[0];
    if (!step || !attempt) return run;
    const task = await this.taskFor(run, attempt);
    let status: string | null = null;
    let error: string | null = null;
    if (task?.status === GenerationTaskStatus.QUEUED) {
      try {
        await this.generation.resumeQueuedTask(run.userId, task.id);
        if (step.status === "failed") status = "running";
      } catch (queueError) {
        status = "failed";
        error =
          queueError instanceof Error
            ? queueError.message
            : "生成队列暂时不可用，可使用原输入恢复";
      }
    } else if (
      task?.status === GenerationTaskStatus.RUNNING &&
      step.status === "failed"
    ) {
      status = "running";
    } else if (task?.status === GenerationTaskStatus.SUCCEEDED) {
      const count = await this.database.designAsset.count({
        where: {
          generationTaskId: task.id,
          projectId: run.projectId,
          archivedAt: null,
        },
      });
      status = count ? "waiting_review" : "failed";
      if (!count) error = "任务已完成但没有可访问的设计资产";
    } else if (
      task &&
      new Set<GenerationTaskStatus>([
        GenerationTaskStatus.FAILED,
        GenerationTaskStatus.MODERATION_FAILED,
        GenerationTaskStatus.CANCELED,
      ]).has(task.status)
    ) {
      status = "failed";
      error = task.errorMessage ?? "生成任务未完成，请检查输入后重试";
    } else if (
      !task &&
      step.status === "running" &&
      attempt.leaseExpiresAt.getTime() <= Date.now()
    ) {
      status = "failed";
      error = "节点提交已中断，可使用原输入继续恢复";
    }
    if (
      status === step.status &&
      error === step.error &&
      (!task || step.generationTaskId === task.id)
    )
      return run;
    if (!status && (!task || step.generationTaskId === task.id)) return run;
    await this.database.$transaction(async (transaction) => {
      const changed = await transaction.agentRun.updateMany({
        where: {
          id: run.id,
          revision: run.revision,
          status: { notIn: ["canceled", "completed"] },
        },
        data: {
          ...(status
            ? {
                status:
                  run.status === "paused" && status !== "waiting_review"
                    ? "paused"
                    : status,
                error,
              }
            : {}),
          revision: { increment: 1 },
        },
      });
      if (!changed.count) return;
      await transaction.agentRunStep.update({
        where: { id: step.id },
        data: {
          ...(status ? { status, error } : {}),
          ...(task ? { generationTaskId: task.id } : {}),
        },
      });
      await transaction.agentRunStepAttempt.update({
        where: { id: attempt.id },
        data: {
          ...(status
            ? {
                status: status === "waiting_review" ? "succeeded" : status,
                error,
              }
            : {}),
          ...(task ? { generationTaskId: task.id } : {}),
        },
      });
    });
    return this.ownedRun(run.userId, run.id);
  }

  private taskFor(run: RunRecord, attempt: AttemptRecord) {
    return this.database.generationTask.findFirst({
      where: {
        id:
          attempt.generationTaskId ??
          agentAttemptTaskId(run.userId, attempt.executionKey),
        userId: run.userId,
        projectId: run.projectId,
      },
    });
  }

  private assertRevision(run: RunRecord, revision: number) {
    if (run.revision !== revision)
      throw new ConflictException({
        code: "AGENT_RUN_REVISION_CONFLICT",
        message: "计划已更新，请刷新后重试",
      });
  }

  private async claimRevision(
    transaction: Prisma.TransactionClient,
    run: RunRecord,
    revision: number,
    data: Prisma.AgentRunUpdateManyMutationInput,
  ) {
    const result = await transaction.agentRun.updateMany({
      where: { id: run.id, userId: run.userId, revision, status: run.status },
      data: { ...data, revision: { increment: 1 } },
    });
    if (!result.count)
      throw new ConflictException({
        code: "AGENT_RUN_REVISION_CONFLICT",
        message: "计划已更新，请刷新后重试",
      });
  }

  private assertSameReservation(run: RunRecord, input: ReserveAgentRunInput) {
    if (
      run.intent !== input.intent ||
      stableJson(requestContext(run.contextSnapshot)) !==
        stableJson(requestContext(input.contextSnapshot))
    )
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "该请求编号已用于不同的设计计划",
      });
  }

  private async ownedConversation(userId: string, conversationId: string) {
    const conversation = await this.database.agentConversation.findUnique({
      where: { id: conversationId },
      include: {
        project: {
          select: { deletedAt: true, workspace: { select: { ownerId: true } } },
        },
      },
    });
    if (!conversation || conversation.project.deletedAt)
      throw new NotFoundException({
        code: "AGENT_CONVERSATION_NOT_FOUND",
        message: "会话不存在",
      });
    if (
      conversation.createdById !== userId ||
      conversation.project.workspace.ownerId !== userId
    )
      throw new ForbiddenException({
        code: "AGENT_CONVERSATION_FORBIDDEN",
        message: "无权访问该会话",
      });
    return conversation;
  }

  private async ownedRun(userId: string, runId: string): Promise<RunRecord> {
    const run = await this.database.agentRun.findUnique({
      where: { id: runId },
      include: runInclude,
    });
    if (!run)
      throw new NotFoundException({
        code: "AGENT_RUN_NOT_FOUND",
        message: "设计计划不存在",
      });
    if (run.userId !== userId)
      throw new ForbiddenException({
        code: "AGENT_RUN_FORBIDDEN",
        message: "无权访问该计划",
      });
    await this.ownedConversation(userId, run.conversationId);
    return run;
  }

  private async ownedSource(
    userId: string,
    projectId: string,
    assetId: string,
  ) {
    const asset = await this.database.designAsset.findFirst({
      where: {
        id: assetId,
        projectId,
        archivedAt: null,
        project: { deletedAt: null, workspace: { ownerId: userId } },
      },
    });
    if (!asset)
      throw new BadRequestException({
        code: "INVALID_AGENT_EDIT_SOURCE",
        message: "编辑来源必须是当前项目可访问的设计资产",
      });
    return asset;
  }

  private async toView(run: RunRecord): Promise<AgentRunView> {
    const taskIds = [
      ...new Set(
        run.steps.flatMap((step) =>
          [
            step.generationTaskId,
            ...step.attempts.map((attempt) => attempt.generationTaskId),
          ].filter((id): id is string => !!id),
        ),
      ),
    ];
    const sourceIds = sourceAssetIds(run);
    const allAssets =
      taskIds.length || sourceIds.length
        ? await this.database.designAsset.findMany({
            where: {
              projectId: run.projectId,
              archivedAt: null,
              OR: [
                { generationTaskId: { in: taskIds } },
                { id: { in: sourceIds } },
              ],
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          })
        : [];
    const steps: AgentRunStepView[] = [];
    for (const step of run.steps) {
      const assets = step.generationTaskId
        ? allAssets.filter(
            (asset) => asset.generationTaskId === step.generationTaskId,
          )
        : [];
      const latest = step.attempts[0];
      const latestTask =
        latest && latest.status !== "rejected"
          ? await this.taskFor(run, latest)
          : null;
      const canEditInputs =
        new Set(["ready", "paused", "failed"]).has(run.status) &&
        new Set(["pending", "failed"]).has(step.status) &&
        (!latest ||
          latest.status === "rejected" ||
          (!!latestTask &&
            new Set<GenerationTaskStatus>([
              GenerationTaskStatus.FAILED,
              GenerationTaskStatus.MODERATION_FAILED,
              GenerationTaskStatus.CANCELED,
            ]).has(latestTask.status)));
      steps.push({
        id: step.id,
        key: step.key,
        ordinal: step.ordinal,
        tool: step.tool as AgentPlanStepSpec["tool"],
        title: step.title,
        instruction: step.instruction,
        prompt: step.prompt,
        negativePrompt: step.negativePrompt,
        sourceAssetId: step.sourceAssetId,
        sourceStepKey: step.sourceStepKey,
        status: step.status as AgentRunStepView["status"],
        generationTaskId: step.generationTaskId,
        selectedAssetId: step.selectedAssetId,
        error: publicError(step.error),
        candidates: assets.map(candidateView),
        canEditInputs,
        attempts: [...step.attempts]
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((attempt) => {
            const request = objectOf(attempt.requestSnapshot);
            return {
              id: attempt.id,
              ordinal: attempt.ordinal,
              status: attempt.status,
              generationTaskId: attempt.generationTaskId,
              prompt: typeof request.prompt === "string" ? request.prompt : "",
              negativePrompt:
                typeof request.negativePrompt === "string"
                  ? request.negativePrompt
                  : "",
              parentAssetId:
                typeof request.parentAssetId === "string"
                  ? request.parentAssetId
                  : null,
              candidates: attempt.generationTaskId
                ? allAssets
                    .filter(
                      (asset) =>
                        asset.generationTaskId === attempt.generationTaskId,
                    )
                    .map(candidateView)
                : [],
              error:
                attempt.status === "rejected"
                  ? attempt.error
                  : publicError(attempt.error),
              createdAt: attempt.createdAt.toISOString(),
            };
          }),
      });
    }
    return {
      id: run.id,
      projectId: run.projectId,
      conversationId: run.conversationId,
      intent: run.intent,
      status: run.status as AgentRunView["status"],
      revision: run.revision,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      error: publicError(run.error),
      steps,
      sourceAssets: allAssets
        .filter((asset) => sourceIds.includes(asset.id))
        .map(candidateView),
    };
  }
}

class SupersededAttemptError extends Error {}

function canEditStructure(step: StepRecord): boolean {
  return (
    step.status === "pending" &&
    step.attempt === 0 &&
    step.attempts.length === 0
  );
}

function stepSpec(step: StepRecord): AgentPlanStepSpec {
  return {
    key: step.key,
    tool: step.tool as AgentPlanStepSpec["tool"],
    title: step.title,
    instruction: step.instruction,
    prompt: step.prompt,
    negativePrompt: step.negativePrompt,
    sourceAssetId: step.sourceAssetId,
    sourceStepKey: step.sourceStepKey,
  };
}

function sourceAssetIds(run: RunRecord): string[] {
  const context = objectOf(run.contextSnapshot);
  return Array.isArray(context.designAssetIds)
    ? [
        ...new Set(
          context.designAssetIds.filter(
            (id): id is string => typeof id === "string",
          ),
        ),
      ]
    : [];
}

function candidateView(asset: {
  id: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}): AgentRunCandidate {
  return {
    assetId: asset.id,
    url: `/api/design-assets/${encodeURIComponent(asset.id)}/content`,
    thumbnailUrl: asset.thumbnailUrl
      ? `/api/design-assets/${encodeURIComponent(asset.id)}/thumbnail`
      : null,
    width: asset.width,
    height: asset.height,
  };
}

function publicError(value: string | null): string | null {
  return (
    value
      ?.replace(/\b(?:https?:\/\/|s3:\/\/|data:)[^\s"'<>]+/giu, "[链接已省略]")
      .replace(
        /\b(api[_-]?key|authorization|token|signature|credential|password)\s*[:=]\s*[^\s,;]+/giu,
        "$1=[已隐藏]",
      ) ?? null
  );
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function requestContext(value: unknown) {
  const context = objectOf(value);
  const request = objectOf(context.requestContext);
  return {
    shapeIds: Array.isArray(request.shapeIds)
      ? [...request.shapeIds].sort()
      : Array.isArray(context.shapeIds)
        ? [...context.shapeIds].sort()
        : [],
    fileAssetIds: Array.isArray(request.fileAssetIds)
      ? [...request.fileAssetIds].sort()
      : Array.isArray(context.fileAssetIds)
        ? [...context.fileAssetIds].sort()
        : [],
  };
}
