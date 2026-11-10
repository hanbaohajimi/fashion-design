import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@fashion/db";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { AgentConversationsController } from "../agent-conversations/agent-conversations.controller";
import { AgentConversationsService } from "../agent-conversations/agent-conversations.service";
import { RateLimitGuard } from "../../security/rate-limit.guard";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import { WorkflowAssistantService } from "./workflow-assistant.service";
import {
  buildWorkflowExecutionResults,
  workflowExecutionResultText,
} from "./workflow-execution-result";

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const createdUsers: string[] = [];
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("缺少隔离测试数据");
  return value;
};
afterEach(async () => {
  const ids = createdUsers.splice(0);
  await prisma.workflowAttempt.deleteMany({
    where: { project: { workspace: { ownerId: { in: ids } } } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});
async function fixture() {
  const user = await prisma.user.create({
    data: {
      email: `result-receipt-${randomUUID()}@example.test`,
      ownedWorkspaces: {
        create: {
          name: "执行结果验收",
          projects: {
            create: [
              { name: "设计项目", workflowAgentVersion: 1 },
              { name: "其他项目" },
            ],
          },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  createdUsers.push(user.id);
  const workspace = required(user.ownedWorkspaces[0]),
    project = required(
      workspace.projects.find((project) => project.name === "设计项目"),
    ),
    other = required(
      workspace.projects.find((project) => project.name === "其他项目"),
    );
  const member = await prisma.user.create({
    data: { email: `result-reader-${randomUUID()}@example.test` },
  });
  createdUsers.push(member.id);
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: member.id, role: "VIEWER" },
  });
  const conversation = await prisma.agentConversation.create({
    data: {
      projectId: project.id,
      createdById: user.id,
      mode: "workflow",
      title: "结果回看",
    },
  });
  await prisma.workflowGraph.create({ data: { projectId: project.id } });
  const tool = await prisma.workflowNode.create({
    data: {
      id: randomUUID(),
      projectId: project.id,
      kind: "tool",
      type: "generate_design",
      title: "方案生成",
      payload: { toolKey: "generate_design", toolVersion: "1" },
      x: 0,
      y: 0,
    },
  });
  const access = new ProjectAccessPolicy(prisma),
    workflows = new WorkflowsService(prisma, access);
  const model = {
    generateJson: vi.fn(async () => {
      throw new Error("结果回执不应调用模型");
    }),
  };
  const assistant = new WorkflowAssistantService(
    prisma,
    workflows,
    {} as never,
    {} as never,
    {} as never,
    model as never,
    undefined,
    access,
  );
  const service = new AgentConversationsService(
    prisma,
    model as never,
    {} as never,
    {} as never,
    undefined,
    assistant,
    access,
  );
  const module = await Test.createTestingModule({
    controllers: [AgentConversationsController],
    providers: [{ provide: AgentConversationsService, useValue: service }],
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
  const get = (
    userId = user.id,
    conversationId = conversation.id,
    query = "",
  ) =>
    request(app.getHttpServer())
      .get(`/agent-conversations/${conversationId}/messages?limit=20${query}`)
      .set("x-test-user", userId);
  async function execution(
    status = "completed",
    actor = user.id,
    chat = conversation.id,
  ) {
    return prisma.workflowExecution.create({
      data: {
        projectId: project.id,
        toolNodeId: tool.id,
        userId: actor,
        conversationId: chat,
        executionKey: randomUUID(),
        status,
        requestSnapshot: {},
        completedAt: new Date(),
      },
    });
  }
  async function output(executionId: string, ordinal: number, title: string) {
    const task = await prisma.generationTask.create({
      data: {
        userId: user.id,
        projectId: project.id,
        taskType: "t2i",
        status: "SUCCEEDED",
        input: {},
      },
    });
    const assetId = randomUUID();
    const asset = await prisma.designAsset.create({
      data: {
        id: assetId,
        rootAssetId: assetId,
        projectId: project.id,
        generationTaskId: task.id,
        operation: "GENERATED",
        url: `s3://verification/${assetId}.png`,
        width: 600,
        height: 800,
      },
    });
    await prisma.generationTask.update({
      where: { id: task.id },
      data: { output: { images: [{ assetId }] } },
    });
    const attempt = await prisma.workflowAttempt.create({
      data: {
        projectId: project.id,
        toolNodeId: tool.id,
        executionId,
        generationTaskId: task.id,
        ordinal,
        executionKey: randomUUID(),
        status: "completed",
        requestSnapshot: {},
      },
    });
    const node = await prisma.workflowNode.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        kind: "asset",
        type: "candidate",
        title,
        payload: { assetId, attemptId: attempt.id, executionId },
        x: ordinal * 100,
        y: 0,
        status: "completed",
      },
    });
    await prisma.workflowEdge.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        sourceNodeId: tool.id,
        targetNodeId: node.id,
        sourcePort: "out",
        targetPort: "source",
      },
    });
    return { task, asset, attempt, node };
  }
  async function receipt(
    executionId: string,
    stored?: unknown,
    actorConversation = conversation.id,
  ) {
    return prisma.agentMessage.create({
      data: {
        conversationId: actorConversation,
        role: "ASSISTANT",
        origin: "execution_result",
        executionId,
        content: "执行已结束",
        context: json(stored ? { executionResult: stored } : {}),
      },
    });
  }
  return {
    user,
    member,
    workspace,
    project,
    other,
    conversation,
    tool,
    assistant,
    model,
    app,
    get,
    execution,
    output,
    receipt,
    cleanup: async () => {
      await app.close();
      await prisma.workflowAttempt.deleteMany({
        where: { projectId: project.id },
      });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.user.delete({ where: { id: member.id } });
    },
  };
}

it("仍在执行的任务不提前发布终态回执或调用后台分析", async () => {
  const f = await fixture();
  try {
    const execution = await f.execution("running");
    const event = await prisma.workflowOutbox.create({ data: { projectId: f.project.id, executionId: execution.id, eventKey: randomUUID(), eventType: "execution.terminal", payload: {} } });
    expect(await f.assistant.observeExecution(event.id)).toBe("deferred");
    expect(await prisma.agentMessage.count({ where: { conversationId: f.conversation.id } })).toBe(0);
    expect(f.model.generateJson).not.toHaveBeenCalled();
  } finally { await f.cleanup(); }
}, 30000);

it("真实终态回执固定本次图片，重复观察和后来重试不改写旧结果", async () => {
  const f = await fixture();
  try {
    const execution = await f.execution(),
      first = await f.output(execution.id, 1, "第一版"),
      second = await f.output(execution.id, 2, "第二版");
    const event = await prisma.workflowOutbox.create({
      data: {
        projectId: f.project.id,
        executionId: execution.id,
        eventKey: randomUUID(),
        eventType: "execution.terminal",
        payload: {},
      },
    });
    await f.assistant.observeExecution(event.id);
    await f.assistant.observeExecution(event.id);
    const page = await f.get().expect(200),
      fact = page.body.items.find(
        (message: { origin: string }) => message.origin === "execution_result",
      );
    expect(
      fact.context.executionResult.images.map(
        (image: { assetId: string }) => image.assetId,
      ),
    ).toEqual([first.asset.id, second.asset.id]);
    const stored = await prisma.agentMessage.findUniqueOrThrow({
      where: { id: fact.id },
    });
    const next = await f.execution();
    await f.output(next.id, 3, "后来的重试图");
    await prisma.workflowNode.update({
      where: { id: first.node.id },
      data: { title: "已经改名", payload: { assetId: second.asset.id } },
    });
    const reread = await f.get().expect(200);
    expect(
      reread.body.items.find(
        (message: { id: string }) => message.id === fact.id,
      ).context.executionResult,
    ).toEqual(fact.context.executionResult);
    expect(
      (await prisma.agentMessage.findUniqueOrThrow({ where: { id: fact.id } }))
        .updatedAt,
    ).toEqual(stored.updatedAt);
    expect(
      await prisma.agentMessage.count({
        where: { conversationId: f.conversation.id },
      }),
    ).toBe(1);
    expect(f.model.generateJson).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
}, 30000);

it("旧回执按尝试与真实任务恢复，排除其他批次、跨项目和伪造输出", async () => {
  const f = await fixture();
  try {
    const execution = await f.execution(),
      first = await f.output(execution.id, 1, "原始结果");
    const next = await f.execution(),
      unrelated = await f.output(next.id, 2, "另一次结果");
    const foreignId = randomUUID();
    await prisma.designAsset.create({
      data: {
        id: foreignId,
        rootAssetId: foreignId,
        projectId: f.other.id,
        operation: "GENERATED",
        url: "s3://verification/foreign.png",
      },
    });
    await prisma.generationTask.update({
      where: { id: first.task.id },
      data: {
        output: {
          images: [
            { assetId: first.asset.id },
            { assetId: first.asset.id },
            { assetId: unrelated.asset.id },
            { assetId: foreignId },
            { assetId: "missing" },
          ],
        },
      },
    });
    const message = await f.receipt(execution.id);
    await prisma.workflowNode.delete({ where: { id: first.node.id } });
    const response = await f.get().expect(200),
      result = response.body.items.find(
        (item: { id: string }) => item.id === message.id,
      ).context.executionResult;
    expect(result.images).toEqual([
      {
        assetId: first.asset.id,
        nodeId: null,
        title: "方案 1",
        width: 600,
        height: 800,
      },
    ]);
    expect(
      (
        await prisma.agentMessage.findUniqueOrThrow({
          where: { id: message.id },
        })
      ).context,
    ).toEqual({});
    expect(f.model.generateJson).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
}, 30000);

it("真实图片变换结果可回看，失败与取消不会构造图片或成功状态", async () => {
  const f = await fixture();
  let transformAttempt: string | undefined;
  try {
    const execution = await f.execution("partial_failed"),
      first = await f.output(execution.id, 1, "已完成方案");
    const attempt = await prisma.workflowAttempt.create({
      data: {
        projectId: f.project.id,
        toolNodeId: f.tool.id,
        executionId: execution.id,
        ordinal: 2,
        executionKey: randomUUID(),
        status: "completed",
        requestSnapshot: {},
      },
    });
    transformAttempt = attempt.id;
    const assetId = randomUUID();
    await prisma.designAsset.create({
      data: {
        id: assetId,
        rootAssetId: assetId,
        projectId: f.project.id,
        operation: "TRANSFORM",
        url: "s3://verification/transform.png",
        width: 400,
        height: 600,
      },
    });
    await prisma.imageTransformResult.create({
      data: { attemptId: attempt.id, assetId },
    });
    await prisma.workflowAttempt.createMany({
      data: ["failed", "canceled"].map((status, index) => ({
        projectId: f.project.id,
        toolNodeId: f.tool.id,
        executionId: execution.id,
        ordinal: index + 3,
        executionKey: randomUUID(),
        status,
        requestSnapshot: {},
      })),
    });
    const result = (
      await buildWorkflowExecutionResults(prisma, f.project.id, [execution])
    ).get(execution.id);
    expect(result).toMatchObject({
      status: "partial_failed",
      attempts: { completed: 2, failed: 1, canceled: 1 },
    });
    expect(result?.images.map((image) => image.assetId)).toEqual([
      first.asset.id,
      assetId,
    ]);
    const canceled = await f.execution("canceled");
    expect(
      (
        await buildWorkflowExecutionResults(prisma, f.project.id, [canceled])
      ).get(canceled.id)?.images,
    ).toEqual([]);
    expect(workflowExecutionResultText("canceled", 0)).toBe("本次执行已取消。");
    expect(workflowExecutionResultText("partial_failed", 1)).toContain(
      "其余操作未完成",
    );
  } finally {
    if (transformAttempt)
      await prisma.imageTransformResult.deleteMany({
        where: { attemptId: transformAttempt },
      });
    await f.cleanup();
  }
}, 30000);

it("消息HTTP权限与分页保持，成员自己的旧结果可只读查看且不读取别人的执行", async () => {
  const f = await fixture();
  try {
    const execution = await f.execution();
    await f.output(execution.id, 1, "个人方案");
    await f.receipt(execution.id);
    await f.get(f.member.id).expect(403);
    const own = await prisma.agentConversation.create({
      data: {
        projectId: f.project.id,
        createdById: f.member.id,
        mode: "workflow",
        title: "成员结果",
      },
    });
    const ownExecution = await f.execution("completed", f.member.id, own.id);
    await f.output(ownExecution.id, 2, "成员的结果");
    await f.receipt(ownExecution.id, undefined, own.id);
    await f.receipt(execution.id, undefined, own.id);
    const response = await f.get(f.member.id, own.id).expect(200);
    expect(
      response.body.items.find(
        (item: { executionId: string }) => item.executionId === ownExecution.id,
      ).context.executionResult.images,
    ).toHaveLength(1);
    expect(
      response.body.items.find(
        (item: { executionId: string }) => item.executionId === execution.id,
      ).context.executionResult,
    ).toBeUndefined();
    await prisma.agentMessage.createMany({
      data: Array.from({ length: 22 }, (_, index) => ({
        conversationId: own.id,
        role: "USER" as const,
        content: `后续消息 ${index}`,
        createdAt: new Date(Date.now() + 1000 + index * 1000),
      })),
    });
    const firstPage = await f.get(f.member.id, own.id).expect(200);
    expect(firstPage.body.items).toHaveLength(20);
    expect(
      firstPage.body.items.every(
        (item: { executionId: string | null }) => !item.executionId,
      ),
    ).toBe(true);
    const older = await f
      .get(f.member.id, own.id, `&cursor=${firstPage.body.nextCursor}`)
      .expect(200);
    expect(
      older.body.items.find(
        (item: { executionId: string }) => item.executionId === ownExecution.id,
      ).context.executionResult.images,
    ).toHaveLength(1);
    expect(older.body.nextCursor).toBeNull();
    await prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId: f.workspace.id,
          userId: f.member.id,
        },
      },
    });
    await f.get(f.member.id, own.id).expect(403);
    expect(f.model.generateJson).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
}, 30000);
