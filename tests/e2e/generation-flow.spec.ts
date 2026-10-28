import { expect, test, type Page } from "@playwright/test";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";
import { openImageDetails } from "./workflow-navigation";

// These scenarios exercise the editable workflow, not the default design workbench.
test.beforeEach(async ({ page }) => {
  await seedReturningFeatureGuideUser(page, ["user-logout", "user-fabric-search", "user-project-create", "user-trends", "user-drop", "user-fabric", "user-e2e"]);
  await page.addInitScript(() => sessionStorage.setItem("fashion:canvas-view", "workflow"));
});

const WORKFLOW_NOW = "2026-10-14T00:00:00.000Z";

interface WorkflowTestNode {
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

interface WorkflowTestEdge {
  id: string;
  sourceNodeId: string;
  sourcePort: "out";
  targetNodeId: string;
  targetPort: string;
}

interface WorkflowTestGraph {
  projectId: string;
  revision: number;
  layoutRevision: number;
  legacyAvailable: boolean;
  nodes: WorkflowTestNode[];
  edges: WorkflowTestEdge[];
}

function workflowNode(
  id: string,
  kind: WorkflowTestNode["kind"],
  type: string,
  title: string,
  payload: Record<string, unknown>,
  x: number,
  y: number,
  status = "completed",
): WorkflowTestNode {
  return { id, kind, type, title, payload, x, y, status, createdAt: WORKFLOW_NOW, updatedAt: WORKFLOW_NOW };
}

async function mockEditableWorkflow(page: Page, projectId: string, initial?: Partial<WorkflowTestGraph>) {
  const graph: WorkflowTestGraph = {
    projectId,
    revision: 0,
    layoutRevision: 0,
    legacyAvailable: false,
    nodes: [],
    edges: [],
    ...initial,
  };
  const semanticMutations: Array<Record<string, unknown>> = [];
  await page.route(`**/api/projects/${projectId}/workflow/sync`, (route) =>
    route.fulfill({ json: graph }),
  );
  await page.route(`**/api/projects/${projectId}/workflow`, (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill({ json: graph });
    const body = route.request().postDataJSON() as {
      mode: "semantic" | "layout";
      operations?: Array<
        | { type: "add_node"; node: Omit<WorkflowTestNode, "status" | "createdAt" | "updatedAt"> }
        | { type: "add_edge"; edge: WorkflowTestEdge }
      >;
      positions?: Array<{ nodeId: string; x: number; y: number }>;
    };
    if (body.mode === "semantic") {
      semanticMutations.push(body as Record<string, unknown>);
      for (const operation of body.operations ?? []) {
        if (operation.type === "add_node") {
          graph.nodes.push({ ...operation.node, status: "ready", createdAt: WORKFLOW_NOW, updatedAt: WORKFLOW_NOW });
        } else {
          graph.edges.push(operation.edge);
        }
      }
      graph.revision += 1;
    } else {
      for (const position of body.positions ?? []) {
        const node = graph.nodes.find((item) => item.id === position.nodeId);
        if (node) { node.x = position.x; node.y = position.y; }
      }
      graph.layoutRevision += 1;
    }
    return route.fulfill({ json: graph });
  });
  return { graph, semanticMutations };
}

test("项目库可以安全退出并返回登录页", async ({ page }) => {
  let logoutRequestCount = 0;

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 88, used: 12 },
        user: {
          authId: "auth-logout",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "logout@example.com",
          id: "user-logout",
          name: "Logout Atelier",
        },
      },
    }),
  );
  await page.route("**/api/projects?*", (route) =>
    route.fulfill({
      json: { items: [], nextCursor: null, total: 0 },
    }),
  );
  await page.route("**/api/auth/logout", async (route) => {
    logoutRequestCount += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await expect(page.getByLabel("logout@example.com", { exact: true })).toBeVisible();

  const workspaceNavigation = page.getByRole("navigation", {
    name: "工作区导航",
  });
  await expect(
    workspaceNavigation.getByRole("link", { name: "项目库" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    workspaceNavigation.getByRole("link", { name: "趋势档案" }),
  ).toHaveAttribute("href", "/trends?from=projects");
  await expect(
    workspaceNavigation.getByRole("link", { name: "面料库" }),
  ).toHaveAttribute("href", "/fabrics");

  await expect(
    page.getByRole("heading", { name: "从第一个系列开始" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "创建第一个项目" }).click();
  await expect(
    page.getByRole("dialog", { name: "给新系列一个名字" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "给新系列一个名字" })).toBeHidden();
  const projectSearch = page.getByRole("searchbox", { name: "搜索项目" });
  await page.keyboard.press("Control+K");
  await expect(projectSearch).toBeFocused();
  await page.keyboard.press("Escape");

  await page.getByLabel("logout@example.com", { exact: true }).click();
  await page.getByRole("button", { name: "退出登录" }).click();

  await expect.poll(() => logoutRequestCount).toBe(1);
  await expect(page).toHaveURL(/\/login$/u);
});

test("登录邮件发送后可更换邮箱并重发到已确认地址", async ({ page }) => {
  const recipients: string[] = [];

  await page.route("**/api/auth/login", async (route) => {
    const body = route.request().postDataJSON() as {
      readonly action: string;
      readonly email?: string;
    };
    if (body.action === "send" && body.email) {
      recipients.push(body.email);
    }
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/login");
  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toHaveAttribute("href", "#main-content");
  const emailInput = page.getByRole("textbox", { name: "邮箱地址" });
  await emailInput.fill("first@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();

  await expect(page.getByRole("status")).toContainText("first@example.com");
  await expect(emailInput).toBeDisabled();
  await page.getByRole("button", { name: "换个邮箱" }).click();
  await expect(emailInput).toBeFocused();
  await emailInput.fill("second@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("status")).toContainText("second@example.com");

  await page.getByRole("button", { name: "重新发送" }).click();
  await expect
    .poll(() => recipients)
    .toEqual(["first@example.com", "second@example.com", "second@example.com"]);
});

test("面料档案支持快捷搜索并可快速清空关键词", async ({ page }) => {
  const requestedSearches: string[] = [];

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 88, used: 12 },
        user: {
          authId: "auth-fabric-search",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "fabric-search@example.com",
          id: "user-fabric-search",
          name: "Fabric Search",
        },
      },
    }),
  );
  await page.route("**/api/fabrics?*", (route) => {
    requestedSearches.push(
      new URL(route.request().url()).searchParams.get("search") ?? "",
    );
    return route.fulfill({
      json: { items: [], limit: 48, page: 1, total: 0, totalPages: 1 },
    });
  });

  await page.goto("/fabrics");
  const search = page.getByRole("searchbox", { name: "搜索面料" });
  // The initial fetch can precede the keyboard effect; retry the real shortcut
  // within a bounded window instead of assuming the first request means ready.
  await expect.poll(() => requestedSearches.length).toBeGreaterThan(0);
  await expect(async () => {
    await page.keyboard.press("Control+K");
    await expect(search).toBeFocused({ timeout: 250 });
  }).toPass({ timeout: 5000 });
  await search.fill("  亚麻  ");
  await expect.poll(() => requestedSearches).toContain("亚麻");
  await expect(page.getByText("没有匹配“亚麻”的面料。")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
});

test("新建项目成功后立即进入空白设计工作流", async ({ page }) => {
  const now = "2026-08-05T00:00:00.000Z";
  const project = {
    archived: false,
    assetCount: 0,
    coverAssetId: null,
    coverUrl: null,
    createdAt: now,
    id: "created-project",
    name: "真实流程胶囊系列",
    updatedAt: now,
  };
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 100, used: 0 },
        user: {
          authId: "auth-project-create",
          avatar: null,
          createdAt: now,
          deletedAt: null,
          email: "project-create@example.com",
          id: "user-project-create",
          name: "Project Creator",
        },
      },
    }),
  );
  await page.route("**/api/projects?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null, total: 0 } }),
  );
  await page.route(/\/api\/projects$/u, (route) =>
    route.fulfill({ json: project, status: 201 }),
  );
  await page.route("**/api/projects/created-project", (route) =>
    route.fulfill({ json: project }),
  );
  await mockEditableWorkflow(page, project.id);
  await page.route("**/api/collections?projectId=created-project", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(
    "**/api/projects/created-project/agent-conversations*",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              archivedAt: null,
              createdAt: now,
              id: "created-project-conversation",
              messageCount: 0,
              projectId: project.id,
              title: "新的设计对话",
              updatedAt: now,
            },
          ],
          nextCursor: null,
        },
      }),
  );
  await page.route("**/api/agent-conversations/*/messages*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill(project.name);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();

  await expect(page).toHaveURL(/\/created-project$/u);
  await expect(page.getByRole("main").getByText(project.name, { exact: true })).toBeVisible();
  const canvas = page.getByRole("region", { name: "设计工作流画布" });
  await expect(canvas).toBeVisible();
  await expect(canvas.getByRole("heading", { name: "让想法成为设计方案" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "开始设计", exact: true })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "＋ 添加素材" })).toBeVisible();
});

test("趋势主题筛选使用接口返回的真实分类", async ({ page }) => {
  const now = "2026-08-05T00:00:00.000Z";
  const trend = (id: string, category: string, title: string) => ({
    category,
    coverImageUrl: null,
    curatedAt: now,
    extracted: null,
    id,
    platform: "vogue",
    publishedAt: now,
    sourceUrl: `https://example.com/${id}`,
    status: "published",
    summary: `${title}摘要`,
    tags: [category],
    title,
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 100, used: 0 },
        user: {
          authId: "auth-trends",
          avatar: null,
          createdAt: now,
          deletedAt: null,
          email: "trends@example.com",
          id: "user-trends",
          name: "Trend Reader",
        },
      },
    }),
  );
  await page.route("**/api/trends?*", (route) =>
    route.fulfill({
      json: {
        items: [
          trend("color-1", "color", "低饱和红"),
          trend("styling-1", "styling", "层叠造型"),
          trend("material-1", "material", "轻量科技面料"),
        ],
        page: 1,
        pageSize: 60,
        total: 3,
      },
    }),
  );
  await page.route("**/api/trends/digest/current", (route) =>
    route.fulfill({
      json: {
        createdAt: now,
        id: "digest-1",
        itemIds: [],
        overview: "本周趋势摘要",
        period: "2026-W32",
        theme: "轻量层叠",
      },
    }),
  );

  await page.goto("/trends");
  const filters = page.getByRole("region", { name: "趋势筛选" });
  await expect(filters.getByRole("button", { name: "色彩" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "造型" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "材质" })).toBeVisible();
  await filters.getByRole("button", { name: "色彩" }).click();
  await expect(page.getByText("低饱和红", { exact: true })).toBeVisible();
  await expect(page.getByText("层叠造型", { exact: true })).toHaveCount(0);
});

test("本地图片从素材菜单上传后保留来源文件 ID 和名称", async ({ page }) => {
  let signedUpload: Record<string, unknown> | undefined;
  let inferredNodeId: string | undefined;
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 9, used: 91 },
        user: {
          authId: "auth-drop",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "drop@example.com",
          id: "user-drop",
          name: "Drop E2E",
        },
      },
    }),
  );
  await page.route("**/api/projects/e2e-drop", (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: "2026-07-27T08:00:00.000Z",
        id: "e2e-drop",
        name: "E2E 拖放项目",
        updatedAt: "2026-07-27T08:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/collections?projectId=e2e-drop", (route) =>
    route.fulfill({ json: [] }),
  );
  const workflow = await mockEditableWorkflow(page, "e2e-drop");
  await page.route("**/api/projects/e2e-drop/workflow/nodes/*/infer-role", (route) => {
    inferredNodeId = new URL(route.request().url()).pathname.split("/").at(-2);
    const node = workflow.graph.nodes.find((item) => item.id === inferredNodeId);
    if (!node) return route.fulfill({ status: 404, json: { message: "参考节点不存在" } });
    node.payload = {
      ...node.payload,
      role: "silhouette_ref",
      roleLabel: "廓形参考",
      roleSource: "inferred",
      roleInferenceState: "ready",
    };
    workflow.graph.revision += 1;
    return route.fulfill({ json: workflow.graph });
  });
  await page.route("**/api/files/sign-upload", (route) => {
    signedUpload = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: {
      deduplicated: true,
      file: {
        id: "file-reference-1",
        name: "reference.png",
        status: "READY",
        thumbnail1024Url: "/api/files/file-reference-1/thumbnail/1024",
        thumbnail256Url: null,
      },
      upload: null,
    } });
  });
  await page.route("**/api/files/file-reference-1/thumbnail/1024", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#718093"/></svg>',
    }),
  );

  await page.goto("/e2e-drop");
  await expect(page.getByRole("main").getByText("E2E 拖放项目", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /上传图片 廓形/u }).click();
  await (await chooserPromise).setFiles({
    buffer: Buffer.from([137, 80, 78, 71]),
    mimeType: "image/png",
    name: "reference.png",
  });

  await expect.poll(() => signedUpload ?? {}).toMatchObject({
    projectId: "e2e-drop",
    name: "reference.png",
    mimeType: "image/png",
    size: 4,
  });
  await expect.poll(() => workflow.graph.nodes.filter((node) => node.type === "reference_image")).toHaveLength(1);
  await expect.poll(() => inferredNodeId).toBe(workflow.graph.nodes[0]?.id);
  expect(workflow.graph.nodes[0]?.payload).toMatchObject({
    fileAssetId: "file-reference-1",
    imageUrl: "/api/files/file-reference-1/thumbnail/1024",
    sourceName: "reference.png",
    role: "silhouette_ref",
    roleSource: "inferred",
    roleInferenceState: "ready",
  });
  await expect(page.locator('[data-type="reference_image"]')).toHaveCount(1);
  await page.locator('[data-type="reference_image"]').dblclick();
  await expect(page.getByText(/当前标签：廓形参考\s*模型建议/u)).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-type="reference_image"]')).toHaveCount(1);
  expect(workflow.semanticMutations).toHaveLength(1);
});

test("独立面料库支持点击和拖放上传，并可按原始 ID 引入工作流", async ({ page }) => {
  const userFabrics: Array<Record<string, unknown>> = [];
  let uploadCount = 0;

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 100, remaining: 9, used: 91 },
        user: {
          authId: "auth-fabric",
          avatar: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          deletedAt: null,
          email: "fabric@example.com",
          id: "user-fabric",
          name: "Fabric E2E",
        },
      },
    }),
  );
  await page.route("**/api/projects/e2e-fabric", (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: "2026-07-27T08:00:00.000Z",
        id: "e2e-fabric",
        name: "E2E 面料项目",
        updatedAt: "2026-07-27T08:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/collections?projectId=e2e-fabric", (route) =>
    route.fulfill({ json: [] }),
  );
  const workflow = await mockEditableWorkflow(page, "e2e-fabric");
  await page.route("**/api/fabrics?*", (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    const items = scope === "preset" ? [] : userFabrics;
    return route.fulfill({
      json: { items, limit: 48, page: 1, total: items.length, totalPages: 1 },
    });
  });
  await page.route(/\/api\/fabrics$/u, async (route) => {
    uploadCount += 1;
    const created = {
      attributes: {
        composition: { 混合纤维: 100 },
        weight: 180,
        weave: "plain",
      },
      canManage: true,
      category: "blend",
      createdAt: "2026-08-03T00:00:00.000Z",
      id: `fabric-upload-${uploadCount}`,
      mainFileId: `file-upload-${uploadCount}`,
      mainImageUrl: `/api/fabrics/fabric-upload-${uploadCount}/image`,
      name: uploadCount === 1 ? "click-fabric" : "drop-fabric",
      scope: "user",
      subCategory: null,
      tags: [uploadCount === 1 ? "click-fabric" : "drop-fabric"],
      updatedAt: "2026-08-03T00:00:00.000Z",
    };
    userFabrics.unshift(created);
    await route.fulfill({ json: created, status: 201 });
  });

  await page.goto("/fabrics");
  await page.getByText("上传面料", { exact: true }).first().click();
  const uploadPanel = page.getByRole("region", { name: "上传面料" });
  await expect(uploadPanel).toBeVisible();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await uploadPanel.getByRole("button", { name: /添加面料/u }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: Buffer.from([137, 80, 78, 71]),
    mimeType: "image/png",
    name: "click-fabric.png",
  });
  await uploadPanel.getByRole("textbox", { name: "标签" }).fill("click-fabric");
  await uploadPanel.getByRole("button", { name: "保存到面料库" }).click();
  await expect.poll(() => uploadCount).toBe(1);
  const clickFabricCard = page.getByRole("article", {
    name: "click-fabric，拖拽到白板",
  });
  await expect(clickFabricCard.getByText("#click-fabric")).toBeVisible();

  const manageFabricButton = clickFabricCard.getByRole("button", {
    name: "管理面料：click-fabric",
  });
  await manageFabricButton.click();
  const fabricDialog = page.getByRole("dialog", { name: "管理或删除面料" });
  const closeFabricDialog = fabricDialog.getByRole("button", { name: "关闭" });
  await expect(closeFabricDialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    fabricDialog.getByRole("button", { name: "删除" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(fabricDialog).toHaveCount(0);
  await expect(manageFabricButton).toBeFocused();

  await uploadPanel.evaluate((target) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "drop-fabric.png", {
        type: "image/png",
      }),
    );
    target.dispatchEvent(
      new DragEvent("dragenter", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
  });
  await uploadPanel.getByRole("textbox", { name: "标签" }).fill("drop-fabric");
  await uploadPanel.getByRole("button", { name: "保存到面料库" }).click();
  await expect.poll(() => uploadCount).toBe(2);
  await expect(
    page.getByRole("article", { name: "drop-fabric，拖拽到白板" })
      .getByText("#drop-fabric"),
  ).toBeVisible();

  await page.goto("/e2e-fabric");
  await page.getByRole("button", { name: "＋ 添加素材" }).click();
  await page.getByRole("button", { name: /面料库 引用现有面料记录/u }).click();
  const library = page.getByRole("region", { name: "选择面料" });
  await expect(library).toBeVisible();
  await library.getByRole("button", { name: /click-fabric/u }).click();
  await expect.poll(() => workflow.graph.nodes.filter((node) => node.type === "fabric")).toHaveLength(1);
  expect(workflow.graph.nodes[0]?.payload).toMatchObject({
    fabricId: "fabric-upload-1",
    imageUrl: "/api/fabrics/fabric-upload-1/image",
  });
  await expect(page.locator('[data-type="fabric"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-type="fabric"]')).toHaveCount(1);
});

test("约束与参考生成的候选只落图一次，保留来源、尝试与 PNG 导出", async ({ page }) => {
  const workflow = await mockEditableWorkflow(page, "e2e-project", {
    revision: 1,
    nodes: [
      workflowNode("constraint", "asset", "constraint", "秋冬通勤约束", {
        text: "利落廓形、藏蓝色、适合通勤",
      }, 40, 100),
      workflowNode("reference", "asset", "reference_image", "廓形参考", {
        fileAssetId: "file-reference-1",
        imageUrl: "/api/files/file-reference-1/thumbnail/1024",
        sourceName: "reference.png",
        role: "silhouette_ref",
        roleSource: "inferred",
        roleInferenceState: "ready",
      }, 40, 420),
      workflowNode("generate", "tool", "generate_design", "方案生成", {
        toolKey: "generate_design",
        toolVersion: "1",
        params: { prompt: "保留利落廓形外套", count: 1, width: 768, height: 1024 },
      }, 390, 220, "ready"),
    ],
    edges: [
      { id: "constraint-input", sourceNodeId: "constraint", sourcePort: "out", targetNodeId: "generate", targetPort: "constraint" },
      { id: "reference-input", sourceNodeId: "reference", sourcePort: "out", targetNodeId: "generate", targetPort: "reference" },
    ],
  });
  let executeRequest: { mutationId?: string } | undefined;
  let executeCount = 0;
  let projected = false;
  let candidateDecision: { assetId?: string; kind?: string; reason?: string; mutationId?: string } | undefined;

  await page.route("**/api/me", (route) => route.fulfill({ json: {
    credits: { limit: 100, remaining: 9, used: 91 },
    user: {
      authId: "auth-e2e",
      avatar: null,
      createdAt: WORKFLOW_NOW,
      deletedAt: null,
      email: "atelier@example.com",
      id: "user-e2e",
      name: "Atelier E2E",
    },
  } }));
  await page.route("**/api/projects/e2e-project", (route) => route.fulfill({ json: {
    archived: false,
    assetCount: 0,
    coverAssetId: null,
    coverUrl: null,
    createdAt: WORKFLOW_NOW,
    id: "e2e-project",
    name: "E2E 生成项目",
    updatedAt: WORKFLOW_NOW,
  } }));
  await page.route("**/api/projects/e2e-project/agent-conversations*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/files/file-reference-1/thumbnail/1024", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#718093"/></svg>',
  }));
  await page.route("**/api/design-assets/asset-e2e-1/thumbnail", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><path d="M100 60h100l40 290H60z" fill="#3e463f"/></svg>',
  }));
  await page.route("**/api/design-assets/asset-e2e-1/content", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><path d="M100 60h100l40 290H60z" fill="#3e463f"/></svg>',
  }));
  await page.route("**/api/design-assets/asset-e2e-1/path", (route) =>
    route.fulfill({ json: { steps: [], decisions: [], incomplete: false } }),
  );
  await page.route("**/api/projects/e2e-project/workflow/nodes/generate/execute", (route) => {
    executeCount += 1;
    executeRequest = route.request().postDataJSON() as { mutationId?: string };
    const generator = workflow.graph.nodes.find((node) => node.id === "generate");
    if (generator) generator.status = "running";
    return route.fulfill({ json: workflow.graph });
  });
  await page.route("**/api/projects/e2e-project/workflow/nodes/generate/history", (route) =>
    route.fulfill({ json: { items: [{
      id: "attempt-e2e-1",
      ordinal: 1,
      status: "completed",
      generationTaskId: "task-e2e-1",
      error: null,
      createdAt: WORKFLOW_NOW,
      request: {
        inputNodeIds: ["constraint", "reference"],
        prompt: "保留利落廓形外套",
        model: "amux/image-model",
        referenceInputs: [{ role: "silhouette_ref", weight: 0.7 }],
      },
    }] } }),
  );
  await page.route("**/api/projects/e2e-project/workflow/nodes/candidate-e2e-1/decisions", (route) => {
    candidateDecision = route.request().postDataJSON() as typeof candidateDecision;
    return route.fulfill({ json: workflow.graph });
  });
  await page.route("**/api/projects/e2e-project/workflow/sync", (route) => {
    if (executeCount > 0 && !projected) {
      projected = true;
      const generator = workflow.graph.nodes.find((node) => node.id === "generate");
      if (generator) generator.status = "completed";
      workflow.graph.nodes.push(workflowNode(
        "candidate-e2e-1", "asset", "candidate", "候选 A",
        {
          assetId: "asset-e2e-1",
          generationTaskId: "task-e2e-1",
          attemptId: "attempt-e2e-1",
          imageUrl: "/api/design-assets/asset-e2e-1/content",
        },
        740, 220,
      ));
      workflow.graph.edges.push({
        id: "generated-output",
        sourceNodeId: "generate",
        sourcePort: "out",
        targetNodeId: "candidate-e2e-1",
        targetPort: "source",
      });
      workflow.graph.revision += 1;
    }
    return route.fulfill({ json: workflow.graph });
  });

  await page.goto("/e2e-project");
  await page.getByRole("button", { name: "适合画布" }).click();
  const canvas = page.getByRole("region", { name: "设计工作流画布" });
  await expect(canvas.locator('[data-type="constraint"]')).toHaveCount(1);
  await expect(canvas.locator('[data-type="reference_image"]')).toHaveCount(1);
  const generationTool = canvas.locator('[data-type="generate_design"]');
  await generationTool.dblclick();
  await expect(page.getByRole("button", { name: "确认并执行" })).toBeEnabled();
  await page.getByRole("button", { name: "确认并执行" }).click();

  await expect.poll(() => executeCount).toBe(1);
  expect(executeRequest?.mutationId).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(canvas.locator('[data-type="candidate"]')).toHaveCount(1);
  expect(workflow.graph.nodes.filter((node) => node.type === "candidate")).toHaveLength(1);
  expect(workflow.graph.nodes.find((node) => node.type === "candidate")?.payload).toMatchObject({
    assetId: "asset-e2e-1",
    generationTaskId: "task-e2e-1",
    attemptId: "attempt-e2e-1",
  });
  expect(workflow.graph.edges).toContainEqual({
    id: "generated-output",
    sourceNodeId: "generate",
    sourcePort: "out",
    targetNodeId: "candidate-e2e-1",
    targetPort: "source",
  });

  await page.getByText("执行记录", { exact: true }).click();
  await page.getByRole("button", { name: "读取尝试记录" }).click();
  await expect(page.getByText("来源：秋冬通勤约束、廓形参考")).toBeVisible();
  await expect(page.getByText("参考角色：silhouette_ref 权重 0.7")).toBeVisible();
  const details = page.getByRole("region", { name: "节点详情工作区", exact: true });
  await details.getByRole("button", { name: "返回画布" }).click();
  await page.getByRole("button", { name: "适合画布", exact: true }).click();
  await canvas.locator('[data-type="candidate"]').dblclick();
  await expect(page.getByRole("dialog", { name: "图片工作区", exact: true })).toBeVisible();
  await openImageDetails(page);
  await page.getByPlaceholder("记录选择或否决理由").fill("更符合通勤场景");
  await page.getByRole("button", { name: "保存决定" }).click();
  await expect.poll(() => candidateDecision).toMatchObject({
    assetId: "asset-e2e-1",
    kind: "selected",
    reason: "更符合通勤场景",
  });
  expect(candidateDecision?.mutationId).toMatch(/^[0-9a-f-]{36}$/u);
  await page.getByRole("button", { name: "关闭图片工作区" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByText("资料与更多", { exact: true }).click();
  await page.getByRole("button", { name: "导出画布 PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("fashion-workflow-e2e-project.png");

  await page.reload();
  await expect(canvas.locator('[data-type="candidate"]')).toHaveCount(1);
  await expect(canvas.locator('[data-type="reference_image"]')).toHaveCount(1);
  expect(workflow.graph.nodes.filter((node) => node.type === "candidate")).toHaveLength(1);
  expect(executeCount).toBe(1);
});
