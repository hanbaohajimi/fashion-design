import {
  DesignAssetOperation,
  GenerationTaskStatus,
  Prisma,
  prisma,
} from "@fashion/db";
import {
  FASHION_AGENT_FRAMEWORK_VERSION,
  type AgentDesignIntelligence,
  type AgentPlanStepSpec,
} from "@fashion/shared";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BillingService } from "../billing/billing.service";
import { ContextCompilerService } from "../generation/compiler/context-compiler.service";
import { GenerationService } from "../generation/generation.service";
import { AgentRunsService } from "./agent-runs.service";

const plan: AgentPlanStepSpec[] = [
  {
    key: "base",
    tool: "generate_design",
    title: "基础方案",
    instruction: "生成风衣",
    prompt: "loose coat",
    negativePrompt: "",
    sourceAssetId: null,
    sourceStepKey: null,
  },
  {
    key: "sleeve",
    tool: "edit_design",
    title: "袖型细化",
    instruction: "细化所选风衣",
    prompt: "wider sleeves",
    negativePrompt: "",
    sourceAssetId: null,
    sourceStepKey: "base",
  },
];
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("测试数据缺失");
  return value;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise 尚未初始化");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function domainIntelligence(
  specs: readonly AgentPlanStepSpec[],
): AgentDesignIntelligence {
  return {
    version: FASHION_AGENT_FRAMEWORK_VERSION,
    evidence: [
      {
        id: "note",
        kind: "board",
        label: "设计便签",
        text: "保留落肩袖",
        assetId: null,
      },
    ],
    brief: {
      summary: "保留落肩袖的风衣",
      garmentType: "风衣",
      constraints: [
        {
          id: "shoulder",
          dimension: "silhouette",
          requirement: "保留落肩袖",
          mode: "preserve",
          priority: "must",
          origin: "explicit",
          verification: "visual",
          evidenceIds: ["note"],
          sourceQuote: "保留落肩袖",
        },
      ],
      unknowns: [],
    },
    rationales: specs.map((step) => ({
      stepKey: step.key,
      goal: step.instruction,
      constraintIds: ["shoulder"],
      acceptanceChecks: ["检查落肩轮廓"],
    })),
    audit: {
      coverage: [
        {
          constraintId: "shoulder",
          stepKeys: specs.map((step) => step.key),
          status: "assigned",
        },
      ],
      warnings: [],
    },
    actions: [],
  };
}
const reviewResult = {
  summary: "落肩轮廓符合目标",
  checks: [
    { constraintId: "shoulder", status: "met", observation: "肩线下移可见" },
  ],
  nextActions: [],
};
const revisionResult = {
  prompt: "dropped shoulder coat with narrow cuffs",
  negativePrompt: "wide cuffs",
  summary: "缩小袖口",
  changes: ["缩小袖口"],
  preserve: ["落肩袖"],
};
async function fixture(
  specs: AgentPlanStepSpec[] = plan,
  withIntelligence = false,
) {
  const user = await prisma.user.create({
    data: {
      email: `agent-run-${crypto.randomUUID()}@example.test`,
      ownedWorkspaces: {
        create: {
          name: "Agent runtime integration",
          projects: { create: { name: "Agent runtime project" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const projectId = required(required(user.ownedWorkspaces[0]).projects[0]).id;
  const conversation = await prisma.agentConversation.create({
    data: { projectId, createdById: user.id, title: "运行器集成测试" },
  });
  const note = await prisma.boardElement.create({
    data: {
      projectId,
      shapeId: "shape:frozen-note",
      shapeType: "fashion-note",
      role: "note",
      record: { props: { text: "保留落肩袖" } },
    },
  });
  const storage = {
    createDownloadUrl: async (key: string) => `https://signed.test/${key}`,
    readPrefix: vi
      .fn()
      .mockResolvedValue(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
  };
  const model = { analyzeImage: vi.fn(), enhancePrompt: vi.fn() };
  const compiler = new ContextCompilerService(prisma, model, storage);
  const jobs = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
  const generation = new GenerationService(
    prisma,
    jobs,
    new BillingService(prisma),
    compiler,
    storage as never,
  );
  const domainModel = { generateJson: vi.fn().mockResolvedValue(reviewResult) };
  const service = new AgentRunsService(
    prisma,
    generation,
    compiler,
    domainModel,
    storage as never,
  );
  const reserved = await service.reserve(user.id, conversation.id, {
    clientRequestId: crypto.randomUUID(),
    intent: "设计并细化风衣",
    contextSnapshot: {
      shapeIds: [note.shapeId],
      fileAssetIds: [],
      designAssetIds: [],
      elements: [{ text: "保留落肩袖" }],
    },
  });
  const run = await service.completePlan(
    user.id,
    reserved.run.id,
    specs,
    withIntelligence ? domainIntelligence(specs) : undefined,
  );
  const finish = async (taskId: string, ids: string[]) =>
    prisma.$transaction(async (tx) => {
      for (const id of ids)
        await tx.designAsset.create({
          data: {
            id,
            projectId,
            generationTaskId: taskId,
            rootAssetId: id,
            operation: DesignAssetOperation.GENERATED,
            url: `s3://${id}.png`,
            width: 1024,
            height: 1024,
          },
        });
      await tx.generationTask.update({
        where: { id: taskId },
        data: { status: GenerationTaskStatus.SUCCEEDED },
      });
    });
  return {
    userId: user.id,
    projectId,
    conversationId: conversation.id,
    note,
    service,
    generation,
    jobs,
    model,
    domainModel,
    compiler,
    storage,
    run,
    finish,
    cleanup: () => prisma.user.delete({ where: { id: user.id } }),
  };
}

describe("AgentRunsService PostgreSQL integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reserves one real JSON action for concurrent idempotent requests and conflicts on a different body", async () => {
    const h = await fixture(plan, true);
    try {
      const executing = await h.service.execute(
        h.userId,
        h.run.id,
        h.run.revision,
      );
      const candidateId = crypto.randomUUID();
      await h.finish(required(executing.steps[0]?.generationTaskId), [
        candidateId,
      ]);
      const waiting = await h.service.get(h.userId, h.run.id);
      const stepId = required(waiting.steps[0]).id;
      const input = {
        revision: waiting.revision,
        clientRequestId: "same-evaluation",
        kind: "evaluate_candidate" as const,
        stepId,
        assetId: candidateId,
      };
      const results = await Promise.all([
        h.service.createDomainAction(h.userId, h.run.id, input),
        h.service.createDomainAction(h.userId, h.run.id, input),
      ]);
      expect(
        results.every((result) => result.status === "waiting_review"),
      ).toBe(true);
      expect(h.domainModel.generateJson).toHaveBeenCalledTimes(1);
      const final = await h.service.get(h.userId, h.run.id);
      expect(final.intelligence?.actions).toHaveLength(1);
      expect(final.intelligence?.actions[0]?.status).toBe("completed");
      await h.service.createDomainAction(h.userId, h.run.id, input);
      expect(h.domainModel.generateJson).toHaveBeenCalledTimes(1);
      await expect(
        h.service.createDomainAction(h.userId, h.run.id, {
          ...input,
          assetId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 409 });
      const task = await prisma.generationTask.findFirstOrThrow({
        where: { userId: h.userId },
      });
      expect(task.input).not.toHaveProperty("domainContract");
      expect(JSON.stringify(final)).not.toMatch(
        /leaseToken|clientRequestId|data:image|signed\.test/u,
      );
    } finally {
      await h.cleanup();
    }
  });

  it("uses the same revision CAS for evaluation reservation and human review", async () => {
    const h = await fixture(plan, true);
    try {
      const executing = await h.service.execute(
        h.userId,
        h.run.id,
        h.run.revision,
      );
      const assetId = crypto.randomUUID();
      await h.finish(required(executing.steps[0]?.generationTaskId), [assetId]);
      const waiting = await h.service.get(h.userId, h.run.id);
      const results = await Promise.allSettled([
        h.service.createDomainAction(h.userId, h.run.id, {
          revision: waiting.revision,
          clientRequestId: "race-evaluation",
          kind: "evaluate_candidate",
          stepId: required(waiting.steps[0]).id,
          assetId,
        }),
        h.service.review(h.userId, h.run.id, {
          revision: waiting.revision,
          assetId,
          reason: "人工采用",
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({ reason: { status: 409 } });
      const final = await h.service.get(h.userId, h.run.id);
      expect(final.steps[0]?.status).toBe(
        final.intelligence?.actions.length ? "waiting_review" : "succeeded",
      );
      expect(
        await prisma.designAssetDecision.count({ where: { userId: h.userId } }),
      ).toBe(final.intelligence?.actions.length ? 0 : 1);
    } finally {
      await h.cleanup();
    }
  });

  it("preserves cancellation when a real reserved action returns late", async () => {
    const h = await fixture(plan, true);
    const modelStarted = deferred<undefined>();
    const reply = deferred<unknown>();
    h.domainModel.generateJson.mockImplementationOnce(() => {
      modelStarted.resolve(undefined);
      return reply.promise;
    });
    try {
      const executing = await h.service.execute(
        h.userId,
        h.run.id,
        h.run.revision,
      );
      const assetId = crypto.randomUUID();
      await h.finish(required(executing.steps[0]?.generationTaskId), [assetId]);
      const waiting = await h.service.get(h.userId, h.run.id);
      const pending = h.service.createDomainAction(h.userId, h.run.id, {
        revision: waiting.revision,
        clientRequestId: "late-evaluation",
        kind: "evaluate_candidate",
        stepId: required(waiting.steps[0]).id,
        assetId,
      });
      await modelStarted.promise;
      const current = await h.service.get(h.userId, h.run.id);
      await h.service.cancel(h.userId, h.run.id, current.revision);
      reply.resolve(reviewResult);
      const late = await pending;
      expect(late.status).toBe("canceled");
      expect(late.intelligence?.actions[0]).toMatchObject({
        status: "superseded",
        evaluation: null,
      });
      expect(
        await prisma.designAssetDecision.count({ where: { userId: h.userId } }),
      ).toBe(0);
    } finally {
      reply.resolve(reviewResult);
      await h.cleanup();
    }
  });

  it("applies a refinement atomically, preserves the rejected attempt and competes with human prompt editing", async () => {
    const h = await fixture(plan, true);
    try {
      const executing = await h.service.execute(
        h.userId,
        h.run.id,
        h.run.revision,
      );
      const assetId = crypto.randomUUID();
      await h.finish(required(executing.steps[0]?.generationTaskId), [assetId]);
      const waiting = await h.service.get(h.userId, h.run.id);
      const rejected = await h.service.reject(h.userId, h.run.id, {
        revision: waiting.revision,
        reason: "袖口太宽",
      });
      const stepId = required(rejected.steps[0]).id;
      h.domainModel.generateJson.mockResolvedValue(revisionResult);
      const proposal = await h.service.createDomainAction(h.userId, h.run.id, {
        revision: rejected.revision,
        clientRequestId: "refine-atomic",
        kind: "refine_step",
        stepId,
      });
      const actionId = required(proposal.intelligence?.actions[0]).id;
      const oldAttempt = await prisma.agentRunStepAttempt.findFirstOrThrow({
        where: { stepId },
      });
      const results = await Promise.allSettled([
        h.service.applyDomainAction(
          h.userId,
          h.run.id,
          actionId,
          proposal.revision,
        ),
        h.service.updateStep(h.userId, h.run.id, stepId, {
          revision: proposal.revision,
          prompt: "human edited coat",
          negativePrompt: "",
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({ reason: { status: 409 } });
      const final = await h.service.get(h.userId, h.run.id);
      expect(final.steps[0]?.prompt).toBe(
        final.intelligence?.actions[0]?.status === "applied"
          ? revisionResult.prompt
          : "human edited coat",
      );
      const unchanged = await prisma.agentRunStepAttempt.findUniqueOrThrow({
        where: { id: oldAttempt.id },
      });
      expect(unchanged.requestSnapshot).toEqual(oldAttempt.requestSnapshot);
      expect(unchanged.status).toBe("rejected");
      expect(
        await prisma.generationTask.count({ where: { userId: h.userId } }),
      ).toBe(1);
      expect(
        final.intelligence?.rationales.some((item) => item.stepKey === "base"),
      ).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  it("rolls back the real action and prompt writes when the application transaction cannot commit", async () => {
    const h = await fixture(plan, true);
    try {
      const executing = await h.service.execute(
        h.userId,
        h.run.id,
        h.run.revision,
      );
      const assetId = crypto.randomUUID();
      await h.finish(required(executing.steps[0]?.generationTaskId), [assetId]);
      const waiting = await h.service.get(h.userId, h.run.id);
      const rejected = await h.service.reject(h.userId, h.run.id, {
        revision: waiting.revision,
        reason: "袖口太宽",
      });
      const stepId = required(rejected.steps[0]).id;
      h.domainModel.generateJson.mockResolvedValue(revisionResult);
      const proposed = await h.service.createDomainAction(h.userId, h.run.id, {
        revision: rejected.revision,
        clientRequestId: "commit-failure",
        kind: "refine_step",
        stepId,
      });
      const originalTransaction = prisma.$transaction.bind(prisma);
      const transaction = vi
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce((async (
          callback: (client: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          originalTransaction(async (client) => {
            await callback(client);
            throw new Error("injected commit failure");
          })) as never);
      try {
        await expect(
          h.service.applyDomainAction(
            h.userId,
            h.run.id,
            required(proposed.intelligence?.actions[0]).id,
            proposed.revision,
          ),
        ).rejects.toThrow("injected commit failure");
      } finally {
        transaction.mockRestore();
      }
      const unchanged = await h.service.get(h.userId, h.run.id);
      expect(unchanged.revision).toBe(proposed.revision);
      expect(unchanged.steps[0]?.prompt).toBe("loose coat");
      expect(unchanged.intelligence?.actions[0]?.status).toBe("completed");
      expect(
        await prisma.generationTask.count({ where: { userId: h.userId } }),
      ).toBe(1);
    } finally {
      await h.cleanup();
    }
  });

  it("swaps pending ordinals under the real unique index and preserves retained IDs across add/remove", async () => {
    const base = required(plan[0]);
    const edit = required(plan[1]);
    const alternate = { ...base, key: "alternate", title: "另一基础方向" };
    const h = await fixture([base, alternate, edit]);
    try {
      const ids = new Map(h.run.steps.map((step) => [step.key, step.id]));
      const swapped = await h.service.updatePlan(h.userId, h.run.id, {
        revision: h.run.revision,
        steps: [base, edit, alternate],
      });
      expect(swapped.steps.map((step) => step.key)).toEqual([
        "base",
        "sleeve",
        "alternate",
      ]);
      expect(swapped.steps.map((step) => step.ordinal)).toEqual([0, 1, 2]);
      for (const step of swapped.steps) expect(step.id).toBe(ids.get(step.key));
      const detail = {
        ...edit,
        key: "detail",
        title: "细节变化",
        sourceStepKey: "sleeve",
      };
      const changed = await h.service.updatePlan(h.userId, h.run.id, {
        revision: swapped.revision,
        steps: [base, edit, detail],
      });
      expect(changed.steps[1]?.id).toBe(ids.get("sleeve"));
      await expect(
        prisma.agentRunStep.count({
          where: { runId: h.run.id, key: "alternate" },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.agentRunStep.findMany({
          where: { runId: h.run.id },
          orderBy: { ordinal: "asc" },
          select: { key: true, ordinal: true },
        }),
      ).resolves.toEqual([
        { key: "base", ordinal: 0 },
        { key: "sleeve", ordinal: 1 },
        { key: "detail", ordinal: 2 },
      ]);
      await expect(
        prisma.agentRunStepAttempt.count({
          where: { step: { runId: h.run.id } },
        }),
      ).resolves.toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  it("lets only one concurrent graph update or execution claim the same revision", async () => {
    const h = await fixture();
    try {
      const changedPlan = [
        { ...required(plan[0]), prompt: "changed before execution" },
        required(plan[1]),
      ];
      const results = await Promise.allSettled([
        h.service.updatePlan(h.userId, h.run.id, {
          revision: h.run.revision,
          steps: changedPlan,
        }),
        h.service.execute(h.userId, h.run.id, h.run.revision),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({ status: "rejected", reason: { status: 409 } });
      const tasks = await prisma.generationTask.count({
        where: { userId: h.userId },
      });
      const attempts = await prisma.agentRunStepAttempt.count({
        where: { step: { runId: h.run.id } },
      });
      expect(tasks).toBeLessThanOrEqual(1);
      expect(attempts).toBe(tasks);
      const current = await h.service.get(h.userId, h.run.id);
      if (current.status === "running")
        expect(current.steps[0]?.attempts?.[0]?.prompt).toBe("loose coat");
      else expect(current.steps[0]?.prompt).toBe("changed before execution");
    } finally {
      await h.cleanup();
    }
  });

  it("serializes review against rejection and writes only the winning design decision", async () => {
    const h = await fixture();
    try {
      const running = await h.service.execute(
        h.userId,
        h.run.id,
        h.run.revision,
      );
      const candidateIds = [crypto.randomUUID(), crypto.randomUUID()];
      await h.finish(
        required(required(running.steps[0]).generationTaskId),
        candidateIds,
      );
      const waiting = await h.service.get(h.userId, h.run.id);
      const results = await Promise.allSettled([
        h.service.review(h.userId, h.run.id, {
          revision: waiting.revision,
          assetId: required(candidateIds[0]),
          reason: "选定当前方向",
        }),
        h.service.reject(h.userId, h.run.id, {
          revision: waiting.revision,
          reason: "整体方向不合适",
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({ status: "rejected", reason: { status: 409 } });
      const decisions = await prisma.designAssetDecision.findMany({
        where: { userId: h.userId },
      });
      const kinds = new Set(decisions.map((decision) => decision.kind));
      expect(kinds.size).toBe(1);
      if (kinds.has("selected")) expect(decisions).toHaveLength(1);
      else {
        expect(kinds.has("rejected")).toBe(true);
        expect(decisions).toHaveLength(2);
      }
      const current = await h.service.get(h.userId, h.run.id);
      expect(current.status).toBe("ready");
      expect(current.steps[0]?.status).toBe(
        kinds.has("selected") ? "succeeded" : "pending",
      );
    } finally {
      await h.cleanup();
    }
  });

  it("retries a rejected result with a new task and retains the old request, compiler snapshot and reason", async () => {
    const h = await fixture();
    try {
      const running = await h.service.execute(
        h.userId,
        h.run.id,
        h.run.revision,
      );
      const oldTaskId = required(required(running.steps[0]).generationTaskId);
      await h.finish(oldTaskId, [crypto.randomUUID(), crypto.randomUUID()]);
      const firstAttempt = await prisma.agentRunStepAttempt.findFirstOrThrow({
        where: { stepId: required(running.steps[0]).id },
      });
      const waiting = await h.service.get(h.userId, h.run.id);
      const rejected = await h.service.reject(h.userId, h.run.id, {
        revision: waiting.revision,
        reason: "配色太强烈，重新做低饱和方案",
      });
      expect(rejected.steps[0]?.candidates).toHaveLength(0);
      expect(rejected.steps[0]?.attempts?.[0]?.candidates).toHaveLength(2);
      const refreshed = await h.service.get(h.userId, h.run.id);
      expect(refreshed.revision).toBe(rejected.revision);
      expect(refreshed.steps[0]?.status).toBe("pending");
      const revised = await h.service.updateStep(
        h.userId,
        h.run.id,
        required(rejected.steps[0]).id,
        {
          revision: rejected.revision,
          prompt: "muted gray loose coat",
          negativePrompt: "bright saturated color",
        },
      );
      await expect(
        h.service.updatePlan(h.userId, h.run.id, {
          revision: revised.revision,
          steps: [
            {
              ...required(plan[0]),
              prompt: "muted gray loose coat",
              negativePrompt: "bright saturated color",
              title: "覆盖已执行结构",
            },
            required(plan[1]),
          ],
        }),
      ).rejects.toMatchObject({ status: 409 });
      const retried = await h.service.execute(
        h.userId,
        h.run.id,
        revised.revision,
      );
      expect(retried.steps[0]?.generationTaskId).not.toBe(oldTaskId);
      const history = await prisma.agentRunStepAttempt.findMany({
        where: { stepId: required(running.steps[0]).id },
        orderBy: { ordinal: "asc" },
      });
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        id: firstAttempt.id,
        status: "rejected",
        generationTaskId: oldTaskId,
        requestSnapshot: firstAttempt.requestSnapshot,
        compiledSnapshot: firstAttempt.compiledSnapshot,
        error: "配色太强烈，重新做低饱和方案",
      });
      expect(history[1]?.requestSnapshot).toMatchObject({
        prompt: "muted gray loose coat",
        negativePrompt: "bright saturated color",
      });
      await expect(
        prisma.generationTask.findUniqueOrThrow({ where: { id: oldTaskId } }),
      ).resolves.toMatchObject({ status: GenerationTaskStatus.SUCCEEDED });
      await expect(
        prisma.designAssetDecision.count({
          where: { userId: h.userId, kind: "rejected" },
        }),
      ).resolves.toBe(2);
      await expect(
        prisma.generationTask.count({ where: { userId: h.userId } }),
      ).resolves.toBe(2);
    } finally {
      await h.cleanup();
    }
  });

  it("rolls back every rejection write if recording a later candidate fails", async () => {
    const h = await fixture();
    try {
      const running = await h.service.execute(
        h.userId,
        h.run.id,
        h.run.revision,
      );
      const candidateIds = [crypto.randomUUID(), crypto.randomUUID()];
      await h.finish(
        required(required(running.steps[0]).generationTaskId),
        candidateIds,
      );
      const waiting = await h.service.get(h.userId, h.run.id);
      const attemptId = required(required(waiting.steps[0]).attempts?.[0]).id;
      const ordered = await prisma.designAsset.findMany({
        where: {
          generationTaskId: required(
            required(waiting.steps[0]).generationTaskId,
          ),
          projectId: h.projectId,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const later = required(ordered[1]);
      await prisma.designAssetDecision.create({
        data: {
          assetId: later.id,
          userId: h.userId,
          kind: "rejected",
          reason: "预置冲突用于检查回滚",
          clientRequestId: `agent-attempt:${attemptId}:reject`,
        },
      });
      await expect(
        h.service.reject(h.userId, h.run.id, {
          revision: waiting.revision,
          reason: "所有候选重新设计",
        }),
      ).rejects.toMatchObject({ code: "P2002" });
      const unchanged = await h.service.get(h.userId, h.run.id);
      expect(unchanged.status).toBe("waiting_review");
      expect(unchanged.revision).toBe(waiting.revision);
      expect(unchanged.steps[0]?.status).toBe("waiting_review");
      expect(unchanged.steps[0]?.attempts?.[0]?.status).toBe("succeeded");
      await expect(
        prisma.designAssetDecision.count({ where: { userId: h.userId } }),
      ).resolves.toBe(1);
      await expect(
        prisma.designAssetDecision.count({
          where: { assetId: required(ordered[0]).id, userId: h.userId },
        }),
      ).resolves.toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  it("serializes concurrent execution with revision CAS and passes the second selected candidate to the edit node", async () => {
    const h = await fixture();
    try {
      const executions = await Promise.allSettled([
        h.service.execute(h.userId, h.run.id, h.run.revision),
        h.service.execute(h.userId, h.run.id, h.run.revision),
      ]);
      expect(
        executions.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = executions.find((item) => item.status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { status: 409 },
      });
      await expect(
        prisma.agentRunStepAttempt.count({
          where: { step: { runId: h.run.id } },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.generationTask.count({ where: { userId: h.userId } }),
      ).resolves.toBe(1);
      const running = await h.service.get(h.userId, h.run.id);
      const taskId = required(required(running.steps[0]).generationTaskId);
      const candidates = [crypto.randomUUID(), crypto.randomUUID()];
      await h.finish(taskId, candidates);
      const waiting = await h.service.get(h.userId, h.run.id);
      const secondCandidate = required(candidates[1]);
      const selected = await h.service.review(h.userId, h.run.id, {
        revision: waiting.revision,
        assetId: secondCandidate,
        reason: "第二版袖型更接近目标",
      });
      await expect(
        prisma.designAssetDecision.findFirst({
          where: { assetId: secondCandidate, userId: h.userId },
        }),
      ).resolves.toMatchObject({
        kind: "selected",
        reason: "第二版袖型更接近目标",
      });
      await prisma.boardElement.update({
        where: { id: h.note.id },
        data: { record: { props: { text: "新的白板便签" } } },
      });
      const editing = await h.service.execute(
        h.userId,
        h.run.id,
        selected.revision,
      );
      const editTaskId = required(required(editing.steps[1]).generationTaskId);
      await expect(
        prisma.generationTask.findUniqueOrThrow({ where: { id: editTaskId } }),
      ).resolves.toMatchObject({
        taskType: "i2i",
        parentAssetId: secondCandidate,
      });
      const firstAttempt = await prisma.agentRunStepAttempt.findFirstOrThrow({
        where: { stepId: required(running.steps[0]).id },
      });
      expect(firstAttempt.compiledSnapshot).toMatchObject({
        notes: ["保留落肩袖"],
      });
      expect(firstAttempt.requestSnapshot).toMatchObject({
        taskType: "t2i",
        prompt: "loose coat",
      });
      expect(h.model.enhancePrompt).not.toHaveBeenCalled();
      const editedAsset = crypto.randomUUID();
      await h.finish(editTaskId, [editedAsset]);
      const finalReview = await h.service.get(h.userId, h.run.id);
      const complete = await h.service.review(h.userId, h.run.id, {
        revision: finalReview.revision,
        assetId: editedAsset,
        reason: "选定细化版本",
      });
      expect(complete.status).toBe("completed");
      expect(JSON.stringify(complete)).not.toContain("https://signed.test");
    } finally {
      await h.cleanup();
    }
  });

  it("keeps cancellation terminal when task creation and queue acknowledgement cross the cancellation transaction", async () => {
    const h = await fixture();
    const submitted = deferred<undefined>();
    const queueAck = deferred<undefined>();
    h.jobs.enqueue.mockImplementationOnce(async () => {
      submitted.resolve(undefined);
      await queueAck.promise;
    });
    try {
      const executing = h.service.execute(h.userId, h.run.id, h.run.revision);
      await submitted.promise;
      const current = await h.service.get(h.userId, h.run.id);
      const canceled = await h.service.cancel(
        h.userId,
        h.run.id,
        current.revision,
      );
      expect(canceled.status).toBe("canceled");
      queueAck.resolve(undefined);
      const late = await executing;
      expect(late.status).toBe("canceled");
      expect(late.steps[0]?.status).toBe("canceled");
      await expect(
        prisma.generationTask.findFirstOrThrow({ where: { userId: h.userId } }),
      ).resolves.toMatchObject({ status: GenerationTaskStatus.CANCELED });
      await expect(
        prisma.agentRunStepAttempt.findFirstOrThrow({
          where: { step: { runId: h.run.id } },
        }),
      ).resolves.toMatchObject({
        generationTaskId: expect.any(String),
        status: "canceled",
      });
    } finally {
      queueAck.resolve(undefined);
      await h.cleanup();
    }
  });
});
