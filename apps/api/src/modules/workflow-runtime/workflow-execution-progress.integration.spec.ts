import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@fashion/db";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { AgentConversationsController } from "../agent-conversations/agent-conversations.controller";
import { AgentConversationsService } from "../agent-conversations/agent-conversations.service";
import { CanvasService } from "../canvas/canvas.service";
import { DesignContextService } from "../design-context/design-context.service";
import { GenerationController } from "../generation/generation.controller";
import { GenerationService } from "../generation/generation.service";
import { GenerationEventsService } from "../generation/generation-events.service";
import { GenerationMaskService } from "../generation/generation-mask.service";
import { RateLimitGuard } from "../../security/rate-limit.guard";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import { WorkflowRuntimeController } from "./workflow-runtime.controller";
import { WorkflowRuntimeService } from "./workflow-runtime.service";
import { WorkflowAssistantService } from "./workflow-assistant.service";
import { workflowActionSchema } from "./workflow-planner";
import { initialProposalExecutionId } from "./proposal-execution-binding";

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const users: string[] = [];
afterEach(async () => {
  const ids = users.splice(0);
  await prisma.workflowAttempt.deleteMany({
    where: { project: { workspace: { ownerId: { in: ids } } } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});
async function fixture() {
  const user = await prisma.user.create({
    data: {
      email: `execution-progress-${randomUUID()}@example.test`,
      ownedWorkspaces: {
        create: {
          name: "聊天执行验收",
          projects: { create: { name: "确认与执行" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  users.push(user.id);
  const workspace = user.ownedWorkspaces[0],
    project = workspace?.projects[0];
  if (!workspace || !project) throw new Error("缺少隔离项目");
  const viewer = await prisma.user.create({
    data: { email: `execution-reader-${randomUUID()}@example.test` },
  });
  users.push(viewer.id);
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
  });
  const access = new ProjectAccessPolicy(prisma),
    workflows = new WorkflowsService(prisma, access),
    contexts = new DesignContextService(prisma, workflows);
  const constraint = randomUUID();
  await workflows.patch(user.id, project.id, {
    mode: "semantic",
    mutationId: randomUUID(),
    baseRevision: 0,
    operations: [
      {
        type: "add_node",
        node: {
          id: constraint,
          kind: "asset",
          type: "constraint",
          title: "立领约束",
          payload: { text: "保留立领与藏蓝色" },
          x: 0,
          y: 0,
        },
      },
    ],
  });
  const conversation = await prisma.agentConversation.create({
    data: {
      projectId: project.id,
      createdById: user.id,
      title: "风衣设计",
      mode: "workflow",
    },
  });
  const model = {
    generateJson: vi.fn(async () => {
      throw new Error("定向执行与读取不应调用模型");
    }),
  };
  const generation = {
    createFromAgent: vi.fn(
      async (_actor: string, input: { taskType: string }, key: string) => {
        const existing = await prisma.workflowAttempt.findUniqueOrThrow({
          where: { executionKey: key },
        });
        if (existing.generationTaskId)
          return { taskId: existing.generationTaskId };
        return {
          taskId: (
            await prisma.generationTask.create({
              data: {
                userId: user.id,
                projectId: project.id,
                taskType: input.taskType,
                input: json(input),
                status: "QUEUED",
              },
            })
          ).id,
        };
      },
    ),
    get: async (_actor: string, id: string) => {
      const task = await prisma.generationTask.findUniqueOrThrow({
        where: { id },
      });
      return {
        id,
        status: task.status.toLowerCase(),
        output: task.output,
        compiledPrompt: task.compiledPrompt,
        error: task.errorMessage ? { message: task.errorMessage } : null,
      };
    },
  };
  const runtime = new WorkflowRuntimeService(
    prisma,
    workflows,
    generation as never,
    model as never,
    {} as never,
    {} as never,
    contexts,
  );
  const assistant = new WorkflowAssistantService(
    prisma,
    workflows,
    runtime,
    contexts,
    {} as never,
    model as never,
    undefined,
    access,
  );
  const chats = new AgentConversationsService(
    prisma,
    model as never,
    generation as never,
    {} as never,
    undefined,
    assistant,
    access,
  );
  const jobs = { cancel: vi.fn(async () => {}) };
  const cancellation = new GenerationService(
    prisma,
    jobs as never,
    {} as never,
    {} as never,
    {} as never,
    access,
  );
  const module = await Test.createTestingModule({
    controllers: [
      AgentConversationsController,
      WorkflowRuntimeController,
      GenerationController,
    ],
    providers: [
      { provide: AgentConversationsService, useValue: chats },
      { provide: WorkflowRuntimeService, useValue: runtime },
      { provide: CanvasService, useValue: {} },
      { provide: GenerationService, useValue: cancellation },
      { provide: GenerationEventsService, useValue: {} },
      { provide: GenerationMaskService, useValue: {} },
    ],
  })
    .overrideGuard(RateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = module.createNestApplication();
  app.use(
    (
      req: { auth?: unknown; headers: Record<string, string> },
      _res: unknown,
      next: () => void,
    ) => {
      req.auth = { userId: req.headers["x-test-user"] };
      next();
    },
  );
  await app.init();
  const graph = await workflows.get(user.id, project.id),
    context = await contexts.build(user.id, project.id);
  const proposal = await runtime.prepareAction(user.id, project.id, {
    content: "生成两张藏蓝立领风衣",
    referencedNodeIds: [constraint],
    mutationId: randomUUID(),
    graphRevision: graph.revision,
    contextRevision: context.context.contextRevision,
    conversationId: conversation.id,
    action: workflowActionSchema.parse({
      type: "create_tool",
      toolKey: "generate_design",
      toolVersion: "1",
      title: "藏蓝风衣方案",
      parameters: { prompt: "保留立领，生成藏蓝风衣", count: 2 },
      inputs: [{ nodeId: constraint, port: "constraint" }],
      rationale: "明确生成请求",
    }),
  });
  await prisma.agentMessage.create({
    data: {
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: "请确认两张藏蓝方案",
      kind: "propose",
      proposalId: proposal.id,
    },
  });
  await runtime.accept(user.id, project.id, proposal.id, {
    baseRevision: proposal.baseRevision,
    mutationId: randomUUID(),
  });
  const toolId = String(object(proposal.evidence).toolNodeId);
  const get = (actor = user.id, chatId = conversation.id) =>
    request(app.getHttpServer())
      .get(`/agent-conversations/${chatId}/messages?limit=20`)
      .set("x-test-user", actor);
  const execute = (
    mutationId: string = randomUUID(),
    extra: Record<string, unknown> = { proposalId: proposal.id },
  ) =>
    request(app.getHttpServer())
      .post(`/projects/${project.id}/workflow/nodes/${toolId}/execute`)
      .set("x-test-user", user.id)
      .send({ mutationId, conversationId: conversation.id, ...extra });
  const cancel = (id: string, actor = user.id) =>
    request(app.getHttpServer())
      .delete(`/generations/${id}`)
      .set("x-test-user", actor);
  return {
    user,
    viewer,
    workspace,
    project,
    conversation,
    proposal,
    toolId,
    runtime,
    workflows,
    model,
    generation,
    app,
    jobs,
    get,
    execute,
    cancel,
    cleanup: async () => {
      await app.close();
      await prisma.workflowAttempt.deleteMany({
        where: { projectId: project.id },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [user.id, viewer.id] } },
      });
    },
  };
}

it("确认版本与执行关联落盘，排队及实际处理中按任务记录显示且读取不回写消息", async () => {
  const f = await fixture();
  try {
    const stored = await prisma.workflowProposal.findUniqueOrThrow({
      where: { id: f.proposal.id },
    });
    expect(object(stored.evidence).acceptedNodeVersionId).toEqual(
      expect.any(String),
    );
    const before = await f.get().expect(200);
    expect(before.body.items[0].proposal.execution).toMatchObject({
      binding: "not_started",
      canExecute: true,
      progress: null,
    });
    const mutationId = randomUUID();
    await f.execute(mutationId).expect(201);
    await f.execute(mutationId).expect(201);
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(2);
    const execution = await prisma.workflowExecution.findFirstOrThrow({
      where: { projectId: f.project.id },
    });
    expect(execution.requestSnapshot).toMatchObject({
      proposalId: f.proposal.id,
    });
    const attempts = await prisma.workflowAttempt.findMany({
      where: { executionId: execution.id },
      orderBy: { ordinal: "asc" },
    });
    const queued = await f.get().expect(200);
    expect(queued.body.items[0].proposal.execution.progress).toMatchObject({
      status: "queued",
      counts: { total: 2, queued: 2, running: 0, completed: 0 },
    });
    const first = attempts[0]?.generationTaskId;
    if (!first) throw new Error("缺少任务");
    await prisma.generationTask.update({
      where: { id: first },
      data: { status: "RUNNING" },
    });
    const running = await f.get().expect(200);
    expect(running.body.items[0].proposal.execution.progress).toMatchObject({
      status: "running",
      counts: { queued: 1, running: 1 },
    });
    expect(
      running.body.items[0].proposal.execution.progress.cancelTaskIds,
    ).toHaveLength(2);
    await prisma.generationTask.updateMany({
      where: { projectId: f.project.id },
      data: { status: "SUCCEEDED", output: { images: [] } },
    });
    expect(
      (await f.get().expect(200)).body.items[0].proposal.execution.progress,
    ).toMatchObject({
      status: "processing",
      counts: { completed: 0, queued: 0, running: 0, preparing: 0 },
      cancelTaskIds: [],
    });
    expect(f.model.generateJson).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
}, 30000);

it("历史卡片保留原执行与参数，后来改变版本不能借原确认重新执行", async () => {
  const f = await fixture();
  try {
    await f.execute().expect(201);
    const original = (await f.get().expect(200)).body.items[0].proposal
      .execution;
    const graph = await f.workflows.get(f.user.id, f.project.id),
      node = graph.nodes.find((node) => node.id === f.toolId);
    if (!node) throw new Error("缺少工具");
    await f.workflows.applySystemMutation(f.project.id, {
      mode: "semantic",
      baseRevision: graph.revision,
      mutationId: randomUUID(),
      operations: [
        {
          type: "update_node",
          nodeId: f.toolId,
          status: "ready",
          payload: {
            ...object(node.payload),
            params: {
              ...object(object(node.payload).params),
              prompt: "后来改成红色夹克",
            },
          },
        },
      ],
    });
    const changed = (await f.get().expect(200)).body.items[0].proposal;
    expect(changed.execution).toMatchObject({
      binding: "changed",
      canExecute: false,
      progress: { executionId: original.progress.executionId },
    });
    expect(changed.action.parameters.prompt).toBe("保留立领，生成藏蓝风衣");
    await f.execute().expect(409);
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(2);
  } finally {
    await f.cleanup();
  }
}, 30000);

it("旧确认只恢复可验证的首次编号，不把同工具的无关执行归给旧卡片", async () => {
  const f = await fixture();
  try {
    const stored = await prisma.workflowProposal.findUniqueOrThrow({
      where: { id: f.proposal.id },
    });
    const evidence = { ...object(stored.evidence) };
    delete evidence.acceptedNodeVersionId;
    await prisma.workflowProposal.update({
      where: { id: stored.id },
      data: { evidence: json(evidence) },
    });
    await f
      .execute(initialProposalExecutionId(f.project.id, stored.id), {})
      .expect(201);
    const linked = (await f.get().expect(200)).body.items[0].proposal.execution;
    expect(linked.binding).toBe("linked");
    await prisma.workflowExecution.create({
      data: {
        projectId: f.project.id,
        userId: f.user.id,
        conversationId: f.conversation.id,
        toolNodeId: f.toolId,
        nodeVersionId: linked.nodeVersionId,
        executionKey: randomUUID(),
        requestSnapshot: { mutationId: randomUUID() },
        status: "failed",
      },
    });
    expect(
      (await f.get().expect(200)).body.items[0].proposal.execution.progress
        .executionId,
    ).toBe(linked.progress.executionId);
    await f.get(f.viewer.id).expect(403);
    expect(f.model.generateJson).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
}, 30000);

it("同版本失败后重试准确关联新执行，原始失败记录保留且同次请求不重复提交", async () => {
  const f = await fixture();
  try {
    await f.execute().expect(201);
    const old = await prisma.workflowExecution.findFirstOrThrow({
      where: { projectId: f.project.id },
    });
    await prisma.generationTask.updateMany({
      where: { projectId: f.project.id },
      data: { status: "FAILED", errorMessage: "临时处理失败" },
    });
    await f.runtime.sync(f.user.id, f.project.id);
    const failed = (await f.get().expect(200)).body.items[0].proposal.execution;
    expect(failed).toMatchObject({
      binding: "linked",
      canExecute: true,
      progress: { status: "failed", executionId: old.id },
    });
    const mutationId = randomUUID();
    await f.execute(mutationId).expect(201);
    await f.execute(mutationId).expect(201);
    const next = (await f.get().expect(200)).body.items[0].proposal.execution;
    expect(next.progress.status).toBe("queued");
    expect(next.progress.executionId).not.toBe(old.id);
    expect(
      (
        await prisma.workflowExecution.findUniqueOrThrow({
          where: { id: old.id },
        })
      ).status,
    ).toBe("failed");
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(4);
  } finally {
    await f.cleanup();
  }
}, 30000);

it("同工具的无关执行不会被标成这条确认尚未开始", async () => {
  const f = await fixture();
  try {
    const proposal = await prisma.workflowProposal.findUniqueOrThrow({
      where: { id: f.proposal.id },
    });
    const nodeVersionId = String(
      object(proposal.evidence).acceptedNodeVersionId,
    );
    await prisma.workflowExecution.create({
      data: {
        projectId: f.project.id,
        userId: f.user.id,
        conversationId: f.conversation.id,
        toolNodeId: f.toolId,
        nodeVersionId,
        executionKey: randomUUID(),
        status: "failed",
        requestSnapshot: { mutationId: randomUUID() },
      },
    });
    expect(
      (await f.get().expect(200)).body.items[0].proposal.execution,
    ).toMatchObject({
      binding: "unrecorded",
      canExecute: false,
      progress: null,
      result: null,
    });
    expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
}, 30000);

it("只读成员自己的进度可读取，归档与只读均不提供停止或重试动作", async () => {
  const f = await fixture();
  try {
    const chat = await prisma.agentConversation.create({
      data: {
        projectId: f.project.id,
        createdById: f.viewer.id,
        mode: "workflow",
        title: "成员自己的执行历史",
      },
    });
    const execution = await prisma.workflowExecution.create({
      data: {
        projectId: f.project.id,
        userId: f.viewer.id,
        conversationId: chat.id,
        toolNodeId: f.toolId,
        status: "running",
        executionKey: randomUUID(),
        requestSnapshot: {},
        expectedAttempts: 1,
      },
    });
    const task = await prisma.generationTask.create({
      data: {
        projectId: f.project.id,
        userId: f.viewer.id,
        taskType: "t2i",
        input: {},
        status: "QUEUED",
      },
    });
    await prisma.workflowAttempt.create({
      data: {
        projectId: f.project.id,
        executionId: execution.id,
        toolNodeId: f.toolId,
        ordinal: 1,
        executionKey: randomUUID(),
        generationTaskId: task.id,
        status: "running",
        requestSnapshot: {},
      },
    });
    const message = await prisma.agentMessage.create({
      data: {
        conversationId: chat.id,
        role: "ASSISTANT",
        executionId: execution.id,
        content: "原任务已提交",
        context: {
          executionReceipt: { nodeId: f.toolId, status: "submitted" },
        },
      },
    });
    const read = await f.get(f.viewer.id, chat.id).expect(200);
    expect(read.body.items[0].context.executionProgress).toMatchObject({
      status: "queued",
      counts: { queued: 1 },
      cancelTaskIds: [],
    });
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: f.workspace.id,
          userId: f.viewer.id,
        },
      },
      data: { role: "EDITOR" },
    });
    await prisma.generationTask.update({
      where: { id: task.id },
      data: { userId: f.user.id },
    });
    expect(
      (await f.get(f.viewer.id, chat.id).expect(200)).body.items[0].context
        .executionProgress.cancelTaskIds,
    ).toEqual([task.id]);
    await f.cancel(task.id, f.viewer.id).expect(200);
    expect(
      (
        await prisma.agentMessage.findUniqueOrThrow({
          where: { id: message.id },
        })
      ).updatedAt,
    ).toEqual(message.updatedAt);
    await f.execute().expect(201);
    await prisma.project.update({
      where: { id: f.project.id },
      data: { archived: true },
    });
    expect(
      (await f.get().expect(200)).body.items[0].proposal.execution,
    ).toMatchObject({ canExecute: false, progress: { cancelTaskIds: [] } });
    expect(f.model.generateJson).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
}, 30000);

it("实际取消只停止剩余任务，保留已完成结果，重复请求不重复安排取消", async () => {
  const f = await fixture();
  try {
    await f.execute().expect(201);
    const tasks = await prisma.generationTask.findMany({
      where: { projectId: f.project.id },
      orderBy: { createdAt: "asc" },
    });
    const first = tasks[0],
      remaining = tasks[1];
    if (!first || !remaining) throw new Error("缺少两份任务");
    const assetId = randomUUID();
    await prisma.designAsset.create({
      data: {
        id: assetId,
        rootAssetId: assetId,
        projectId: f.project.id,
        generationTaskId: first.id,
        operation: "GENERATED",
        url: `s3://verification/${assetId}.png`,
        width: 600,
        height: 800,
      },
    });
    await prisma.generationTask.update({
      where: { id: first.id },
      data: {
        status: "SUCCEEDED",
        output: { images: [{ assetId, width: 600, height: 800 }] },
      },
    });
    await f.runtime.sync(f.user.id, f.project.id);
    await f.cancel(remaining.id, f.viewer.id).expect(403);
    await f.cancel(remaining.id).expect(200);
    await f.cancel(remaining.id).expect(200);
    expect(f.jobs.cancel).toHaveBeenCalledTimes(1);
    await f.runtime.sync(f.user.id, f.project.id);
    const record = (await f.get().expect(200)).body.items[0].proposal.execution;
    expect(record.progress).toMatchObject({
      status: "partial_failed",
      counts: { completed: 1, canceled: 1 },
      cancelTaskIds: [],
    });
    expect(
      record.result.images.map((image: { assetId: string }) => image.assetId),
    ).toEqual([assetId]);
    expect(await prisma.designAsset.count({ where: { id: assetId } })).toBe(1);
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(2);
    expect(f.model.generateJson).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
}, 30000);
