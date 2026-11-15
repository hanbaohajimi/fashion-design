import { expect, type Locator, type Page } from "@playwright/test";
import type { ProjectTaskActivity, ProjectTaskPage } from "../../packages/shared/src/project-tasks";
import type { CanvasDocumentView, CanvasSave } from "../../packages/shared/src/canvas-workspace";
import type { WorkflowGraph } from "../../apps/web/src/modules/board/workflow/workflow-api";
import { seedVisualApp, PROJECT, NOW } from "../visual/fixtures";

export const emptyActivity = (): ProjectTaskActivity => ({ preparing: 0, queued: 0, executing: 0, awaitingUser: 0, waiting: { input: 0, confirmation: 0, resume: 0 }, recent: [] });
export async function elementBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`元素不可见，无法检查位置：${locator}`);
  return box;
}
export async function prepareZhiya(page: Page, options: { count?: number; activity?: ProjectTaskActivity; history?: boolean; viewport?: { width: number; height: number }; realClock?: boolean; canEdit?: boolean } = {}) {
  await seedVisualApp(page, { firstAssistantVisit: true, realClock: options.realClock ?? false });
  if (!options.realClock) await page.clock.setSystemTime(new Date("2026-11-08T12:00:00Z"));
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  await page.setViewportSize(options.viewport ?? { width: 1440, height: 900 });
  const state = {
    activity: options.activity ?? emptyActivity(), failTasks: false, queries: [] as number[],
    mutations: [] as string[], saves: [] as CanvasSave[], errors: [] as string[], oldModelRequests: 0,
  };
  page.on("pageerror", error => { if (error.name !== "NetworkError") state.errors.push(error.message); });
  page.on("request", request => {
    if (request.url().includes("/live2d/")) state.oldModelRequests++;
    if (request.method() !== "GET" && request.url().includes("/api/") && !request.url().includes("/canvas/initialize") && !request.url().includes("/canvas") && !request.url().includes("/workflow/sync")) state.mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const count = options.count ?? 3;
  const graph: WorkflowGraph = {
    projectId: PROJECT, revision: 1, layoutRevision: 0, legacyAvailable: false, edges: [],
    nodes: Array.from({ length: count }, (_, index) => {
      const type = index % 10 < 3 ? "candidate" : index % 10 === 9 ? "swatch" : "reference_text";
      return { id: `material-${index}`, kind: "asset", type,
        title: type === "candidate" ? `通勤外套 ${index + 1}` : type === "swatch" ? `材质色彩 ${index + 1}` : `设计灵感 ${index + 1}`,
        status: "completed", x: (index % 10) * 280, y: Math.floor(index / 10) * 290, createdAt: NOW, updatedAt: NOW,
        payload: type === "candidate" ? { assetId: `look-${index}`, imageUrl: "/visual-garment.svg", imageWidth: 600, imageHeight: 800 }
          : type === "swatch" ? { colors: [{ hex: "#53644b", name: "苔绿" }, { hex: "#d6c6a7", name: "暖砂" }], color: "#53644b" }
          : { text: "宽松廓形与轻盈结构，保留织物的自然肌理。" },
      };
    }),
  };
  let document: CanvasDocumentView = { projectId: PROJECT, mode: "canvas", revision: 0, formatVersion: 1, initializedFrom: "workflow", canEdit: options.canEdit ?? true, snapshot: {}, bindings: graph.nodes.map(node => ({ shapeId: `shape:canvas-${node.id}`, nodeId: node.id, removed: false })) };
  await page.route(/\/api\/projects\/[^/]+\/workflow(?:\/[^?]*)?(?:\?.*)?$/, route => {
    if (route.request().url().endsWith("/tools")) return route.fulfill({ json: { agentVersion: 2, tools: [] } });
    return route.fulfill({ json: { ...graph, projectId: new URL(route.request().url()).pathname.split("/")[3] } });
  });
  await page.route(/\/api\/projects\/[^/]+\/canvas(?:\/[^?]*)?(?:\?.*)?$/, route => {
    if (route.request().url().endsWith("/creations")) return route.fulfill({ json: { items: [], canEdit: options.canEdit ?? true } });
    if (route.request().url().endsWith("/commands")) throw new Error("织芽交互不应提交画布命令");
    if (route.request().method() === "PATCH") {
      const save = route.request().postDataJSON() as CanvasSave;
      state.saves.push(save);
      document = { ...document, revision: document.revision + 1, snapshot: save.snapshot, bindings: save.bindings.map(binding => ({ ...binding, removed: false })) };
    }
    return route.fulfill({ json: { ...document, projectId: new URL(route.request().url()).pathname.split("/")[3] } });
  });
  await page.route(/\/api\/projects\/[^/]+\/tasks(?:\?.*)?$/, route => {
    state.queries.push(Date.now());
    if (state.failTasks) return route.fulfill({ status: 503, json: { message: "测试断线" } });
    const page: ProjectTaskPage = { items: [], nextCursor: null, counts: { running: state.activity.preparing + state.activity.executing, attention: state.activity.awaitingUser }, activity: state.activity };
    return route.fulfill({ json: page });
  });
  if (options.history) await page.route("**/api/agent-conversations/visual-chat/messages*", route => route.fulfill({ json: {
    items: Array.from({ length: 20 }, (_, index) => ({ id: `history-${index}`, conversationId: "visual-chat", role: index % 2 ? "assistant" : "user", status: "completed", content: `第 ${index + 1} 条设计讨论：保留面料肌理，比较不同廓形的空间关系。\n\n用柔和的比例与实用的细节完成本轮方案。`, referencedNodeIds: [], createdAt: NOW, updatedAt: NOW })), nextCursor: null,
  } }));
  return Object.assign(state, { graph, getCanvasDocument: () => document, setCanvasDocument: (next: CanvasDocumentView) => { document = next; }, setCanEdit: (canEdit: boolean) => { document = { ...document, canEdit }; }, setCanvasSnapshot: (snapshot: CanvasDocumentView["snapshot"]) => { document = { ...document, snapshot }; } });
}

export const zhiya = (page: Page) => page.locator("[data-zhiya]");
export const hit = (page: Page) => zhiya(page).locator(".pp-hit");
export async function openZhiya(page: Page) {
  await hit(page).click({ position: { x: 48, y: 78 } });
  await expect(page.getByRole("textbox", { name: "描述设计需求", exact: true })).toBeVisible();
}
export async function loadZhiya(page: Page, path = `/${PROJECT}`) {
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByLabel("无限白板", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(zhiya(page)).toBeVisible();
  await expect(zhiya(page)).toHaveAttribute("data-active", "true");
  await expect.poll(() => zhiya(page).locator("img").evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
}
