import type { Page } from "@playwright/test";
import {
  canvasCommandSchema,
  type CanvasCommand,
  type CanvasDocumentView,
  type CanvasSave,
} from "../../packages/shared/src/canvas-workspace";
import { prepareZhiya, loadZhiya, openZhiya } from "./zhiya-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

export async function assistantImageUploadFixture(
  page: Page,
  options: {
    width?: number;
    count?: number;
    canEdit?: boolean;
    referenceSize?: { width: number; height: number };
  } = {},
) {
  const width = options.width ?? 1440;
  const base = await prepareZhiya(page, {
    count: options.count ?? 3,
    realClock: true,
    canEdit: options.canEdit ?? true,
    viewport: { width, height: width === 320 ? 640 : 900 },
  });
  let graph = base.graph;
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
  const files = new Map<
    string,
    {
      id: string;
      name: string;
      mimeType: string;
      status: string;
      size: number;
      width: number;
      height: number;
      error: null;
      thumbnail256Url: string;
      thumbnail1024Url: string;
    }
  >();
  const state = {
    ...base,
    sign: [] as Record<string, unknown>[],
    puts: [] as Buffer[],
    complete: [] as string[],
    imports: [] as CanvasCommand[],
    placements: [] as CanvasCommand[],
    sends: [] as {
      referencedNodeIds: string[];
      content: string;
      clientRequestId: string;
    }[],
    failedPut: false,
    failSave: false,
    failedThumbnail: false,
    loseImport: false,
    failImportCode: 0,
    failPlacementCode: 0,
    losePlacement: false,
    holdPlacement: null as Promise<void> | null,
    holdSign: null as Promise<void> | null,
    holdImport: null as Promise<void> | null,
  };
  const receipts = new Map<string, string>();
  const placedReceipts = new Set<string>();
  await page.route(`**/api/projects/${PROJECT}/workflow**`, (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/tools")
        ? { agentVersion: 2, tools: [] }
        : graph,
    }),
  );
  await page.route("**/api/files/sign-upload", async (route) => {
    const input = route.request().postDataJSON();
    state.sign.push(input);
    if (state.holdSign) await state.holdSign;
    const id = `file-${String(input.sha256).slice(0, 16)}`;
    let file = files.get(id);
    if (!file) {
      file = {
        id,
        name: input.name,
        mimeType: input.mimeType,
        size: input.size,
        width: options.referenceSize?.width ?? 24,
        height: options.referenceSize?.height ?? 32,
        status: "PENDING",
        error: null,
        thumbnail256Url: `/api/files/${id}/thumbnail/256`,
        thumbnail1024Url: `/api/files/${id}/thumbnail/1024`,
      };
      files.set(id, file);
    }
    return route.fulfill({
      json: {
        deduplicated: file.status === "READY",
        file,
        upload:
          file.status === "READY"
            ? null
            : {
                url: `http://127.0.0.1:3000/__chat-reference/${id}`,
                method: "PUT",
                headers: { "Content-Type": input.mimeType },
              },
      },
    });
  });
  await page.route("**/__chat-reference/*", (route) => {
    const body = route.request().postDataBuffer();
    if (body) state.puts.push(body);
    if (state.failedPut) {
      state.failedPut = false;
      return route.fulfill({ status: 503, body: "temporary unavailable" });
    }
    return route.fulfill({ status: 200 });
  });
  await page.route(/\/api\/files\/[^/]+(?:\/.*)?$/, (route) => {
    const path = new URL(route.request().url()).pathname,
      id = path.split("/")[3] ?? "",
      file = files.get(id);
    if (path.includes("/thumbnail/"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#eeeae1"/><path d="m160 200 140-60 140 60 70 150-100 35-20 340H210l-20-340-100-35Z" fill="#203449"/></svg>',
      });
    if (!file) return route.fallback();
    if (path.endsWith("/complete")) {
      file.status = state.failedThumbnail ? "FAILED" : "READY";
      state.failedThumbnail = false;
      state.complete.push(id);
    }
    return route.fulfill({ json: file });
  });
  await page.route(`**/api/projects/${PROJECT}/canvas**`, async (route) => {
    if (route.request().url().endsWith("/commands")) {
      const command = canvasCommandSchema.parse(route.request().postDataJSON());
      if (command.type === "place_reference_image") {
        state.placements.push(command);
        if (state.failPlacementCode)
          return route.fulfill({
            status: state.failPlacementCode,
            json: { message: "参考图片暂时不可放入白板" },
          });
        if (!placedReceipts.has(command.mutationId)) {
          placedReceipts.add(command.mutationId);
          if (
            !document.bindings.some(
              (binding) =>
                binding.nodeId === command.nodeId && !binding.removed,
            )
          ) {
            const shapeId = `shape:reference-${command.mutationId}`;
            document = {
              ...document,
              revision: document.revision + 1,
              bindings: [
                ...document.bindings,
                { shapeId, nodeId: command.nodeId, removed: false },
              ],
              snapshot: {
                ...document.snapshot,
                placementHints: {
                  ...((document.snapshot.placementHints as object) ?? {}),
                  [shapeId]: command.position,
                },
              },
            };
          }
        }
        if (state.holdPlacement) await state.holdPlacement;
        if (state.losePlacement) {
          state.losePlacement = false;
          return route.fulfill({
            status: 503,
            json: { message: "放置结果尚未确认" },
          });
        }
        return route.fulfill({
          json: { nodeId: command.nodeId, graph, canvas: document },
        });
      }
      if (command.type !== "import_reference_image")
        throw new Error("附件上传不应运行生成工具");
      state.imports.push(command);
      if (state.failImportCode)
        return route.fulfill({
          status: state.failImportCode,
          json: { message: "参考图片暂时不可加入项目" },
        });
      let id = receipts.get(command.mutationId);
      if (!id) {
        const file = files.get(command.fileId);
        if (!file) throw new Error("缺少已上传文件");
        const existing = graph.nodes.find(
          (node) => node.payload.fileAssetId === command.fileId,
        );
        id = existing?.id ?? `uploaded-${receipts.size + 1}`;
        receipts.set(command.mutationId, id);
        if (!existing) {
          graph = {
            ...graph,
            revision: graph.revision + 1,
            nodes: [
              ...graph.nodes,
              {
                id,
                kind: "asset",
                type: "reference_image",
                title: file.name,
                status: "ready",
                createdAt: NOW,
                updatedAt: NOW,
                x: command.position?.x ?? 0,
                y: command.position?.y ?? 0,
                payload: {
                  fileAssetId: file.id,
                  sourceName: file.name,
                  imageUrl: file.thumbnail1024Url,
                  width: file.width,
                  height: file.height,
                  role: "style_ref",
                  roleSource: "default",
                  roleInferenceState: "none",
                  ...(command.placement === "reference"
                    ? { canvasPlacement: "manual" }
                    : {}),
                },
              },
            ],
          };
          const shapeId = `shape:canvas-${id}`;
          if (command.placement !== "reference")
            document = {
              ...document,
              revision: document.revision + 1,
              bindings: [
                ...document.bindings,
                { shapeId, nodeId: id, removed: false },
              ],
              snapshot: {
                ...document.snapshot,
                placementHints: {
                  ...((document.snapshot.placementHints as object) ?? {}),
                  [shapeId]: command.position,
                },
              },
            };
        }
      }
      if (state.holdImport) await state.holdImport;
      if (state.loseImport) {
        state.loseImport = false;
        return route.fulfill({
          status: 503,
          json: { message: "加入项目的结果暂未确认" },
        });
      }
      return route.fulfill({ json: { nodeId: id, graph, canvas: document } });
    }
    if (route.request().method() === "PATCH") {
      if (state.failSave)
        return route.fulfill({
          status: 503,
          json: { message: "画布保存暂不可用" },
        });
      const save = route.request().postDataJSON() as CanvasSave;
      state.saves.push(save);
      document = {
        ...document,
        revision: document.revision + 1,
        snapshot: save.snapshot,
        bindings: save.bindings.map((binding) => ({
          ...binding,
          removed: false,
        })),
      };
    }
    return route.fulfill({ json: document });
  });
  await page.route(
    "**/api/agent-conversations/*/workflow-messages",
    (route) => {
      const input = route.request().postDataJSON();
      state.sends.push(input);
      const conversation = new URL(route.request().url()).pathname.split(
        "/",
      )[3];
      return route.fulfill({
        json: {
          userMessage: {
            id: `user-${state.sends.length}`,
            conversationId: conversation,
            role: "user",
            status: "completed",
            content: input.content,
            clientRequestId: input.clientRequestId,
            referencedNodeIds: input.referencedNodeIds,
            context: input,
            createdAt: NOW,
            updatedAt: NOW,
          },
          assistantMessage: {
            id: `assistant-${state.sends.length}`,
            conversationId: conversation,
            role: "assistant",
            status: "completed",
            content: "已收到参考，先核对设计要求。",
            referencedNodeIds: input.referencedNodeIds,
            context: input,
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
      });
    },
  );
  const open = async () => {
    await loadZhiya(page);
    await openZhiya(page);
  };
  return Object.assign(state, {
    files,
    open,
    getGraph: () => graph,
    setCanEdit: (canEdit: boolean) => {
      document = { ...document, canEdit };
    },
  });
}

export const chatImageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WkAAAAASUVORK5CYII=",
  "base64",
);
