import { expect, test } from "@playwright/test";

const PROJECT_ID = "e2e-history";
const CREATED_AT = "2026-07-27T08:00:00.000Z";

interface GraphNode {
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
}

interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort: "out";
  targetPort: string;
}

function node(id: string, kind: GraphNode["kind"], type: string, title: string, x: number, y: number, payload: Record<string, unknown>): GraphNode {
  return { id, kind, type, title, payload, x, y, status: "completed", createdAt: CREATED_AT, updatedAt: CREATED_AT };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, targetPort: string): GraphEdge {
  return { id, sourceNodeId, targetNodeId, sourcePort: "out", targetPort };
}

function version(id: string, operation: "generated" | "restore" | "variation", restoredFromAssetId: string | null, parentAssetId: string | null) {
  return {
    archivedAt: null, createdAt: CREATED_AT, height: 1024, id, operation, parentAssetId,
    projectId: PROJECT_ID, restoredFromAssetId, seed: 417,
    thumbnailUrl: `/api/design-assets/${id}/thumbnail`, url: `/api/design-assets/${id}/content`, width: 768,
  };
}

test("主工作流从版本历史恢复后落新分支；图接入失败刷新重试不会重复创建资产", async ({ page }) => {
  const root = version("asset-root", "generated", null, null);
  const current = version("asset-current", "variation", null, "asset-root");
  const restoredOne = version("asset-restore-1", "restore", "asset-root", "asset-current");
  const restoredTwo = version("asset-restore-2", "restore", "asset-current", "asset-restore-1");
  const graph = {
    projectId: PROJECT_ID, revision: 1, layoutRevision: 0, legacyAvailable: false,
    nodes: [
      node("brief", "asset", "brief", "短款夹克需求", 40, 100, { text: "保留肩线与袖口细节" }),
      node("swatch", "asset", "swatch", "藏蓝色卡", 40, 350, { color: "#112233" }),
      node("fabric", "asset", "fabric", "挺括羊毛", 40, 600, { fabricId: "fabric-wool", text: "挺括羊毛" }),
      node("generate", "tool", "generate_design", "生成初版", 390, 180, { toolKey: "generate_design", toolVersion: "1", params: { prompt: "cropped jacket" } }),
      node("candidate-root", "asset", "candidate", "初版夹克", 740, 150, { assetId: "asset-root" }),
      node("edit", "tool", "edit_design", "修改袖口", 1090, 180, { toolKey: "edit_design", toolVersion: "1", params: { prompt: "revised cuffs" } }),
      node("candidate-current", "asset", "candidate", "当前夹克", 1440, 150, { assetId: "asset-current" }),
    ] as GraphNode[],
    edges: [
      edge("e1", "brief", "generate", "reference"), edge("e2", "swatch", "generate", "reference"),
      edge("e3", "fabric", "generate", "reference"), edge("e4", "generate", "candidate-root", "source"),
      edge("e5", "candidate-root", "edit", "source"), edge("e6", "edit", "candidate-current", "source"),
    ] as GraphEdge[],
  };
  const restoreRequests: Array<{ currentAssetId: string; targetAssetId: string; clientRequestId: string }> = [];
  const restoreByRequestId = new Map<string, ReturnType<typeof version>>();
  const importedAssets: string[] = [];
  const decisions: string[] = [];
  let failFirstImport = true;

  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { authId: "auth-history", avatar: null, createdAt: CREATED_AT, deletedAt: null, email: "history@example.com", id: "user-history", name: "Archive Atelier" },
    credits: { limit: 100, remaining: 18, used: 82 },
  } }));
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) => route.fulfill({ json: {
    archived: false, assetCount: 2, coverAssetId: null, coverUrl: null,
    createdAt: CREATED_AT, id: PROJECT_ID, name: "E2E 版本项目", updatedAt: CREATED_AT,
  } }));
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/sync`, (route) => route.fulfill({ json: { ...graph, proposals: [] } }));
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/import-asset`, (route) => {
    const body = route.request().postDataJSON() as { sourceNodeId: string; assetId: string; mutationId: string };
    importedAssets.push(body.assetId);
    if (failFirstImport) {
      failFirstImport = false;
      return route.fulfill({ status: 503, json: { message: "暂时无法写入工作流" } });
    }
    const source = graph.nodes.find((item) => item.id === body.sourceNodeId);
    expect(source?.payload.assetId).toBe(body.assetId === restoredOne.id ? "asset-current" : "asset-restore-1");
    if (!graph.nodes.some((item) => item.payload.assetId === body.assetId)) {
      const restoreToolId = `restore-tool-${body.assetId}`;
      const outputId = `restore-result-${body.assetId}`;
      graph.nodes.push(node(restoreToolId, "tool", "restore_version", "版本恢复", (source?.x ?? 1400) + 340, (source?.y ?? 150) + 180, { toolKey: "restore_version", toolVersion: "1", params: {} }));
      graph.nodes.push(node(outputId, "asset", "candidate", "恢复的版本", (source?.x ?? 1400) + 680, (source?.y ?? 150) + 180, { assetId: body.assetId }));
      graph.edges.push(edge(`restore-in-${body.assetId}`, body.sourceNodeId, restoreToolId, "source"));
      graph.edges.push(edge(`restore-out-${body.assetId}`, restoreToolId, outputId, "source"));
      graph.revision += 1;
    }
    return route.fulfill({ json: graph });
  });
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/nodes/candidate-current/decisions`, (route) => {
    const body = route.request().postDataJSON() as { reason: string };
    decisions.push(body.reason);
    const candidate = graph.nodes.find((item) => item.id === "candidate-current");
    if (candidate) {
      candidate.payload = { assetId: "asset-current", decision: { kind: "selected", reason: body.reason } };
    }
    graph.revision += 1;
    return route.fulfill({ json: graph });
  });
  await page.route(/\/api\/design-assets\/([^/]+)\/versions/u, (route) => {
    const activeId = new URL(route.request().url()).pathname.split("/").at(-2);
    const items = activeId === restoredTwo.id ? [restoredTwo, restoredOne, current, root] :
      activeId === restoredOne.id ? [restoredOne, current, root] : [current, root];
    return route.fulfill({ json: { items, nextCursor: null } });
  });
  await page.route(/\/api\/design-assets\/([^/]+)\/restore$/u, (route) => {
    const targetAssetId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    const body = route.request().postDataJSON() as { currentAssetId: string; clientRequestId: string };
    restoreRequests.push({ currentAssetId: body.currentAssetId, targetAssetId, clientRequestId: body.clientRequestId });
    const restored = restoreByRequestId.get(body.clientRequestId) ?? (targetAssetId === root.id ? restoredOne : restoredTwo);
    restoreByRequestId.set(body.clientRequestId, restored);
    return route.fulfill({ json: restored });
  });
  await page.route("**/api/design-assets/*/content", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024"><rect width="768" height="1024" fill="#dad1c5"/><path d="M200 150h368l70 720H130z" fill="#243751"/></svg>',
  }));
  await page.route("**/api/design-assets/*/thumbnail", (route) => route.fulfill({
    contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="260"><rect width="200" height="260" fill="#243751"/></svg>',
  }));
  await page.route("**/api/design-assets/*/path", (route) => route.fulfill({ json: {
    assetId: "asset-current", incomplete: false, decisions: [],
    steps: [{ id: "step-current", version: 1, actor: "agent", tool: "i2i", intent: "修改袖口，保留肩线",
      sources: [{ elementId: "root", assetId: "asset-root", role: "edit_source", title: "初版夹克" }],
      constraints: { palette: ["#112233"], notes: ["隐藏式按扣"], avoidLabels: [], fabricTerms: ["挺括羊毛"] },
      parameters: { prompt: "revised cuffs", width: 768, height: 1024 }, createdAt: CREATED_AT,
      status: "succeeded", snapshotAvailable: true, outputs: [current], conversationId: null }],
  } }));

  await page.goto(`/${PROJECT_ID}`);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.locator('[data-type="candidate"]').filter({ hasText: "当前夹克" }).dblclick();
  const details = page.getByRole("complementary", { name: "设计助手与节点详情" });
  await details.getByText("来源与路径", { exact: true }).click();
  await expect(details.getByText("挺括羊毛").first()).toBeVisible();
  await details.getByPlaceholder("记录选择或否决理由").fill("保留肩线，面料表现符合预期");
  await details.getByRole("button", { name: "保存决定" }).click();
  await expect.poll(() => decisions).toContain("保留肩线，面料表现符合预期");
  await details.getByRole("button", { name: "打开大图、版本与局部重绘" }).click();
  let workspace = page.getByRole("dialog", { name: "候选资产工作台" });
  await workspace.getByRole("tab", { name: "版本历史" }).click();
  await workspace.getByRole("listitem").filter({ hasText: "初次生成" }).getByRole("button", { name: "恢复此版" }).click();
  await expect(workspace.getByText("恢复版本已创建，正在等待加入画布。", { exact: false })).toBeVisible();
  expect(restoreRequests).toHaveLength(1);
  expect(importedAssets).toEqual([restoredOne.id]);
  const pendingKey = `fashion-restore-request:${current.id}:${root.id}`;
  const firstRequestId = restoreRequests[0]?.clientRequestId;
  expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).toBe(firstRequestId);

  await page.reload();
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.locator('[data-type="candidate"]').filter({ hasText: "当前夹克" }).dblclick();
  await details.getByRole("button", { name: "打开大图、版本与局部重绘" }).click();
  workspace = page.getByRole("dialog", { name: "候选资产工作台" });
  await workspace.getByRole("tab", { name: "版本历史" }).click();
  await workspace.getByRole("listitem").filter({ hasText: "初次生成" }).getByRole("button", { name: "恢复此版" }).click();
  await expect.poll(() => graph.nodes.filter((item) => item.payload.assetId === restoredOne.id).length).toBe(1);
  expect(restoreRequests.map((item) => item.clientRequestId)).toEqual([firstRequestId, firstRequestId]);
  expect(importedAssets).toEqual([restoredOne.id, restoredOne.id]);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).toBeNull();

  await expect(page.locator('[data-type="candidate"]').filter({ hasText: "恢复的版本" })).toHaveCount(1);
  await page.getByRole("button", { name: "适合画布" }).click();
  await page.locator('[data-type="candidate"]').filter({ hasText: "恢复的版本" }).first().dblclick();
  await details.getByRole("button", { name: "打开大图、版本与局部重绘" }).click();
  workspace = page.getByRole("dialog", { name: "候选资产工作台" });
  await workspace.getByRole("tab", { name: "版本历史" }).click();
  await workspace.getByRole("listitem").filter({ hasText: "设计变体" }).getByRole("button", { name: "恢复此版" }).click();
  await expect.poll(() => graph.nodes.filter((item) => item.payload.assetId === restoredTwo.id).length).toBe(1);
  expect(restoreRequests.at(-1)).toMatchObject({ currentAssetId: restoredOne.id, targetAssetId: current.id });
  expect(graph.nodes.filter((item) => item.type === "restore_version")).toHaveLength(2);
  expect(graph.nodes.filter((item) => item.payload.assetId === root.id)).toHaveLength(1);
});
