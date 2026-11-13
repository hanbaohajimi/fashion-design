import { expect, type Page } from "@playwright/test";
import { canvasCommandSchema, type CanvasCommand, type CanvasDocumentView, type CanvasSave } from "../../packages/shared/src/canvas-workspace";
import { canvasMediaUrl } from "../../packages/shared/src/canvas-media";
import { generatedFilesFixture } from "./generated-files-fixture";
import { generatedAudioBytes, generatedVideoBytes } from "./generated-media-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

export async function canvasMediaFixture(page: Page, options: { width?: number; canEdit?: boolean; canvasCount?: number; demoVideo?: Buffer } = {}) {
  const base = await generatedFilesFixture(page, { count: 8, canvasCount: options.canvasCount ?? 3, ...options });
  base.files = base.files.filter(file => file.kind === "video" || file.kind === "audio").map(file => ({
    ...file, title: file.kind === "video" ? "秋冬服装秀成片" : "系列配乐", contentUrl: canvasMediaUrl(PROJECT, file.resourceId),
    mimeType: file.kind === "video" ? "video/mp4" : "audio/wav", width: file.kind === "video" ? options.demoVideo ? 360 : 240 : null, height: file.kind === "video" ? options.demoVideo ? 480 : 160 : null, durationMs: options.demoVideo && file.kind === "video" ? 6000 : 2000,
  }));
  let graph = base.graph;
  let document: CanvasDocumentView = { projectId: PROJECT, mode: "canvas", revision: 0, formatVersion: 1, initializedFrom: "workflow", canEdit: options.canEdit ?? true, snapshot: {}, bindings: graph.nodes.map(node => ({ nodeId: node.id, shapeId: `shape:canvas-${node.id}`, removed: false })) };
  const state = { ...base, placements: [] as CanvasCommand[], saved: [] as CanvasSave[], loseResponse: false, failCode: 0, failSave: false, failContent: false, contentReads: [] as string[], hold: null as Promise<void> | null };
  const receipts = new Map<string, string>();
  await page.route(`**/api/projects/${PROJECT}/generated-files/runway/*/download`, route => {
    if (state.failContent) return route.fulfill({ status: 503, json: { message: "媒体原文件暂不可用，请重试。" } });
    const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    state.downloads.push(id);
    return route.fulfill({ json: { url: `/media-original/${id}`, fileName: id === "result-4" ? "audio.wav" : "video.mp4" } });
  });
  await page.route("**/media-original/*", route => {
    const audio = route.request().url().endsWith("result-4"), bytes = audio ? generatedAudioBytes() : generatedVideoBytes;
    return route.fulfill({ body: bytes, contentType: audio ? "audio/wav" : "video/mp4", headers: { "Content-Disposition": `attachment; filename=${audio ? "audio.wav" : "video.mp4"}` } });
  });
  await page.route(`**/api/projects/${PROJECT}/workflow**`, route => route.fulfill({ json: route.request().url().endsWith("/tools") ? { agentVersion: 2, tools: [] } : graph }));
  await page.route(`**/api/projects/${PROJECT}/canvas**`, async route => {
    if (route.request().url().endsWith("/commands")) {
      const command = canvasCommandSchema.parse(route.request().postDataJSON());
      if (command.type !== "place_generated_media") throw new Error("媒体放置不得生成图片或其他请求");
      state.placements.push(command);
      if (state.failCode) return route.fulfill({ status: state.failCode, json: { message: "媒体原文件暂时无法读取，请继续原操作。" } });
      let nodeId = receipts.get(command.mutationId);
      if (!nodeId) {
        const file = state.files.find(file => file.resourceId === command.mediaId); if (!file) throw new Error("缺少隔离媒体");
        nodeId = `placed-media-${receipts.size + 1}`; receipts.set(command.mutationId, nodeId);
        graph = { ...graph, revision: graph.revision + 1, nodes: [...graph.nodes, { id: nodeId, kind: "asset", type: "media", status: "completed", title: file.title, createdAt: NOW, updatedAt: NOW, x: command.position?.x ?? 0, y: command.position?.y ?? 0, payload: {
          mediaId: file.resourceId, mediaKind: file.kind, mimeType: file.mimeType, mediaUrl: file.contentUrl, runId: "run-3", showId: "show-3", width: file.width, height: file.height, durationMs: file.durationMs,
        } }] };
        const shapeId = `shape:generated-media-${command.mutationId}`;
        document = { ...document, revision: document.revision + 1, bindings: [...document.bindings, { shapeId, nodeId, removed: false }], snapshot: { ...document.snapshot, placementHints: { ...(document.snapshot.placementHints as object ?? {}), [shapeId]: command.position } } };
        file.nodeId = nodeId;
      }
      if (state.hold) await state.hold;
      if (state.loseResponse) { state.loseResponse = false; return route.fulfill({ status: 503, json: { message: "放置回执尚未确认" } }); }
      return route.fulfill({ json: { nodeId, graph, canvas: document } });
    }
    if (route.request().method() === "PATCH") {
      const save = route.request().postDataJSON() as CanvasSave; state.saved.push(save);
      if (state.failSave) return route.fulfill({ status: 503, json: { message: "画布保存暂不可用" } });
      document = { ...document, revision: document.revision + 1, snapshot: save.snapshot, bindings: save.bindings.map(binding => ({ ...binding, removed: false })) };
    }
    return route.fulfill({ json: document });
  });
  await page.route(`**/api/projects/${PROJECT}/runway/media/*/content*`, async route => {
    const url = new URL(route.request().url()); state.contentReads.push(url.pathname);
    if (state.failContent) return route.fulfill({ status: 503, body: "media unavailable" });
    const audio = url.pathname.includes("result-4"), bytes = audio ? generatedAudioBytes() : options.demoVideo ?? generatedVideoBytes;
    const range = /bytes=(\d+)-(\d*)/u.exec(route.request().headers().range ?? "");
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    const sliced = bytes.subarray(start, end + 1);
    return route.fulfill({ status: range ? 206 : 200, body: sliced, contentType: audio ? "audio/wav" : "video/mp4", headers: {
      "Accept-Ranges": "bytes", "Content-Length": String(sliced.length), ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
      ...(url.searchParams.get("download") === "1" ? { "Content-Disposition": `attachment; filename=${audio ? "audio.wav" : "video.mp4"}` } : {}),
    } });
  });
  return Object.assign(state, { getGraph: () => graph, getCanvas: () => document,
    setReadOnly: () => { document = { ...document, canEdit: false }; graph = { ...graph, canEdit: false }; },
  });
}

export const mediaPanel = (page: Page) => page.getByRole("dialog", { name: "生成文件", exact: true });
export const mediaCard = (page: Page, id = "result-3") => page.locator(`[data-canvas-media="${id}"]`);
export async function openMediaFiles(page: Page) {
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await page.getByRole("button", { name: "生成文件", exact: true }).click();
  await expect(mediaPanel(page)).toBeVisible();
}
export async function placeMedia(page: Page, id = "result-3") {
  await openMediaFiles(page);
  const row = mediaPanel(page).locator(`[data-generated-file-id="runway:${id}"]`);
  await row.getByRole("button", { name: "放入画布", exact: true }).click();
  await row.getByRole("button", { name: "查看已放入的媒体", exact: true }).click();
  await expect(mediaPanel(page)).toHaveCount(0);
  await expect(mediaCard(page, id)).toBeVisible();
}
