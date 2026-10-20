import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { REVIEW_VIEWPORTS, contrastFailures, controlFontFailures, tabTo } from "./review-accessibility";

const PROJECT_ID = "e2e-workflow-canvas";
const NOW = "2026-10-14T00:00:00.000Z";

async function showCanvas(page: Page, width: number) {
  if (width < 768) await page.getByRole("button", { name: "画布", exact: true }).click();
  else if (width < 1100 && await page.getByRole("button", { name: "收起设计助手" }).isVisible()) await page.getByRole("button", { name: "收起设计助手" }).click();
}
async function showAssistant(page: Page, width: number) {
  if (width < 768) await page.getByRole("button", { name: "助手", exact: true }).click();
  else if (await page.getByRole("button", { name: "展开设计助手" }).isVisible()) await page.getByRole("button", { name: "展开设计助手" }).click();
}

test("帮助提示可键盘关闭，草图窗口圈定焦点并返回素材入口", async ({ page }) => {
  await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const help = page.getByRole("button", { name: "工作室帮助", exact: true });
  await help.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  const tip = await page.getByRole("tooltip").boundingBox();
  expect(tip!.x).toBeGreaterThanOrEqual(0);
  expect(tip!.x + tip!.width).toBeLessThanOrEqual(1280);
  await help.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(help).toBeFocused();
  await help.press("Enter");
  const guide = page.getByRole("dialog", { name: "工作室使用帮助" });
  await expect(guide).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  const trigger = page.getByRole("button", { name: "＋ 添加素材", exact: true });
  await trigger.click();
  await page.getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true }).click();
  const sketch = page.getByRole("dialog", { name: "绘制廓形草图" });
  await expect(sketch.getByRole("textbox", { name: "素材名称" })).toBeFocused();
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press("Tab");
    expect(await sketch.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sketch).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("阅读历史时新消息不会抢走滚动位置，点击提示后回到最新消息", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.setMessages(Array.from({ length: 12 }, (_, index) => ({
    id: `reading-${index}`, role: "assistant", status: "completed", kind: "reply", proposal: null,
    content: `第 ${index + 1} 条设计讨论\n${"继续比较廓形、面料与细节。".repeat(20)}`, createdAt: NOW,
  })));
  await page.goto(`/${PROJECT_ID}`);
  const conversation = page.getByLabel("设计对话", { exact: true });
  await expect(page.getByText("第 12 条设计讨论", { exact: false })).toBeVisible();
  await conversation.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  mocked.appendMessage({ id: "reading-latest", role: "assistant", status: "completed", kind: "reply", proposal: null, content: "新到达的设计分析", createdAt: NOW });
  const jump = page.getByRole("button", { name: "有新消息 ↓", exact: true });
  await expect(jump).toBeVisible();
  expect(await conversation.evaluate((element) => element.scrollTop)).toBeLessThan(40);
  await jump.click();
  await expect(jump).toHaveCount(0);
  await expect.poll(() => conversation.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(80);
});

test("工作室详情草稿在对话切换和同步后保留；侧栏支持键盘调整", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const tool = mocked.getGraph().nodes.find((node) => node.id === "generate")!;
  tool.status = "ready";
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.locator('[data-type="generate_design"]').first().click();
  await page.getByRole("button", { name: "节点详情", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: "执行指令", exact: true });
  await prompt.fill("尚未保存的领口修改");
  await page.getByRole("button", { name: "返回对话" }).click();
  await page.getByRole("button", { name: "节点详情", exact: true }).click();
  await expect(prompt).toHaveValue("尚未保存的领口修改");
  await page.waitForTimeout(3200);
  await expect(prompt).toHaveValue("尚未保存的领口修改");
  const separator = page.getByRole("separator", { name: "调整侧栏宽度" });
  const before = Number(await separator.getAttribute("aria-valuenow"));
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 16));
  await page.getByRole("button", { name: "返回对话" }).click();
  await page.locator('[data-type="candidate"]').first().click();
  await page.getByRole("button", { name: "节点详情", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "保留未保存的参数" })).toBeVisible();
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveValue("尚未保存的领口修改");
});

test("统一工作区在桌面、抽屉及手机视图保持操作可达", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkflow(page);
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/${PROJECT_ID}`);
  await mkdir("output/playwright/atelier", { recursive: true });
  // 683×384 also checks the CSS viewport available at 200% zoom on 1366×768.
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 683, height: 384 }]) {
    await page.setViewportSize(viewport);
    await showCanvas(page, viewport.width);
    await page.getByRole("button", { name: "适合画布" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (viewport.width >= 1100) {
      await expect(page.locator("main > header")).toHaveCSS("height", "56px");
      const bounds = await page.getByRole("region", { name: "设计工作流画布" }).boundingBox();
      expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(640);
    }
    await page.screenshot({ path: `output/playwright/atelier/studio-${viewport.width}.png` });
    await showAssistant(page, viewport.width);
    await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeVisible();
    await expect(page.getByRole("button", { name: "发送 ↑", exact: true })).toBeInViewport({ ratio: 1 });
    const send = await page.getByRole("button", { name: "发送 ↑", exact: true }).boundingBox();
    const license = page.getByRole("button", { name: "Get a license for production", exact: true });
    // Canvas visibility can remove the SDK badge between two locator reads.
    const badge = await license.evaluateAll((elements) => {
      const element = elements.find((item) => item.checkVisibility({ checkVisibilityCSS: true }));
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    if (send && badge) {
      if (badge) expect(send.x + send.width <= badge.x || send.x >= badge.x + badge.width || send.y + send.height <= badge.y || send.y >= badge.y + badge.height, "SDK 标识不能遮挡发送按钮").toBe(true);
    }
    await page.screenshot({ path: `output/playwright/atelier/assistant-${viewport.width}.png` });
    const actions = page.getByText("更多", { exact: true });
    await actions.click();
    const actionBounds = await page.getByRole("button", { name: "暂停设计协作", exact: true }).boundingBox();
    expect(actionBounds).not.toBeNull();
    expect(actionBounds!.y).toBeGreaterThanOrEqual(0);
    expect(actionBounds!.y + actionBounds!.height).toBeLessThanOrEqual(viewport.height);
    await actions.press("Escape");
    await expect(actions).toBeFocused();
  }
});

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
  canDelete?: boolean;
  deleteDisabledReason?: string | null;
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
  let failNextMessage = false;
  let agentVersion = 2;
  let currentPlan: Record<string, unknown> | null = null;
  const executionRequests: Array<Record<string, unknown>> = [];
  const rejectionRequests: Array<Record<string, unknown>> = [];
  const workflowRequests: Array<{ clientRequestId: string; content: string; referencedNodeIds: string[]; focusNodeIds?: string[]; respondingToProposalId?: string }> = [];
  const proposalRequests: Array<{ content: string; referencedNodeIds: string[] }> = [];
  const chatRequests: Array<{ content: string; fileAssetIds: string[]; shapeIds: string[] }> = [];
  const conversations = [
    { id: "workflow-current", mode: "workflow", projectId: PROJECT_ID, title: "通勤风衣协作", createdAt: NOW, updatedAt: NOW, archivedAt: null },
    { id: "chat-old", mode: "legacy", projectId: PROJECT_ID, title: "历史会话", createdAt: NOW, updatedAt: NOW, archivedAt: null },
  ];
  const workflowMessages = new Map<string, Array<Record<string, unknown>>>();
  const contextPatches: Array<Record<string, unknown>> = [];
  const storedPreferences = [{ id: "prefer-matte", text: "偏好哑光面料", status: "active", origin: "inferred", scope: "project", sourceQuote: "上次否决了强反光方案", branchNodeIds: [] as string[], sourceNodeIds: [] as string[] }];
  const context = {
    revision: 1, summaryRevision: 0, currentObjective: "秋冬通勤风衣", currentTask: "比较已有候选", focusNodeIds: [] as string[],
    requirements: [{ id: "must-navy", text: "保留藏蓝色", status: "active", origin: "explicit", sourceQuote: "藏蓝色、宽松廓形", scope: "project" }],
    preferences: storedPreferences.slice(), state: { preferences: storedPreferences },
    scopedMemory: [] as Array<{ id: string; branchNodeIds: string[]; applicable: boolean }>,
    nodes: graph.nodes.map(({ id, title, type, kind }) => ({ id, title, type, kind })),
    visualCoverage: { total: 2, ready: 1, pending: 1, failed: 0, attachedNodeIds: ["candidate-a"] },
  };
  const projectContext = () => {
    const related = new Set(context.focusNodeIds);
    for (const direction of ["upstream", "downstream"]) {
      const seen = new Set(context.focusNodeIds);
      const pending = [...context.focusNodeIds];
      while (pending.length) {
        const id = pending.pop();
        for (const connection of graph.edges) {
          const next = direction === "upstream" ? connection.targetNodeId === id ? connection.sourceNodeId : null : connection.sourceNodeId === id ? connection.targetNodeId : null;
          if (next && !seen.has(next)) { seen.add(next); related.add(next); pending.push(next); }
        }
      }
    }
    const applicable = (item: (typeof storedPreferences)[number]) => item.status === "active" && (item.scope === "project" || item.branchNodeIds.some((id) => related.has(id)));
    context.preferences = storedPreferences.filter(applicable);
    context.scopedMemory = storedPreferences.filter((item) => item.status === "active" && item.scope === "branch").map((item) => ({ id: item.id, branchNodeIds: item.branchNodeIds, applicable: applicable(item) }));
    return context;
  };

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
    if (path.endsWith("/tools")) return route.fulfill({ json: { agentVersion, tools: [] } });
    if (path.endsWith("/agent-settings")) { agentVersion = route.request().postDataJSON().version; return route.fulfill({ json: { version: agentVersion } }); }
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
        if (operation.type === "remove_edge") graph.edges = graph.edges.filter((item) => item.id !== operation.edgeId);
        if (operation.type === "update_node") { const target = graph.nodes.find((item) => item.id === operation.nodeId); if (target) { if (operation.title) target.title = operation.title; if (operation.payload) target.payload = operation.payload; target.updatedAt = new Date().toISOString(); } }
      }
      graph.revision += 1;
      proposal.status = "accepted";
      proposal = null;
      return route.fulfill({ json: graph });
    }
    if (path.endsWith("/reject")) {
      rejectionRequests.push(route.request().postDataJSON());
      if (proposal) proposal.status = "rejected";
      proposal = null;
      return route.fulfill({ json: { ...graph, proposals: [] } });
    }
    if (path.endsWith("/execute")) {
      executeCount += 1;
      executionRequests.push(route.request().postDataJSON());
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
      const created = { id: "chat-new", mode: "workflow", projectId: PROJECT_ID, title: "新会话", createdAt: NOW, updatedAt: NOW, archivedAt: null };
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
    const id = path.split("/").at(-2) ?? "";
    return route.fulfill({ json: { items: path.includes("chat-old") ? [{ id: "old-message", content: "历史消息", role: "user", status: "completed" }] : workflowMessages.get(id) ?? [], nextCursor: null } });
  });
  await page.route("**/api/agent-conversations/*/context", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      contextPatches.push(body);
      if (body.currentObjective !== undefined) context.currentObjective = body.currentObjective;
      if (body.focusNodeIds !== undefined) { context.focusNodeIds = body.focusNodeIds; context.summaryRevision += 1; }
      for (const id of body.disabledPreferenceIds ?? []) {
        const preference = storedPreferences.find((item) => item.id === id);
        if (preference) preference.status = "inactive";
      }
      for (const update of body.updatedItems ?? []) {
        const item = [...context.requirements, ...storedPreferences].find((entry) => entry.id === update.id);
        if (item && update.text) item.text = update.text;
        if (item && update.scope) item.scope = update.scope;
        if (item && update.confirm) item.origin = "explicit";
      }
      context.revision += 1;
    }
    return route.fulfill({ json: projectContext() });
  });
  await page.route("**/api/agent-conversations/*/plan", (route) => route.fulfill({ json: { revision: 1, plan: currentPlan } }));
  await page.route("**/api/agent-conversations/*/workflow-messages", (route) => {
    const body = route.request().postDataJSON() as { clientRequestId: string; content: string; referencedNodeIds: string[]; focusNodeIds?: string[]; respondingToProposalId?: string };
    workflowRequests.push(body);
    const conversationId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    const history = workflowMessages.get(conversationId) ?? [];
    if (body.respondingToProposalId) for (const message of history) {
      const prior = message.proposal as { id?: string; status?: string } | null;
      if (prior?.id === body.respondingToProposalId) prior.status = "superseded";
    }
    const previous = history.findIndex((message) => message.clientRequestId === body.clientRequestId);
    const ordinal = previous >= 0 ? previous : history.length;
    const failed = failNextMessage;
    failNextMessage = false;
    if (!failed && body.focusNodeIds !== undefined) { context.focusNodeIds = body.focusNodeIds; context.summaryRevision += 1; }
    const isReply = body.content.includes("比较两张风衣图");
    if (!isReply) {
      proposalRequests.push(body);
      const added = node(`edit-proposed-${ordinal}`, "tool", "edit_design", "局部修改 A", 740, 690, { toolKey: "edit_design", toolVersion: "1", params: { prompt: body.content } });
      proposal = { id: `proposal-${ordinal}`, baseRevision: graph.revision, status: "pending", content: body.content, referencedNodeIds: body.referencedNodeIds, rationale: "保留候选 A 主体，单独调整袖型。", toolNodeId: added.id, createdAt: NOW, operations: [
        { type: "add_node", node: { id: added.id, kind: added.kind, type: added.type, title: added.title, payload: added.payload, x: added.x, y: added.y } },
        { type: "add_edge", edge: edge("edit-source", "candidate-a", added.id, "source") },
      ] };
    }
    const userMessage = { id: `user-${ordinal}`, clientRequestId: body.clientRequestId, content: body.content, role: "user", status: "completed", context: { referencedNodeIds: body.referencedNodeIds, focusNodeIds: body.focusNodeIds ?? null, respondingToProposalId: body.respondingToProposalId ?? null } };
    const assistantMessage = { id: `assistant-${ordinal}`, replyToId: userMessage.id, content: failed ? "本轮分析未完成，请重试。" : isReply ? "已收到，继续设计。" : "可以保留主体，单独调整袖型。", role: "assistant", status: failed ? "failed" : "completed", kind: isReply ? "reply" : "propose", proposal: isReply ? null : proposal, context: projectContext(), error: failed ? { code: "WORKFLOW_ASSISTANT_FAILED", message: "设计助手暂时无法完成请求，可以重试" } : null };
    if (previous >= 0) history.splice(previous, 2, userMessage, assistantMessage);
    else history.push(userMessage, assistantMessage);
    workflowMessages.set(conversationId, history);
    return route.fulfill({ status: 201, json: { userMessage, assistantMessage } });
  });
  return { getGraph: () => graph, getExecuteCount: () => executeCount, getInferRoleCount: () => inferRoleCount, rejectSketchOnce: () => { rejectNextSketch = true; }, rejectRoleOnce: () => { rejectNextRole = true; }, failMessageOnce: () => { failNextMessage = true; }, setPendingProposal: (value: Record<string, unknown>) => { proposal = value; }, proposalRequests, chatRequests, workflowRequests, contextPatches, executionRequests, rejectionRequests, getContext: () => context, setPlan: (value: Record<string, unknown>) => { currentPlan = value; }, setMessages: (items: Array<Record<string, unknown>>) => workflowMessages.set("workflow-current", items), appendMessage: (value: Record<string, unknown>) => { const items = workflowMessages.get("workflow-current") ?? []; items.push(value); workflowMessages.set("workflow-current", items); }, clearConversations: () => { conversations.length = 0; } };
}

test("Fig8 原卡配置预览保留位置与数量，确认修改不会执行", async ({ page }) => {
  // Keep artifact capture independent of optional external canvas fonts.
  await page.route(/\.(?:woff2?|ttf|otf)(?:\?.*)?$/u, (route) => route.abort());
  const mocked = await mockWorkflow(page);
  const draft = node("fig8-draft", "tool", "generate_design", "待执行生成", 1080, 1050, { params: { prompt: "原方案", count: 2 } });
  draft.status = "ready";
  mocked.getGraph().nodes.push(draft);
  mocked.getGraph().edges.push(edge("fig8-old-input", "constraint", draft.id, "constraint"));
  const proposal = { id: "fig8-configure", schemaVersion: 2, baseRevision: 1, status: "pending", rationale: "只修改候选数量", content: "生成四张", toolNodeId: draft.id, referencedNodeIds: ["constraint"], createdAt: NOW,
    action: { type: "configure_tool", toolKey: "generate_design", toolVersion: "1", targetNodeId: draft.id, targetNodeVersionId: "version-1", title: "四个风衣方案", parameters: { prompt: "保留藏蓝和肩线", count: 4 }, inputs: [{ nodeId: "constraint", port: "constraint" }] }, preserve: ["藏蓝色", "肩线"], preview: { before: { parameters: { count: 2 } }, after: { parameters: { count: 4 } }, effect: "更新原工具，保留版本" },
    operations: [{ type: "update_node", nodeId: draft.id, title: "四个风衣方案", payload: { params: { prompt: "保留藏蓝和肩线", count: 4 } } }] };
  mocked.setPendingProposal(proposal);
  mocked.setMessages([{ id: "fig8-reply", role: "assistant", status: "completed", content: "可以按四个候选比较。", proposal, context: null }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('[data-kind="tool"]')).toHaveCount(4);
  await expect(page.locator('[data-type="generate_design"][data-status="proposed"]')).toHaveCount(1);
  await page.getByText("查看修改前后", { exact: true }).click();
  await expect(page.getByText("候选数量：4", { exact: false })).toBeVisible();
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/fig8-collaboration-review.png" });
  await page.getByRole("button", { name: "确认修改", exact: true }).click();
  await expect.poll(() => draft.payload.params).toMatchObject({ count: 4 });
  expect(mocked.getGraph().nodes).toHaveLength(10);
  expect({ x: draft.x, y: draft.y }).toEqual({ x: 1080, y: 1050 });
  expect(mocked.getExecuteCount()).toBe(0);
});

test("Fig8 调整直接编辑参数和输入，关联原提案并覆盖旧引用", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("请修改 @候选 A 的袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await page.getByRole("button", { name: "调整", exact: true }).click();
  await page.getByRole("textbox", { name: "调整执行指令" }).fill("保留藏蓝和立领，只调整候选B袖型");
  await page.getByRole("combobox", { name: "调整母图 1", exact: true }).selectOption("candidate-b");
  await page.getByRole("spinbutton", { name: "调整候选数量", exact: true }).fill("3");
  await page.getByRole("button", { name: "提交调整建议", exact: true }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(2);
  expect(mocked.workflowRequests[1]).toMatchObject({ respondingToProposalId: "proposal-0", referencedNodeIds: ["candidate-b"] });
  expect(mocked.workflowRequests[1]?.content).toContain("候选数量：3");
  expect(mocked.workflowRequests[1]?.referencedNodeIds).not.toContain("candidate-a");
  expect(mocked.getExecuteCount()).toBe(0);
});

test("Fig8 后台结果持续恢复且不阻塞用户输入，计划随刷新保留", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.setPlan({ goal: "改进通勤风衣", milestones: [{ id: "inspect", title: "比较实际候选", status: "active", completionCriteria: ["确认肩线和袖型"], evidenceRefs: ["candidate-a"] }], activeMilestoneId: "inspect", nextGoal: "确定修改范围", completionCriteria: ["设计师选定方案"] });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByLabel("工作计划", { exact: true }).locator("summary").click();
  await expect(page.getByText("当前步骤 · 比较实际候选", { exact: true })).toBeVisible();
  mocked.appendMessage({ id: "result-1", role: "assistant", status: "completed", content: "已完成本次执行，共两个候选。", origin: "execution_result", executionId: "execution-1", sourceEventId: "event-1" });
  mocked.appendMessage({ id: "analysis-1", role: "assistant", status: "pending", content: "正在比较两个候选的肩线。", origin: "background_analysis", executionId: "execution-1" });
  await expect(page.getByText("已完成本次执行，共两个候选。", { exact: true })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("比较两张风衣图，先保留现有方案");
  await expect(page.getByRole("button", { name: "发送 ↑" })).toBeEnabled();
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByText("已完成本次执行，共两个候选。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("工作计划", { exact: true })).toBeVisible();
});

test("Fig8 调整提案失败后重试保留原提案关联和精确输入", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("请修改 @候选 A 的袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await page.getByRole("button", { name: "调整", exact: true }).click();
  await page.getByRole("textbox", { name: "调整执行指令" }).fill("保留藏蓝和立领，只调整候选B袖型");
  await page.getByRole("combobox", { name: "调整母图 1", exact: true }).selectOption("candidate-b");
  mocked.failMessageOnce();
  await page.getByRole("button", { name: "提交调整建议", exact: true }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "重试这条回复" }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(3);
  expect(mocked.workflowRequests[2]).toEqual(mocked.workflowRequests[1]);
  expect(mocked.workflowRequests[2]).toMatchObject({ respondingToProposalId: "proposal-0", referencedNodeIds: ["candidate-b"], focusNodeIds: ["candidate-b"] });
  await expect(page.locator('[data-role="user"]')).toHaveCount(2);
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(2);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("Fig8 逐条纠正有来源的要求，暂停协作后历史保留并可重新启用", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByLabel("设计上下文", { exact: true }).locator("summary").click();
  await page.getByRole("button", { name: "更正这条要求", exact: true }).click();
  await page.getByRole("textbox", { name: "更正内容", exact: true }).fill("保留深藏蓝色，避免纯黑");
  await page.getByRole("button", { name: "保存更正", exact: true }).click();
  await expect.poll(() => mocked.contextPatches.length).toBe(1);
  expect(mocked.contextPatches[0]).toMatchObject({ updatedItems: [{ id: "must-navy", text: "保留深藏蓝色，避免纯黑", scope: "project", confirm: true }] });
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "暂停设计协作", exact: true }).click();
  await expect(page.getByText("设计协作已暂停。历史消息和已有执行仍保留，可在“更多”中重新启用。", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByText("设计协作已暂停。历史消息和已有执行仍保留，可在“更多”中重新启用。", { exact: true })).toBeVisible();
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "启用设计协作", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeEnabled();
});

test("Fig8 手动参数遵循统一契约，执行前创建会话并绑定执行归属", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.clearConversations();
  const draft = node("fig8-manual", "tool", "generate_design", "手动生成", 1080, 1050, { toolKey: "generate_design", toolVersion: "1", params: { prompt: "保持通勤风衣要求" } });
  draft.status = "ready";
  const reference = node("fig8-ref", "asset", "reference_image", "肩线参考", 740, 1050, { fileAssetId: "sketch-file", role: "detail_ref", roleSource: "manual" });
  mocked.getGraph().nodes.push(draft, reference);
  mocked.getGraph().edges.push(edge("fig8-constraint", "constraint", draft.id, "constraint"), edge("fig8-reference", reference.id, draft.id, "reference"));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('[data-kind="tool"]')).toHaveCount(4);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fashion-workflow:node-details", { detail: "fig8-manual" })));
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "候选数量", exact: true }).fill("4");
  await page.getByRole("combobox", { name: "图像质量", exact: true }).selectOption("auto");
  await page.getByRole("spinbutton", { name: "参考强度 肩线参考", exact: true }).fill("0.4");
  await page.getByRole("button", { name: "保存工具参数", exact: true }).click();
  await expect.poll(() => draft.payload.params).toMatchObject({ count: 4, quality: "auto", referenceInputs: [{ nodeId: reference.id, role: "detail_ref", weight: 0.4 }] });
  await page.getByRole("button", { name: "确认并执行", exact: true }).click();
  await expect.poll(() => mocked.executionRequests.length).toBe(1);
  expect(mocked.executionRequests[0]).toMatchObject({ conversationId: "chat-new" });
});

test("Fig8 跳过理由随提案保存，不触发执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("请优化袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await page.getByRole("textbox", { name: "跳过理由", exact: true }).fill("先保留袖型，等待材料测试");
  await page.getByRole("button", { name: "确认跳过", exact: true }).click();
  await expect.poll(() => mocked.rejectionRequests.length).toBe(1);
  expect(mocked.rejectionRequests[0]).toMatchObject({ reason: "先保留袖型，等待材料测试" });
  expect(mocked.getExecuteCount()).toBe(0);
});

test("主画布完整显示设计路径，节点保存与拖拽可在刷新后恢复", async ({ page }) => {
  test.setTimeout(60_000);
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
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
  await page.waitForTimeout(250);
  await page.screenshot({ path: "output/playwright/workflow-canvas-1920-verified.png" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "＋ 添加工具" }).click();
  await page.getByRole("button", { name: /局部修改 候选/ }).click();
  await expect(canvas.locator('[data-type="edit_design"]')).toHaveCount(1);
  const newNode = mocked.getGraph().nodes.find((item) => item.type === "edit_design");
  expect(newNode).toBeDefined();
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(canvas.locator('[data-type="edit_design"]')).toHaveCount(1);

  const shape = canvas.locator('[data-type="brief"]');
  await shape.hover();
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
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  expect(mocked.getGraph().nodes.find((item) => item.id === "brief")?.x).toBe(savedPosition?.x);
});

test("从面料库加入的图片使用素材布局且名称只显示一次", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.route("**/api/fabrics?*", (route) => route.fulfill({ json: { items: [
    { id: "fabric-cotton", tags: ["棉麻", "斜纹"], mainImageUrl: "/api/files/sketch-file/thumbnail/1024" },
  ] } }));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: /面料库/ }).click();
  await page.getByRole("region", { name: "选择面料" }).getByRole("button", { name: "棉麻 · 斜纹" }).click();
  const fabric = page.locator('[data-type="fabric"]');
  await expect(fabric).toHaveAttribute("data-image", "true");
  await expect(fabric.getByText("棉麻 · 斜纹", { exact: true })).toHaveCount(1);
  await expect(fabric.locator("p")).toHaveCount(0);
  await expect(fabric.locator("img")).toHaveCSS("object-fit", "contain");
  expect(mocked.getGraph().nodes.find((item) => item.type === "fabric")?.payload).toMatchObject({ fabricId: "fabric-cotton", text: "" });
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(fabric).toHaveAttribute("data-image", "true");
  await expect(fabric.getByText("棉麻 · 斜纹", { exact: true })).toHaveCount(1);
  await expect(fabric.locator("p")).toHaveCount(0);
});

for (const { imageType, width, height, metadata } of [
  { imageType: "reference_image", width: 1600, height: 900, metadata: false },
  { imageType: "sketch", width: 600, height: 900, metadata: true },
  { imageType: "candidate", width: 1200, height: 1200, metadata: false },
  { imageType: "reference_image", width: 2400, height: 400, metadata: true },
  { imageType: "candidate", width: 400, height: 2400, metadata: true },
  { imageType: "fabric", width: 1600, height: 900, metadata: false },
  { imageType: "fabric", width: 600, height: 900, metadata: true },
  { imageType: "fabric", width: 900, height: 900, metadata: false },
] as const) {
  test(`${imageType} ${width}×${height} 图片完整贴合节点，连线随尺寸同步且刷新后保持`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    const graph = mocked.getGraph();
    graph.nodes = [
      node("ratio-image", "asset", imageType, "自适应图片", 40, 120, { imageUrl: "/api/ratio-image", ...(imageType === "fabric" ? { text: "自适应图片" } : {}), ...(metadata ? { width, height } : {}) }),
      node("ratio-target", "tool", "evaluate_design", "服装评估", 540, 120),
    ];
    graph.edges = [edge("ratio-edge", "ratio-image", "ratio-target", imageType === "candidate" ? "candidate" : "reference")];
    await page.route("**/api/ratio-image", (route) => route.fulfill({
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#a5b9b0"/><path d="M0 0L${width} ${height}M${width} 0L0 ${height}" stroke="#40544e" stroke-width="8"/></svg>`,
      contentType: "image/svg+xml",
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    const image = page.locator(`[data-type="${imageType}"] img`);
    const expectFittedImage = async () => {
      await expect.poll(() => image.evaluate((element) => {
        const img = element as HTMLImageElement;
        if (!img.complete || !img.naturalWidth) return Infinity;
        const box = img.getBoundingClientRect();
        const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
        return Math.max(Math.abs(box.width - img.naturalWidth * scale), Math.abs(box.height - img.naturalHeight * scale));
      })).toBeLessThan(1);
      const title = page.locator(`[data-type="${imageType}"] header`);
      await expect(title).toBeVisible();
      await expect(page.locator(`[data-type="${imageType}"]`).getByText("自适应图片", { exact: true })).toHaveCount(1);
      await expect(image).toHaveCSS("object-fit", "contain");
      await expect.poll(() => image.evaluate((element) => {
        const imageBox = element.getBoundingClientRect();
        const titleBox = element.closest('[data-image="true"]')?.querySelector("header")?.getBoundingClientRect();
        return titleBox ? Math.abs(imageBox.bottom - titleBox.top) : Infinity;
      })).toBeLessThan(1);
      await expect.poll(() => page.locator('[data-workflow-edge="ratio-edge"] path').first().evaluate((element) => {
        const origin = (element as SVGPathElement).getScreenCTM();
        const port = document.querySelector('[data-node-id="ratio-image"][data-workflow-port="output"]')?.getBoundingClientRect();
        return origin && port ? Math.hypot(origin.e - port.x - port.width / 2, origin.f - port.y - port.height / 2) : Infinity;
      })).toBeLessThan(2);
    };
    await expect(image).toBeVisible();
    await expectFittedImage();
    if (width === 1600 || width === 400) {
      await mkdir("output/playwright", { recursive: true });
      await page.screenshot({ path: `output/playwright/workflow-${imageType}-${width === 1600 ? "landscape" : "portrait"}-fitted.png` });
    }
    await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await expect(image).toBeVisible();
    await expectFittedImage();
  });
}

for (const imageType of ["reference_image", "sketch", "candidate"] as const) {
  test(`${imageType} 图片区域可连续拖动、缩放拖动并在刷新后恢复`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    const graph = mocked.getGraph();
    const draggedNode = node("dragged-image", "asset", imageType, "图片拖动回归", 40, 120, { imageUrl: "/api/design-assets/asset-a/thumbnail" });
    graph.nodes = [
      draggedNode,
      node("target", "tool", "evaluate_design", "服装评估", 440, 120),
    ];
    graph.edges = [edge("image-output", "dragged-image", "target", imageType === "candidate" ? "candidate" : "reference")];
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    const shape = page.locator(`[data-type="${imageType}"]`);
    const image = shape.locator("img");
    await expect(image).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
    await shape.evaluate(async (element) => {
      const animations: Animation[] = [];
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) animations.push(...ancestor.getAnimations());
      await Promise.all(animations.filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished));
    });
    const events = await page.evaluateHandle(() => {
      const events: string[] = [];
      const canvas = document.querySelector('.tl-container');
      if (!canvas) throw new Error("画布未挂载");
      for (const type of ["dragstart", "pointercancel"]) {
        canvas.addEventListener(type, () => events.push(type), true);
      }
      return events;
    });
    const pointerEvents = await page.evaluateHandle(() => {
      const points: Array<{ type: string; x: number; y: number }> = [];
      for (const type of ["pointerdown", "pointermove", "pointerup"]) {
        document.addEventListener(type, (event) => {
          const pointer = event as PointerEvent;
          const point = { type, x: pointer.clientX, y: pointer.clientY };
          if (type === "pointermove" && points.at(-1)?.type === type) points[points.length - 1] = point;
          else points.push(point);
        }, true);
      }
      return points;
    });
    const wire = page.locator('[data-workflow-edge="image-output"] path').first();
    const expectWireAttached = async () => {
      await expect.poll(async () => {
        const start = await wire.evaluate((element) => {
          const path = element as SVGPathElement;
          const transform = path.getScreenCTM();
          if (!transform) throw new Error("连接未投影到屏幕");
          const point = path.getPointAtLength(0).matrixTransform(transform);
          return { x: point.x, y: point.y };
        });
        const bounds = await shape.boundingBox();
        return bounds ? Math.abs(start.x - bounds.x - bounds.width) + Math.abs(start.y - bounds.y - bounds.height / 2) : Infinity;
      }).toBeLessThan(2);
    };
    const dragImage = async (dx: number, dy: number) => {
      // 等待相机动画结束后测量，避免把缩放位移误当作拖动位移。
      await expect.poll(async () => {
        const before = await shape.boundingBox();
        await page.waitForTimeout(80);
        const after = await shape.boundingBox();
        return before && after ? Math.abs(after.x - before.x) + Math.abs(after.y - before.y) + Math.abs(after.width - before.width) : Infinity;
      }).toBeLessThan(0.1);
      const before = await shape.boundingBox();
      const imageBounds = await image.boundingBox();
      if (!before || !imageBounds) throw new Error("图片素材未显示");
      const initial = { x: draggedNode.x, y: draggedNode.y };
      const zoom = before.width / await shape.evaluate((element) => Number.parseFloat(getComputedStyle(element).width));
      const x = Math.round(imageBounds.x + imageBounds.width / 2);
      const y = Math.round(imageBounds.y + imageBounds.height / 2);
      const layoutRevision = graph.layoutRevision;
      const expectDraggedToDestination = () => expect.poll(async () => {
        const after = await shape.boundingBox();
        return after ? Math.abs(after.x - before.x - dx) + Math.abs(after.y - before.y - dy) : Infinity;
      }).toBeLessThan(2);
      try {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await expect(shape).toHaveAttribute("data-highlighted", "true");
        await page.mouse.move(x + dx, y + dy, { steps: 12 });
        // 连线与节点可能同时停在上一帧，必须先确认移动到终点再松开鼠标。
        await expectDraggedToDestination();
        await expectWireAttached();
        await page.mouse.up();
        expect(await events.jsonValue()).toEqual([]);
        await expectDraggedToDestination();
        await expect.poll(() => graph.layoutRevision).toBeGreaterThan(layoutRevision);
        expect(draggedNode.x - initial.x).toBeCloseTo(dx / zoom, 0);
        expect(draggedNode.y - initial.y).toBeCloseTo(dy / zoom, 0);
      } catch (error) {
        console.log("drag-coordinate-diagnostic", JSON.stringify({ before, after: await shape.boundingBox(), initial, saved: { x: draggedNode.x, y: draggedNode.y }, zoom, points: await pointerEvents.jsonValue() }));
        throw error;
      }
    };
    // 模拟入场动画移动视口但未触发尺寸变化，首个拖动也必须使用最新屏幕边界。
    await page.locator(".tl-container").evaluate((element) => { (element as HTMLElement).style.translate = "14px 8px"; });
    await dragImage(60, 30);
    await dragImage(-40, 25);
    const originalBounds = await shape.boundingBox();
    if (!originalBounds) throw new Error("图片素材未显示");
    await page.getByRole("button", { name: "缩小画布", exact: true }).click();
    await expect.poll(async () => (await shape.boundingBox())?.width ?? Infinity).toBeLessThan(originalBounds.width - 1);
    await dragImage(35, -30);
    const saved = { x: draggedNode.x, y: draggedNode.y };
    await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await expect(image).toBeVisible();
    await expectWireAttached();
    await expect.poll(async () => {
      const imageBounds = await shape.boundingBox();
      const targetBounds = await page.locator('[data-kind="tool"]').boundingBox();
      if (!imageBounds || !targetBounds) return Infinity;
      const zoom = imageBounds.width / await shape.evaluate((element) => Number.parseFloat(getComputedStyle(element).width));
      return Math.abs((imageBounds.x - targetBounds.x) / zoom - (saved.x - 440)) + Math.abs((imageBounds.y - targetBounds.y) / zoom - (saved.y - 120));
    }).toBeLessThan(1);
  });
}

test("@节点提案先以虚线预览，确认后保留分支且不自动执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
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
  await page.getByRole("button", { name: "加入画布", exact: true }).click();
  await expect(page.locator('[data-type="edit_design"][data-status="ready"]')).toBeVisible();
  expect(mocked.getGraph().edges.some((item) => item.id === "edit-source")).toBe(true);
  expect(mocked.getExecuteCount()).toBe(0);
});

const port = (page: Page, id: string, side: "input" | "output") => page.locator(`[data-workflow-port="${side}"][data-node-id="${id}"]`);

async function selectWire(page: Page, id: string) {
  const path = page.locator(`[data-workflow-edge="${id}"] path`).first();
  await path.waitFor();
  // Camera fit is animated; wait for the projected curve to settle before measuring it.
  await expect.poll(async () => {
    const a = await path.boundingBox();
    await page.waitForTimeout(80);
    const b = await path.boundingBox();
    return a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) : Infinity;
  }).toBeLessThan(0.1);
  const point = await path.evaluate((element) => {
    const curve = element as SVGPathElement;
    const middle = curve.getPointAtLength(curve.getTotalLength() * 0.55);
    const transform = curve.getScreenCTM();
    if (!transform) throw new Error("连接未投影到屏幕");
    return { x: middle.x * transform.a + middle.y * transform.c + transform.e, y: middle.x * transform.b + middle.y * transform.d + transform.f };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel("连接操作")).toBeVisible();
}

test("上传图片直接作为修改原图，已有参考连线可切换用途", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getGraph().nodes = [
    { ...node("upload", "asset", "reference_image", "上传服装", 80, 100, { fileAssetId: "uploaded-file", role: "style_ref", roleSource: "manual" }), status: "ready" },
    { ...node("detail", "asset", "reference_image", "袖口参考", 80, 470, { fileAssetId: "detail-file", role: "detail_ref", roleSource: "manual" }), status: "ready" },
    { ...node("edit", "tool", "edit_design", "修改上传服装", 480, 100, { toolKey: "edit_design", toolVersion: "1", params: { prompt: "只收窄袖口" } }), status: "ready" },
  ];
  mocked.getGraph().edges = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await port(page, "upload", "output").click();
  await port(page, "edit", "input").click();
  await expect.poll(() => mocked.getGraph().edges.find((item) => item.sourceNodeId === "upload")?.targetPort).toBe("source");
  const mother = mocked.getGraph().edges[0];
  if (!mother) throw new Error("原图连线未保存");
  await selectWire(page, mother.id);
  await page.getByRole("button", { name: "用作参考素材", exact: true }).click();
  await expect.poll(() => mocked.getGraph().edges[0]?.targetPort).toBe("reference");
  const reference = mocked.getGraph().edges[0];
  if (!reference) throw new Error("参考连线未保存");
  await selectWire(page, reference.id);
  await page.getByRole("button", { name: "用作原图", exact: true }).click();
  await expect.poll(() => mocked.getGraph().edges[0]?.targetPort).toBe("source");
  await port(page, "detail", "output").click();
  await port(page, "edit", "input").click();
  await expect.poll(() => mocked.getGraph().edges.find((item) => item.sourceNodeId === "detail")?.targetPort).toBe("reference");
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator("[data-workflow-edge]")).toHaveCount(2);
  expect(mocked.getGraph().edges.filter((item) => item.targetPort === "source")).toHaveLength(1);
  expect(mocked.getExecuteCount()).toBe(0);
  await page.locator('[data-type="edit_design"]').dblclick();
  const details = page.getByRole("complementary", { name: "设计助手与节点详情" });
  await details.getByText("来源与路径", { exact: true }).click();
  await expect(details.getByText("原图 · 上传服装", { exact: true })).toBeVisible();
  await details.getByRole("button", { name: "确认并执行", exact: true }).click();
  await expect.poll(() => mocked.getExecuteCount()).toBe(1);
});

test("直接拖线、点击连线、键盘连接与断开可刷新恢复", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const evaluate = mocked.getGraph().nodes.find((item) => item.id === "evaluate");
  if (evaluate) evaluate.status = "ready";
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await port(page, "reference", "output").hover();
  await port(page, "reference", "output").dragTo(port(page, "evaluate", "input"));
  await expect.poll(() => mocked.getGraph().edges.some((item) => item.sourceNodeId === "reference" && item.targetNodeId === "evaluate")).toBe(true);
  const added = mocked.getGraph().edges.find((item) => item.sourceNodeId === "reference" && item.targetNodeId === "evaluate");
  if (!added) throw new Error("连线未保存");
  await selectWire(page, added.id);
  await page.getByRole("button", { name: "断开连接", exact: true }).click();
  await expect.poll(() => mocked.getGraph().edges.some((item) => item.id === added.id)).toBe(false);
  await port(page, "reference", "output").focus();
  await page.keyboard.press("Enter");
  await port(page, "evaluate", "input").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => mocked.getGraph().edges.length).toBe(12);
  await port(page, "brief", "output").click();
  await port(page, "evaluate", "input").click();
  await expect(page.getByRole("status").filter({ hasText: "这类素材不能" })).toBeVisible();
  expect(mocked.getGraph().edges.length).toBe(12);
  await port(page, "reference", "output").click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("选择另一端的节点 · Esc 取消")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator("[data-workflow-edge]")).toHaveCount(12);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("已运行工具改输入建立独立分支，系统结果来源保持只读", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const originalEdges = structuredClone(mocked.getGraph().edges);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await port(page, "candidate-a", "output").hover();
  await port(page, "candidate-a", "output").click();
  await port(page, "generate", "input").click();
  await expect.poll(() => mocked.getGraph().nodes.length).toBe(10);
  const branch = mocked.getGraph().nodes.find((item) => item.title === "方案生成 · 分支");
  expect(branch).toMatchObject({ status: "ready", type: "generate_design" });
  expect(mocked.getGraph().edges.filter((item) => originalEdges.some((old) => old.id === item.id))).toEqual(originalEdges);
  expect(mocked.getGraph().edges.filter((item) => item.targetNodeId === branch?.id)).toHaveLength(3);
  expect(mocked.getGraph().edges.some((item) => item.sourceNodeId === branch?.id)).toBe(false);
  expect(mocked.getExecuteCount()).toBe(0);
  await expect(page.getByText("已建立新分支", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-workflow-edge="e6"]').waitFor();
  await selectWire(page, "e6");
  await expect(page.getByText("由工具执行维护")).toBeVisible();
  await expect(page.getByRole("button", { name: "断开连接", exact: true })).toHaveCount(0);
});

test("单击保留对话，详情返回恢复草稿，引用需显式加入", async ({ page }) => {
  test.setTimeout(60_000);
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  const appearance = (control: Locator) => control.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, borderColor: style.borderTopColor, borderWidth: Number.parseFloat(style.borderTopWidth) };
  });
  const context = page.getByLabel("设计上下文", { exact: true });
  const summary = context.locator("summary").first();
  await summary.focus();
  await summary.press("Enter");
  await expect(context).toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
  expect(await summary.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
  })).toBe(true);
  await summary.press("Space");
  await expect(context).not.toHaveAttribute("open");
  await composer.fill("保留这段输入草稿");
  await page.locator('[data-type="candidate"]').first().click();
  await expect(composer).toBeVisible();
  await summary.press("Enter");
  const reference = page.getByRole("button", { name: /引用「候选 A」/ });
  const referenceStyle = await appearance(reference);
  const locationStyle = await appearance(context.getByRole("button", { name: "定位 候选 A", exact: true }));
  expect(referenceStyle.borderWidth).toBeGreaterThan(0);
  expect(referenceStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(locationStyle.borderWidth).toBe(0);
  expect(locationStyle.background).toBe("rgba(0, 0, 0, 0)");
  await summary.press("Space");
  await page.getByRole("button", { name: "节点详情", exact: true }).click();
  await expect(composer).toBeHidden();
  await page.getByRole("button", { name: "返回对话" }).click();
  await expect(composer).toHaveValue("保留这段输入草稿");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.proposalRequests.length).toBe(1);
  expect(mocked.proposalRequests[0]?.referencedNodeIds).toEqual([]);
  const primaryStyle = await appearance(page.getByRole("button", { name: "加入画布", exact: true }));
  const secondaryStyle = await appearance(page.getByRole("button", { name: "调整", exact: true }));
  const quietStyle = await appearance(page.getByRole("button", { name: "跳过", exact: true }));
  expect(primaryStyle.background).not.toBe(secondaryStyle.background);
  expect(secondaryStyle.borderWidth).toBeGreaterThan(0);
  expect(secondaryStyle.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(quietStyle.background).toBe("rgba(0, 0, 0, 0)");
  expect(quietStyle.borderColor).toBe("rgba(0, 0, 0, 0)");
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/workflow-assistant-actions-desktop.png" });
  await page.getByRole("button", { name: "调整", exact: true }).click();
  expect((await appearance(page.getByRole("button", { name: "提交调整建议", exact: true }))).background).toBe(primaryStyle.background);
  expect(await appearance(page.getByRole("button", { name: "取消调整", exact: true }))).toEqual(quietStyle);
  await page.getByRole("button", { name: "取消调整", exact: true }).click();
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  expect(await appearance(page.getByRole("button", { name: "返回建议", exact: true }))).toEqual(quietStyle);
  const rejectStyle = await appearance(page.getByRole("button", { name: "确认跳过", exact: true }));
  expect(rejectStyle.background !== quietStyle.background || rejectStyle.borderColor !== quietStyle.borderColor).toBe(true);
  await page.getByRole("button", { name: "确认跳过", exact: true }).click();
  await page.getByRole("button", { name: /引用「候选 A」/ }).click();
  await composer.fill("修改领口");
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await page.getByRole("button", { name: "展开设计助手", exact: true }).click();
  await expect(composer).toHaveValue("修改领口");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.proposalRequests.length).toBe(2);
  expect(mocked.proposalRequests[1]?.referencedNodeIds).toEqual(["candidate-a"]);
  expect(mocked.getExecuteCount()).toBe(0);
  const longTitle = "秋冬通勤风衣候选方案：保留藏蓝色与宽松廓形，优化袖口细节。".repeat(4);
  const candidate = mocked.getGraph().nodes.find((item) => item.id === "candidate-a");
  if (!candidate) throw new Error("候选节点不存在");
  candidate.title = longTitle;
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="candidate"]').first().click();
  const longReference = page.getByRole("button", { name: `＋ 引用「${longTitle}」`, exact: true });
  await expect(longReference).toBeVisible();
  expect(await longReference.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const panel = element.closest("aside")?.getBoundingClientRect();
    return panel ? bounds.left >= panel.left && bounds.right <= panel.right : false;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("拖动输入线的素材端替换原图并清除旧蒙版，取消拖线不保存", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const edit = node("manual-edit", "tool", "edit_design", "修改袖口", 740, 1050, { toolKey: "edit_design", toolVersion: "1", params: { prompt: "修改袖口", taskType: "inpaint", maskImageUrl: "old-mask", referenceImageUrl: "old-image", parentAssetId: "asset-a" } });
  edit.status = "ready";
  mocked.getGraph().nodes.push(edit);
  mocked.getGraph().edges.push(edge("manual-source", "candidate-a", edit.id, "source"));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await selectWire(page, "manual-source");
  await page.getByLabel("拖动更换输入素材").locator("circle").first().dragTo(port(page, "candidate-b", "output"));
  await expect.poll(() => mocked.getGraph().edges.find((item) => item.targetNodeId === edit.id)?.sourceNodeId).toBe("candidate-b");
  expect(edit.payload.params).toEqual({ prompt: "修改袖口", taskType: "i2i" });
  expect(mocked.getGraph().nodes.length).toBe(10);
  const revision = mocked.getGraph().revision;
  await port(page, "reference", "output").hover();
  const start = await port(page, "reference", "output").boundingBox();
  if (!start) throw new Error("端口不可见");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(200, 650, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("选择另一端的节点 · Esc 取消")).toHaveCount(0);
  expect(mocked.getGraph().revision).toBe(revision);
  expect(mocked.getExecuteCount()).toBe(0);
});

for (const savedTheme of [null, "dark", "system"] as const) {
  test(`固定浅色忽略历史主题 ${savedTheme ?? "未设置"}、系统偏好、刷新及页面切换`, async ({ page }) => {
    test.setTimeout(90_000);
    await mockWorkflow(page);
    await page.route("**/api/trends?*", (route) => route.fulfill({ json: { items: [], total: 0, hasMore: false } }));
    await page.route("**/api/trends/digest/current", (route) => route.fulfill({ json: null }));
    await page.addInitScript((value) => {
      if (value === null) localStorage.removeItem("theme");
      else localStorage.setItem("theme", value);
    }, savedTheme);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);

    const expectLightCanvas = async () => {
      await expect(page.locator("[data-workflow-edge]")).toHaveCount(11);
      await expect(page.getByRole("application", { name: "tldraw" })).toHaveClass(/\btl-theme__light\b/);
      await expect(page.locator(".tl-theme__dark")).toHaveCount(0);
      await expect(page.locator("main")).toHaveCSS("background-color", "rgb(233, 230, 223)");
      await expect(page.locator("main")).toHaveCSS("color", "rgb(31, 29, 26)");
      await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
      await expect(page.locator("[data-theme]")).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(savedTheme);
    };

    await expectLightCanvas();
    await page.emulateMedia({ colorScheme: "light" });
    await expectLightCanvas();
    await page.emulateMedia({ colorScheme: "dark" });
    await expectLightCanvas();
    await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await expectLightCanvas();

    const trendsPath = `/trends?from=board&boardId=${PROJECT_ID}`;
    await expect(page.getByRole("link", { name: "趋势", exact: true })).toHaveAttribute("href", trendsPath);
    await page.goto(trendsPath);
    await page.waitForURL(/\/trends\?/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "趋势档案", exact: true })).toBeVisible();
    for (const width of [390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("button", { name: "切换主题" })).toHaveCount(0);
      await expect(page.locator("main")).toHaveCSS("background-color", "rgb(241, 239, 234)");
      await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const back = page.getByRole("link", { name: "返回设计工作室", exact: true });
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute("href", `/${PROJECT_ID}`);
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: "趋势档案", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "切换主题" })).toHaveCount(0);
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(241, 239, 234)");
    await page.getByRole("link", { name: "返回设计工作室", exact: true }).click();
    await expectLightCanvas();
  });
}

test("固定浅色与三种宽度保持画布布局，PNG 导出包含曲线", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator("[data-workflow-edge]")).toHaveCount(11);
  await mkdir("output/playwright", { recursive: true });
  await expect(page.getByRole("application", { name: "tldraw" })).toHaveClass(/\btl-theme__light\b/);
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await showCanvas(page, width);
    await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await showAssistant(page, width);
    await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeVisible();
    await showCanvas(page, width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: `output/playwright/workflow-light-${width}.png` });
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出画布 PNG", exact: true }).click();
  const file = await download;
  await file.saveAs("output/playwright/workflow-export-with-curves.png");
  expect(await file.failure()).toBeNull();
  await page.getByRole("button", { name: "放大画布" }).click();
  await page.getByRole("button", { name: "缩小画布" }).click();
  await expect(page.locator("[data-workflow-edge]")).toHaveCount(11);
  // Zoom controls take focus; return it to the canvas before the Space pan shortcut.
  const canvas = page.getByRole("application", { name: "tldraw" });
  await canvas.click({ position: { x: 350, y: 120 } });
  await expect(canvas).toBeFocused();
  const beforePan = await port(page, "brief", "output").boundingBox();
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(420, 210, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(async () => (await port(page, "brief", "output").boundingBox())?.x).not.toBe(beforePan?.x);
  const aligned = await page.locator('[data-workflow-edge="e1"] path').first().evaluate((element) => {
    const origin = (element as SVGPathElement).getScreenCTM();
    const bounds = document.querySelector('[data-node-id="brief"][data-workflow-port="output"]')?.getBoundingClientRect();
    return origin && bounds ? Math.hypot(origin.e - bounds.x - bounds.width / 2, origin.f - bounds.y - bounds.height / 2) : Infinity;
  });
  expect(aligned).toBeLessThan(2);
});

test.describe("触屏连线", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("点击两端无需打开详情即可连接", async ({ page }) => {
    const mocked = await mockWorkflow(page);
    mocked.getGraph().nodes = mocked.getGraph().nodes.filter((item) => item.id === "reference" || item.id === "evaluate").map((item, index) => ({ ...item, status: "ready", x: 40 + index * 380, y: 100 }));
    mocked.getGraph().edges = [];
    await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
    await port(page, "reference", "output").tap();
    await port(page, "evaluate", "input").tap();
    await expect.poll(() => mocked.getGraph().edges.length).toBe(1);
    await page.getByRole("button", { name: "助手", exact: true }).click();
    await expect(page.getByRole("heading", { name: "设计助手", exact: true })).toBeVisible();
    expect(mocked.getExecuteCount()).toBe(0);
  });
});

test("持续对话保留只读历史与新会话；手机节点列表及菜单无横向溢出", async ({ page }) => {
  test.setTimeout(60_000);
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "助手", exact: true }).click();
  const initialSend = page.getByRole("button", { name: "发送 ↑", exact: true });
  await expect(initialSend).toBeDisabled();
  await expect(initialSend).toBeInViewport({ ratio: 1 });
  const disabledBackground = await initialSend.evaluate((element) => getComputedStyle(element).backgroundColor);
  await initialSend.hover();
  await expect(initialSend).toHaveCSS("background-color", disabledBackground);
  await page.getByRole("button", { name: "节点列表" }).click();
  await expect(page.getByRole("listitem").filter({ has: page.getByText("候选 A", { exact: true }) })).toBeVisible();
  await page.getByRole("button", { name: "＋ 添加工具" }).click();
  await expect.poll(async () => {
    const bounds = await page.getByRole("button", { name: /局部修改 候选/ }).boundingBox();
    return bounds ? bounds.x + bounds.width : Infinity;
  }).toBeLessThanOrEqual(390);
  const menuBox = await page.getByRole("button", { name: /局部修改 候选/ }).boundingBox();
  expect((menuBox?.x ?? -1) >= 0).toBe(true);
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? Infinity)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("button", { name: "关闭菜单" }).click();

  await page.getByRole("button", { name: "助手", exact: true }).click();
  const more = page.getByText("更多", { exact: true });
  const moreMenu = more.locator("..");
  await expect(page.getByText("持续设计协作", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" }).locator("..").getByText("更多", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新对话", exact: true })).toHaveCount(0);
  await more.focus();
  await more.press("Enter");
  await expect(moreMenu).toHaveAttribute("open", "");
  await expect(moreMenu.getByRole("button")).toHaveText(["历史会话", "新建设计对话", "暂停设计协作"]);
  await expect.poll(() => moreMenu.getByRole("button").evaluateAll((buttons) => buttons.every((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
  }))).toBe(true);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/workflow-assistant-menu-mobile.png" });
  await page.getByRole("button", { name: "新建设计对话", exact: true }).click();
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await page.getByRole("combobox", { name: "历史会话" }).selectOption("chat-old");
  await expect(page.getByText("历史消息")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toHaveCount(0);
  await more.click();
  await expect(moreMenu.getByRole("button")).toHaveText(["历史会话", "新建设计对话", "旧设计运行", "暂停设计协作"]);
  await more.press("Space");
  await expect(moreMenu).not.toHaveAttribute("open");
  await page.getByRole("combobox", { name: "历史会话" }).selectOption("chat-new");
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("比较两张风衣图");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.getByText("已收到，继续设计。")).toBeVisible();
  const sendBox = await page.getByRole("button", { name: "发送 ↑" }).boundingBox();
  if (!sendBox) throw new Error("发送按钮未显示");
  expect(sendBox.x).toBeGreaterThanOrEqual(0);
  expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(mocked.chatRequests).toHaveLength(0);
  expect(mocked.proposalRequests).toHaveLength(0);
});

test("候选的大图、版本、局部重绘入口和新草图保存均可从主画布到达", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="candidate"]').first().click();
  await page.getByRole("button", { name: "节点详情", exact: true }).click();
  await page.getByRole("button", { name: "打开大图、版本与局部重绘" }).click();
  const workspace = page.getByRole("dialog", { name: "候选资产工作台" });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("button", { name: "单图高清导出" })).toBeVisible();
  await workspace.getByRole("tab", { name: "版本历史" }).click();
  await expect(workspace.getByRole("region", { name: "版本时间线" })).toBeVisible();
  await workspace.getByRole("tab", { name: "局部重绘" }).click();
  await expect(workspace.getByRole("textbox", { name: "局部重绘说明" })).toBeVisible();
  await workspace.getByRole("button", { name: "关闭候选工作台" }).click();

  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true }).click();
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
  await page.getByRole("button", { name: "廓形草图 上传已绘制的草图", exact: true }).click();
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
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="generate_design"]').hover();
  await page.locator('[data-type="generate_design"]').dblclick();
  const details = page.getByRole("complementary", { name: "设计助手与节点详情" });
  await expect(details.getByRole("textbox", { name: "执行指令" })).toHaveValue("原始风衣");
  await details.getByRole("textbox", { name: "执行指令" }).fill("新版通勤风衣");
  await details.getByText("高级设置", { exact: true }).click();
  await details.getByRole("textbox", { name: "排除内容" }).fill("避免亮面");
  await details.getByRole("spinbutton", { name: "候选数量" }).fill("3");
  await details.getByRole("spinbutton", { name: "宽度" }).fill("1024");
  await expect(details.getByRole("button", { name: "确认并执行" })).toBeDisabled();
  await details.getByRole("button", { name: "保存工具参数" }).click();
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.id === "generate")?.payload.params).toMatchObject({ prompt: "新版通勤风衣", negativePrompt: "避免亮面", count: 3, width: 1024, height: 1024 });
  await expect(details.getByRole("button", { name: "确认并执行" })).toBeEnabled();
  await details.getByText("执行记录", { exact: true }).click();
  await details.getByRole("button", { name: "读取尝试记录" }).click();
  await expect(details.getByText("模型：test-image-model")).toBeVisible();
  await expect(details.getByText("来源：设计约束、参考素材")).toBeVisible();
  await details.getByRole("button", { name: "确认并执行" }).click();
  expect(mocked.getExecuteCount()).toBe(1);
  generate.status = "completed";
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="generate_design"]').dblclick();
  await expect(details.getByRole("button", { name: "确认并执行" })).toHaveCount(0);
  await expect(details.getByRole("textbox", { name: "执行指令" })).toBeDisabled();
});

test("同名节点仅引用 @列表里明确选中的那条分支", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.getContext().focusNodeIds = ["candidate-a"];
  mocked.getGraph().nodes.push(node("candidate-a-branch", "asset", "candidate", "候选 A", 1770, 390, { assetId: "asset-b" }));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
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
  expect(mocked.workflowRequests[0]?.focusNodeIds).toEqual(["candidate-a-branch"]);
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await page.getByRole("button", { name: "确认跳过", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(composer).toBeEnabled();
  await page.locator('[data-type="candidate"]').first().click();
  expect(mocked.contextPatches).toHaveLength(0);
  expect(mocked.getContext().focusNodeIds).toEqual(["candidate-a-branch"]);
  await composer.fill("比较两张风衣图，继续说明这个分支的袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect.poll(() => mocked.workflowRequests.length).toBe(2);
  expect(mocked.workflowRequests[1]?.referencedNodeIds).toEqual([]);
  expect(mocked.workflowRequests[1]?.focusNodeIds).toEqual(["candidate-a-branch"]);
  expect(mocked.getExecuteCount()).toBe(0);
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
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await page.getByRole("combobox", { name: "历史会话" }).selectOption("chat-old");
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "旧设计运行", exact: true }).click();
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
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
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
  await page.waitForTimeout(250);
  await page.locator('[data-type="reference_image"]').dblclick();
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
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="candidate"]').filter({ hasText: "候选 A" }).dblclick();
  const details = page.getByRole("complementary", { name: "设计助手与节点详情" });
  await details.getByRole("button", { name: "设为 Hero / 建立系列" }).click();
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.id === "candidate-a")?.payload.collectionId).toBe("collection-one");
  await page.getByRole("button", { name: "关闭系列抽屉" }).click();
  await expect(details.getByRole("button", { name: "打开关联系列" })).toBeVisible();
  await details.getByRole("button", { name: "打开关联系列" }).click();
  const drawer = page.getByRole("dialog", { name: "系列 DNA" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("tab", { name: "Look 扩展" }).click();
  await expect(drawer.getByRole("combobox", { name: "服装类型", exact: true })).toBeVisible();
  expect(createCalls).toBe(1);
});

test("新会话可查看全部分支偏好，作用范围明确且停用记录刷新后保留", async ({ page }) => {
  test.setTimeout(60_000);
  const mocked = await mockWorkflow(page);
  mocked.getContext().state.preferences.push({ id: "prefer-silver", text: "该分支偏好银灰色", status: "active", origin: "inferred", scope: "branch", sourceQuote: "在候选 B 的两轮修改中保留银灰色", branchNodeIds: ["candidate-b"], sourceNodeIds: ["generate"] });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "新建设计对话", exact: true }).click();
  await page.getByText("设计上下文", { exact: true }).click();
  const context = page.getByLabel("设计上下文", { exact: true });
  const preference = context.locator("li").filter({ hasText: "该分支偏好银灰色" });
  await expect(preference).toBeVisible();
  await expect(preference).toContainText("当前焦点不适用");
  await expect(preference).toContainText("作用分支：候选 B");
  await expect(preference.getByRole("button", { name: "定位 候选 B", exact: true })).toBeVisible();
  expect(mocked.getContext().preferences.some((item) => item.id === "prefer-silver")).toBe(false);
  await page.locator('[data-type="candidate"]').filter({ hasText: "候选 B" }).click();
  expect(mocked.contextPatches).toHaveLength(0);
  await context.getByRole("button", { name: "将「候选 B」设为焦点" }).click();
  await expect(preference).toContainText("当前焦点适用");
  await context.getByRole("button", { name: "清除焦点" }).click();
  await expect(preference).toContainText("当前焦点不适用");
  await preference.getByRole("button", { name: "停用这条偏好" }).click();
  await expect(preference).toContainText("已停用");
  expect(mocked.contextPatches.at(-1)?.disabledPreferenceIds).toEqual(["prefer-silver"]);
  expect(mocked.getContext().preferences.some((item) => item.id === "prefer-silver")).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByText("设计上下文", { exact: true }).click();
  await expect(preference).toContainText("已停用");
  await expect(preference.getByRole("button", { name: "停用这条偏好" })).toHaveCount(0);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("持续助手显示真实上下文，点击节点不改焦点，目标与偏好更正可恢复", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByText("设计上下文", { exact: true }).click();
  const context = page.getByLabel("设计上下文", { exact: true });
  await expect(context.getByText("秋冬通勤风衣", { exact: true }).last()).toBeVisible();
  await expect(context.getByText("共 2 张 · 已理解 1 · 处理中 1 · 失败 0")).toBeVisible();
  await page.locator('[data-type="candidate"]').first().click();
  expect(mocked.contextPatches).toHaveLength(0);
  await context.getByRole("button", { name: "将「候选 A」设为焦点" }).click();
  await expect.poll(() => mocked.getContext().focusNodeIds).toEqual(["candidate-a"]);
  expect(mocked.contextPatches[0]?.summaryRevision).toBe(0);
  await context.getByRole("button", { name: "停用这条偏好" }).click();
  await expect(context.locator('li[data-status="inactive"]').filter({ hasText: "偏好哑光面料" })).toBeVisible();
  await context.getByRole("button", { name: "更正项目目标" }).click();
  await context.getByRole("textbox", { name: "更正项目目标" }).fill("春季轻量通勤风衣");
  await context.getByRole("button", { name: "保存目标" }).click();
  await expect(context.getByText("春季轻量通勤风衣", { exact: true }).last()).toBeVisible();
  await context.getByRole("heading", { name: "项目目标", exact: true }).scrollIntoViewIfNeeded();
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/workflow-assistant-context-verified.png" });
  expect(mocked.contextPatches.every((patch) => typeof patch.baseRevision === "number" && typeof patch.mutationId === "string")).toBe(true);
  expect(mocked.getExecuteCount()).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByText("设计上下文", { exact: true }).click();
  await expect(context.getByText("春季轻量通勤风衣", { exact: true }).last()).toBeVisible();
  await expect(context.getByRole("button", { name: "清除焦点" })).toBeVisible();
  await context.getByRole("button", { name: "清除焦点" }).click();
  await expect.poll(() => mocked.getContext().focusNodeIds).toEqual([]);
});

test("持续助手刷新后保留消息和待确认提案，不重复或自动执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("请修改 @候选 A 的袖型");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.getByRole("button", { name: "加入画布", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByRole("button", { name: "加入画布", exact: true })).toBeVisible();
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  expect(mocked.proposalRequests).toHaveLength(1);
  expect(mocked.getExecuteCount()).toBe(0);
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await page.getByRole("button", { name: "确认跳过", exact: true }).click();
  await expect(page.getByRole("button", { name: "加入画布", exact: true })).toHaveCount(0);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("项目中其他会话的待确认提案不会自动出现在当前对话和画布预览", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.setPendingProposal({ id: "foreign-proposal", baseRevision: 1, status: "pending", content: "另一段会话的请求", referencedNodeIds: ["candidate-a"], rationale: "另一会话的提案", toolNodeId: "foreign-tool", createdAt: NOW, operations: [
    { type: "add_node", node: { id: "foreign-tool", kind: "tool", type: "edit_design", title: "另一会话修改", payload: {}, x: 740, y: 1050 } },
  ] });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.getByLabel("对话操作", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toBeEnabled();
  await expect(page.locator('[data-status="proposed"]')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(page.locator('[data-status="proposed"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加入画布", exact: true })).toHaveCount(0);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("失败的设计回复可用原请求和上下文重试，消息不重复且不自动执行", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  mocked.failMessageOnce();
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("比较两张风衣图 @候选 A");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await page.getByRole("button", { name: "重试这条回复" }).click();
  await expect(page.getByText("已收到，继续设计。", { exact: true })).toBeVisible();
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  expect(mocked.workflowRequests).toHaveLength(2);
  expect(mocked.workflowRequests[1]).toEqual(mocked.workflowRequests[0]);
  expect(mocked.workflowRequests[0]?.referencedNodeIds).toEqual(["candidate-a"]);
  expect(mocked.workflowRequests[0]?.focusNodeIds).toEqual(["candidate-a"]);
  expect(mocked.getExecuteCount()).toBe(0);
});

test("持续对话的待处理回复自动更新为终态且不会重复追加", async ({ page }) => {
  test.setTimeout(60_000);
  await mockWorkflow(page);
  let reads = 0;
  await page.route("**/api/agent-conversations/workflow-current/messages*", (route) => {
    reads += 1;
    return route.fulfill({ json: { items: [
      { id: "user-one", content: "比较两张风衣", role: "user", status: "completed" },
      { id: "assistant-one", content: reads === 1 ? "正在分析…" : "藏蓝方案更贴近通勤需求。", role: "assistant", status: reads === 1 ? "pending" : "completed" },
    ], nextCursor: null } });
  });
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
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
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('[data-type="reference_image"]')).toHaveCount(1);
  await page.locator('[data-type="reference_image"]').dblclick();
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
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
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
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
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

test("保存失败保留批次，重试使用同一请求且成功前不显示已保存", async ({ page }) => {
  await mockWorkflow(page);
  let fail = true;
  const requests: unknown[] = [];
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    const body = route.request().postDataJSON();
    if (body?.mode !== "layout") return route.fallback();
    requests.push(body);
    if (fail) return route.fulfill({ status: 503, json: { message: "保存服务暂不可用" } });
    return route.fallback();
  });
  await page.goto(`/${PROJECT_ID}`);
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  const box = await brief.boundingBox();
  if (!box) throw new Error("需求节点不可见");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page.getByText("画布已保存", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "output/playwright/review-save-error-after.png" });
  fail = false;
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByText("画布已保存", { exact: true })).toBeVisible();
  expect(requests[1]).toEqual(requests[0]);
});

test("布局保存失败阻止站内离开，保存恢复后再进入项目库", async ({ page }) => {
  await mockWorkflow(page);
  let fail = true;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    return fail ? route.fulfill({ status: 503, json: { message: "保存失败" } }) : route.fallback();
  });
  await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: [], total: 0, page: 1, hasMore: false } }));
  await page.goto(`/${PROJECT_ID}`);
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  const box = await brief.boundingBox();
  if (!box) throw new Error("需求节点不可见");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("link", { name: "返回项目库" }).click();
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(PROJECT_ID));
  fail = false;
  await page.getByRole("link", { name: "返回项目库" }).click();
  await expect(page).toHaveURL("/");
});

test("素材弹窗支持 Escape、焦点圈定和关闭后恢复焦点", async ({ page }) => {
  await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const trigger = page.getByRole("button", { name: "＋ 添加素材" });
  await trigger.click();
  const option = page.getByRole("button", { name: "设计需求 目标、场景、必需条件" });
  await option.click();
  const dialog = page.getByRole("dialog", { name: "添加设计需求" });
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index++) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  for (let index = 0; index < 8; index++) await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("默认视图可读，查看全图、100%和窄屏保持可达", async ({ page }) => {
  await mockWorkflow(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/${PROJECT_ID}`);
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  expect((await brief.boundingBox())!.width / 258).toBeGreaterThanOrEqual(0.85);
  await page.screenshot({ path: "output/playwright/review-canvas-after.png" });
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "画布原始比例" }).click();
  for (const width of [1440, 1920, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expect(page.getByRole("button", { name: "画布原始比例" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("服务器决定节点能否移除，允许移除时先确认关联连线", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  const removable = node("removable", "asset", "reference_text", "可移除备注", 40, 800, { text: "尚未执行的参考" });
  removable.status = "ready";
  removable.canDelete = true;
  removable.deleteDisabledReason = null;
  mocked.getGraph().nodes.push(removable);
  mocked.getGraph().edges.push(edge("removable-input", removable.id, "analysis", "reference"));
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-type="brief"]').dblclick();
  await expect(page.getByRole("button", { name: "从工作流移除节点" })).toBeDisabled();
  await page.locator('[data-kind="asset"]').filter({ has: page.getByText("可移除备注", { exact: true }) }).dblclick();
  await page.getByRole("button", { name: "从工作流移除节点" }).click();
  const confirmation = page.getByRole("dialog", { name: "确认移除节点" });
  await expect(confirmation).toContainText("1 条关联连线");
  expect(mocked.getGraph().nodes.some((item) => item.id === removable.id)).toBe(true);
  await confirmation.getByRole("button", { name: "确认移除", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(mocked.getGraph().nodes.some((item) => item.id === removable.id)).toBe(false);
  expect(mocked.getGraph().edges.some((item) => item.id === "removable-input")).toBe(false);
});

test("同账号后台认证与临时服务故障不会清空设计助手草稿", async ({ page }) => {
  await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("保留袖口，下一步比较面料");
  await page.route("**/api/me", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 503, json: { message: "认证服务暂不可用" } });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(composer).toHaveValue("保留袖口，下一步比较面料");
  await page.waitForTimeout(400);
  await expect(composer).toHaveValue("保留袖口，下一步比较面料");
});

for (const deleted of [false, true]) {
  test(`布局 409 后读取新修订，${deleted ? "不重放已删除节点" : "重放本地拖动位置"}`, async ({ page }) => {
    const mocked = await mockWorkflow(page);
    const requests: Array<{ mutationId: string; baseLayoutRevision: number; positions: Array<{ nodeId: string; x: number; y: number }> }> = [];
    await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const body = route.request().postDataJSON();
      if (body.mode !== "layout") return route.fallback();
      requests.push(body);
      if (requests.length !== 1) return route.fallback();
      mocked.getGraph().layoutRevision = 7;
      if (deleted) {
        mocked.getGraph().nodes = mocked.getGraph().nodes.filter((item) => item.id !== "brief");
        mocked.getGraph().edges = mocked.getGraph().edges.filter((item) => item.sourceNodeId !== "brief");
        mocked.getGraph().revision += 1;
      }
      return route.fulfill({ status: 409, json: { message: "布局修订冲突" } });
    });
    await page.goto(`/${PROJECT_ID}`);
    const brief = page.locator('[data-type="brief"]');
    await expect(brief).toBeVisible();
    const box = await brief.boundingBox();
    if (!box) throw new Error("需求节点不可见");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 25, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => requests.length).toBe(deleted ? 1 : 2);
    await expect(page.getByText("画布已保存", { exact: true })).toBeVisible();
    if (deleted) {
      await expect(brief).toHaveCount(0);
    } else {
      expect(requests[1]?.baseLayoutRevision).toBe(7);
      expect(requests[1]?.mutationId).not.toBe(requests[0]?.mutationId);
      expect(requests[1]?.positions).toEqual(requests[0]?.positions);
      expect(mocked.getGraph().nodes.find((item) => item.id === "brief")?.x).toBe(requests[0]?.positions[0]?.x);
    }
  });
}

async function dragReviewBrief(page: Page, dx = 55) {
  const brief = page.locator('[data-type="brief"]');
  await expect(brief).toBeVisible();
  const box = await brief.boundingBox();
  if (!box) throw new Error("需求节点不可见");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + 15, { steps: 6 });
  await page.mouse.up();
}

test("断网保留待保存数量，恢复后同一批次重试成功", async ({ page, context }) => {
  await mockWorkflow(page);
  let offline = true;
  const requests: unknown[] = [];
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    requests.push(route.request().postDataJSON());
    return offline ? route.abort("internetdisconnected") : route.fallback();
  });
  await page.goto(`/${PROJECT_ID}`);
  await expect(page.locator('[data-type="brief"]')).toBeVisible();
  await context.setOffline(true);
  await dragReviewBrief(page);
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page.getByLabel("待保存节点数")).toContainText("1 个节点");
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await context.setOffline(false);
  offline = false;
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByText("画布已保存", { exact: true })).toBeVisible();
  await expect(page.getByLabel("待保存节点数")).toHaveCount(0);
  expect(requests[1]).toEqual(requests[0]);
});

for (const action of ["reload", "close"] as const) {
  test(`未保存时 ${action} 触发标准离开提示，取消后保留页面`, async ({ page }) => {
    await mockWorkflow(page);
    await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { message: "保存失败" } }) : route.fallback());
    await page.goto(`/${PROJECT_ID}`);
    await dragReviewBrief(page);
    await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
    const prompt = page.waitForEvent("dialog");
    const navigation = action === "reload" ? page.reload({ timeout: 2000 }).catch(() => undefined) : page.close({ runBeforeUnload: true });
    const dialog = await prompt;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await navigation;
    expect(page.isClosed()).toBe(false);
    await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  });
}

test("保存失败的后退可取消，恢复后前进历史仍然可用", async ({ page }) => {
  await mockWorkflow(page);
  await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: [{ id: PROJECT_ID, name: "历史导航验收", assetCount: 0, coverUrl: null, archived: false, createdAt: NOW, updatedAt: NOW }], total: 1, page: 1, hasMore: false } }));
  let fail = true;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "PATCH" && fail
    ? route.fulfill({ status: 503, json: { message: "保存失败" } }) : route.fallback());
  await page.goto("/");
  await page.getByRole("link", { name: "打开项目 历史导航验收" }).click();
  await dragReviewBrief(page);
  await expect(page.getByLabel("待保存节点数")).toBeVisible();
  await page.goBack({ timeout: 1500 }).catch(() => undefined);
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(PROJECT_ID));
  fail = false;
  await page.goBack();
  await expect(page).toHaveURL("/");
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(PROJECT_ID));
  await expect(page.getByText("画布已保存", { exact: true })).toBeVisible();
});

test("保存飞行中继续拖动，旧响应不覆盖新位置且串行提交", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  let release!: () => void;
  const bodies: Array<{ positions: Array<{ nodeId: string; x: number }> }> = [];
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) await new Promise<void>((resolve) => { release = resolve; });
    return route.fallback();
  });
  await page.goto(`/${PROJECT_ID}`);
  await dragReviewBrief(page);
  await expect.poll(() => bodies.length).toBe(1);
  await dragReviewBrief(page, 85);
  const afterSecond = await page.locator('[data-type="brief"]').boundingBox();
  release();
  await expect(page.getByText("画布已保存", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  const afterSave = await page.locator('[data-type="brief"]').boundingBox();
  expect(Math.abs((afterSave?.x ?? 0) - (afterSecond?.x ?? 0))).toBeLessThan(2);
  expect(mocked.getGraph().nodes.find((item) => item.id === "brief")?.x).toBe(bodies[1]?.positions[0]?.x);
});

for (const crossTab of [false, true]) {
  test(`${crossTab ? "真实双标签切换" : "同标签退出重登"}后清除上一账号图片、对话与草稿`, async ({ page, context }) => {
    await context.addCookies([{ name: "review-account", value: "a", url: "http://127.0.0.1:3000" }]);
    await context.route("**/api/auth/logout", (route) => route.fulfill({ json: { ok: true }, headers: { "set-cookie": "review-account=; Path=/; Max-Age=0" } }));
    await context.route("**/api/auth/login", (route) => route.request().postDataJSON()?.action === "verify"
      ? route.fulfill({ json: { projectId: PROJECT_ID }, headers: { "set-cookie": "review-account=b; Path=/; SameSite=Lax" } })
      : route.fulfill({ status: 401, json: { message: "未登录" } }));
    const install = async (target: Page) => {
      const mocked = await mockWorkflow(target);
      const account = (cookie: string) => cookie.includes("review-account=b") ? "b" : cookie.includes("review-account=a") ? "a" : null;
      await target.route("**/api/me", (route) => {
        const id = account(route.request().headers().cookie ?? "");
        return id ? route.fulfill({ json: { user: { id, email: `${id}@example.com`, name: id }, credits: { limit: 600, used: 0, remaining: 600 } } })
          : route.fulfill({ status: 401, json: { message: "未登录" } });
      });
      const graphFor = (cookie: string) => account(cookie) === "b" ? { ...mocked.getGraph(),
        nodes: [node("account-b-brief", "asset", "brief", "B 的设计需求", 40, 120, { text: "账号 B 的独立内容" })], edges: [] } : mocked.getGraph();
      await target.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "GET"
        ? route.fulfill({ json: graphFor(route.request().headers().cookie ?? "") }) : route.fallback());
      await target.route(`**/api/projects/${PROJECT_ID}/workflow/sync`, (route) => route.fulfill({ json: { ...graphFor(route.request().headers().cookie ?? ""), proposals: [] } }));
      await target.route(`**/api/projects/${PROJECT_ID}/agent-conversations*`, (route) => account(route.request().headers().cookie ?? "") === "b"
        ? route.fulfill({ json: { items: [], nextCursor: null } }) : route.fallback());
      await target.route("**/api/agent-conversations/*/messages*", (route) => route.fulfill({ json: { items: [{ id: "private-a-message", role: "assistant", content: "账号 A 的私有对话", status: "completed" }], nextCursor: null } }));
    };
    await install(page);
    await page.goto(`/${PROJECT_ID}`);
    await expect(page.getByText("账号 A 的私有对话", { exact: true })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
    await composer.fill("账号 A 尚未发送的草稿");
    expect(await page.locator('img[src*="asset-a"]').count()).toBeGreaterThan(0);
    if (crossTab) {
      const other = await context.newPage();
      await install(other);
      await other.goto("/auth/confirm?token_hash=review-switch");
      await expect(other.getByText("B 的设计需求", { exact: true })).toBeVisible();
    } else {
      await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: [], total: 0, page: 1, hasMore: false } }));
      await page.getByRole("link", { name: "返回项目库" }).click();
      await expect(page).toHaveURL("/");
      await page.reload();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/auth/confirm?token_hash=review-switch");
    }
    await expect(page.getByText("B 的设计需求", { exact: true })).toBeVisible();
    await expect(page.getByText("账号 A 的私有对话", { exact: true })).toHaveCount(0);
    await expect(page.locator('img[src*="asset-a"]')).toHaveCount(0);
    await expect(composer).toHaveValue("");
  });
}

for (const viewport of REVIEW_VIEWPORTS) {
  test(`画布完整验收 ${viewport.width}×${viewport.height}：初始比例、文字对比度与布局`, async ({ page }) => {
    await mockWorkflow(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(viewport);
    await page.goto(`/${PROJECT_ID}`);
    const brief = page.locator('[data-type="brief"]');
    await expect(brief).toBeVisible();
    expect((await brief.boundingBox())!.width / 258).toBeGreaterThanOrEqual(0.85);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await contrastFailures(page)).toEqual([]);
    expect(await controlFontFailures(page)).toEqual([]);
    await page.screenshot({ path: `output/playwright/review-canvas-${viewport.width}-final.png`, fullPage: true });
    await page.getByRole("button", { name: "＋ 添加素材" }).click();
    await page.getByRole("button", { name: "设计需求 目标、场景、必需条件" }).click();
    await expect(page.getByRole("dialog", { name: "添加设计需求" })).toBeVisible();
    expect(await contrastFailures(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { message: "保存服务暂不可用" } }) : route.fallback());
    await dragReviewBrief(page, 15);
    await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
    await expect(page.getByLabel("待保存节点数")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await contrastFailures(page)).toEqual([]);
    await page.screenshot({ path: `output/playwright/review-canvas-error-${viewport.width}-final.png`, fullPage: true });
  });
}

test("未保存时前进也会等待保存，失败不破坏前进目标", async ({ page }) => {
  await mockWorkflow(page);
  await page.route("**/api/projects?*", (route) => route.fulfill({ json: { items: [], total: 0, page: 1, hasMore: false } }));
  let fail = true;
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => route.request().method() === "PATCH" && fail
    ? route.fulfill({ status: 503, json: { message: "保存失败" } }) : route.fallback());
  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("link", { name: "返回项目库" }).click();
  await expect(page).toHaveURL("/");
  await page.goBack();
  await dragReviewBrief(page);
  await expect(page.getByLabel("待保存节点数")).toBeVisible();
  await page.goForward({ timeout: 1500 }).catch(() => undefined);
  await expect(page.getByText("画布未保存", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(PROJECT_ID));
  fail = false;
  await page.goForward();
  await expect(page).toHaveURL("/");
});

test("仅用键盘完成添加、取消、打开详情和删除确认", async ({ page }) => {
  const mocked = await mockWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  const trigger = page.getByRole("button", { name: "＋ 添加素材" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const option = page.getByRole("button", { name: "设计需求 目标、场景、必需条件" });
  await tabTo(page, option);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "添加设计需求" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await tabTo(page, option);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "名称", exact: true })).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("键盘操作验收");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "内容", exact: true })).toBeFocused();
  await page.keyboard.insertText("未执行的设计需求");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const created = mocked.getGraph().nodes.find((item) => item.title === "键盘操作验收");
  if (!created) throw new Error("键盘添加未创建节点");
  created.canDelete = true;
  created.deleteDisabledReason = null;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await tabTo(page, page.getByRole("button", { name: "适合画布" }));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const frame = page.getByRole("group", { name: "设计节点 键盘操作验收", exact: true });
  await tabTo(page, frame);
  await page.keyboard.press("Enter");
  const remove = page.getByRole("button", { name: "从工作流移除节点" });
  await expect(remove).toBeEnabled();
  await tabTo(page, remove);
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "确认移除节点" });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  await tabTo(page, confirmation.getByRole("button", { name: "确认移除", exact: true }));
  await page.keyboard.press("Enter");
  await expect(frame).toHaveCount(0);
});
