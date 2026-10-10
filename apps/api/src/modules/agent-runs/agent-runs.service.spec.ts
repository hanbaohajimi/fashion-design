import { GenerationTaskStatus, Prisma } from "@fashion/db";
import type { AgentPlanStepSpec } from "@fashion/shared";
import { describe, expect, it, vi } from "vitest";
import { AgentRunsService } from "./agent-runs.service";
import { agentPlanSchema } from "./agent-runs.schemas";
import { agentAttemptTaskId } from "./agent-tool.registry";

type Row = Record<string, unknown>;
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("测试记录缺失");
  return value;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise 尚未初始化");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Promise 尚未初始化");
  };
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const specs: AgentPlanStepSpec[] = [
  {
    key: "base",
    tool: "generate_design",
    title: "基础方案",
    instruction: "生成基础方案",
    prompt: "loose coat",
    negativePrompt: "",
    sourceAssetId: null,
    sourceStepKey: null,
  },
  {
    key: "sleeve",
    tool: "edit_design",
    title: "细化袖型",
    instruction: "细化选定方案袖型",
    prompt: "wider sleeves",
    negativePrompt: "",
    sourceAssetId: null,
    sourceStepKey: "base",
  },
];
const compiled = {
  version: 1,
  mode: "text_only",
  positivePrompt: "frozen coat",
  negativePrompt: "",
  palette: [],
  paletteReferences: [],
  styleReferences: [],
  silhouetteReferences: [],
  fabricReferences: [],
  fabricInputs: [],
  patternReferences: [],
  detailReferences: [],
  avoidLabels: [],
  notes: [],
  enhancement: "keywords",
};

function matches(row: Row, where: Row, steps: Row[] = []): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR")
      return (value as Row[]).some((query) => matches(row, query, steps));
    if (key === "project") return true;
    if (key === "step")
      return steps.some(
        (step) => step.id === row.stepId && matches(step, value as Row),
      );
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const condition = value as Row;
      if ("not" in condition) return row[key] !== condition.not;
      if ("in" in condition)
        return (condition.in as unknown[]).includes(row[key]);
      if ("notIn" in condition)
        return !(condition.notIn as unknown[]).includes(row[key]);
      if ("gt" in condition)
        return (row[key] as Date).getTime() > (condition.gt as Date).getTime();
    }
    return row[key] === value;
  });
}
function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data))
    row[key] =
      value && typeof value === "object" && "increment" in value
        ? Number(row[key]) + Number((value as Row).increment)
        : structuredClone(value);
  row.updatedAt = new Date();
}
function harness(initialSpecs = specs) {
  const now = new Date();
  const runs: Row[] = [
    {
      id: "run-a",
      projectId: "project-a",
      conversationId: "conversation-a",
      userId: "user-a",
      clientRequestId: "request-a",
      intent: "设计并细化风衣",
      contextSnapshot: {
        shapeIds: ["shape-a"],
        fileAssetIds: [],
        designAssetIds: ["source-a"],
        elements: [],
      },
      status: "ready",
      revision: 1,
      error: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const steps: Row[] = initialSpecs.map((spec, ordinal) => ({
    ...spec,
    id: `step-${ordinal}`,
    runId: "run-a",
    ordinal,
    status: "pending",
    attempt: 0,
    generationTaskId: null,
    selectedAssetId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  }));
  const attempts: Row[] = [];
  let nextStepId = steps.length;
  const tasks: Row[] = [];
  const assets: Row[] = [
    {
      id: "source-a",
      projectId: "project-a",
      generationTaskId: null,
      archivedAt: null,
      width: 1024,
      height: 768,
      url: "s3://source-a.png",
      thumbnailUrl: null,
      createdAt: now,
    },
  ];
  const decisions: Row[] = [];
  const withSteps = (run: Row | undefined) =>
    run
      ? structuredClone({
          ...run,
          steps: steps
            .filter((step) => step.runId === run.id)
            .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
            .map((step) => ({
              ...step,
              attempts: attempts
                .filter((attempt) => attempt.stepId === step.id)
                .sort((a, b) => Number(b.ordinal) - Number(a.ordinal)),
            })),
        })
      : null;
  function runWhere(where: Row) {
    const query = where.conversationId_clientRequestId as Row | undefined;
    return runs.find((run) => matches(run, query ?? where));
  }
  const database = {
    agentConversation: {
      findUnique: vi.fn().mockResolvedValue({
        id: "conversation-a",
        projectId: "project-a",
        createdById: "user-a",
        archivedAt: null,
        project: { deletedAt: null, workspace: { ownerId: "user-a" } },
      }),
    },
    agentRun: {
      findUnique: vi.fn(async ({ where }: { where: Row }) =>
        withSteps(runWhere(where)),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) =>
        withSteps(runWhere(where)),
      ),
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        runs.filter((run) => matches(run, where)).map((run) => withSteps(run)),
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const run = {
          id: `run-${runs.length}`,
          revision: 0,
          error: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        runs.push(run);
        return withSteps(run);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const found = runs.filter((run) => matches(run, where));
        found.forEach((run) => apply(run, data));
        return { count: found.length };
      }),
    },
    agentRunStep: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        for (const row of data)
          steps.push({
            id: `step-${nextStepId++}`,
            attempt: 0,
            generationTaskId: null,
            selectedAssetId: null,
            error: null,
            createdAt: now,
            updatedAt: now,
            ...row,
          });
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const step = required(steps.find((row) => matches(row, where)));
        apply(step, data);
        return structuredClone(step);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const found = steps.filter((row) => matches(row, where));
        found.forEach((row) => apply(row, data));
        return { count: found.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const deleted = steps.filter((row) => matches(row, where));
        for (const row of deleted) steps.splice(steps.indexOf(row), 1);
        return { count: deleted.length };
      }),
    },
    agentRunStepAttempt: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `attempt-${attempts.length}`,
          compiledSnapshot: null,
          generationTaskId: null,
          error: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        attempts.push(row);
        return structuredClone(row);
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = required(attempts.find((row) => matches(row, where)));
        apply(row, data);
        return structuredClone(row);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const found = attempts.filter((row) => matches(row, where, steps));
        found.forEach((row) => apply(row, data));
        return { count: found.length };
      }),
    },
    generationTask: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        structuredClone(tasks.find((row) => matches(row, where)) ?? null),
      ),
    },
    designAsset: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        structuredClone(assets.find((row) => matches(row, where)) ?? null),
      ),
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        structuredClone(assets.filter((row) => matches(row, where))),
      ),
      count: vi.fn(
        async ({ where }: { where: Row }) =>
          assets.filter((row) => matches(row, where)).length,
      ),
    },
    designAssetDecision: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        decisions.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(),
  };
  database.$transaction.mockImplementation(
    async (callback: (transaction: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone([runs, steps, attempts, decisions]);
      try {
        return await callback(database);
      } catch (error) {
        [runs, steps, attempts, decisions].forEach((rows, index) =>
          rows.splice(0, rows.length, ...required(snapshot[index])),
        );
        throw error;
      }
    },
  );
  const submit = (userId: string, request: Row, key: string) => {
    const taskId = agentAttemptTaskId(userId, key);
    if (!tasks.some((task) => task.id === taskId))
      tasks.push({
        id: taskId,
        userId,
        projectId: request.projectId,
        status: GenerationTaskStatus.QUEUED,
        errorMessage: null,
      });
    return { taskId };
  };
  const generation = {
    createFromAgent: vi.fn(async (userId: string, request: Row, key: string) =>
      submit(userId, request, key),
    ),
    cancel: vi.fn(async (_userId: string, id: string) => {
      const task = tasks.find((task) => task.id === id);
      if (task) task.status = GenerationTaskStatus.CANCELED;
    }),
    resumeQueuedTask: vi.fn().mockResolvedValue(undefined),
  };
  const compiler = { compile: vi.fn().mockResolvedValue(compiled) };
  const service = new AgentRunsService(
    database as never,
    generation as never,
    compiler as never,
  );
  const finish = (taskId: string, assetId: string) => {
    required(tasks.find((task) => task.id === taskId)).status =
      GenerationTaskStatus.SUCCEEDED;
    assets.push({
      id: assetId,
      projectId: "project-a",
      generationTaskId: taskId,
      archivedAt: null,
      width: 1024,
      height: 1024,
      url: `s3://${assetId}.png`,
      thumbnailUrl: `s3://${assetId}.webp`,
      createdAt: now,
    });
  };
  return {
    service,
    database,
    generation,
    compiler,
    runs,
    steps,
    attempts,
    tasks,
    assets,
    decisions,
    submit,
    finish,
  };
}

describe("Agent plan schema", () => {
  it("rejects duplicate keys, forward references, source-less edits and forbidden tools", () => {
    expect(agentPlanSchema.safeParse(specs).success).toBe(true);
    expect(agentPlanSchema.safeParse([specs[1], specs[0]]).success).toBe(false);
    expect(agentPlanSchema.safeParse([specs[0], specs[0]]).success).toBe(false);
    expect(
      agentPlanSchema.safeParse([{ ...specs[1], sourceStepKey: null }]).success,
    ).toBe(false);
    expect(
      agentPlanSchema.safeParse([{ ...specs[0], tool: "create_collection" }])
        .success,
    ).toBe(false);
    expect(agentPlanSchema.safeParse(Array(7).fill(specs[0])).success).toBe(
      false,
    );
  });
});

describe("AgentRunsService", () => {
  it("adds, removes and reorders only unexecuted nodes while preserving IDs for retained keys", async () => {
    const base = required(specs[0]);
    const other = { ...base, key: "other", title: "平行参考方案" };
    const edit = required(specs[1]);
    const h = harness([base, other, edit]);
    const ids = new Map(h.steps.map((step) => [step.key, step.id]));
    const swapped = await h.service.updatePlan("user-a", "run-a", {
      revision: 1,
      steps: [base, edit, other],
    });
    expect(swapped.steps.map((step) => step.key)).toEqual([
      "base",
      "sleeve",
      "other",
    ]);
    for (const step of swapped.steps) expect(step.id).toBe(ids.get(step.key));
    const added = {
      ...base,
      key: "new",
      tool: "edit_design" as const,
      sourceStepKey: "sleeve",
    };
    const changed = await h.service.updatePlan("user-a", "run-a", {
      revision: swapped.revision,
      steps: [base, edit, added],
    });
    expect(changed.steps.map((step) => step.ordinal)).toEqual([0, 1, 2]);
    expect(changed.steps.map((step) => step.key)).toEqual([
      "base",
      "sleeve",
      "new",
    ]);
    expect(changed.steps[1]?.id).toBe(ids.get("sleeve"));
    expect(h.steps.some((step) => step.key === "other")).toBe(false);
  });

  it("locks every admitted node's structure and ordinal even after rejecting its results", async () => {
    const h = harness();
    const running = await h.service.execute("user-a", "run-a", 1);
    h.finish(
      required(required(running.steps[0]).generationTaskId),
      "rejected-base",
    );
    const waiting = await h.service.get("user-a", "run-a");
    const rejected = await h.service.reject("user-a", "run-a", {
      revision: waiting.revision,
      reason: "袖型不符合",
    });
    const base = required(specs[0]);
    await expect(
      h.service.updatePlan("user-a", "run-a", {
        revision: rejected.revision,
        steps: [{ ...base, title: "覆盖历史标题" }, required(specs[1])],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.updatePlan("user-a", "run-a", {
        revision: rejected.revision,
        steps: [{ ...base, key: "insert-before" }, ...specs],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.updatePlan("user-a", "run-a", {
        revision: rejected.revision,
        steps: [{ ...base, key: "replacement" }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.attempts).toHaveLength(1);
    expect(rejected.steps[0]?.canEditInputs).toBe(true);
  });

  it("rejects invalid graphs, unselected sources and cross-project sources without writes", async () => {
    const h = harness();
    await expect(
      h.service.updatePlan("user-a", "run-a", {
        revision: 1,
        steps: [required(specs[1]), required(specs[0])],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.updatePlan("user-a", "run-a", {
        revision: 1,
        steps: [
          {
            ...required(specs[1]),
            sourceAssetId: "forged",
            sourceStepKey: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    required(h.assets[0]).projectId = "other-project";
    await expect(
      h.service.updatePlan("user-a", "run-a", {
        revision: 1,
        steps: [
          {
            ...required(specs[1]),
            sourceAssetId: "source-a",
            sourceStepKey: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.runs[0]?.revision).toBe(1);
    expect(h.database.agentRunStep.deleteMany).not.toHaveBeenCalled();
    await expect(
      h.service.updatePlan("intruder", "run-a", { revision: 1, steps: specs }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("completes a plan when its remaining unexecuted suffix is deleted", async () => {
    const h = harness();
    const running = await h.service.execute("user-a", "run-a", 1);
    h.finish(
      required(required(running.steps[0]).generationTaskId),
      "final-base",
    );
    const waiting = await h.service.get("user-a", "run-a");
    const selected = await h.service.review("user-a", "run-a", {
      revision: waiting.revision,
      assetId: "final-base",
      reason: "基础方案已足够",
    });
    const completed = await h.service.updatePlan("user-a", "run-a", {
      revision: selected.revision,
      steps: [required(specs[0])],
    });
    expect(completed.status).toBe("completed");
    expect(completed.steps).toHaveLength(1);
    expect(completed.steps[0]?.selectedAssetId).toBe("final-base");
    expect(h.attempts).toHaveLength(1);
  });

  it("rejects all actual candidates, keeps original facts and makes a new attempt after prompt editing", async () => {
    const h = harness();
    const running = await h.service.execute("user-a", "run-a", 1);
    const oldTaskId = required(required(running.steps[0]).generationTaskId);
    h.finish(oldTaskId, "reject-a");
    h.finish(oldTaskId, "reject-b");
    const waiting = await h.service.get("user-a", "run-a");
    const rejected = await h.service.reject("user-a", "run-a", {
      revision: waiting.revision,
      reason: "  色彩过亮  ",
    });
    expect(rejected.status).toBe("ready");
    expect(rejected.steps[0]).toMatchObject({
      status: "pending",
      generationTaskId: null,
      canEditInputs: true,
    });
    expect(rejected.steps[0]?.attempts?.[0]).toMatchObject({
      status: "rejected",
      error: "色彩过亮",
      generationTaskId: oldTaskId,
      prompt: "loose coat",
    });
    expect(rejected.steps[0]?.attempts?.[0]?.candidates).toHaveLength(2);
    expect(h.decisions).toEqual([
      expect.objectContaining({
        assetId: "reject-a",
        kind: "rejected",
        reason: "色彩过亮",
      }),
      expect.objectContaining({
        assetId: "reject-b",
        kind: "rejected",
        reason: "色彩过亮",
      }),
    ]);
    const refreshed = await h.service.get("user-a", "run-a");
    expect(refreshed.revision).toBe(rejected.revision);
    expect(refreshed.status).toBe("ready");
    expect(refreshed.steps[0]?.status).toBe("pending");
    await expect(
      h.service.reject("user-a", "run-a", {
        revision: rejected.revision,
        reason: "重复否决",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const edited = await h.service.updateStep(
      "user-a",
      "run-a",
      required(rejected.steps[0]).id,
      {
        revision: rejected.revision,
        prompt: "muted gray coat",
        negativePrompt: "bright color",
      },
    );
    const retry = await h.service.execute("user-a", "run-a", edited.revision);
    expect(h.attempts).toHaveLength(2);
    expect(h.tasks).toHaveLength(2);
    expect(h.attempts[0]?.requestSnapshot).toMatchObject({
      prompt: "loose coat",
    });
    expect(h.attempts[0]?.compiledSnapshot).toEqual(compiled);
    expect(h.attempts[0]?.generationTaskId).toBe(oldTaskId);
    expect(retry.steps[0]?.attempts?.[1]).toMatchObject({
      ordinal: 2,
      prompt: "muted gray coat",
      negativePrompt: "bright color",
    });
    expect(h.attempts[0]?.executionKey).not.toBe(h.attempts[1]?.executionKey);
    expect(retry.steps[0]?.canEditInputs).toBe(false);
  });

  it("does not let a late rejected attempt callback replace the current attempt", async () => {
    const h = harness();
    const response = deferred<{ taskId: string }>();
    const submitted = deferred<undefined>();
    h.generation.createFromAgent.mockImplementationOnce(
      async (userId, request, key) => {
        const result = h.submit(userId, request, key);
        submitted.resolve(undefined);
        return response.promise.then(() => result);
      },
    );
    const oldExecution = h.service.execute("user-a", "run-a", 1);
    await submitted.promise;
    const oldTaskId = String(required(h.tasks[0]).id);
    h.finish(oldTaskId, "late-rejected");
    const waiting = await h.service.get("user-a", "run-a");
    const rejected = await h.service.reject("user-a", "run-a", {
      revision: waiting.revision,
      reason: "重新设计",
    });
    const current = await h.service.execute(
      "user-a",
      "run-a",
      rejected.revision,
    );
    response.resolve({ taskId: oldTaskId });
    const late = await oldExecution;
    expect(late.status).toBe("running");
    expect(late.steps[0]?.generationTaskId).toBe(
      current.steps[0]?.generationTaskId,
    );
    expect(late.steps[0]?.generationTaskId).not.toBe(oldTaskId);
    expect(late.steps[0]?.attempts?.[0]?.status).toBe("rejected");
  });

  it("hides signed URLs and compiled internals while preserving user rejection reasons", async () => {
    const h = harness();
    const running = await h.service.execute("user-a", "run-a", 1);
    const secret = "PRIVATE_SIGNED_SECRET";
    const attempt = required(h.attempts[0]);
    attempt.compiledSnapshot = {
      ...compiled,
      leaseToken: secret,
      styleReferences: [
        { imageUrl: `https://private.test/source?signature=${secret}` },
      ],
    };
    attempt.requestSnapshot = {
      ...(attempt.requestSnapshot as Row),
      referenceImageUrl: `https://private.test/source?signature=${secret}`,
    };
    attempt.error = `provider failed at https://private.test/source?signature=${secret}; token=${secret}`;
    required(h.runs[0]).error = attempt.error;
    required(h.steps[0]).error = attempt.error;
    const safe = await h.service.get("user-a", "run-a");
    expect(JSON.stringify(safe)).not.toContain(secret);
    expect(JSON.stringify(safe)).not.toContain("compiledSnapshot");
    expect(JSON.stringify(safe)).not.toContain("leaseToken");
    expect(safe.sourceAssets?.[0]?.url).toBe(
      "/api/design-assets/source-a/content",
    );
    h.finish(
      required(required(running.steps[0]).generationTaskId),
      "with-public-reason",
    );
    const waiting = await h.service.get("user-a", "run-a");
    const reason =
      "参考 https://example.test/design，标记 token=contrast 为配色说明";
    const rejected = await h.service.reject("user-a", "run-a", {
      revision: waiting.revision,
      reason,
    });
    expect(rejected.steps[0]?.attempts?.[0]?.error).toBe(reason);
    expect(h.decisions[0]?.reason).toBe(reason);
  });

  it("requires a nonempty rejection reason and checks ownership", async () => {
    const h = harness();
    await expect(
      h.service.reject("user-a", "run-a", { revision: 1, reason: " " }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.reject("intruder", "run-a", { revision: 1, reason: "不符合" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.decisions).toHaveLength(0);
  });

  it("executes one node, waits for selection and binds the chosen asset into the next edit", async () => {
    const h = harness();
    const first = await h.service.execute("user-a", "run-a", 1);
    expect(first.status).toBe("running");
    expect(h.generation.createFromAgent).toHaveBeenCalledTimes(1);
    expect(h.attempts[0]?.compiledSnapshot).toEqual(compiled);
    expect(first.steps[1]?.status).toBe("pending");
    const taskId = required(required(first.steps[0]).generationTaskId);
    h.finish(taskId, "chosen-base");
    const review = await h.service.get("user-a", "run-a");
    expect(review.status).toBe("waiting_review");
    expect(review.steps[0]?.candidates[0]).toMatchObject({
      assetId: "chosen-base",
      url: "/api/design-assets/chosen-base/content",
    });
    const repeated = await h.service.get("user-a", "run-a");
    expect(repeated.revision).toBe(review.revision);
    const ready = await h.service.review("user-a", "run-a", {
      revision: review.revision,
      assetId: "chosen-base",
      reason: "袖型最接近目标",
    });
    expect(ready.status).toBe("ready");
    expect(h.decisions).toEqual([
      expect.objectContaining({
        kind: "selected",
        assetId: "chosen-base",
        reason: "袖型最接近目标",
      }),
    ]);
    await h.service.execute("user-a", "run-a", ready.revision);
    expect(h.generation.createFromAgent).toHaveBeenLastCalledWith(
      "user-a",
      expect.objectContaining({
        taskType: "i2i",
        parentAssetId: "chosen-base",
      }),
      expect.any(String),
      "细化选定方案袖型",
      compiled,
    );
  });

  it("reuses the same attempt and frozen compiler result after task creation succeeds but enqueue fails", async () => {
    const h = harness();
    h.generation.createFromAgent.mockImplementationOnce(
      async (userId, request, key) => {
        h.submit(userId, request, key);
        throw new Error("QUEUE_UNAVAILABLE");
      },
    );
    const failed = await h.service.execute("user-a", "run-a", 1);
    expect(failed.status).toBe("failed");
    expect(h.tasks).toHaveLength(1);
    const key = required(h.attempts[0]).executionKey;
    const retried = await h.service.execute("user-a", "run-a", failed.revision);
    expect(retried.status).toBe("running");
    expect(h.attempts).toHaveLength(1);
    expect(h.tasks).toHaveLength(1);
    expect(h.compiler.compile).toHaveBeenCalledTimes(1);
    expect(h.generation.createFromAgent.mock.calls[1]?.[2]).toBe(key);
  });

  it("preserves terminal failed attempts and creates a new execution key for a generation retry", async () => {
    const h = harness();
    const running = await h.service.execute("user-a", "run-a", 1);
    required(h.tasks[0]).status = GenerationTaskStatus.FAILED;
    required(h.tasks[0]).errorMessage = "provider failed";
    const failed = await h.service.get("user-a", "run-a");
    expect(failed.status).toBe("failed");
    await h.service.execute("user-a", "run-a", failed.revision);
    expect(h.attempts).toHaveLength(2);
    expect(h.attempts[0]?.generationTaskId).toBe(
      running.steps[0]?.generationTaskId,
    );
    expect(h.attempts[0]?.executionKey).not.toBe(h.attempts[1]?.executionKey);
    expect(h.tasks).toHaveLength(2);
  });

  it("rejects stale revisions and forged review assets without advancing the workflow", async () => {
    const h = harness();
    await expect(h.service.execute("user-a", "run-a", 0)).rejects.toMatchObject(
      { status: 409 },
    );
    const running = await h.service.execute("user-a", "run-a", 1);
    h.finish(required(required(running.steps[0]).generationTaskId), "actual");
    const review = await h.service.get("user-a", "run-a");
    await expect(
      h.service.review("user-a", "run-a", {
        revision: review.revision,
        assetId: "source-a",
        reason: "",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.runs[0]?.status).toBe("waiting_review");
    expect(h.decisions).toHaveLength(0);
  });

  it("checks ownership on every read and control operation", async () => {
    const h = harness();
    await expect(h.service.get("intruder", "run-a")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      h.service.execute("intruder", "run-a", 1),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      h.service.cancel("intruder", "run-a", 1),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
  });

  it("never submits a generation until its compiled snapshot is saved under the current lease", async () => {
    const h = harness();
    h.compiler.compile.mockImplementationOnce(async () => {
      required(h.attempts[0]).leaseToken = "new-owner";
      return compiled;
    });
    const view = await h.service.execute("user-a", "run-a", 1);
    expect(view.status).toBe("running");
    expect(h.attempts[0]?.compiledSnapshot).toBeNull();
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
  });

  it("recovers a task admitted before binding without new generation work on GET", async () => {
    const h = harness();
    const running = await h.service.execute("user-a", "run-a", 1);
    required(h.steps[0]).generationTaskId = null;
    required(h.attempts[0]).generationTaskId = null;
    h.finish(
      required(required(running.steps[0]).generationTaskId),
      "recovered",
    );
    const view = await h.service.get("user-a", "run-a");
    expect(view.status).toBe("waiting_review");
    expect(view.steps[0]?.generationTaskId).toBe(
      running.steps[0]?.generationTaskId,
    );
    expect(h.generation.createFromAgent).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues an admitted QUEUED task on refresh without creating another task or attempt", async () => {
    const h = harness();
    const running = await h.service.execute("user-a", "run-a", 1);
    h.generation.resumeQueuedTask.mockClear();
    required(h.steps[0]).generationTaskId = null;
    required(h.attempts[0]).generationTaskId = null;
    const view = await h.service.get("user-a", "run-a");
    expect(h.generation.resumeQueuedTask).toHaveBeenCalledWith(
      "user-a",
      running.steps[0]?.generationTaskId,
    );
    expect(view.steps[0]?.generationTaskId).toBe(
      running.steps[0]?.generationTaskId,
    );
    expect(h.attempts).toHaveLength(1);
    expect(h.tasks).toHaveLength(1);
    expect(h.generation.createFromAgent).toHaveBeenCalledTimes(1);
  });

  it("reports a queue recovery failure and then recovers the same attempt when the queue is available", async () => {
    const h = harness();
    await h.service.execute("user-a", "run-a", 1);
    h.generation.resumeQueuedTask.mockRejectedValueOnce(
      new Error("QUEUE_UNAVAILABLE"),
    );
    const failed = await h.service.get("user-a", "run-a");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("QUEUE_UNAVAILABLE");
    const recovered = await h.service.get("user-a", "run-a");
    expect(recovered.status).toBe("running");
    expect(recovered.error).toBeNull();
    expect(h.attempts).toHaveLength(1);
    expect(h.generation.createFromAgent).toHaveBeenCalledTimes(1);
  });

  it("recovers an expired compilation lease with the original request before admitting any task", async () => {
    const h = harness();
    h.compiler.compile.mockImplementationOnce(async () => {
      required(h.attempts[0]).leaseExpiresAt = new Date(Date.now() - 1000);
      return compiled;
    });
    const interrupted = await h.service.execute("user-a", "run-a", 1);
    expect(interrupted.status).toBe("failed");
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
    expect(h.attempts[0]?.compiledSnapshot).toBeNull();
    const recovered = await h.service.execute(
      "user-a",
      "run-a",
      interrupted.revision,
    );
    expect(recovered.status).toBe("running");
    expect(h.attempts).toHaveLength(1);
    expect(h.compiler.compile).toHaveBeenCalledTimes(2);
    expect(h.generation.createFromAgent).toHaveBeenCalledTimes(1);
  });

  it("compensates cancellation after a restart even if task binding was lost", async () => {
    const h = harness();
    await h.service.execute("user-a", "run-a", 1);
    required(h.runs[0]).status = "canceled";
    required(h.steps[0]).status = "canceled";
    required(h.steps[0]).generationTaskId = null;
    required(h.attempts[0]).generationTaskId = null;
    required(h.tasks[0]).status = GenerationTaskStatus.RUNNING;
    const view = await h.service.get("user-a", "run-a");
    expect(view.status).toBe("canceled");
    expect(h.generation.cancel).toHaveBeenCalledWith("user-a", h.tasks[0]?.id);
    expect(h.attempts[0]?.generationTaskId).toBe(h.tasks[0]?.id);
  });

  it("does not let a late queue error overwrite a canceled workflow", async () => {
    const h = harness();
    const response = deferred<{ taskId: string }>();
    const submitted = deferred<undefined>();
    h.generation.createFromAgent.mockImplementationOnce(
      async (userId, request, key) => {
        h.submit(userId, request, key);
        submitted.resolve(undefined);
        return response.promise;
      },
    );
    const pending = h.service.execute("user-a", "run-a", 1);
    await submitted.promise;
    await h.service.cancel(
      "user-a",
      "run-a",
      Number(required(h.runs[0]).revision),
    );
    response.reject(new Error("late queue error"));
    const view = await pending;
    expect(view.status).toBe("canceled");
    expect(view.steps[0]?.status).toBe("canceled");
  });

  it("keeps a task running when the worker starts before an enqueue acknowledgement fails", async () => {
    const h = harness();
    const response = deferred<{ taskId: string }>();
    const submitted = deferred<undefined>();
    h.generation.createFromAgent.mockImplementationOnce(
      async (userId, request, key) => {
        h.submit(userId, request, key);
        submitted.resolve(undefined);
        return response.promise;
      },
    );
    const pending = h.service.execute("user-a", "run-a", 1);
    await submitted.promise;
    required(h.tasks[0]).status = GenerationTaskStatus.RUNNING;
    response.reject(new Error("late enqueue acknowledgement failure"));
    const view = await pending;
    expect(view.status).toBe("running");
    expect(view.error).toBeNull();
    expect(view.steps[0]?.status).toBe("running");
    expect(h.tasks).toHaveLength(1);
  });

  it("reconciles a persisted submission failure when the real task is already running", async () => {
    const h = harness();
    await h.service.execute("user-a", "run-a", 1);
    required(h.runs[0]).status = "failed";
    required(h.runs[0]).error = "old queue error";
    required(h.steps[0]).status = "failed";
    required(h.steps[0]).error = "old queue error";
    required(h.attempts[0]).status = "failed";
    required(h.tasks[0]).status = GenerationTaskStatus.RUNNING;
    const view = await h.service.get("user-a", "run-a");
    expect(view.status).toBe("running");
    expect(view.steps[0]?.status).toBe("running");
    expect(view.error).toBeNull();
    expect(h.generation.createFromAgent).toHaveBeenCalledTimes(1);
  });

  it("does not let a late submission error overwrite a reviewed and completed result", async () => {
    const h = harness([required(specs[0])]);
    const response = deferred<{ taskId: string }>();
    const submitted = deferred<undefined>();
    h.generation.createFromAgent.mockImplementationOnce(
      async (userId, request, key) => {
        h.submit(userId, request, key);
        submitted.resolve(undefined);
        return response.promise;
      },
    );
    const pending = h.service.execute("user-a", "run-a", 1);
    await submitted.promise;
    h.finish(String(required(h.tasks[0]).id), "complete-before-queue-reply");
    const waiting = await h.service.get("user-a", "run-a");
    await h.service.review("user-a", "run-a", {
      revision: waiting.revision,
      assetId: "complete-before-queue-reply",
      reason: "选定",
    });
    response.reject(new Error("late response failure"));
    const view = await pending;
    expect(view.status).toBe("completed");
    expect(view.steps[0]?.status).toBe("succeeded");
    expect(view.steps[0]?.selectedAssetId).toBe("complete-before-queue-reply");
  });

  it("replays a reservation after live context changes while comparing original request IDs", async () => {
    const h = harness();
    const replay = await h.service.findReservation("user-a", "conversation-a", {
      clientRequestId: "request-a",
      intent: "设计并细化风衣",
      contextSnapshot: {
        requestContext: { shapeIds: ["shape-a"], fileAssetIds: [] },
        elements: [{ text: "新便签" }],
      },
    });
    expect(replay?.id).toBe("run-a");
    await expect(
      h.service.findReservation("user-a", "conversation-a", {
        clientRequestId: "request-a",
        intent: "不同需求",
        contextSnapshot: { shapeIds: ["shape-a"] },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("resolves a concurrent reserve unique constraint conflict to the original plan", async () => {
    const h = harness();
    h.database.agentRun.findUnique.mockResolvedValueOnce(null);
    h.database.agentRun.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "7",
      }),
    );
    const result = await h.service.reserve("user-a", "conversation-a", {
      clientRequestId: "request-a",
      intent: "设计并细化风衣",
      contextSnapshot: { shapeIds: ["shape-a"], fileAssetIds: [] },
    });
    expect(result.created).toBe(false);
    expect(result.run.id).toBe("run-a");
  });

  it("rejects unselected edit sources and late planning completion after cancellation", async () => {
    const h = harness([]);
    required(h.runs[0]).status = "planning";
    await expect(
      h.service.completePlan("user-a", "run-a", [
        {
          ...required(specs[1]),
          sourceStepKey: null,
          sourceAssetId: "unselected",
        },
      ]),
    ).rejects.toMatchObject({ status: 400 });
    await h.service.cancel("user-a", "run-a", 1);
    const canceled = await h.service.completePlan("user-a", "run-a", specs);
    expect(canceled.status).toBe("canceled");
    expect(h.steps).toHaveLength(0);
  });

  it("marks an interrupted planning request failed without running tools", async () => {
    const h = harness([]);
    required(h.runs[0]).status = "planning";
    required(h.runs[0]).updatedAt = new Date(Date.now() - 11 * 60 * 1000);
    const view = await h.service.get("user-a", "run-a");
    expect(view.status).toBe("failed");
    expect(view.error).toContain("计划生成已中断");
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
  });
});
