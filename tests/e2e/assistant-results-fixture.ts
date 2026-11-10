import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import type { WorkflowExecutionResult } from "../../packages/shared/src/workflow-execution-result";
import type { WorkflowMessageView } from "../../apps/web/src/modules/board/agent/agent-api";
import type {
  CanvasDocumentView,
  CanvasSave,
} from "../../packages/shared/src/canvas-workspace";
import { prepareZhiya, loadZhiya, openZhiya } from "./zhiya-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

export async function assistantResultsFixture(
  page: Page,
  options: {
    width?: number;
    count?: number;
    status?: WorkflowExecutionResult["status"];
    detached?: boolean;
    canEdit?: boolean;
    images?: number;
    receipts?: number;
  } = {},
) {
  const width = options.width ?? 1440,
    base = await prepareZhiya(page, {
      realClock: true,
      count: options.count ?? 3,
      canEdit: options.canEdit ?? true,
      viewport: { width, height: width === 320 ? 640 : 900 },
    });
  const pictures = await Promise.all(
    ["coat-original.png", "coat-cuff.png"].map((file) =>
      readFile(`apps/web/public/prototype-assets/impeccable/${file}`),
    ),
  );
  let graph = {
    ...base.graph,
    nodes: base.graph.nodes.map((node) => ({ ...node })),
  };
  const result: WorkflowExecutionResult = {
    version: 1,
    executionId: "result-batch-1",
    toolNodeId: "generation-tool",
    status: options.status ?? "completed",
    completedAt: NOW,
    attempts: {
      completed: options.images ?? 2,
      failed: options.status === "partial_failed" ? 1 : 0,
      canceled: options.status === "canceled" ? 1 : 0,
    },
    images: Array.from({ length: options.images ?? 2 }, (_, index) => ({
      assetId: `result-${index + 1}`,
      nodeId: `result-node-${index + 1}`,
      title: index === 0 ? "藏蓝通勤外套" : `袖口细节方案 ${index + 1}`,
      width: pictures[index % 2]?.readUInt32BE(16) ?? 600,
      height: pictures[index % 2]?.readUInt32BE(20) ?? 800,
    })),
  };
  if (!options.detached)
    graph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        ...result.images.map((image, index) => ({
          id: image.nodeId ?? `result-node-${index}`,
          kind: "asset" as const,
          type: "candidate" as const,
          title: image.title,
          status: "completed",
          createdAt: NOW,
          updatedAt: NOW,
          x: index * 360,
          y: 1200,
          payload: {
            assetId: image.assetId,
            executionId: result.executionId,
            imageUrl: `/api/design-assets/${image.assetId}/content`,
            width: image.width,
            height: image.height,
          },
        })),
      ],
    };
  const receipt = (index: number): WorkflowMessageView => ({
    id: `result-receipt-${index}`,
    conversationId: "visual-chat",
    role: "assistant",
    status: "completed",
    origin: "execution_result",
    executionId: index === 0 ? result.executionId : `batch-${index}`,
    content:
      result.status === "partial_failed"
        ? "本次部分图片完成，其余操作未完成。"
        : result.images.length
          ? "本次图片已完成，可以继续修改。"
          : "本次执行已取消。",
    context: {
      executionResult: {
        ...structuredClone(result),
        executionId: index === 0 ? result.executionId : `batch-${index}`,
      },
    },
    createdAt: NOW,
    updatedAt: NOW,
    referencedNodeIds: [],
    clientRequestId: null,
    replyToId: null,
    generationTaskId: null,
    error: null,
  });
  const state = {
    ...base,
    result,
    messages: Array.from({ length: options.receipts ?? 1 }, (_, index) =>
      receipt(index),
    ),
    sends: [] as { content: string; referencedNodeIds: string[] }[],
    assetsRead: [] as string[],
    failThumbnails: false,
    failContent: false,
  };
  let document: CanvasDocumentView = {
    projectId: PROJECT,
    mode: "canvas",
    revision: 0,
    formatVersion: 1,
    initializedFrom: "workflow",
    canEdit: options.canEdit ?? true,
    snapshot: {},
    bindings: graph.nodes.map((node) => ({
      shapeId: `shape:canvas-${node.id}`,
      nodeId: node.id,
      removed: false,
    })),
  };
  await page.route(`**/api/projects/${PROJECT}/workflow**`, (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/tools")
        ? { agentVersion: 2, tools: [] }
        : graph,
    }),
  );
  await page.route(`**/api/projects/${PROJECT}/canvas**`, (route) => {
    if (route.request().method() === "PATCH") {
      const save = route.request().postDataJSON() as CanvasSave;
      document = {
        ...document,
        revision: document.revision + 1,
        snapshot: save.snapshot,
        bindings: save.bindings.map((binding) => ({
          ...binding,
          removed: false,
        })),
      };
      state.saves.push(save);
    }
    return route.fulfill({ json: document });
  });
  await page.route(
    "**/api/agent-conversations/visual-chat/messages*",
    (route) =>
      route.fulfill({ json: { items: state.messages, nextCursor: null } }),
  );
  await page.route(
    "**/api/agent-conversations/visual-chat/workflow-messages",
    (route) => {
      const body = route.request().postDataJSON();
      state.sends.push(body);
      return route.fulfill({
        json: {
          userMessage: {
            id: "follow-up-user",
            conversationId: "visual-chat",
            role: "user",
            status: "completed",
            content: body.content,
            clientRequestId: body.clientRequestId,
            referencedNodeIds: body.referencedNodeIds,
            createdAt: NOW,
            updatedAt: NOW,
          },
          assistantMessage: {
            id: "follow-up-assistant",
            conversationId: "visual-chat",
            role: "assistant",
            status: "completed",
            content: "已收到这张图片的修改要求。",
            referencedNodeIds: body.referencedNodeIds,
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
      });
    },
  );
  await page.route(/\/api\/design-assets\/[^/]+(?:\/.*)?$/, (route) => {
    const path = new URL(route.request().url()).pathname,
      id = path.split("/")[3] ?? "",
      image = result.images.find((image) => image.assetId === id);
    if (!image) return route.fallback();
    state.assetsRead.push(path);
    if (path.endsWith("/thumbnail") || path.endsWith("/content"))
      return (state.failThumbnails && path.endsWith("/thumbnail")) ||
        (state.failContent && path.endsWith("/content"))
        ? route.fulfill({ status: 404 })
        : route.fulfill({
            contentType: "image/png",
              body: pictures[(Number(id.split("-")[1] ?? 1) - 1) % 2],
          });
    if (path.endsWith("/feedback"))
      return route.fulfill({
        json: { revision: 0, annotations: [], comments: [] },
      });
    if (path.endsWith("/versions"))
      return route.fulfill({
        json: {
          items: [
            {
              id,
              projectId: PROJECT,
              operation: "generated",
              rootAssetId: id,
              parentAssetId: null,
              restoredFromAssetId: null,
              width: image.width,
              height: image.height,
              url: `/api/design-assets/${id}/content`,
              thumbnailUrl: `/api/design-assets/${id}/thumbnail`,
              createdAt: NOW,
              archivedAt: null,
              seed: null,
            },
          ],
          nextCursor: null,
        },
      });
    return route.fallback();
  });
  return Object.assign(state, {
    open: async () => {
      await loadZhiya(page);
      await openZhiya(page);
    },
    setGraph: (next: typeof graph) => {
      graph = next;
    },
    getGraph: () => graph,
  });
}
