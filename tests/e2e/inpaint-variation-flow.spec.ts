import { chooseValue, valueControl } from "./choice-control";
import { expect, test, type Page } from "@playwright/test";

// These scenarios exercise the editable workflow, not the default design workbench.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fashion:canvas-view", "workflow"));
});
import type { WorkflowGraph, WorkflowNode, WorkflowOperation } from "../../apps/web/src/modules/board/workflow/workflow-api";

const PROJECT_ID = "e2e-inpaint";
const NOW = "2026-10-14T08:00:00.000Z";
test.setTimeout(60_000);

function node(id: string, type: WorkflowNode["type"], title: string, x: number, y: number, payload: WorkflowNode["payload"]): WorkflowNode {
  return { id, kind: "asset", type, title, x, y, payload, status: "completed", createdAt: NOW, updatedAt: NOW };
}

async function mockEditing(page: Page) {
  let graph: WorkflowGraph = { projectId: PROJECT_ID, revision: 1, layoutRevision: 0, legacyAvailable: false, nodes: [
    node("source", "candidate", "原始短款外套", 40, 100, { assetId: "asset-source", imageUrl: "/api/design-assets/asset-source/thumbnail", text: "结构清晰的短款外套" }),
    node("palette", "swatch", "色卡 01", 40, 450, { color: "#C8AB84", text: "OAT" }),
  ], edges: [] };
  let uploadedMaskBytes = 0;
  let uploadedMaskDimensions: { height: number; width: number } | null = null;
  let uploadCount = 0;
  let failNextExecution = false;
  let rejectNextPatch = false;
  let abortCommittedPatch = false;
  let outputSequence = 0;
  const patchRequests: Array<{ mutationId: string; operations: WorkflowOperation[] }> = [];
  const executions: Array<{ toolId: string; parentAssetId: string; params: Record<string, unknown> }> = [];
  const paths: Array<{ method: string; url: string }> = [];
  let conversationCreated = false;
  const conversation = { id: "editing-conversation", mode: "workflow", projectId: PROJECT_ID, title: "局部编辑会话", archivedAt: null, createdAt: NOW, updatedAt: NOW };
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    credits: { limit: 100, remaining: 20, used: 80 },
    user: { authId: "auth-e2e", avatar: null, createdAt: NOW, deletedAt: null, email: "atelier@example.com", id: "user-e2e", name: "Atelier E2E" },
  } }));
  await page.route("**/api/projects/" + PROJECT_ID, (route) => route.fulfill({ json: { id: PROJECT_ID, name: "E2E 局部编辑项目", archived: false, assetCount: 1, coverAssetId: null, coverUrl: null, createdAt: NOW, updatedAt: NOW } }));
  await page.route("**/api/projects/" + PROJECT_ID + "/agent-conversations*", (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ mode: "workflow" });
      conversationCreated = true;
      return route.fulfill({ status: 201, json: conversation });
    }
    return route.fulfill({ json: { items: conversationCreated ? [conversation] : [], nextCursor: null } });
  });
  await page.route("**/api/agent-conversations/editing-conversation/messages*", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/agent-conversations/editing-conversation/plan", (route) => route.fulfill({ json: { revision: 1, plan: null } }));
  await page.route("**/api/agent-conversations/editing-conversation/context", (route) => route.fulfill({ json: {
    revision: 1, currentObjective: null, focusNodeIds: [], requirements: [], preferences: [], nodes: [],
    visualCoverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [] },
  } }));
  await page.route("**/api/design-assets/*/path", (route) => route.fulfill({ json: { steps: [], decisions: [], incomplete: false } }));
  await page.route(/\/api\/design-assets\/[^/]+\/(?:content|thumbnail)$/u, (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024"><rect width="768" height="1024" fill="#c8b79f"/><path d="M240 180h288l80 680H160z" fill="#39443e"/></svg>',
  }));
  await page.route("**/api/generations/masks/sign", (route) => {
    const body = route.request().postDataJSON() as { checksumSha256: string; height: number; width: number };
    expect(body.checksumSha256).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
    expect(body).toMatchObject({ height: 1024, width: 768 });
    return route.fulfill({ json: { expiresAt: NOW, maskId: "mask-e2e", maskUrl: "https://signed.example/mask-e2e.png?read=1", upload: {
      headers: { "Content-Type": "image/png", "x-amz-checksum-sha256": body.checksumSha256 }, method: "PUT", url: "https://signed.example/mask-e2e.png?write=1",
    } } });
  });
  await page.route("https://signed.example/mask-e2e.png?write=1", (route) => {
    const png = route.request().postDataBuffer();
    uploadCount += 1;
    uploadedMaskBytes = png?.byteLength ?? 0;
    if (png && png.byteLength >= 24) uploadedMaskDimensions = { height: png.readUInt32BE(20), width: png.readUInt32BE(16) };
    return route.fulfill({ status: 200 });
  });
  // 编辑应沿工作流工具执行；若旧路径被意外调用，立即阻断真实生成请求。
  await page.route(/\/api\/generations$/u, (route) => {
    paths.push({ method: route.request().method(), url: route.request().url() });
    return route.fulfill({ status: 400, json: { message: "编辑应从工作流执行" } });
  });
  await page.route("**/api/projects/" + PROJECT_ID + "/workflow", (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill({ json: graph });
    const body = route.request().postDataJSON() as { mode: string; mutationId: string; operations?: WorkflowOperation[] };
    if (body.mode !== "semantic") return route.fulfill({ json: graph });
    patchRequests.push({ mutationId: body.mutationId, operations: body.operations ?? [] });
    if (rejectNextPatch) { rejectNextPatch = false; graph = { ...graph, revision: graph.revision + 1 }; return route.fulfill({ status: 409, json: { message: "模拟图修订冲突" } }); }
    let nodes = [...graph.nodes];
    let edges = [...graph.edges];
    for (const operation of body.operations ?? []) {
      if (operation.type === "add_node" && !nodes.some((item) => item.id === operation.node.id)) nodes.push({ ...operation.node, status: "ready", createdAt: NOW, updatedAt: NOW });
      if (operation.type === "add_edge" && !edges.some((item) => item.id === operation.edge.id)) edges.push(operation.edge);
      if (operation.type === "remove_node") { nodes = nodes.filter((item) => item.id !== operation.nodeId); edges = edges.filter((item) => item.sourceNodeId !== operation.nodeId && item.targetNodeId !== operation.nodeId); }
    }
    graph = { ...graph, nodes, edges, revision: graph.revision + 1 };
    if (abortCommittedPatch) { abortCommittedPatch = false; return route.abort("connectionfailed"); }
    return route.fulfill({ json: graph });
  });
  await page.route("**/api/projects/" + PROJECT_ID + "/workflow/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/sync")) return route.fulfill({ json: graph });
    if (path.endsWith("/execute")) {
      expect(route.request().postDataJSON()).toMatchObject({ conversationId: conversation.id });
      const toolId = path.split("/").at(-2) ?? "";
      const tool = graph.nodes.find((item) => item.id === toolId);
      const sourceEdge = graph.edges.find((item) => item.targetNodeId === toolId && item.targetPort === "source");
      const source = graph.nodes.find((item) => item.id === sourceEdge?.sourceNodeId);
      expect(tool?.type).toBe("edit_design");
      expect(source?.type).toBe("candidate");
      const params = tool?.payload.params as Record<string, unknown>;
      executions.push({ toolId, parentAssetId: String(source?.payload.assetId), params });
      if (failNextExecution) { failNextExecution = false; return route.fulfill({ status: 503, json: { message: "模拟修改任务创建失败" } }); }
      outputSequence += 1;
      const outputId = "edited-" + outputSequence;
      const output = node(outputId, "candidate", String(params.taskType) === "inpaint" ? "局部重绘结果 " + outputSequence : "变体结果 " + outputSequence, 740, 100 + (outputSequence - 1) * 320, { assetId: "asset-" + outputId, imageUrl: "/api/design-assets/asset-" + outputId + "/thumbnail", parentAssetId: source?.payload.assetId });
      graph = { ...graph, revision: graph.revision + 1, nodes: [...graph.nodes.map((item) => item.id === toolId ? { ...item, status: "completed" } : item), output], edges: [...graph.edges, { id: "output-" + outputId, sourceNodeId: toolId, targetNodeId: output.id, sourcePort: "out", targetPort: "source" }] };
      return route.fulfill({ json: graph });
    }
    return route.fulfill({ status: 404 });
  });
  await page.route("**/api/design-assets/*/feedback", (route) => route.fulfill({ json: { revision: 0, annotations: [], comments: [] } }));
  return { getGraph: () => graph, patchRequests, executions, paths, failExecution: () => { failNextExecution = true; }, rejectPatch: () => { rejectNextPatch = true; }, losePatchAck: () => { abortCommittedPatch = true; }, mask: () => ({ uploadedMaskBytes, uploadedMaskDimensions, uploadCount }) };
}

async function openCandidate(page: Page, title = "原始短款外套") {
  const active = page.getByRole("dialog", { name: "图片工作区" });
  if (await active.isVisible()) await active.getByRole("button", { name: "关闭图片工作区" }).click();
  await page.locator('[data-type="candidate"]').filter({ has: page.getByText(title, { exact: true }) }).dblclick();
  return page.getByRole("dialog", { name: "图片工作区", exact: true });
}

test("候选可上传原尺寸蒙版，失败重试保留同一修改分支与父图，色卡按显式选择提交", async ({ page }) => {
  const mocked = await mockEditing(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/" + PROJECT_ID);
  await page.locator('input[type="file"]').setInputFiles({ buffer: Buffer.from("not-an-image"), mimeType: "text/plain", name: "设计说明.txt" });
  await expect(page.getByRole("alert").filter({ hasText: "仅支持 JPG、PNG、WebP 或 HEIC 图片" })).toBeVisible();
  await page.getByRole("button", { name: "关闭提示" }).click();
  const workspace = await openCandidate(page);
  await workspace.getByRole("button", { name: "局部重绘", exact: true }).click();
  await workspace.getByRole("textbox", { name: "局部重绘说明" }).fill("将领口改成窄驳领，保持原有面料");
  await expect(workspace.getByRole("region", { name: "候选资产工作台", exact: true }).getByRole("combobox")).toHaveValue("");
  await workspace.getByRole("button", { name: "提交局部重绘" }).click();
  await expect(workspace.getByRole("alert")).toContainText("请先涂抹需要修改的区域");
  const canvas = workspace.getByLabel("局部重绘掩码画布");
  await workspace.getByRole("button", { name: "标记中央区域" }).focus();
  await page.keyboard.press("Enter");
  await expect(canvas).toHaveAttribute("data-stroke-count", "1");
  await workspace.getByRole("button", { name: "清空", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-stroke-count", "0");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await canvas.click({ position: { x: (bounds?.width ?? 0) * 0.35, y: (bounds?.height ?? 0) * 0.35 } });
  await canvas.click({ position: { x: (bounds?.width ?? 0) * 0.55, y: (bounds?.height ?? 0) * 0.5 } });
  await expect(canvas).toHaveAttribute("data-stroke-count", "2");
  await workspace.getByRole("button", { name: "撤销一笔" }).click();
  await expect(canvas).toHaveAttribute("data-stroke-count", "1");
  await workspace.getByLabel("掩码画笔尺寸").fill("0.16");
  await page.mouse.move((bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.28, (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.3);
  await page.mouse.down();
  await page.mouse.move((bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.7, (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.7, { steps: 18 });
  await page.mouse.up();
  mocked.failExecution();
  await workspace.getByRole("button", { name: "提交局部重绘" }).click();
  await expect(workspace.getByRole("alert")).toContainText("模拟修改任务创建失败");
  await expect(workspace.getByRole("textbox", { name: "局部重绘说明" })).toBeDisabled();
  expect(mocked.executions[0]?.params).not.toHaveProperty("palette");
  expect(mocked.executions[0]).toMatchObject({ parentAssetId: "asset-source", params: { taskType: "inpaint", prompt: "将领口改成窄驳领，保持原有面料", maskImageUrl: "https://signed.example/mask-e2e.png?read=1", width: 768, height: 1024 } });
  await workspace.getByRole("button", { name: "重试执行当前修改节点" }).click();
  await expect(workspace.getByRole("img", { name: /^(局部重绘|变体)结果 /u })).toBeVisible();
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await expect(workspace).toBeHidden();
  expect(mocked.executions).toHaveLength(2);
  expect(mocked.executions[1]?.toolId).toBe(mocked.executions[0]?.toolId);
  expect(mocked.patchRequests).toHaveLength(1);
  expect(mocked.mask().uploadCount).toBe(1);
  expect(mocked.mask().uploadedMaskBytes).toBeGreaterThan(100);
  expect(mocked.mask().uploadedMaskDimensions).toEqual({ height: 1024, width: 768 });
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(2);
  await openCandidate(page);
  await workspace.getByRole("button", { name: "局部重绘", exact: true }).click();
  await workspace.getByRole("textbox", { name: "局部重绘说明" }).fill("将口袋改成贴袋，保持廓形");
  await chooseValue(valueControl(workspace.getByRole("region", { name: "候选资产工作台", exact: true }), "参考色卡 · 可选"), "palette");
  await workspace.getByRole("button", { name: "标记中央区域" }).click();
  await workspace.getByRole("button", { name: "提交局部重绘" }).click();
  await expect(workspace.getByRole("img", { name: /^(局部重绘|变体)结果 /u })).toBeVisible();
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await expect(workspace).toBeHidden();
  expect(mocked.executions[2]).toMatchObject({ parentAssetId: "asset-source", params: { taskType: "inpaint", palette: [{ hex: "#C8AB84", name: "色卡 01" }] } });
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(3);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.locator('[data-type="candidate"]').filter({ has: page.getByText("局部重绘结果 1", { exact: true }) }).dblclick();
  await page.getByRole("dialog", { name: "图片工作区" }).getByRole("button", { name: /图像/u }).click();
  await page.getByRole("button", { name: "来源与设计决策", exact: true }).click();
  await expect(page.getByRole("button", { name: "从工作流移除节点" })).toBeDisabled();
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(3);
  expect(mocked.getGraph().edges.some((edge) => edge.sourceNodeId === "edited-1" || edge.targetNodeId === "edited-1")).toBe(true);
  expect(mocked.getGraph().nodes.find((item) => item.id === "source")?.payload.assetId).toBe("asset-source");
  expect(mocked.paths).toHaveLength(0);
});

test("变体修改方向与保留项需显式确认，图冲突和执行失败重试不复制节点且保留父图", async ({ page }) => {
  const mocked = await mockEditing(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/" + PROJECT_ID);
  const workspace = await openCandidate(page);
  await workspace.getByRole("button", { name: "生成变体", exact: true }).click();
  expect(mocked.patchRequests).toHaveLength(0);
  expect(mocked.executions).toHaveLength(0);
  await workspace.getByRole("button", { name: "确认生成变体" }).click();
  await expect(workspace.getByRole("alert")).toContainText("请描述变体需要如何修改");
  await workspace.getByRole("textbox", { name: "变体修改说明" }).fill("探索更简洁的领型");
  await workspace.getByRole("button", { name: "确认生成变体" }).click();
  await expect(workspace.getByRole("alert")).toContainText("请明确需要保留的设计特征");
  await workspace.getByRole("textbox", { name: "变体保留特征" }).fill("保持宽松廓形、原有面料与配色");
  mocked.rejectPatch();
  await workspace.getByRole("button", { name: "确认生成变体" }).click();
  await expect(workspace.getByRole("alert")).toContainText("模拟图修订冲突");
  expect(mocked.executions).toHaveLength(0);
  mocked.failExecution();
  await workspace.getByRole("button", { name: "确认生成变体" }).click();
  await expect(workspace.getByRole("alert")).toContainText("模拟修改任务创建失败");
  expect(mocked.patchRequests).toHaveLength(2);
  expect(mocked.patchRequests[1]?.mutationId).not.toBe(mocked.patchRequests[0]?.mutationId);
  expect(mocked.patchRequests[1]?.operations).toEqual(mocked.patchRequests[0]?.operations);
  expect(mocked.getGraph().nodes.filter((item) => item.type === "edit_design")).toHaveLength(1);
  await workspace.getByRole("button", { name: "重试执行当前变体节点" }).click();
  await expect(workspace.getByRole("img", { name: /^(局部重绘|变体)结果 /u })).toBeVisible();
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await expect(workspace).toBeHidden();
  expect(mocked.executions).toHaveLength(2);
  expect(mocked.executions[1]?.toolId).toBe(mocked.executions[0]?.toolId);
  expect(mocked.executions[1]).toMatchObject({ parentAssetId: "asset-source", params: { taskType: "i2i", prompt: "探索更简洁的领型\n保持不变：保持宽松廓形、原有面料与配色", width: 768, height: 1024 } });
  expect(mocked.executions[1]?.params).not.toHaveProperty("maskImageUrl");
  expect(mocked.mask().uploadCount).toBe(0);
  expect(mocked.getGraph().edges.find((item) => item.targetNodeId === mocked.executions[1]?.toolId)?.sourceNodeId).toBe("source");
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(2);
  expect(mocked.getGraph().nodes.find((item) => item.id === "source")?.payload.assetId).toBe("asset-source");
  expect(mocked.paths).toHaveLength(0);
});

test("变体分支已提交但响应丢失时，重试认领原节点且只执行一次", async ({ page }) => {
  const mocked = await mockEditing(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/" + PROJECT_ID);
  const workspace = await openCandidate(page);
  await workspace.getByRole("button", { name: "生成变体", exact: true }).click();
  await workspace.getByRole("textbox", { name: "变体修改说明" }).fill("探索不同的领口比例");
  await workspace.getByRole("textbox", { name: "变体保留特征" }).fill("保留短款衣长与原有面料");
  mocked.losePatchAck();
  await workspace.getByRole("button", { name: "确认生成变体" }).click();
  await expect(workspace.getByRole("alert")).toBeVisible();
  expect(mocked.getGraph().nodes.filter((item) => item.type === "edit_design")).toHaveLength(1);
  expect(mocked.executions).toHaveLength(0);
  await workspace.getByRole("button", { name: "确认生成变体" }).click();
  await expect(workspace.getByRole("img", { name: /^(局部重绘|变体)结果 /u })).toBeVisible();
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await expect(workspace).toBeHidden();
  expect(mocked.patchRequests).toHaveLength(1);
  expect(mocked.executions).toHaveLength(1);
  const tool = mocked.getGraph().nodes.find((item) => item.type === "edit_design");
  expect(mocked.getGraph().nodes.filter((item) => item.type === "edit_design")).toHaveLength(1);
  expect(mocked.getGraph().edges.filter((item) => item.sourceNodeId === "source" && item.targetNodeId === tool?.id)).toHaveLength(1);
  expect(mocked.executions[0]?.parentAssetId).toBe("asset-source");
  expect(mocked.getGraph().nodes.filter((item) => item.type === "candidate")).toHaveLength(2);
});
