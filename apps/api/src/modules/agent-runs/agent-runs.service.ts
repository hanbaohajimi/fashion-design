import { GenerationTaskStatus, Prisma, type PrismaClient } from "@fashion/db";
import { AGENT_PLAN_MAX_STEPS, type AgentRunCandidate } from "@fashion/shared";
import type {
  AgentDesignIntelligence,
  AgentDesignEvaluation,
  AgentDesignRefinement,
  AgentDomainActionView,
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
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AmuxClaudeImageInput } from "@fashion/ai";
import { randomUUID } from "node:crypto";

import { AMUX_CLAUDE_CLIENT, type AmuxClaudeJsonClient } from "../ai/ai.tokens";
import { S3FileStorage } from "../files/storage.service";
import { ProjectAccessPolicy, type ProjectAction } from "../studio/project-access.policy";
import { ContextCompilerService } from "../generation/compiler/context-compiler.service";
import type { CompiledGenInput } from "../generation/compiler/compiler.types";
import { GenerationService } from "../generation/generation.service";
import type { GenerationCreateRequest } from "../generation/generation.schemas";
import { agentAttemptTaskId, AGENT_TOOL_REGISTRY } from "./agent-tool.registry";
import {
  FashionAgentFramework,
  parseIntelligence,
  auditPlan,
} from "./fashion-agent-framework";
import {
  agentPlanSchema,
  agentPlanStepSchema,
  type ReviewAgentRunInput,
  type UpdateAgentRunStepInput,
  type UpdateAgentRunPlanInput,
  type RejectAgentRunInput,
  type CreateAgentDomainActionInput,
} from "./agent-runs.schemas";

export const AGENT_RUNS_DB = Symbol("AGENT_RUNS_DB");
const ATTEMPT_LEASE_MS = 2 * 60 * 1000;
const DOMAIN_ACTION_LEASE_MS = 10 * 60 * 1000;
const DOMAIN_ACTION_LIMIT = 48;
const DOMAIN_IMAGE_MAX_BYTES = 7 * 1024 * 1024;
const DOMAIN_IMAGE_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
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
  | "project"
  | "workspaceMember"
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
interface StoredDomainAction extends AgentDomainActionView {
  readonly clientRequestId: string;
  readonly requestFingerprint: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly leaseRevision: number;
  readonly attemptId: string;
}

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
    @Optional()
    @Inject(AMUX_CLAUDE_CLIENT)
    private readonly model?: AmuxClaudeJsonClient,
    @Optional()
    @Inject(S3FileStorage)
    private readonly storage?: S3FileStorage,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database),
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
    intelligence?: AgentDesignIntelligence,
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
    const domain =
      intelligence === undefined ? null : parseIntelligence(intelligence);
    if (intelligence !== undefined && !domain)
      throw new BadRequestException({
        code: "INVALID_AGENT_INTELLIGENCE",
        message: "设计契约无效",
      });
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
        data: {
          status: "ready",
          revision: { increment: 1 },
          error: null,
          ...(domain
            ? {
                contextSnapshot: {
                  ...context,
                  intelligence: domain,
                } as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
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
    const conversation = await this.ownedConversation(userId, conversationId, "read");
    const { capabilities } = await this.access.require(userId, conversation.projectId, "read");
    const runs = await this.database.agentRun.findMany({
      where: { userId, conversationId },
      include: runInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    });
    const items: AgentRunView[] = [];
    for (const run of runs)
      items.push(await this.toView(capabilities.edit ? await this.reconcile(run) : run));
    return { items };
  }

  async get(userId: string, runId: string): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId, "read");
    const { capabilities } = await this.access.require(userId, run.projectId, "read");
    return this.toView(capabilities.edit ? await this.reconcile(run) : run);
  }

  async createDomainAction(
    userId: string,
    runId: string,
    input: CreateAgentDomainActionInput,
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    const fingerprint = stableJson({
      kind: input.kind,
      stepId: input.stepId,
      assetId: input.assetId ?? null,
    });
    const previous = domainActions(run.contextSnapshot).find(
      (action) => action.clientRequestId === input.clientRequestId,
    );
    if (previous) {
      if (previous.requestFingerprint !== fingerprint)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "该请求编号已用于不同的领域操作",
        });
      return this.get(userId, runId);
    }
    this.assertRevision(run, input.revision);
    const intelligence = publicIntelligence(run.contextSnapshot);
    if (!intelligence || !this.model)
      throw new ServiceUnavailableException({
        code: "AGENT_FRAMEWORK_UNAVAILABLE",
        message: "当前计划没有领域契约，请创建新的设计计划",
      });
    const step = run.steps.find((item) => item.id === input.stepId);
    if (!step)
      throw new NotFoundException({
        code: "AGENT_RUN_STEP_NOT_FOUND",
        message: "计划节点不存在",
      });
    const attempt = step.attempts[0];
    if (!attempt)
      throw new ConflictException({
        code: "AGENT_ACTION_ATTEMPT_UNAVAILABLE",
        message: "当前节点尚无可评价或修订的执行记录",
      });
    let candidate: Awaited<ReturnType<AgentRunsService["ownedSource"]>> | null =
      null;
    let reason = "";
    if (input.kind === "evaluate_candidate") {
      if (!input.assetId)
        throw new BadRequestException({
          code: "INVALID_AGENT_RUN_SELECTION",
          message: "评价必须指定实际候选资产",
        });
      if (
        run.status !== "waiting_review" ||
        step.status !== "waiting_review" ||
        !step.generationTaskId ||
        step.generationTaskId !== attempt.generationTaskId
      )
        throw new ConflictException({
          code: "AGENT_ACTION_NOT_REVIEWABLE",
          message: "仅可评价当前等待选择的实际结果",
        });
      const asset = await this.database.designAsset.findFirst({
        where: {
          id: input.assetId,
          projectId: run.projectId,
          generationTaskId: attempt.generationTaskId,
          archivedAt: null,
        },
      });
      if (!asset)
        throw new BadRequestException({
          code: "INVALID_AGENT_RUN_SELECTION",
          message: "请选择当前节点实际生成且可访问的候选",
        });
      candidate = asset;
    } else {
      await this.assertEditableStep(run, step);
      const task = await this.taskFor(run, attempt);
      if (
        attempt.status !== "rejected" &&
        (!task || !terminalTaskFailure(task.status))
      )
        throw new ConflictException({
          code: "AGENT_ACTION_NOT_REFINABLE",
          message: "请先否决结果或等待当前尝试失败后再修订",
        });
      reason = attempt.error ?? task?.errorMessage ?? step.error ?? "";
      if (attempt.status !== "rejected") reason = publicError(reason) ?? "";
      if (!reason.trim())
        throw new ConflictException({
          code: "AGENT_ACTION_REASON_REQUIRED",
          message: "当前尝试没有失败或否决原因",
        });
    }
    const actions = domainActions(run.contextSnapshot);
    if (actions.length >= DOMAIN_ACTION_LIMIT)
      throw new ConflictException({
        code: "AGENT_ACTION_LIMIT_REACHED",
        message: "本计划的领域操作已达到上限，请新建计划",
      });
    const action: StoredDomainAction = {
      id: randomUUID(),
      kind: input.kind,
      stepId: step.id,
      assetId: candidate?.id ?? null,
      status: "running",
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      evaluation: null,
      refinement: null,
      clientRequestId: input.clientRequestId,
      requestFingerprint: fingerprint,
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(
        Date.now() + DOMAIN_ACTION_LEASE_MS,
      ).toISOString(),
      leaseRevision: run.revision + 1,
      attemptId: attempt.id,
    };
    try {
      await this.database.$transaction(async (transaction) => {
        await this.claimRevision(
          transaction,
          run,
          input.revision,
          {
            contextSnapshot: contextWithActions(run.contextSnapshot, [
              ...actions,
              action,
            ]),
          },
          action.id,
        );
      });
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const replay = await this.ownedRun(userId, runId);
      const existing = domainActions(replay.contextSnapshot).find(
        (item) => item.clientRequestId === input.clientRequestId,
      );
      if (!existing) throw error;
      if (existing.requestFingerprint !== fingerprint)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "该请求编号已用于不同的领域操作",
        });
      return this.toView(replay);
    }
    try {
      const request = objectOf(attempt.requestSnapshot);
      const frozen = objectOf(request.domainContract);
      const domain = parseIntelligence(frozen.intelligence) ?? intelligence;
      const frozenStep = agentPlanStepSchema.safeParse(frozen.step);
      const parentId =
        typeof request.parentAssetId === "string"
          ? request.parentAssetId
          : null;
      const needsImages =
        input.kind === "evaluate_candidate" || attempt.status === "rejected";
      const parent =
        needsImages && parentId
          ? await this.ownedSource(userId, run.projectId, parentId)
          : null;
      const outputs = !needsImages
        ? []
        : candidate
          ? [candidate]
          : attempt.generationTaskId
            ? await this.database.designAsset.findMany({
                where: {
                  generationTaskId: attempt.generationTaskId,
                  projectId: run.projectId,
                  archivedAt: null,
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: 2,
              })
            : [];
      const images = needsImages
        ? await this.loadDomainImages([...outputs, ...(parent ? [parent] : [])])
        : [];
      if (input.kind === "evaluate_candidate" && !images.length)
        throw new Error("候选图片不可读取，无法进行视觉评价");
      if (!(await this.domainActionIsActive(userId, runId, action)))
        return this.get(userId, runId);
      const framework = new FashionAgentFramework(this.model);
      const prompt = typeof request.prompt === "string" ? request.prompt : "";
      const negativePrompt =
        typeof request.negativePrompt === "string"
          ? request.negativePrompt
          : "";
      if (candidate) {
        const evaluation = await framework.evaluate({
          brief: domain.brief,
          evidence: domain.evidence,
          step: {
            ...(frozenStep.success ? frozenStep.data : stepSpec(step)),
            prompt,
            negativePrompt,
          },
          stepId: step.id,
          attemptId: attempt.id,
          assetId: candidate.id,
          prompt,
          negativePrompt,
          images,
        });
        return this.finishDomainAction(userId, runId, action, { evaluation });
      }
      const evaluations = actions.flatMap((item) =>
        item.evaluation?.attemptId === attempt.id && item.status === "completed"
          ? [item.evaluation]
          : [],
      );
      const refinement = await framework.refine({
        brief: domain.brief,
        evidence: domain.evidence,
        stepId: step.id,
        attemptId: attempt.id,
        prompt: step.prompt,
        negativePrompt: step.negativePrompt,
        previousAttempt: { prompt, negativePrompt },
        feedbackKind:
          attempt.status === "rejected"
            ? "design_rejection"
            : "execution_failure",
        reason,
        evaluations,
        images,
      });
      return this.finishDomainAction(userId, runId, action, { refinement });
    } catch (error) {
      return this.finishDomainAction(userId, runId, action, {
        error: error instanceof Error ? error.message : "领域 Agent 操作失败",
      });
    }
  }

  async applyDomainAction(
    userId: string,
    runId: string,
    actionId: string,
    revision: number,
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    this.assertRevision(run, revision);
    const action = domainActions(run.contextSnapshot).find(
      (item) => item.id === actionId,
    );
    const refinement = action?.refinement;
    const step = run.steps.find((item) => item.id === action?.stepId);
    if (
      !action ||
      action.kind !== "refine_step" ||
      action.status !== "completed" ||
      !refinement ||
      !step ||
      step.attempts[0]?.id !== refinement.attemptId ||
      action.attemptId !== refinement.attemptId ||
      step.prompt !== refinement.originalPrompt ||
      step.negativePrompt !== refinement.originalNegativePrompt
    )
      throw new ConflictException({
        code: "AGENT_REFINEMENT_STALE",
        message: "该修订草案已不适用于当前输入，请重新生成建议",
      });
    await this.assertEditableStep(run, step);
    const context = this.updatedPlanContext(
      run,
      run.steps.map((item) =>
        item.id === step.id
          ? {
              ...stepSpec(item),
              prompt: refinement.prompt,
              negativePrompt: refinement.negativePrompt,
            }
          : stepSpec(item),
      ),
    );
    const actions = domainActions(context).map((item) =>
      item.id === action.id ? { ...item, status: "applied" as const } : item,
    );
    await this.database.$transaction(async (transaction) => {
      await this.claimRevision(transaction, run, revision, {
        contextSnapshot: contextWithActions(context, actions),
        error: null,
      });
      await transaction.agentRunStep.update({
        where: { id: step.id },
        data: {
          prompt: refinement.prompt,
          negativePrompt: refinement.negativePrompt,
        },
      });
    });
    return this.toView(await this.ownedRun(userId, runId));
  }

  private async assertEditableStep(
    run: RunRecord,
    step: StepRecord,
  ): Promise<void> {
    if (
      !new Set(["ready", "paused", "failed"]).has(run.status) ||
      !new Set(["pending", "failed"]).has(step.status)
    )
      throw new ConflictException({
        code: "AGENT_RUN_STEP_IMMUTABLE",
        message: "当前节点不能修改输入",
      });
    const latest = step.attempts[0];
    if (latest && latest.status !== "rejected") {
      const task = await this.taskFor(run, latest);
      if (!task || !terminalTaskFailure(task.status))
        throw new ConflictException({
          code: "AGENT_RUN_STEP_IMMUTABLE",
          message: "当前尝试已冻结输入，请等待结果",
        });
    }
  }

  private async domainActionIsActive(
    userId: string,
    runId: string,
    action: StoredDomainAction,
  ): Promise<boolean> {
    const run = await this.ownedRun(userId, runId);
    const current = domainActions(run.contextSnapshot).find(
      (item) => item.id === action.id,
    );
    return (
      run.revision === action.leaseRevision &&
      current?.status === "running" &&
      current.leaseToken === action.leaseToken &&
      Date.parse(current.leaseExpiresAt) > Date.now()
    );
  }

  private async finishDomainAction(
    userId: string,
    runId: string,
    action: StoredDomainAction,
    result: {
      evaluation?: AgentDesignEvaluation;
      refinement?: AgentDesignRefinement;
      error?: string;
    },
  ): Promise<AgentRunView> {
    const run = await this.ownedRun(userId, runId);
    const actions = domainActions(run.contextSnapshot);
    const current = actions.find((item) => item.id === action.id);
    if (
      run.revision !== action.leaseRevision ||
      current?.status !== "running" ||
      current.leaseToken !== action.leaseToken ||
      Date.parse(current.leaseExpiresAt) <= Date.now()
    )
      return this.get(userId, runId);
    const next = actions.map((item) =>
      item.id === action.id
        ? {
            ...item,
            status: result.error ? ("failed" as const) : ("completed" as const),
            completedAt: new Date().toISOString(),
            error: result.error?.slice(0, 1000) ?? null,
            evaluation: result.evaluation ?? null,
            refinement: result.refinement ?? null,
          }
        : item,
    );
    await this.database.$transaction(async (transaction) => {
      await transaction.agentRun.updateMany({
        where: {
          id: run.id,
          userId,
          revision: action.leaseRevision,
          status: run.status,
        },
        data: {
          contextSnapshot: contextWithActions(run.contextSnapshot, next),
          revision: { increment: 1 },
        },
      });
    });
    return this.toView(await this.ownedRun(userId, runId));
  }

  private updatedPlanContext(
    run: RunRecord,
    specs: readonly AgentPlanStepSpec[],
  ): Prisma.InputJsonValue {
    const intelligence = publicIntelligence(run.contextSnapshot);
    if (!intelligence) return run.contextSnapshot as Prisma.InputJsonValue;
    const previous = new Map(
      run.steps.map((step) => [step.key, stepSpec(step)]),
    );
    const unchanged = new Set(
      specs
        .filter(
          (step) => stableJson(step) === stableJson(previous.get(step.key)),
        )
        .map((step) => step.key),
    );
    const rationales = intelligence.rationales.filter((item) =>
      unchanged.has(item.stepKey),
    );
    const audit = auditPlan({
      brief: intelligence.brief,
      evidence: intelligence.evidence,
      steps: specs,
      rationales,
      selectedAssetIds: sourceAssetIds(run),
    });
    const context = objectOf(run.contextSnapshot);
    return {
      ...context,
      intelligence: { ...objectOf(context.intelligence), rationales, audit },
    } as unknown as Prisma.InputJsonValue;
  }

  private executionDomainContract(
    run: RunRecord,
    step: StepRecord,
    request: GenerationCreateRequest,
  ): Record<string, unknown> {
    const intelligence = publicIntelligence(run.contextSnapshot);
    return intelligence
      ? {
          domainContract: {
            intelligence: { ...intelligence, actions: [] },
            step: stepSpec(step),
            toolContract: {
              name: step.tool,
              ...AGENT_TOOL_REGISTRY[step.tool as AgentPlanStepSpec["tool"]],
            },
            parentAssetId: request.parentAssetId ?? null,
          },
        }
      : {};
  }

  private async loadDomainImages(
    assets: readonly { url: string; thumbnailUrl: string | null }[],
  ): Promise<AmuxClaudeImageInput[]> {
    let totalBytes = 0;
    const images: AmuxClaudeImageInput[] = [];
    for (const asset of assets) {
      const source = asset.thumbnailUrl ?? asset.url;
      const objectKey = domainObjectKey(source);
      if (!objectKey) {
        const remote = trustedDomainImageUrl(source);
        if (!remote) throw new Error("设计图片地址不可读取，请重新生成后重试");
        images.push({ url: remote, detail: "auto" });
        continue;
      }
      if (!this.storage) throw new Error("图片存储暂时不可用");
      const bytes = await this.storage.readPrefix(
        objectKey,
        DOMAIN_IMAGE_MAX_BYTES + 1,
      );
      if (!bytes.byteLength || bytes.byteLength > DOMAIN_IMAGE_MAX_BYTES)
        throw new Error("领域 Agent 图片为空或超过 7MB");
      totalBytes += bytes.byteLength;
      if (totalBytes > DOMAIN_IMAGE_TOTAL_MAX_BYTES)
        throw new Error("领域 Agent 图片总大小超过 20MB");
      const mimeType = domainImageMimeType(bytes);
      if (!mimeType) throw new Error("领域 Agent 不支持该图片格式");
      images.push({
        url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
        detail: "auto",
      });
    }
    return images;
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
        contextSnapshot: this.updatedPlanContext(
          run,
          run.steps.map((item) =>
            item.id === stepId
              ? { ...stepSpec(item), ...data }
              : stepSpec(item),
          ),
        ),
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
        contextSnapshot: this.updatedPlanContext(run, parsed.data),
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
      ? generationRequestFromSnapshot(previous.requestSnapshot)
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
              requestSnapshot: {
                ...request,
                ...this.executionDomainContract(run, step, request),
              } as unknown as Prisma.InputJsonValue,
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
    const actions = domainActions(run.contextSnapshot);
    const reconciledActions = actions.map((action) => {
      if (action.status !== "running") return action;
      if (action.leaseRevision !== run.revision)
        return {
          ...action,
          status: "superseded" as const,
          completedAt: new Date().toISOString(),
        };
      if (Date.parse(action.leaseExpiresAt) > Date.now()) return action;
      return {
        ...action,
        status: "failed" as const,
        completedAt: new Date().toISOString(),
        error: "领域 Agent 处理已中断，请使用新的请求编号重试",
      };
    });
    if (stableJson(actions) !== stableJson(reconciledActions)) {
      await this.database.agentRun.updateMany({
        where: {
          id: run.id,
          userId: run.userId,
          revision: run.revision,
          status: run.status,
        },
        data: {
          contextSnapshot: contextWithActions(
            run.contextSnapshot,
            reconciledActions,
          ),
          revision: { increment: 1 },
        },
      });
      run = await this.ownedRun(run.userId, run.id);
    }
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

  private async taskFor(run: RunRecord, attempt: AttemptRecord) {
    const { ownerId } = await this.access.require(run.userId, run.projectId, "read");
    const executionKey = run.userId === ownerId ? attempt.executionKey : `${run.userId}:${attempt.executionKey}`;
    return this.database.generationTask.findFirst({
      where: {
        id:
          attempt.generationTaskId ??
          agentAttemptTaskId(ownerId, executionKey),
        userId: ownerId,
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
    preserveActionId?: string,
  ) {
    const context = data.contextSnapshot ?? run.contextSnapshot;
    const actions = domainActions(context);
    const superseded = actions.map((action) =>
      action.status === "running" && action.id !== preserveActionId
        ? {
            ...action,
            status: "superseded" as const,
            completedAt: new Date().toISOString(),
          }
        : action,
    );
    const result = await transaction.agentRun.updateMany({
      where: { id: run.id, userId: run.userId, revision, status: run.status },
      data: {
        ...data,
        ...(actions.length
          ? { contextSnapshot: contextWithActions(context, superseded) }
          : {}),
        revision: { increment: 1 },
      },
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

  private async ownedConversation(userId: string, conversationId: string, action: ProjectAction = "edit") {
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
    await this.access.require(userId, conversation.projectId, action);
    if (conversation.createdById !== userId)
      throw new ForbiddenException({
        code: "AGENT_CONVERSATION_FORBIDDEN",
        message: "无权访问该会话",
      });
    return conversation;
  }

  private async ownedRun(userId: string, runId: string, action: ProjectAction = "edit"): Promise<RunRecord> {
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
    await this.ownedConversation(userId, run.conversationId, action);
    return run;
  }

  private async ownedSource(
    userId: string,
    projectId: string,
    assetId: string,
  ) {
    await this.access.require(userId, projectId, "read");
    const asset = await this.database.designAsset.findFirst({
      where: {
        id: assetId,
        projectId,
        archivedAt: null,
        project: { deletedAt: null },
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
    const intelligence = publicIntelligence(run.contextSnapshot);
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
      ...(intelligence ? { intelligence } : {}),
    };
  }
}

class SupersededAttemptError extends Error {}

function terminalTaskFailure(status: GenerationTaskStatus): boolean {
  return new Set<GenerationTaskStatus>([
    GenerationTaskStatus.FAILED,
    GenerationTaskStatus.MODERATION_FAILED,
    GenerationTaskStatus.CANCELED,
  ]).has(status);
}

function domainActions(context: unknown): StoredDomainAction[] {
  const raw = objectOf(objectOf(context).intelligence).actions;
  return Array.isArray(raw)
    ? raw.flatMap((entry) => {
        const action = objectOf(entry);
        return typeof action.id === "string" &&
          typeof action.clientRequestId === "string" &&
          typeof action.leaseToken === "string" &&
          typeof action.leaseRevision === "number" &&
          typeof action.leaseExpiresAt === "string"
          ? [action as unknown as StoredDomainAction]
          : [];
      })
    : [];
}

function contextWithActions(
  context: unknown,
  actions: readonly StoredDomainAction[],
): Prisma.InputJsonValue {
  const source = objectOf(context);
  return {
    ...source,
    intelligence: { ...objectOf(source.intelligence), actions },
  } as unknown as Prisma.InputJsonValue;
}

function publicIntelligence(context: unknown): AgentDesignIntelligence | null {
  const raw = objectOf(objectOf(context).intelligence);
  if (!raw.version) return null;
  const array = (value: unknown) =>
    Array.isArray(value) ? value.map(objectOf) : [];
  const brief = objectOf(raw.brief);
  const audit = objectOf(raw.audit);
  const view = {
    version: raw.version,
    evidence: array(raw.evidence).map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      text: item.text,
      assetId: item.assetId,
    })),
    brief: {
      summary: brief.summary,
      garmentType: brief.garmentType,
      unknowns: brief.unknowns,
      constraints: array(brief.constraints).map((item) => ({
        id: item.id,
        dimension: item.dimension,
        requirement: item.requirement,
        mode: item.mode,
        priority: item.priority,
        origin: item.origin,
        verification: item.verification,
        evidenceIds: item.evidenceIds,
        sourceQuote: item.sourceQuote,
      })),
    },
    rationales: array(raw.rationales).map((item) => ({
      stepKey: item.stepKey,
      goal: item.goal,
      constraintIds: item.constraintIds,
      acceptanceChecks: item.acceptanceChecks,
    })),
    audit: {
      coverage: array(audit.coverage).map((item) => ({
        constraintId: item.constraintId,
        stepKeys: item.stepKeys,
        status: item.status,
      })),
      warnings: audit.warnings,
    },
    actions: array(raw.actions).map((item) => {
      const evaluation = objectOf(item.evaluation);
      const refinement = objectOf(item.refinement);
      return {
        id: item.id,
        kind: item.kind,
        stepId: item.stepId,
        assetId: item.assetId,
        status: item.status,
        createdAt: item.createdAt,
        completedAt: item.completedAt,
        error: typeof item.error === "string" ? publicError(item.error) : null,
        evaluation: item.evaluation
          ? {
              stepId: evaluation.stepId,
              attemptId: evaluation.attemptId,
              assetId: evaluation.assetId,
              summary: evaluation.summary,
              checks: array(evaluation.checks).map((check) => ({
                constraintId: check.constraintId,
                status: check.status,
                observation: check.observation,
              })),
              nextActions: evaluation.nextActions,
            }
          : null,
        refinement: item.refinement
          ? {
              stepId: refinement.stepId,
              attemptId: refinement.attemptId,
              originalPrompt: refinement.originalPrompt,
              originalNegativePrompt: refinement.originalNegativePrompt,
              prompt: refinement.prompt,
              negativePrompt: refinement.negativePrompt,
              summary: refinement.summary,
              changes: refinement.changes,
              preserve: refinement.preserve,
            }
          : null,
      };
    }),
  };
  return parseIntelligence(redactDomainContent(view));
}

function redactDomainContent(value: unknown): unknown {
  if (typeof value === "string") return publicError(value);
  if (Array.isArray(value)) return value.map(redactDomainContent);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactDomainContent(entry),
      ]),
    );
  return value;
}

function generationRequestFromSnapshot(
  value: unknown,
): GenerationCreateRequest {
  const source = objectOf(value);
  const fields = [
    "taskType",
    "prompt",
    "negativePrompt",
    "width",
    "height",
    "quality",
    "outputFormat",
    "outputCompression",
    "background",
    "projectId",
    "parentAssetId",
    "shapeIds",
    "referenceImageUrl",
    "referenceImageUrls",
    "referenceImages",
    "maskImageUrl",
    "palette",
  ];
  return Object.fromEntries(
    fields
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  ) as GenerationCreateRequest;
}

function domainObjectKey(value: string): string | null {
  if (value.startsWith("s3://")) return value.slice(5) || null;
  try {
    const parsed = new URL(value);
    const cdn = process.env.ASSET_CDN_ORIGIN?.trim();
    if (cdn) {
      const base = new URL(cdn.endsWith("/") ? cdn : `${cdn}/`);
      if (
        parsed.origin === base.origin &&
        parsed.pathname.startsWith(base.pathname)
      )
        return decodeURIComponent(parsed.pathname.slice(base.pathname.length));
    }
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const bucket = process.env.S3_BUCKET?.trim();
    if (
      endpoint &&
      bucket &&
      parsed.origin === new URL(endpoint).origin &&
      parsed.pathname.startsWith(`/${bucket}/`)
    )
      return decodeURIComponent(parsed.pathname.slice(bucket.length + 2));
  } catch {
    return null;
  }
  return null;
}

function trustedDomainImageUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host === "::1" ||
      host === "[::1]" ||
      host.includes(":") ||
      /^\d+\.\d+\.\d+\.\d+$/u.test(host)
    )
      return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function domainImageMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 6 && /GIF8[79]a/u.test(ascii(0, 6))) return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
    return "image/webp";
  return null;
}

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
