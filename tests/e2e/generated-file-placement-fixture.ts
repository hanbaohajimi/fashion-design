import type { Page } from "@playwright/test";
import { canvasCommandSchema, type CanvasDocumentView, type CanvasSave, type CanvasCommand } from "../../packages/shared/src/canvas-workspace";
import { generatedFilesFixture } from "./generated-files-fixture";
import { PROJECT, NOW } from "../visual/fixtures";

export async function generatedFilePlacementFixture(page: Page, options: { width?: number; canEdit?: boolean } = {}) {
  const base = await generatedFilesFixture(page, { ...options, canvasCount: 3 });
  let graph = base.graph;
  let document: CanvasDocumentView = { projectId: PROJECT, mode: "canvas", revision: 0, formatVersion: 1, initializedFrom: "workflow", canEdit: options.canEdit ?? true, snapshot: {}, bindings: graph.nodes.map(node => ({ nodeId: node.id, shapeId: `shape:canvas-${node.id}`, removed: false })) };
  const state = { ...base, placements: [] as CanvasCommand[], loseResponse: false, failCode: 0, failSave: false, hold: null as Promise<void> | null, saved: [] as CanvasSave[] };
  const receipts = new Map<string, string>();
  await page.route(`**/api/projects/${PROJECT}/workflow**`, route => route.fulfill({ json: route.request().url().endsWith("/tools") ? { agentVersion: 2, tools: [] } : graph }));
  await page.route(`**/api/projects/${PROJECT}/canvas**`, async route => {
    if (route.request().url().endsWith("/creations")) return route.fulfill({ json: { items: [], canEdit: options.canEdit ?? true } });
    if (route.request().url().endsWith("/commands")) {
      const command = canvasCommandSchema.parse(route.request().postDataJSON());
      if (command.type !== "place_generated_asset") throw new Error("放置不得提交生成任务");
      state.placements.push(command);
      if (state.failCode) return route.fulfill({ status: state.failCode, json: { message: "当前图片无法放置，请核对后重试。" } });
      let nodeId = receipts.get(command.mutationId);
      if (!nodeId) {
        nodeId = `placed-${receipts.size + 1}`; receipts.set(command.mutationId, nodeId);
        const file = state.files.find(file => file.resourceId === command.assetId); if (!file) throw new Error("测试图片不存在");
        const assetId = command.archived ? `restored-${receipts.size}` : command.assetId;
        graph = { ...graph, revision: graph.revision + 1, nodes: [...graph.nodes, { id: nodeId, type: "candidate", kind: "asset", title: file.title, status: "completed", x: command.position?.x ?? 0, y: command.position?.y ?? 0, createdAt: NOW, updatedAt: NOW, payload: { assetId, historicalImport: true, imageUrl: `/api/design-assets/${assetId}/content`, imageWidth: 600, imageHeight: 800, ...(command.archived ? { parentAssetId: command.assetId, restoredFromAssetId: command.assetId } : {}) } }] };
        const shapeId = `shape:generated-file-${command.mutationId}`;
        document = { ...document, revision: document.revision + 1, bindings: [...document.bindings, { shapeId, nodeId, removed: false }], snapshot: { ...document.snapshot, placementHints: { ...(document.snapshot.placementHints as object ?? {}), [shapeId]: command.position } } };
      }
      if (state.hold) await state.hold;
      if (state.loseResponse) { state.loseResponse = false; return route.fulfill({ status: 503, json: { message: "放置回执暂未确认" } }); }
      return route.fulfill({ json: { nodeId, graph, canvas: document } });
    }
    if (route.request().method() === "PATCH") {
      const save = route.request().postDataJSON() as CanvasSave; state.saved.push(save);
      if (state.failSave) return route.fulfill({ status: 503, json: { message: "画布保存暂不可用" } });
      document = { ...document, revision: document.revision + 1, snapshot: save.snapshot, bindings: save.bindings.map(binding => ({ ...binding, removed: false })) };
    }
    return route.fulfill({ json: document });
  });
  await page.route("**/api/design-assets/*/content", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#ebe8e1"/><path d="m160 200 140-60 140 60 70 150-100 35-20 340H210l-20-340-100-35Z" fill="#203449"/></svg>' }));
  return Object.assign(state, { getGraph: () => graph, getCanvas: () => document });
}
