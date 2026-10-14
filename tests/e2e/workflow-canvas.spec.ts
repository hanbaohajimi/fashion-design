import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const PROJECT_ID = "e2e-workflow-canvas";
const NOW = "2026-10-14T00:00:00.000Z";

type GraphNode = {
  id: string;
  kind: "asset" | "tool";
  type: string;
  title: string;
  payload: Record<string, unknown>;
  x: number;
  y: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};
type GraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort: "out";
  targetPort: string;
};
type Operation =
  | { type: "add_node"; node: Omit<GraphNode, "status" | "createdAt" | "updatedAt"> }
  | { type: "update_node"; nodeId: string; title?: string; payload?: Record<string, unknown> }
  | { type: "link_collection"; nodeId: string; collectionId: string }
  | { type: "add_edge"; edge: GraphEdge }
  | { type: "remove_node"; nodeId: string }
  | { type: "remove_edge"; edgeId: string };

function node(id: string, kind: GraphNode["kind"], type: string, title: string, x: number, y: number, payload: Record<string, unknown> = {}): GraphNode {
  return { id, kind, type, title, x, y, payload, status: "completed", createdAt: NOW, updatedAt: NOW };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, targetPort: string): GraphEdge {
  return { id, sourceNodeId, targetNodeId, sourcePort: "out", targetPort };
}

function sampleGraph() {
  return {
    projectId: PROJECT_ID,
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: true,
    nodes: [
      node("brief", "asset", "brief", "设计需求", 40, 120, { text: "秋冬通勤风衣，藏蓝色、宽松廓形。" }),
      node("reference", "asset", "reference_text", "参考素材", 40, 420, { text: "挺括面料；保留肩线。" }),
      node("analysis", "tool", "analyze_brief", "需求分析", 390, 260),
      node("constraint", "asset", "constraint", "设计约束", 740, 260, { text: "藏蓝色与宽松 H 型廓形" }),
      node("generate", "tool", "generate_design", "方案生成", 1090, 260),
      node("candidate-a", "asset", "candidate", "候选 A", 1440, 70, { assetId: "asset-a", text: "双排扣风衣" }),
      node("candidate-b", "asset", "candidate", "候选 B", 1440, 390, { assetId: "asset-b", text: "系带风衣" }),
      node("evaluate", "tool", "evaluate_design", "服装评估", 1090, 690),
      node("report", "asset", "evaluation", "评估报告", 1440, 690, { text: "候选 A 更符合目标" }),
    ],
    edges: [
      edge("e1", "brief", "analysis", "goal"),
      edge("e2", "reference", "analysis", "reference"),
      edge("e3", "analysis", "constraint", "source"),
      edge("e4", "constraint", "generate", "constraint"),
      edge("e5", "reference", "generate", "reference"),
      edge("e6", "generate", "candidate-a", "source"),
      edge("e7", "generate", "candidate-b", "source"),
      edge("e8", "candidate-a", "evaluate", "candidate"),
      edge("e9", "candidate-b", "evaluate", "candidate"),
      edge("e10", "constraint", "evaluate", "constraint"),
      edge("e11", "evaluate", "report", "source"),
    ],
  };
}

async function mockWorkflow(page: Page) {
  const graph = sampleGraph();
  let proposal: Record<string, unknown> | null = null;
  let executeCount = 0;
  let rejectNextSketch = false;
  let rejectNextRole = false;
  let inferRoleCount = 0;
  const proposalRequests: Array<{ content: string; referencedNodeIds: string[] }> = [];
  const chatRequests: Array<{ content: string; fileAssetIds: string[]; shapeIds: string[] }> = [];
  const conversations = [{ id: "chat-old", projectId: PROJECT_ID, title: "历史会话", createdAt: NOW, updatedAt: NOW, archivedAt: null }];

  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: "e2e-user", authId: "auth-e2e", email: "workflow@example.com", name: "Workflow E2E", avatar: null, createdAt: NOW, deletedAt: null },
    credits: { limit: 600, remaining: 500, used: 100 },
  } }));
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) => route.fulfill({ json: {
    id: PROJECT_ID, name: "秋冬通勤风衣", archived: false, createdAt: NOW, updatedAt: NOW,
    assetCount: 2, coverAssetId: null, coverUrl: null,
  } }));
  await page.route("**/api/design-assets/asset-*/thumbnail", (route) => route.fulfill({
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400'><rect width='300' height='400' fill='#e9e5df'/><path d='M100 60 150 35 200 60 235 130 190 145 185 345 115 345 110 145 65 130Z' fill='#263950'/></svg>",
    contentType: "image/svg+xml",
  }));
  await page.route("**/api/design-assets/asset-*/content", (route) => route.fulfill({
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400'><rect width='300' height='400' fill='#e9e5df'/><path d='M100 60 150 35 200 60 235 130 190 145 185 345 115 345 110 145 65 130Z' fill='#263950'/></svg>",
    contentType: "image/svg+xml",
  }));
  await page.route("**/api/design-assets/asset-*/versions?*", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/design-assets/asset-*/path", (route) => route.fulfill({ json: { steps: [], decisions: [], incomplete: false } }));
  await page.route("**/api/files/sign-upload", (route) => route.fulfill({ json: {
    file: { id: "sketch-file", status: "READY", thumbnail1024Url: "/api/files/sketch-file/thumbnail/1024", thumbnail256Url: null },
    upload: null,
  } }));
  await page.route("**/api/files/sketch-file/thumbnail/1024", (route) => route.fulfill({
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><path d='M120 40 170 40 225 245 70 245Z' fill='#40536d'/></svg>",
    contentType: "image/svg+xml",
  }));
  await page.route(`**/api/projects/${PROJECT_ID}/board`, (route) => route.fulfill({ json: { elements: [], revision: 0, snapshot: null } }));
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill({ json: graph });
    const body = route.request().postDataJSON() as {
      mode: "semantic" | "layout";
      operations?: Operation[];
      positions?: Array<{ nodeId: string; x: number; y: number }>;
    };
    if (body.mode === "semantic" && rejectNextSketch && body.operations?.some((item) => item.type === "add_node" && item.node.type === "sketch")) {
      rejectNextSketch = false;
      return route.fulfill({ json: { message: "图修订冲突，请重试" }, status: 409 });
    }
    if (body.mode === "semantic") {
      for (const operation of body.operations ?? []) {
        if (operation.type === "add_node") graph.nodes.push({ ...operation.node, status: "ready", createdAt: NOW, updatedAt: NOW });
        if (operation.type === "update_node") {
          const target = graph.nodes.find((item) => item.id === operation.nodeId);
          if (target) {
            if (operation.title !== undefined) target.title = operation.title;
            if (operation.payload !== undefined) target.payload = operation.payload;
            target.updatedAt = new Date().toISOString();
          }
        }
        if (operation.type === "link_collection") {
          const target = graph.nodes.find((item) => item.id === operation.nodeId);
          if (target) target.payload = { ...target.payload, collectionId: operation.collectionId };
        }
        if (operation.type === "add_edge") graph.edges.push(operation.edge);
        if (operation.type === "remove_node") {
          graph.nodes = graph.nodes.filter((item) => item.id !== operation.nodeId);
          graph.edges = graph.edges.filter((item) => item.sourceNodeId !== operation.nodeId && item.targetNodeId !== operation.nodeId);
        }
        if (operation.type === "remove_edge") graph.edges = graph.edges.filter((item) => item.id !== operation.edgeId);
      }
      graph.revision += 1;
    } else {
      for (const position of body.positions ?? []) {
        const target = graph.nodes.find((item) => item.id === position.nodeId);
        if (target) { target.x = position.x; target.y = position.y; }
      }
      graph.layoutRevision += 1;
    }
    return route.fulfill({ json: graph });
  });
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/sync")) return route.fulfill({ json: { ...graph, proposals: proposal ? [proposal] : [] } });
    if (path.endsWith("/proposals")) {
      const body = route.request().postDataJSON() as { content: string; referencedNodeIds: string[] };
      proposalRequests.push(body);
      const added = node("edit-proposed", "tool", "edit_design", "局部修改 A", 740, 690, {
        toolKey: "edit_design", toolVersion: "1", params: { prompt: body.content },
      });
      proposal = {
        id: "proposal-1", baseRevision: graph.revision, status: "pending", content: body.content,
        referencedNodeIds: body.referencedNodeIds, rationale: "保留候选 A 主体，单独调整袖型。",
        toolNodeId: added.id, createdAt: NOW,
        operations: [
          { type: "add_node", node: { id: added.id, kind: added.kind, type: added.type, title: added.title, payload: added.payload, x: added.x, y: added.y } },
          { type: "add_edge", edge: edge("edit-source", "candidate-a", added.id, "source") },
        ],
      };
      return route.fulfill({ json: proposal, status: 201 });
    }
    if (path.endsWith("/accept") && proposal) {
      const accepted = proposal as { operations: Operation[] };
      for (const operation of accepted.operations) {
        if (operation.type === "add_node") graph.nodes.push({ ...operation.node, status: "ready", createdAt: NOW, updatedAt: NOW });
        if (operation.type === "add_edge") graph.edges.push(operation.edge);
      }
      graph.revision += 1;
      proposal = null;
      return route.fulfill({ json: graph });
    }
    if (path.endsWith("/reject")) {
      proposal = null;
      return route.fulfill({ json: { ...graph, proposals: [] } });
    }
    if (path.endsWith("/execute")) {
      executeCount += 1;
      return route.fulfill({ json: graph });
    }
    if (path.endsWith("/infer-role")) {
      inferRoleCount += 1;
      if (rejectNextRole) {
        rejectNextRole = false;
        return route.fulfill({ status: 503, json: { message: "角色识别暂不可用" } });
      }
      const nodeId = path.split("/").at(-2);
      const target = graph.nodes.find((item) => item.id === nodeId);
      if (target) {
        target.payload = { ...target.payload, role: target.type === "sketch" ? "silhouette_ref" : "detail_ref", roleSource: "inferred", roleInferenceState: "ready", roleLabel: target.type === "sketch" ? "廓形草图" : "细节参考" };
        target.updatedAt = new Date().toISOString();
        graph.revision += 1;
      }
      return route.fulfill({ json: graph });
    }
    if (path.endsWith("/history")) return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 404 });
  });
  await page.route(`**/api/projects/${PROJECT_ID}/agent-conversations*`, (route) => {
    if (route.request().method() === "POST") {
      const created = { id: "chat-new", projectId: PROJECT_ID, title: "新会话", createdAt: NOW, updatedAt: NOW, archivedAt: null };
      conversations.unshift(created);
      return route.fulfill({ json: created, status: 201 });
    }
    return route.fulfill({ json: { items: conversations, nextCursor: null } });
  });
  await page.route("**/api/agent-conversations/*/messages*", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { content: string; fileAssetIds: string[]; shapeIds: string[] };
      chatRequests.push(body);
      return route.fulfill({ json: {
        userMessage: { id: "new-user", content: body.content, role: "user", status: "completed" },
        assistantMessage: { id: "new-assistant", content: "已收到，继续设计。", role: "assistant", status: "completed" },
        taskId: null,
      }, status: 201 });
    }
    return route.fulfill({ json: { items: path.includes("chat-old") ? [{ id: "old-message", content: "历史消息", role: "user", status: "completed" }] : [], nextCursor: null } });
  });
  return { getGraph: () => graph, getExecuteCount: () => executeCount, getInferRoleCount: () => inferRoleCount, rejectSketchOnce: () => { rejectNextSketch = true; }, rejectRoleOnce: () => { rejectNextRole = true; }, proposalRequests, chatRequests };
}

test("主画布完整显示设计路径，节点保存与拖拽可在刷新后恢复", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  const canvas = page.getByRole("region", { name: "设计工作流画布" });
  const report = canvas.locator('[data-type="evaluation"]');
  await expect(report).toBeVisible();
  await expect(canvas.locator('[data-type="candidate"]')).toHaveCount(2);
  const reportBox = await report.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(reportBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect((reportBox?.x ?? Infinity) + (reportBox?.width ?? Infinity)).toBeLessThan((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0));
  const menuBox = await page.getByRole("button", { name: "＋ 添加素材" }).boundingBox();
  expect((reportBox?.y ?? Infinity) + (reportBox?.height ?? Infinity)).toBeLessThan(menuBox?.y ?? 0);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/workflow-canvas-1440-verified.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "output/playwright/workflow-canvas-1920-verified.png" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "＋ 添加工具" }).click();
  await page.getByRole("button", { name: /局部修改 候选/ }).click();
  await expect(canvas.locator('[data-type="edit_design"]')).toHaveCount(1);
  const newNode = mocked.getGraph().nodes.find((item) => item.type === "edit_design");
  expect(newNode).toBeDefined();
  await page.reload();
  await expect(canvas.locator('[data-type="edit_design"]')).toHaveCount(1);

  const shape = canvas.locator('[data-type="brief"]');
  const before = await shape.boundingBox();
  expect(before).not.toBeNull();
  const x = (before?.x ?? 0) + (before?.width ?? 0) / 2;
  const y = (before?.y ?? 0) + (before?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => mocked.getGraph().layoutRevision).toBeGreaterThan(0);
  const savedPosition = mocked.getGraph().nodes.find((item) => item.id === "brief");
  await page.reload();
  expect(mocked.getGraph().nodes.find((item) => item.id === "brief")?.x).toBe(savedPosition?.x);
});

test("@节点提案先以虚线预览，确认后保留分支且不自动执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await expect(page.getByText("保持藏蓝与宽松廓形，给我两种通勤风衣方案。")).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("请修改 @候选");
  await page.getByRole("option", { name: /候选 A/ }).click();
  await expect(composer).toHaveValue("请修改 @候选 A ");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.getByText("请修改 @候选 A", { exact: false })).toBeVisible();
  await expect(page.locator('[data-type="edit_design"][data-status="proposed"]')).toBeVisible();
  expect(mocked.proposalRequests[0]?.referencedNodeIds).toEqual(["candidate-a"]);
  expect(mocked.getExecuteCount()).toBe(0);
  await page.getByRole("button", { name: "确认加入画布" }).click();
  await expect(page.locator('[data-type="edit_design"][data-status="ready"]')).toBeVisible();
  expect(mocked.getGraph().edges.some((item) => item.id === "edit-source")).toBe(true);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("普通聊天保留历史与新会话；手机节点列表及菜单无横向溢出", async ({ page }) => {
  test.setTimeout(60_000);
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "节点列表" }).click();
  await expect(page.getByRole("listitem").filter({ has: page.getByText("候选 A", { exact: true }) })).toBeVisible();
  await page.getByRole("button", { name: "＋ 添加工具" }).click();
  const menuBox = await page.getByRole("button", { name: /局部修改 候选/ }).boundingBox();
  expect((menuBox?.x ?? -1) >= 0).toBe(true);
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? Infinity)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("button", { name: "关闭菜单" }).click();

  await page.getByRole("button", { name: "普通聊天" }).click();
  await expect(page.getByText("历史消息")).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "＋ 新会话" }).click();
  await page.getByRole("combobox", { name: "历史会话" }).selectOption("chat-old");
  await expect(page.getByText("历史消息")).toBeVisible();
  await page.getByRole("combobox", { name: "历史会话" }).selectOption("chat-new");
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("比较两张风衣图");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.getByText("已收到，继续设计。")).toBeVisible();
  expect(mocked.chatRequests[0]).toMatchObject({ content: "比较两张风衣图", fileAssetIds: [], shapeIds: [] });
});

test("候选的大图、版本、局部重绘入口和新草图保存均可从主画布到达", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.locator('[data-type="candidate"]').first().click();
  await page.getByRole("tab", { name: "节点详情" }).click();
  await page.getByRole("button", { name: "打开大图、版本与局部重绘" }).click();
  const workspace = page.getByRole("dialog", { name: "候选资产工作台" });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("button", { name: "单图高清导出" })).toBeVisible();
  await workspace.getByRole("button", { name: "版本历史" }).click();
  await expect(workspace.getByRole("region", { name: "版本时间线" })).toBeVisible();
  await workspace.getByRole("button", { name: "局部重绘" }).click();
  await expect(workspace.getByRole("textbox", { name: "局部重绘说明" })).toBeVisible();
  await workspace.getByRole("button", { name: "关闭候选工作台" }).click();

  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: /廓形草图/ }).click();
  const sketch = page.getByRole("dialog", { name: "绘制廓形草图" });
  await expect(sketch).toBeVisible();
  const sketchCanvas = sketch.locator('canvas[aria-label="廓形草图画布"]');
  const bounds = await sketchCanvas.boundingBox();
  expect(bounds).not.toBeNull();
  const x = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
  const y = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
  await page.mouse.move(x - 25, y - 40);
  await page.mouse.down();
  await page.mouse.move(x + 25, y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(sketch.getByRole("button", { name: "保存到工作流" })).toBeEnabled();
  await sketch.getByRole("button", { name: "保存到工作流" }).click();
  await expect(sketch).toHaveCount(0);
  const created = mocked.getGraph().nodes.find((item) => item.type === "sketch");
  expect(created?.payload.fileAssetId).toBe("sketch-file");
  expect(created?.payload).toMatchObject({ role: "silhouette_ref", roleSource: "inferred", roleInferenceState: "ready" });
  await expect(page.locator('[data-type="sketch"]')).toHaveCount(1);

  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: /廓形草图/ }).click();
  const retryCanvas = sketch.locator('canvas[aria-label="廓形草图画布"]');
  const retryBounds = await retryCanvas.boundingBox();
  const retryX = (retryBounds?.x ?? 0) + (retryBounds?.width ?? 0) / 2;
  const retryY = (retryBounds?.y ?? 0) + (retryBounds?.height ?? 0) / 2;
  await page.mouse.move(retryX - 20, retryY - 20);
  await page.mouse.down();
  await page.mouse.move(retryX + 20, retryY + 20, { steps: 6 });
  await page.mouse.up();
  mocked.rejectSketchOnce();
  await sketch.getByRole("button", { name: "保存到工作流" }).click();
  await expect(sketch).toBeVisible();
  await expect(sketch.getByRole("alert")).toContainText("图修订冲突");
});

test("未执行工具可保存真实参数；历史显示来源和模型，完成后不再提供执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const generate = mocked.getGraph().nodes.find((item) => item.id === "generate");
  expect(generate).toBeDefined();
  if (!generate) return;
  generate.status = "ready";
  generate.payload = { toolKey: "generate_design", toolVersion: "1", params: { prompt: "原始风衣", count: 2, width: 768, height: 1024 } };
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/nodes/generate/history`, (route) => route.fulfill({ json: { items: [{
    id: "attempt-one", ordinal: 1, status: "completed", generationTaskId: "task-one", error: null, createdAt: NOW,
    request: { model: "test-image-model", prompt: "新版通勤风衣", negativePrompt: "避免亮面", width: 1024, height: 1024, inputNodeIds: ["constraint", "reference"], referenceInputs: [{ role: "style_ref", weight: 0.7 }] },
  }] } }));
  await page.goto(`/${PROJECT_ID}`);
  await page.locator('[data-type="generate_design"]').click();
  const details = page.getByRole("complementary", { name: "设计助手与节点详情" });
  await expect(details.getByRole("textbox", { name: "执行指令" })).toHaveValue("原始风衣");
  await details.getByRole("textbox", { name: "执行指令" }).fill("新版通勤风衣");
  await details.getByRole("textbox", { name: "排除内容" }).fill("避免亮面");
  await details.getByRole("spinbutton", { name: "候选数量" }).fill("3");
  await details.getByRole("spinbutton", { name: "宽度" }).fill("1024");
  await expect(details.getByRole("button", { name: "确认并执行" })).toBeDisabled();
  await details.getByRole("button", { name: "保存工具参数" }).click();
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.id === "generate")?.payload.params).toMatchObject({ prompt: "新版通勤风衣", negativePrompt: "避免亮面", count: 3, width: 1024, height: 1024 });
  await expect(details.getByRole("button", { name: "确认并执行" })).toBeEnabled();
  await details.getByRole("button", { name: "查看尝试记录" }).click();
  await expect(details.getByText("模型：test-image-model")).toBeVisible();
  await expect(details.getByText("来源：设计约束、参考素材")).toBeVisible();
  await details.getByRole("button", { name: "确认并执行" }).click();
  expect(mocked.getExecuteCount()).toBe(1);
  generate.status = "completed";
  await page.reload();
  await page.locator('[data-type="generate_design"]').click();
  await expect(details.getByRole("button", { name: "确认并执行" })).toHaveCount(0);
  await expect(details.getByRole("textbox", { name: "执行指令" })).toBeDisabled();
});

test("同名节点仅引用 @列表里明确选中的那条分支", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getGraph().nodes.push(node("candidate-a-branch", "asset", "candidate", "候选 A", 1770, 390, { assetId: "asset-b" }));
  await page.goto(`/${PROJECT_ID}`);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("请修改 @候选 A ");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.getByRole("complementary", { name: "设计助手与节点详情" }).getByRole("alert")).toContainText("请从 @列表选择准确节点");
  expect(mocked.proposalRequests).toHaveLength(0);
  await composer.fill("请修改 @候选");
  await page.getByRole("option", { name: /候选 A/ }).last().click();
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.proposalRequests.length).toBe(1);
  expect(mocked.proposalRequests[0]?.referencedNodeIds).toEqual(["candidate-a-branch"]);
});

test("普通会话可只读查看旧设计运行的简报、尝试和人工决定", async ({ page }) => {
  await mockWorkflow(page);
  await page.route("**/api/agent-conversations/chat-old/plans", (route) => route.fulfill({ json: { items: [{ id: "legacy-run", intent: "秋冬风衣设计", status: "completed", createdAt: NOW }] } }));
  await page.route("**/api/agent-runs/legacy-run", (route) => route.fulfill({ json: {
    id: "legacy-run", projectId: PROJECT_ID, conversationId: "chat-old", intent: "秋冬风衣设计", status: "completed", revision: 4, createdAt: NOW, updatedAt: NOW, error: null,
    intelligence: { brief: { summary: "藏蓝色通勤风衣", constraints: [{ id: "c1", priority: "must", requirement: "保留宽松廓形" }] }, actions: [] },
    steps: [{ id: "step-one", key: "generate", ordinal: 0, title: "方案生成", instruction: "参考挺括面料", prompt: "藏蓝风衣", negativePrompt: "", sourceAssetId: null, sourceStepKey: null, tool: "generate_design", status: "succeeded", generationTaskId: "task-one", selectedAssetId: "asset-a", candidates: [], error: null, attempts: [{ id: "try-one", ordinal: 1, status: "rejected", generationTaskId: "task-old", prompt: "亮面风衣", negativePrompt: "", parentAssetId: null, candidates: [], error: "反光过强", createdAt: NOW }] }],
  } }));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "普通聊天" }).click();
  await page.getByRole("button", { name: "查看旧设计运行历史" }).click();
  const history = page.getByRole("region", { name: "旧设计运行历史" });
  await history.getByRole("button", { name: /秋冬风衣设计/ }).click();
  const detail = history.getByRole("region", { name: "旧运行详情" });
  await expect(detail.getByText("藏蓝色通勤风衣")).toBeVisible();
  await expect(detail.getByText("人工选定：asset-a")).toBeVisible();
  await expect(detail.getByText("否决理由：反光过强")).toBeVisible();
  await expect(detail.getByRole("button", { name: /执行|保存|编辑/ })).toHaveCount(0);
});

test("上传参考图会自动识别角色，失败可重试并可由设计师手动指定", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.rejectRoleOnce();
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: /上传图片/ }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "袖口参考.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lJ8AAAAASUVORK5CYII=", "base64"),
  });
  await expect.poll(() => mocked.getGraph().nodes.filter((item) => item.type === "reference_image").length).toBe(1);
  const uploaded = mocked.getGraph().nodes.find((item) => item.type === "reference_image");
  expect(uploaded?.payload).toMatchObject({ fileAssetId: "sketch-file", role: "style_ref", roleSource: "default", roleInferenceState: "pending" });
  await expect(page.getByRole("complementary", { name: "设计助手与节点详情" }).getByRole("alert")).toContainText("角色识别暂不可用");
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.locator('[data-type="reference_image"]').click();
  const details = page.getByRole("complementary", { name: "设计助手与节点详情" });
  await details.getByRole("button", { name: "识别参考角色" }).click();
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.type === "reference_image")?.payload.roleSource).toBe("inferred");
  expect(mocked.getInferRoleCount()).toBe(2);
  await details.getByRole("combobox", { name: "参考图角色" }).selectOption("palette_ref");
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.type === "reference_image")?.payload.roleSource).toBe("manual");
  expect(mocked.getGraph().nodes.find((item) => item.type === "reference_image")?.payload.role).toBe("palette_ref");
  await expect(details.getByRole("button", { name: /识别参考角色/ })).toHaveCount(0);
});

test("候选建立系列后图中保存关联，再打开不会重复创建", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  let createCalls = 0;
  const collection = {
    id: "collection-one", projectId: PROJECT_ID, name: "秋冬风衣系列", createdAt: NOW, updatedAt: NOW,
    sourceGarmentType: null,
    hero: { assetId: "asset-a", url: "/api/design-assets/asset-a/content", thumbnailUrl: "/api/design-assets/asset-a/thumbnail" },
    dna: { extractionStatus: "ready", fabrics: [], locks: { fabrics: false, moodWords: false, palette: false, silhouettes: false }, moodWords: [], palette: [], referenceFileIds: [], signatureDetails: [], silhouettes: [], updatedAt: NOW },
  };
  await page.route("**/api/collections", (route) => {
    createCalls += 1;
    return route.fulfill({ status: 201, json: collection });
  });
  await page.route("**/api/collections/collection-one", (route) => route.fulfill({ json: collection }));
  await page.route("**/api/collections/collection-one/consistency", (route) => route.fulfill({ json: { looks: [], referenceLabel: "参考相似度", similarities: [] } }));
  await page.route("**/api/generations?*", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.goto(`/${PROJECT_ID}`);
  await page.locator('[data-type="candidate"]').filter({ hasText: "候选 A" }).click();
  const details = page.getByRole("complementary", { name: "设计助手与节点详情" });
  await details.getByRole("button", { name: "设为 Hero / 建立系列" }).click();
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.id === "candidate-a")?.payload.collectionId).toBe("collection-one");
  await page.getByRole("button", { name: "关闭系列抽屉" }).click();
  await expect(details.getByText("已关联系列：collection-one")).toBeVisible();
  await details.getByRole("button", { name: "打开关联系列" }).click();
  const drawer = page.getByRole("dialog", { name: "系列 DNA" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Look 扩展" }).click();
  await expect(drawer.getByText("服装类型")).toBeVisible();
  expect(createCalls).toBe(1);
});

test("普通聊天的待处理回复自动更新为终态且不会重复追加", async ({ page }) => {
  test.setTimeout(60_000);
  await mockWorkflow(page);
  let reads = 0;
  await page.route("**/api/agent-conversations/chat-old/messages*", (route) => {
    reads += 1;
    return route.fulfill({ json: { items: [
      { id: "user-one", content: "比较两张风衣", role: "user", status: "completed" },
      { id: "assistant-one", content: reads === 1 ? "正在分析…" : "藏蓝方案更贴近通勤需求。", role: "assistant", status: reads === 1 ? "pending" : "completed" },
    ], nextCursor: null } });
  });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "普通聊天" }).click();
  await expect(page.getByText("正在分析…")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("藏蓝方案更贴近通勤需求。")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  expect(reads).toBeGreaterThanOrEqual(2);
});

test("跨窗口读取到待识别参考图时会同步最终角色", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const reference = node("role-pending", "asset", "reference_image", "待识别袖口图", 40, 700, {
    fileAssetId: "sketch-file", role: "style_ref", roleSource: "default", roleInferenceState: "pending",
  });
  reference.status = "ready";
  mocked.getGraph().nodes.push(reference);
  let reads = 0;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/sync`, (route) => {
    reads += 1;
    if (reads > 1) {
      reference.payload = { ...reference.payload, role: "detail_ref", roleSource: "inferred", roleInferenceState: "ready", roleLabel: "细节参考" };
      mocked.getGraph().revision += 1;
    }
    return route.fulfill({ json: { ...mocked.getGraph(), proposals: [] } });
  });
  await page.goto(`/${PROJECT_ID}`);
  await expect(page.locator('[data-type="reference_image"]')).toHaveCount(1);
  await page.locator('[data-type="reference_image"]').click();
  const details = page.getByRole("complementary", { name: "设计助手与节点详情" });
  await expect(details.getByText(/当前标签：细节参考/)).toBeVisible({ timeout: 10_000 });
  await expect(details.getByRole("button", { name: /识别参考角色/ })).toHaveCount(0);
  expect(reads).toBeGreaterThanOrEqual(2);
});

test("较新的语义响应不会把已保存的节点位置回退到旧布局", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getGraph().layoutRevision = 2;
  let reads = 0;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/sync`, async (route) => {
    reads += 1;
    if (reads === 1) return route.fulfill({ json: { ...mocked.getGraph(), proposals: [] } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const stale = {
      ...mocked.getGraph(), revision: 2, layoutRevision: 1,
      nodes: [
        ...mocked.getGraph().nodes.map((item) => item.id === "brief" ? { ...item, x: -700 } : item),
        node("late-reference", "asset", "reference_text", "延迟到达的语义节点", 40, 850, { text: "补充袖口参考" }),
      ],
      proposals: [],
    };
    return route.fulfill({ json: stale });
  });
  await page.goto(`/${PROJECT_ID}`);
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  const before = await brief.boundingBox();
  expect(before).not.toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(page.locator('[data-type="reference_text"]').filter({ hasText: "延迟到达的语义节点" })).toHaveCount(1);
  const after = await brief.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
});

test("主工作流禁用自由绘图和复制快捷键，不产生图外节点", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const canvas = page.getByRole("application", { name: "tldraw" });
  await expect(page.locator('[data-type="brief"]')).toBeVisible();
  const shapeCount = await canvas.locator(".tl-shape").count();
  expect(shapeCount).toBeGreaterThan(0);
  const graphCount = mocked.getGraph().nodes.length;
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const x = (bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.35;
  const y = (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.75;
  await page.mouse.click(x, y);
  await page.keyboard.press("r");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y - 65, { steps: 8 });
  await page.mouse.up();
  await page.locator('[data-type="brief"]').click();
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+c");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("图外的粘贴文本"));
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => canvas.locator(".tl-shape").count()).toBe(shapeCount);
  await expect(page.locator('[data-type="brief"]')).toHaveCount(1);
  expect(mocked.getGraph().nodes).toHaveLength(graphCount);
});
