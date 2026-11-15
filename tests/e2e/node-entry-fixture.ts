import type { Page } from "@playwright/test";
import { prepareZhiya } from "./zhiya-fixture";
import { PROJECT, NOW } from "../visual/fixtures";
import { canvasCommandSchema, type CanvasCommand } from "../../packages/shared/src/canvas-workspace";
import { createCanvasCreationSchema, type CanvasCreation, type CreationResultView, type UpdateCanvasCreationInput } from "../../packages/shared/src/canvas-creations";
import type { WorkflowNode } from "../../apps/web/src/modules/board/workflow/workflow-api";
import { generatedVideoBytes } from "./generated-media-fixture";
import { useCanvasPhotograph } from "./canvas-photo-fixture";
type MutableCreation = { -readonly [Key in keyof CanvasCreation]: CanvasCreation[Key] };

export async function prepareNodeEntry(page: Page, width = 1440) {
  const state = await prepareZhiya(page, { count: 1, realClock: true, viewport: { width, height: width < 700 ? 844 : 900 } });
  await useCanvasPhotograph(page);
  const items: MutableCreation[] = [], commands: CanvasCommand[] = [];
  const receipt = new Map<string, string>(), commandNodes = new Map<string, string>();
  let sequence = 0, aiCalls = 0, imageCalls = 0, loseAttach = false, loseText = false, failText = false;
  const append = (node: WorkflowNode) => { if (!state.graph.nodes.some(item => item.id === node.id)) Object.assign(state.graph, { revision: state.graph.revision + 1, nodes: [...state.graph.nodes, node] }); };
  const output = (item: MutableCreation, text: string | null, mediaSource?: WorkflowNode): CreationResultView => {
    const nodeId = `created-output-${++sequence}`, runId = `created-run-${sequence}`;
    const result: CreationResultView = { nodeId, assetId: item.module === "image" ? `image-${sequence}` : null, title: item.title, text, imageUrl: item.module === "image" ? "/visual-garment.svg" : null, width: item.module === "image" ? 1536 : null, height: item.module === "image" ? 864 : null,
      ...(mediaSource ? { sourceNodeId: mediaSource.id, media: { url: String(mediaSource.payload.mediaUrl), mimeType: "video/mp4", durationMs: 2000 } } : {}) };
    append({ id: nodeId, kind: "asset", type: mediaSource ? "media" : item.module === "image" ? "candidate" : "reference_text", title: item.title, status: "completed", x: 0, y: 0, createdAt: NOW, updatedAt: NOW, payload: { ...(mediaSource?.payload ?? {}), ...(text ? { text } : {}), ...(result.assetId ? { assetId: result.assetId, imageUrl: result.imageUrl } : {}), canvasCreationId: item.id, canvasCreationRunId: runId, canvasPlacement: "manual", ...(mediaSource ? { sourceNodeId: mediaSource.id } : {}) } });
    item.currentResult = result; item.currentResultNodeId = nodeId;
    item.runs = [{ id: runId, creationId: item.id, executionId: null, toolNodeId: null, conversationId: null, status: "completed", draft: structuredClone(item.draft), inputSnapshot: structuredClone(item.draft.inputs), results: [result], error: null, createdAt: NOW }, ...item.runs];
    return result;
  };
  await page.route(`**/api/projects/${PROJECT}/canvas/creations**`, async route => {
    const parts = new URL(route.request().url()).pathname.split("/");
    if (route.request().method() === "GET") return route.fulfill({ json: { items, canEdit: true } });
    const body = route.request().postDataJSON();
    if (parts.at(-1) === "creations") {
      const input = createCanvasCreationSchema.parse(body);
      let item = items.find(item => item.id === input.id);
      if (!item) { item = { ...input, projectId: PROJECT, revision: 0, position: input.position ?? null, resource: null, currentResult: null, currentResultNodeId: null, runs: [], removed: false, createdAt: NOW, updatedAt: NOW }; items.push(item); }
      return route.fulfill({ json: item });
    }
    const item = items.find(item => item.id === (parts.at(-1) === "runs" ? parts.at(-2) : parts.at(-1)));
    if (!item) return route.fulfill({ status: 404, json: { message: "目标不存在" } });
    if (receipt.has(body.mutationId)) return route.fulfill({ json: item });
    if (body.expectedRevision !== item.revision) return route.fulfill({ status: 409, json: { message: "目标已更新" } });
    if (route.request().method() === "PATCH") {
      const input = body as UpdateCanvasCreationInput;
      if (input.draft) item.draft = structuredClone(input.draft);
      if (input.publishText) { const result = output(item, item.draft.textContent ?? ""); item.draft = { ...item.draft, textMode: "manual", textBaseNodeId: result.nodeId }; }
      if (input.mediaNodeId) {
        const source = state.graph.nodes.find(node => node.id === input.mediaNodeId); if (!source) return route.fulfill({ status: 400, json: { message: "缺少视频" } });
        output(item, null, source);
      }
      if (input.currentResultNodeId) { const selectedRun = item.runs.find(run => run.results.some(result => result.nodeId === input.currentResultNodeId)); const selected = selectedRun?.results.find(result => result.nodeId === input.currentResultNodeId); if (selected && selectedRun) { item.currentResult = selected; item.currentResultNodeId = selected.nodeId; item.draft = structuredClone(selectedRun.draft); } }
      item.revision++; receipt.set(input.mutationId, item.id);
      if (input.mediaNodeId && loseAttach) { loseAttach = false; return route.abort("connectionfailed"); }
      if (input.publishText && loseText) { loseText = false; return route.abort("connectionfailed"); }
    } else {
      if (item.draft.inputs.some(input => input.creationId && !input.nodeId && !items.find(source => source.id === input.creationId)?.currentResult)) return route.fulfill({ status: 400, json: { message: "参考节点尚无可用结果，请等待完成后再生成" } });
      if (item.module === "text") { aiCalls++; if (failText) { failText = false; return route.fulfill({ status: 503, json: { message: "文本服务暂不可用，请重试" } }); } output(item, "AI 起草的春夏设计文案，保留柔和的结构与轻盈的视觉。" ); } else { imageCalls++; output(item, null); }
      receipt.set(body.mutationId, item.id);
    }
    return route.fulfill({ json: item });
  });
  const videoPayload = (id: string, uploaded: boolean) => ({ mediaId: id, ...(uploaded ? { fileAssetId: id } : {}), mediaKind: "video", mimeType: "video/mp4", mediaUrl: uploaded ? `/api/files/${id}/content` : `/api/projects/${PROJECT}/runway/media/${id}/content`, runId: uploaded ? "" : "video-run", showId: uploaded ? "" : "video-show", width: uploaded ? null : 240, height: uploaded ? null : 160, durationMs: uploaded ? null : 2000 });
  await page.route(`**/api/projects/${PROJECT}/canvas/commands`, async route => {
    const command = canvasCommandSchema.parse(route.request().postDataJSON()); commands.push(command);
    let nodeId = commandNodes.get(command.mutationId);
    if (!nodeId) {
      if (command.type === "import_reference_video" || command.type === "place_generated_media") {
        const uploaded = command.type === "import_reference_video", id = uploaded ? command.fileId : command.mediaId;
        nodeId = `media-node-${id}`;
        append({ id: nodeId, kind: "asset", type: "media", title: uploaded ? "上传视频.mp4" : "项目视频", status: "completed", x: 0, y: 0, createdAt: NOW, updatedAt: NOW, payload: { ...videoPayload(id, uploaded), ...(command.placement === "reference" ? { canvasPlacement: "manual" } : {}) } });
      } else if (command.type === "place_generated_asset") {
        nodeId = `asset-node-${command.assetId}`; append({ id: nodeId, kind: "asset", type: "candidate", title: "历史图片", status: "completed", x: 0, y: 0, createdAt: NOW, updatedAt: NOW, payload: { assetId: command.assetId, imageUrl: "/visual-garment.svg" } });
      } else if (command.type === "place_canvas_material") nodeId = command.nodeId;
      else return route.fulfill({ status: 400, json: { message: "不支持的测试命令" } });
      commandNodes.set(command.mutationId, nodeId);
      if (!("placement" in command && command.placement === "reference")) {
        const document = state.getCanvasDocument(), shapeId = `shape:import-${command.mutationId}`;
        state.setCanvasDocument({ ...document, revision: document.revision + 1, bindings: [...document.bindings, { shapeId, nodeId, removed: false }], snapshot: { ...document.snapshot, placementHints: { ...(document.snapshot.placementHints as object ?? {}), [shapeId]: "position" in command ? command.position : { x: 500, y: 200 } } } });
      }
    }
    return route.fulfill({ json: { nodeId, graph: state.graph, canvas: state.getCanvasDocument() } });
  });
  await page.route(`**/api/projects/${PROJECT}/generated-files?**`, route => route.fulfill({ json: { items: [{ id: "runway:existing-video", resourceId: "existing-video", domain: "runway", kind: "video", title: "项目视频", operation: "generated", createdAt: NOW, archived: false, status: "ready", mimeType: "video/mp4", width: 240, height: 160, durationMs: 2000, sizeBytes: generatedVideoBytes.length, expiresAt: null, previewUrl: null, contentUrl: `/api/projects/${PROJECT}/runway/media/existing-video/content`, sourceHref: `/${PROJECT}/studio`, nodeId: null }], nextCursor: null } }));
  const uploadedFile = { id: "uploaded-video", mimeType: "video/mp4", name: "上传视频.mp4", size: generatedVideoBytes.length, status: "READY", thumbnail1024Url: null, thumbnail256Url: null, width: null, height: null, error: null };
  await page.route("**/api/files/sign-upload", route => route.fulfill({ json: { deduplicated: false, file: { ...uploadedFile, status: "PENDING" }, upload: { method: "PUT", url: "http://localhost:3000/node-video-upload", headers: { "Content-Type": "video/mp4" } } } }));
  await page.route("**/node-video-upload", route => route.fulfill({ status: 200, body: "" }));
  await page.route("**/api/files/uploaded-video/complete", route => route.fulfill({ json: uploadedFile }));
  await page.route(/\/api\/(files\/uploaded-video|projects\/[^/]+\/runway\/media\/existing-video)\/content$/, route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0, end = Math.min(range?.[2] ? Number(range[2]) : generatedVideoBytes.length - 1, generatedVideoBytes.length - 1);
    return route.fulfill({ status: range ? 206 : 200, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${generatedVideoBytes.length}` } : {}) }, body: generatedVideoBytes.subarray(start, end + 1) });
  });
  return { ...state, items, commands, aiCalls: () => aiCalls, imageCalls: () => imageCalls, loseNextAttach: () => { loseAttach = true; }, loseNextTextSave: () => { loseText = true; }, failNextTextRun: () => { failText = true; } };
}
