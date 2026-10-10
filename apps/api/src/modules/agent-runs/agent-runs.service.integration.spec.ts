import {
  DesignAssetOperation,
  GenerationTaskStatus,
  prisma,
} from "@fashion/db";
import type { AgentPlanStepSpec } from "@fashion/shared";
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
async function fixture() {
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
  const service = new AgentRunsService(prisma, generation, compiler);
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
  const run = await service.completePlan(user.id, reserved.run.id, plan);
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
    run,
    finish,
    cleanup: () => prisma.user.delete({ where: { id: user.id } }),
  };
}

describe("AgentRunsService PostgreSQL integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
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
