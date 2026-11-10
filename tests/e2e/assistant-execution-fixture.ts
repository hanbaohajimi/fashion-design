import type { Page } from "@playwright/test";
import type {
  WorkflowExecutionProgress,
  WorkflowProposalExecution,
} from "../../packages/shared/src/workflow-execution-progress";
import type { WorkflowProposal } from "../../apps/web/src/modules/board/workflow/workflow-api";
import { assistantResultsFixture } from "./assistant-results-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

export async function assistantExecutionFixture(
  page: Page,
  options: {
    width?: number;
    legacy?: boolean;
    canEdit?: boolean;
    count?: number;
  } = {},
) {
  const base = await assistantResultsFixture(page, {
    width: options.width ?? 1440,
    detached: true,
    canEdit: options.canEdit ?? true,
    count: options.count ?? 3,
  });
  const progress: WorkflowExecutionProgress = {
    version: 1,
    executionId: base.result.executionId,
    toolNodeId: "generation-tool",
    title: "藏蓝风衣方案",
    operation: "image",
    status: "queued",
    updatedAt: new Date().toISOString(),
    counts: {
      total: 2,
      preparing: 0,
      queued: 2,
      running: 0,
      completed: 0,
      failed: 0,
      canceled: 0,
    },
    cancelTaskIds: options.canEdit === false ? [] : ["task-1", "task-2"],
  };
  const binding: WorkflowProposalExecution = {
    version: 1,
    binding: "linked",
    nodeVersionId: "accepted-version",
    canExecute: false,
    progress,
    result: null,
  };
  const proposal: WorkflowProposal = {
    id: "approved-proposal",
    schemaVersion: 2,
    baseRevision: 1,
    status: "accepted",
    toolNodeId: progress.toolNodeId,
    content: "保留立领与藏蓝色",
    rationale: "明确两张方案",
    createdAt: NOW,
    referencedNodeIds: [],
    operations: [],
    execution: binding,
    action: {
      type: "create_tool",
      toolKey: "generate_design",
      toolVersion: "1",
      title: "藏蓝风衣方案",
      parameters: { prompt: "保留立领与藏蓝色", count: 2 },
      inputs: [],
    },
  };
  base.setGraph({
    ...base.getGraph(),
    nodes: [
      ...base.getGraph().nodes,
      {
        id: progress.toolNodeId,
        kind: "tool",
        type: "generate_design",
        title: "后来的红色夹克",
        status: "running",
        createdAt: NOW,
        updatedAt: NOW,
        payload: {
          toolKey: "generate_design",
          toolVersion: "1",
          params: { prompt: "后来红色夹克", count: 4 },
        },
        x: 800,
        y: 0,
      },
    ],
  });
  base.messages = [
    {
      id: "submitted-message",
      conversationId: "visual-chat",
      role: "assistant",
      status: "completed",
      origin: "user",
      executionId: progress.executionId,
      content: options.legacy
        ? "请查看本次确认执行记录。"
        : "本次操作已提交，可查看进度与结果。",
      referencedNodeIds: [],
      context: {
        executionReceipt: { status: "submitted", nodeId: progress.toolNodeId },
        executionProgress: progress,
      },
      ...(options.legacy ? { proposal } : {}),
      createdAt: NOW,
      updatedAt: NOW,
      error: null,
      replyToId: null,
      clientRequestId: null,
      generationTaskId: null,
    },
  ];
  const state = Object.assign(base, {
    progress,
    binding,
    proposal,
    messageReads: 0,
    cancelRequests: [] as string[],
    executionRequests: [] as unknown[],
    failMessages: false,
    failCancel: false,
    holdCancel: null as Promise<void> | null,
    holdMessages: null as Promise<void> | null,
  });
  const update = () => {
    progress.updatedAt = new Date().toISOString();
    const message = state.messages[0];
    if (!message) throw new Error("缺少执行消息");
    state.messages[0] = {
      ...message,
      context: {
        ...message.context,
        executionProgress: structuredClone(progress),
      },
      ...(options.legacy
        ? {
            proposal: {
              ...proposal,
              execution: { ...binding, progress: structuredClone(progress) },
            },
          }
        : {}),
    };
    state.activity.preparing =
      progress.counts.queued + progress.counts.preparing;
    state.activity.queued = progress.counts.queued;
    state.activity.executing = progress.counts.running;
  };
  update();
  await page.route(
    "**/api/agent-conversations/visual-chat/messages*",
    async (route) => {
      state.messageReads++;
      if (state.holdMessages) await state.holdMessages;
      return state.failMessages
        ? route.fulfill({ status: 503, json: { message: "执行状态暂不可用" } })
        : route.fulfill({ json: { items: state.messages, nextCursor: null } });
    },
  );
  await page.route("**/api/generations/task-*", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const id = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    state.cancelRequests.push(id);
    if (state.holdCancel) await state.holdCancel;
    if (state.failCancel && id === "task-2")
      return route.fulfill({
        status: 503,
        json: { message: "停止结果尚未确认" },
      });
    if (progress.cancelTaskIds.includes(id)) {
      progress.cancelTaskIds = progress.cancelTaskIds.filter(
        (value) => value !== id,
      );
      if (progress.counts.queued) progress.counts.queued--;
      else if (progress.counts.running) progress.counts.running--;
      progress.counts.canceled++;
      if (!progress.counts.queued && !progress.counts.running)
        progress.status = "processing";
      update();
    }
    return route.fulfill({ json: { id, status: "canceled" } });
  });
  await page.route(
    `**/api/projects/${PROJECT}/workflow/nodes/*/execute`,
    (route) => {
      state.executionRequests.push(route.request().postDataJSON());
      return route.fulfill({ json: state.getGraph() });
    },
  );
  await page.route(`**/api/projects/${PROJECT}/tasks**`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: `workflow:${progress.executionId}`,
            domain: "workflow",
            title: progress.title,
            rawStatus: progress.status,
            status: progress.status,
            group: ["queued", "running", "processing", "preparing"].includes(
              progress.status,
            )
              ? "running"
              : "ended",
            createdAt: NOW,
            updatedAt: progress.updatedAt,
            objectId: progress.toolNodeId,
            conversationId: "visual-chat",
            href: `/${PROJECT}?conversationId=visual-chat`,
            actions: progress.cancelTaskIds.map((id) => ({
              kind: "cancel_generation",
              targetId: id,
            })),
          },
        ],
        nextCursor: null,
        counts: {
          running:
            progress.counts.queued +
            progress.counts.running +
            progress.counts.preparing
              ? 1
              : 0,
          attention: 0,
        },
        activity: state.activity,
      },
    }),
  );
  const finish = (
    status: "completed" | "partial_failed" | "failed" | "canceled",
    images = status === "completed" ? 2 : 0,
    receipt = true,
  ) => {
    progress.status = status;
    progress.counts = {
      total: 2,
      queued: 0,
      running: 0,
      preparing: 0,
      completed: images,
      failed:
        status === "failed" || status === "partial_failed" ? 2 - images : 0,
      canceled: status === "canceled" ? 2 - images : 0,
    };
    progress.cancelTaskIds = [];
    const result = {
      ...state.result,
      status,
      images: state.result.images.slice(0, images),
      attempts: {
        completed: images,
        failed: progress.counts.failed,
        canceled: progress.counts.canceled,
      },
    };
    binding.result = result;
    state.setGraph({
      ...state.getGraph(),
      revision: state.getGraph().revision + 1,
      nodes: [
        ...state
          .getGraph()
          .nodes.filter((node) => !node.id.startsWith("result-node-")),
        ...result.images.map((image, index) => ({
          id: image.nodeId ?? `result-node-${index}`,
          kind: "asset" as const,
          type: "candidate" as const,
          title: image.title,
          status: "completed",
          payload: {
            assetId: image.assetId,
            imageUrl: `/api/design-assets/${image.assetId}/content`,
            executionId: progress.executionId,
          },
          x: index * 400,
          y: 500,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      ],
    });
    update();
    if (receipt)
      state.messages.push({
        id: "terminal-receipt",
        conversationId: "visual-chat",
        role: "assistant",
        origin: "execution_result",
        executionId: progress.executionId,
        status: "completed",
        content:
          status === "canceled" ? "本次执行已取消。" : "本次执行结果已记录。",
        referencedNodeIds: [],
        context: { executionResult: result },
        createdAt: NOW,
        updatedAt: new Date().toISOString(),
        replyToId: null,
        clientRequestId: null,
        generationTaskId: null,
        error: null,
      });
  };
  return Object.assign(state, { update, finish });
}
