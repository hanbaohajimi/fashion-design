import { expect, test, type Page } from "@playwright/test";
import type { WorkflowGraph, WorkflowNode, WorkflowOperation, WorkflowProposal, WorkflowAttempt } from "../../apps/web/src/modules/board/workflow/workflow-api";

const PROJECT_ID = "e2e-agent-workspace";
const NOW = "2026-10-14T06:00:00.000Z";
test.setTimeout(60_000);

function node(id: string, kind: WorkflowNode["kind"], type: WorkflowNode["type"], title: string, x: number, y: number, payload: WorkflowNode["payload"] = {}, status = "completed"): WorkflowNode {
  return { id, kind, type, title, x, y, payload, status, createdAt: NOW, updatedAt: NOW };
}

function sampleGraph(): WorkflowGraph {
  return {
    projectId: PROJECT_ID, revision: 1, layoutRevision: 0, legacyAvailable: false,
    nodes: [
      node("brief", "asset", "brief", "通勤风衣需求", 30, 80, { text: "保持宽松廓形，面料应呈现自然哑光，并确认防水性能" }),
      node("constraint", "asset", "constraint", "风衣设计约束", 350, 80, { brief: {
        summary: "保留宽松通勤廓形", garmentType: "风衣", unknowns: ["尚未提供面料性能检测资料"],
        constraints: [
          { id: "shape", dimension: "silhouette", requirement: "保持宽松廓形", mode: "preserve", priority: "must", origin: "explicit", verification: "visual", evidenceIds: ["brief"], sourceQuote: "保持宽松" },
          { id: "matte", dimension: "material", requirement: "面料呈现自然哑光质感", mode: "change", priority: "prefer", origin: "interpretation", verification: "visual", evidenceIds: ["brief"], sourceQuote: null },
          { id: "water", dimension: "function", requirement: "确认面料防水性能", mode: "require", priority: "must", origin: "explicit", verification: "requires_measurement", evidenceIds: ["brief"], sourceQuote: "防水" },
        ],
      } }),
      node("generate", "tool", "generate_design", "生成通勤风衣", 670, 80, { toolKey: "generate_design", toolVersion: "1", params: { prompt: "loose trench coat", negativePrompt: "logos", count: 2, width: 768, height: 1024 } }, "ready"),
    ],
    edges: [
      { id: "brief-constraint", sourceNodeId: "brief", targetNodeId: "constraint", sourcePort: "out", targetPort: "source" },
      { id: "constraint-generate", sourceNodeId: "constraint", targetNodeId: "generate", sourcePort: "out", targetPort: "constraint" },
    ],
  };
}

async function mockWorkspace(page: Page) {
  let graph = sampleGraph();
  let proposal: WorkflowProposal | null = null;
  let proposalSequence = 0;
  let failNextExecution = false;
  let completePending = false;
  const proposalRequests: Array<{ content: string; referencedNodeIds: string[] }> = [];
  const executionRequests: string[] = [];
  const decisions: Array<{ assetId: string; kind: string; reason: string }> = [];
  const chatRequests: Array<{ content: string; fileAssetIds: string[]; shapeIds: string[] }> = [];
  const histories = new Map<string, WorkflowAttempt[]>();
  const conversations = [
    { id: "workflow-current", mode: "workflow", projectId: PROJECT_ID, title: "当前设计协作", archivedAt: null, createdAt: NOW, updatedAt: NOW },
    { id: "chat-old", mode: "legacy", projectId: PROJECT_ID, title: "近期设计讨论", archivedAt: null, createdAt: NOW, updatedAt: NOW },
  ];
  const messages = new Map<string, Array<{ id: string; role: string; content: string; status: string; kind?: string; proposal?: WorkflowProposal | null }>>([
    ["chat-old", [{ id: "historical-user", role: "user", content: "历史中保留的风衣设计需求", status: "completed" }]],
  ]);
  const applyOperations = (operations: readonly WorkflowOperation[]) => {
    let nodes = [...graph.nodes];
    let edges = [...graph.edges];
    for (const operation of operations) {
      if (operation.type === "add_node") nodes.push({ ...operation.node, status: "ready", createdAt: NOW, updatedAt: NOW });
      if (operation.type === "update_node") nodes = nodes.map((item) => item.id === operation.nodeId ? { ...item, ...(operation.payload ? { payload: operation.payload } : {}), ...(operation.title ? { title: operation.title } : {}), updatedAt: new Date().toISOString() } : item);
      if (operation.type === "add_edge") edges.push(operation.edge);
      if (operation.type === "remove_node") { nodes = nodes.filter((item) => item.id !== operation.nodeId); edges = edges.filter((item) => item.sourceNodeId !== operation.nodeId && item.targetNodeId !== operation.nodeId); }
      if (operation.type === "remove_edge") edges = edges.filter((item) => item.id !== operation.edgeId);
    }
    graph = { ...graph, revision: graph.revision + 1, nodes, edges };
  };
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: "user-agent-e2e", authId: "auth-agent-e2e", email: "agent@example.com", name: "Agent E2E", avatar: null, createdAt: NOW, deletedAt: null },
    credits: { limit: 600, remaining: 527, used: 73 },
  } }));
  await page.route("**/api/projects/" + PROJECT_ID, (route) => route.fulfill({ json: { id: PROJECT_ID, name: "AGENT 工作区验收项目", archived: false, assetCount: 0, coverAssetId: null, coverUrl: null, createdAt: NOW, updatedAt: NOW } }));
  await page.route("**/api/design-assets/*/path", (route) => route.fulfill({ json: { steps: [], decisions: [], incomplete: false } }));
  await page.route("**/api/design-assets/*/thumbnail", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#d6c8b7"/><path d="M100 70h100l40 280H60z" fill="#394b5e"/></svg>' }));
  await page.route("**/api/projects/" + PROJECT_ID + "/workflow", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { mode: string; operations?: WorkflowOperation[]; positions?: Array<{ nodeId: string; x: number; y: number }> };
      if (body.mode === "semantic") applyOperations(body.operations ?? []);
      else graph = { ...graph, layoutRevision: graph.layoutRevision + 1, nodes: graph.nodes.map((item) => { const p = body.positions?.find((entry) => entry.nodeId === item.id); return p ? { ...item, x: p.x, y: p.y } : item; }) };
    }
    return route.fulfill({ json: graph });
  });
  await page.route("**/api/projects/" + PROJECT_ID + "/workflow/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/sync")) return route.fulfill({ json: { ...graph, proposals: proposal ? [proposal] : [] } });
    if (path.endsWith("/proposals")) {
      const body = route.request().postDataJSON() as { content: string; referencedNodeIds: string[] };
      proposalRequests.push(body);
      proposalSequence += 1;
      const id = "edit-" + proposalSequence;
      proposal = { id: "proposal-" + proposalSequence, status: "pending", baseRevision: graph.revision, content: body.content, referencedNodeIds: body.referencedNodeIds, rationale: "保留宽松通勤廓形，依据所选候选减弱面料反光。", toolNodeId: id, createdAt: NOW, operations: [
        { type: "add_node", node: { id, kind: "tool", type: "edit_design", title: "调整哑光面料", x: 670, y: 450, payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: body.content, negativePrompt: "logos", width: 768, height: 1024 } } } },
        { type: "add_edge", edge: { id: "source-" + proposalSequence, sourceNodeId: body.referencedNodeIds[0] ?? "constraint", targetNodeId: id, sourcePort: "out", targetPort: "source" } },
      ] };
      return route.fulfill({ json: proposal, status: 201 });
    }
    if (path.endsWith("/accept") && proposal) { applyOperations(proposal.operations); for (const [id, history] of messages) messages.set(id, history.map((message) => message.proposal?.id === proposal?.id ? { ...message, proposal: { ...message.proposal, status: "accepted" } } : message)); proposal = null; return route.fulfill({ json: graph }); }
    if (path.endsWith("/reject")) { for (const [id, history] of messages) messages.set(id, history.map((message) => message.proposal?.id === proposal?.id ? { ...message, proposal: { ...message.proposal, status: "rejected" } } : message)); proposal = null; return route.fulfill({ json: { ...graph, proposals: [] } }); }
    const nodeId = path.split("/").at(-2) ?? "";
    if (path.endsWith("/history")) return route.fulfill({ json: { items: histories.get(nodeId) ?? [] } });
    if (path.endsWith("/decisions")) {
      const body = route.request().postDataJSON() as { assetId: string; kind: string; reason: string };
      decisions.push(body);
      graph = { ...graph, revision: graph.revision + 1, nodes: graph.nodes.map((item) => item.id === nodeId ? { ...item, payload: { ...item.payload, decision: body.kind, decisionReason: body.reason } } : item) };
      return route.fulfill({ json: graph });
    }
    if (path.endsWith("/execute")) {
      executionRequests.push(nodeId);
      const target = graph.nodes.find((item) => item.id === nodeId);
      if (!target) return route.fulfill({ status: 404 });
      const failed = failNextExecution;
      failNextExecution = false;
      const previous = histories.get(nodeId) ?? [];
      histories.set(nodeId, [...previous, { id: "attempt-" + executionRequests.length, ordinal: previous.length + 1, status: failed ? "failed" : "completed", generationTaskId: null, error: failed ? "模拟生成服务暂不可用" : null, createdAt: NOW, request: { ...(target.payload.params as Record<string, unknown>), model: "mock-image-model", inputNodeIds: graph.edges.filter((item) => item.targetNodeId === nodeId).map((item) => item.sourceNodeId) } }]);
      graph = { ...graph, revision: graph.revision + 1, nodes: graph.nodes.map((item) => item.id === nodeId ? { ...item, status: failed ? "failed" : "completed" } : item) };
      if (!failed && target.type === "generate_design") {
        const candidates = [1, 2].map((index) => node("candidate-" + index, "asset", "candidate", "风衣候选 " + index, 1000, 70 + (index - 1) * 330, { assetId: "asset-" + index, imageUrl: "/api/design-assets/asset-" + index + "/thumbnail", text: index === 2 ? "面料反光较强" : "自然哑光面料" }));
        graph = { ...graph, nodes: [...graph.nodes, ...candidates], edges: [...graph.edges, ...candidates.map((item) => ({ id: "output-" + item.id, sourceNodeId: nodeId, targetNodeId: item.id, sourcePort: "out" as const, targetPort: "source" as const }))] };
      }
      if (!failed && target.type === "evaluate_design") {
        const report = node("report", "asset", "evaluation", "逐候选评估报告", 1000, 720, { report: { evaluations: [1, 2].map((index) => ({ assetId: "asset-" + index, summary: index === 2 ? "廓形稳定，面料反光需修正" : "自然哑光，保持通勤比例", checks: [
          { constraintId: "shape", status: "met", observation: "肩线与腰线保留明显宽松余量" },
          { constraintId: "matte", status: index === 2 ? "concern" : "met", observation: index === 2 ? "衣身出现较强镜面反光，需要减弱" : "表面反光自然" },
          { constraintId: "water", status: "unknown", observation: "不能单凭图像确认防水性能，需要实测" },
        ] })) } });
        graph = { ...graph, nodes: [...graph.nodes, report], edges: [...graph.edges, { id: "evaluate-report", sourceNodeId: nodeId, targetNodeId: report.id, sourcePort: "out", targetPort: "source" }] };
      }
      return route.fulfill({ json: graph });
    }
    return route.fulfill({ status: 404 });
  });
  await page.route("**/api/projects/" + PROJECT_ID + "/agent-conversations*", (route) => {
    if (route.request().method() === "POST") {
      const created = { id: "chat-new", mode: "workflow", projectId: PROJECT_ID, title: "新的设计对话", archivedAt: null, createdAt: NOW, updatedAt: NOW };
      conversations.unshift(created); messages.set(created.id, []);
      return route.fulfill({ json: created, status: 201 });
    }
    return route.fulfill({ json: { items: conversations, nextCursor: null } });
  });
  await page.route("**/api/agent-conversations/*/messages*", (route) => {
    const conversationId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { content: string; fileAssetIds: string[]; shapeIds: string[] };
      chatRequests.push(body);
      const userMessage = { id: "user-" + chatRequests.length, role: "user", content: body.content, status: "completed" };
      const assistantMessage = { id: "assistant-" + chatRequests.length, role: "assistant", content: "已整理为三个可执行的廓形与面料方向。", status: "completed" };
      messages.set(conversationId, [...(messages.get(conversationId) ?? []), userMessage, assistantMessage]);
      return route.fulfill({ json: { userMessage, assistantMessage, taskId: null }, status: 201 });
    }
    const current = messages.get(conversationId) ?? [];
    return route.fulfill({ json: { items: completePending ? current.map((item) => item.status === "pending" ? { ...item, status: "completed", content: "已创建生成任务。" } : item) : current, nextCursor: null } });
  });
  await page.route("**/api/agent-conversations/*/context", (route) => route.fulfill({ json: {
    revision: 1, currentObjective: "通勤风衣设计", currentTask: "继续比较方案", focusNodeIds: [], requirements: [], preferences: [], nodes: [], visualCoverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [] },
  } }));
  await page.route("**/api/agent-conversations/*/workflow-messages", (route) => {
    const conversationId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    const body = route.request().postDataJSON() as { content: string; referencedNodeIds: string[] };
    const reply = body.content.startsWith("比较风衣");
    if (!reply) {
      proposalRequests.push(body);
      proposalSequence += 1;
      const id = "edit-" + proposalSequence;
      proposal = { id: "proposal-" + proposalSequence, status: "pending", baseRevision: graph.revision, content: body.content, referencedNodeIds: body.referencedNodeIds, rationale: "保留宽松通勤廓形，依据所选候选减弱面料反光。", toolNodeId: id, createdAt: NOW, operations: [
        { type: "add_node", node: { id, kind: "tool", type: "edit_design", title: "调整哑光面料", x: 670, y: 450, payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: body.content, negativePrompt: "logos", width: 768, height: 1024 } } } },
        { type: "add_edge", edge: { id: "source-" + proposalSequence, sourceNodeId: body.referencedNodeIds[0] ?? "constraint", targetNodeId: id, sourcePort: "out", targetPort: "source" } },
      ] };
    }
    const ordinal = (messages.get(conversationId) ?? []).length;
    const userMessage = { id: "user-" + ordinal, role: "user", content: body.content, status: "completed" };
    const assistantMessage = { id: "assistant-" + ordinal, role: "assistant", content: reply ? "已整理为三个可执行的廓形与面料方向。" : "可以基于反馈建立修改分支。", status: "completed", kind: reply ? "reply" : "propose", proposal: reply ? null : proposal };
    messages.set(conversationId, [...(messages.get(conversationId) ?? []), userMessage, assistantMessage]);
    return route.fulfill({ status: 201, json: { userMessage, assistantMessage } });
  });
  return { getGraph: () => graph, setGraph: (next: WorkflowGraph) => { graph = next; }, proposalRequests, executionRequests, decisions, chatRequests, messages, failExecution: () => { failNextExecution = true; }, completePending: () => { completePending = true; } };
}

async function selectNode(page: Page, title: string) {
  await page.locator("[data-kind]").filter({ has: page.getByText(title, { exact: true }) }).dblclick();
  return page.getByRole("complementary", { name: "设计助手与节点详情" });
}

test("逐节点执行先保存参数，失败可恢复，选定第二个候选后刷新保留设计路径", async ({ page }) => {
  const mocked = await mockWorkspace(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/" + PROJECT_ID);
  const details = await selectNode(page, "生成通勤风衣");
  await details.getByRole("textbox", { name: "执行指令" }).fill("loose trench coat with structured waist");
  await details.getByText("高级设置", { exact: true }).click();
  await details.getByRole("textbox", { name: "排除内容" }).fill("logos, shiny coating");
  await expect(details.getByRole("button", { name: "确认并执行" })).toBeDisabled();
  expect(mocked.executionRequests).toHaveLength(0);
  await details.getByRole("button", { name: "保存工具参数" }).click();
  await expect(details.getByRole("button", { name: "确认并执行" })).toBeEnabled();
  expect(mocked.getGraph().nodes.find((item) => item.id === "generate")?.payload.params).toMatchObject({ prompt: "loose trench coat with structured waist", negativePrompt: "logos, shiny coating", count: 2 });
  mocked.failExecution();
  await details.getByRole("button", { name: "确认并执行" }).click();
  await expect(details.getByRole("button", { name: "重试执行" })).toBeEnabled();
  await details.getByText("执行记录", { exact: true }).click();
  await details.getByRole("button", { name: "读取尝试记录" }).click();
  await expect(details.getByText("模拟生成服务暂不可用")).toBeVisible();
  expect(mocked.executionRequests).toHaveLength(1);
  await details.getByRole("button", { name: "重试执行" }).click();
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(2);
  await expect(details.getByRole("button", { name: "确认并执行" })).toHaveCount(0);
  expect(mocked.executionRequests).toHaveLength(2);
  await selectNode(page, "风衣候选 2");
  await details.getByText("来源与路径", { exact: true }).click();
  await expect(details.getByRole("button", { name: "保存决定" })).toBeDisabled();
  await details.getByPlaceholder("记录选择或否决理由").fill("保留第二个候选的肩线与腰部比例");
  await details.getByRole("button", { name: "保存决定" }).click();
  await expect.poll(() => mocked.decisions.length).toBe(1);
  expect(mocked.decisions[0]).toMatchObject({ assetId: "asset-2", kind: "selected", reason: "保留第二个候选的肩线与腰部比例" });
  await page.reload();
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(2);
  await selectNode(page, "风衣候选 2");
  await details.getByText("来源与路径", { exact: true }).click();
  await expect(details.getByText("来源 · 生成通勤风衣", { exact: true })).toBeVisible();
  expect(mocked.getGraph().nodes.find((item) => item.id === "candidate-2")?.payload.decision).toBe("selected");
  expect(mocked.executionRequests).toHaveLength(2);
});

test("领域评估按真实候选显示约束检查，反馈提案先预览后确认且不自动生成", async ({ page }) => {
  const mocked = await mockWorkspace(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/" + PROJECT_ID);
  const details = await selectNode(page, "风衣设计约束");
  await expect(details.getByText("必须 · 明确提出").first()).toBeVisible();
  await expect(details.getByText("偏好 · 解释性建议")).toBeVisible();
  await expect(details.getByText("需实测或规格确认")).toBeVisible();
  await expect(details.getByText("待确认：尚未提供面料性能检测资料")).toBeVisible();
  await selectNode(page, "生成通勤风衣");
  await details.getByRole("button", { name: "确认并执行" }).click();
  await expect(page.locator('[data-type="candidate"]')).toHaveCount(2);
  const evaluate = node("evaluate", "tool", "evaluate_design", "检查两张候选", 670, 720, { toolKey: "evaluate_design", toolVersion: "1", params: { prompt: "根据宽松、哑光与防水条件检查每张候选" } }, "ready");
  mocked.setGraph({ ...mocked.getGraph(), nodes: [...mocked.getGraph().nodes, evaluate], edges: [...mocked.getGraph().edges,
    { id: "check-constraint", sourceNodeId: "constraint", targetNodeId: "evaluate", sourcePort: "out", targetPort: "constraint" },
    ...[1, 2].map((index) => ({ id: "check-" + index, sourceNodeId: "candidate-" + index, targetNodeId: "evaluate", sourcePort: "out" as const, targetPort: "candidate" as const })),
  ] });
  await page.reload();
  await selectNode(page, "检查两张候选");
  await details.getByRole("button", { name: "确认并执行" }).click();
  await expect(page.locator('[data-type="evaluation"]')).toHaveCount(1);
  await selectNode(page, "逐候选评估报告");
  await expect(details.getByText("廓形稳定，面料反光需修正")).toBeVisible();
  await expect(details.getByText("! 存疑 · 衣身出现较强镜面反光，需要减弱")).toBeVisible();
  await expect(details.getByText("? 无法判断 · 不能单凭图像确认防水性能，需要实测").first()).toBeVisible();
  await selectNode(page, "风衣候选 2");
  await details.getByRole("combobox").first().selectOption("rejected");
  await details.getByPlaceholder("记录选择或否决理由").fill("面料反光过强，保持宽松比例并减弱亮面涂层");
  await details.getByRole("button", { name: "保存决定" }).click();
  await expect.poll(() => mocked.decisions.length).toBe(1);
  expect(mocked.decisions[0]).toMatchObject({ assetId: "asset-2", kind: "rejected" });
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "向设计助手描述下一步" });
  await composer.fill("请根据反馈修订 @风衣候选");
  await page.getByRole("option", { name: /风衣候选 2/ }).click();
  await composer.fill("@风衣候选 2 面料反光过强，请保持宽松比例并减弱亮面涂层");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.locator('[data-type="edit_design"][data-status="proposed"]')).toBeVisible();
  expect(mocked.proposalRequests[0]?.referencedNodeIds).toEqual(["candidate-2"]);
  expect(mocked.getGraph().nodes.some((item) => item.type === "edit_design")).toBe(false);
  expect(mocked.executionRequests).toHaveLength(2);
  await page.getByRole("button", { name: "调整", exact: true }).click();
  await expect(page.locator('[data-status="proposed"]')).toHaveCount(0);
  await composer.fill("@风衣候选 2 保留宽松通勤廓形，使用 matte woven fabric");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.locator('[data-status="proposed"]')).toBeVisible();
  await page.getByRole("button", { name: "加入画布", exact: true }).click();
  await expect(page.locator('[data-type="edit_design"][data-status="ready"]')).toBeVisible();
  expect(mocked.getGraph().edges.find((item) => item.targetNodeId === "edit-2")?.sourceNodeId).toBe("candidate-2");
  expect(mocked.executionRequests).toHaveLength(2);
  await page.reload();
  await selectNode(page, "调整哑光面料");
  await expect(details.getByRole("textbox", { name: "执行指令" })).toHaveValue("@风衣候选 2 保留宽松通勤廓形，使用 matte woven fabric");
  expect(mocked.executionRequests).toHaveLength(2);
});

test("持续设计对话里的 pending 助手消息会自动同步为终态", async ({ page }) => {
  const mocked = await mockWorkspace(page);
  mocked.messages.set("workflow-current", [
    { id: "user-pending", role: "user", content: "请生成", status: "completed" },
    { id: "assistant-pending", role: "assistant", content: "正在理解你的设计需求…", status: "pending" },
  ]);
  await page.goto("/" + PROJECT_ID);
  await expect(page.getByText("正在理解你的设计需求…")).toBeVisible();
  mocked.completePending();
  await expect(page.getByText("已创建生成任务。")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("正在理解你的设计需求…")).toHaveCount(0);
});

test("长设计备注作为文字参考完整保存，桌面和窄屏可查看原文", async ({ page }) => {
  const mocked = await mockWorkspace(page);
  const text = "全身正面平视视角，一位身材纤细、气场干练的短发亚裔女模特，身穿短款雕塑感通勤夹克。" +
    "模特双臂自然下垂，双手轻插裤袋，以凸显短款利落的腰线和衣身的立体建筑感折痕。" +
    "纯白无影棚拍摄，柔光箱均匀布光，高清晰度，商业服装摄影，超写实。";
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/" + PROJECT_ID);
  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: /文字参考/ }).click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("拍摄备注");
  await page.getByRole("textbox", { name: "内容", exact: true }).fill(text);
  await page.getByRole("button", { name: "加入工作流" }).click();
  await expect.poll(() => mocked.getGraph().nodes.find((item) => item.title === "拍摄备注")?.payload.text).toBe(text);
  await page.reload();
  const details = await selectNode(page, "拍摄备注");
  await expect(details.getByText(text, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(details.getByText(text, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("持续助手在桌面与窄屏保持会话交互，讨论不会自动提交图修改", async ({ page }) => {
  const mocked = await mockWorkspace(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/" + PROJECT_ID);
  await expect(page.getByRole("region", { name: "设计工作流画布" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "设计助手与节点详情" })).toBeVisible();
  await expect(page.getByText("AGENT 工作区验收项目")).toBeVisible();
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "新建设计对话", exact: true }).click();
  await page.getByText("更多", { exact: true }).click();
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "历史会话" })).toHaveValue("chat-new");
  await page.getByRole("textbox", { name: "向设计助手描述下一步" }).fill("比较风衣的面料垂坠感");
  await page.getByRole("button", { name: "发送 ↑" }).click();
  await expect(page.getByText("已整理为三个可执行的廓形与面料方向。")).toBeVisible();
  expect(mocked.chatRequests).toHaveLength(0);
  expect(mocked.proposalRequests).toHaveLength(0);
  expect(mocked.executionRequests).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox", { name: "历史会话" }).selectOption("chat-old");
  await expect(page.getByText("历史中保留的风衣设计需求")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "向设计助手描述下一步" })).toHaveCount(0);
  await page.getByRole("button", { name: "节点列表" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "生成通勤风衣" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
