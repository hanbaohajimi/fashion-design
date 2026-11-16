import { openCanvasFunction } from "./canvas-function-navigation";
import { canvasAction } from "./canvas-workspace-controls";
import { expect, test, type Page } from "@playwright/test";
import { seedVisualApp, PROJECT, NOW } from "../visual/fixtures";
import type {
  CanvasCommand,
  CanvasDocumentView,
  CanvasSave,
} from "../../packages/shared/src/canvas-workspace";
import type {
  WorkflowGraph,
  WorkflowNode,
} from "../../apps/web/src/modules/board/workflow/workflow-api";

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("验证所需的对象、保存回执或可见元素尚未出现");
  return value;
}

const material = (
  id: string,
  type: string,
  payload: Record<string, unknown>,
  title = id,
): WorkflowNode => ({
  id,
  kind: "asset",
  type,
  title,
  payload,
  x: 0,
  y: 0,
  status: "ready",
  createdAt: NOW,
  updatedAt: NOW,
});
const candidate = material(
  "candidate",
  "candidate",
  { assetId: "visual-look", imageUrl: "/visual-garment.svg" },
  "藏蓝通勤外套",
);

async function canvasFixture(
  page: Page,
  options: {
    nodes?: WorkflowNode[];
    failInitialize?: "project" | "document";
    canEdit?: boolean;
    legacyRecords?: Record<string, unknown>[];
    forkOnUpdate?: boolean;
  } = {},
) {
  await seedVisualApp(page);
  // The visual fixture freezes Date.now; tldraw's frame scheduler needs time
  // to advance for autosave, viewport and undo subscriptions in interaction tests.
  await page.clock.setSystemTime(new Date(NOW));
  await page.setViewportSize({ width: 1440, height: 900 });
  const nodes = options.nodes ?? [candidate];
  let graph: WorkflowGraph = {
    projectId: PROJECT,
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: false,
    nodes,
    edges: [],
  };
  let document: CanvasDocumentView = {
    projectId: PROJECT,
    mode: "canvas",
    revision: 0,
    formatVersion: 1,
    initializedFrom: options.legacyRecords ? "legacy" : "workflow",
    canEdit: options.canEdit ?? true,
    snapshot: options.legacyRecords
      ? { legacyRecords: options.legacyRecords }
      : {},
    bindings: nodes.map((node) => ({
      shapeId: `shape:canvas-${node.id}`,
      nodeId: node.id,
      removed: false,
    })),
  };
  const commands: CanvasCommand[] = [];
  const saves: CanvasSave[] = [];
  const commandReplies = new Map<
    string,
    { nodeId: string; graph: WorkflowGraph; canvas: CanvasDocumentView }
  >();
  const saveReplies = new Map<string, CanvasDocumentView>();
  let initializationBlocked = Boolean(options.failInitialize);
  let failMaterial = false;
  let failLayout = false;
  let materialDelay: Promise<void> | null = null;
  const inconsistentLayouts: string[] = [];
  let graphWrites = 0;
  await page.route(`**/api/projects/${PROJECT}/workflow**`, (route) => {
    if (route.request().method() === "PATCH") graphWrites++;
    if (route.request().url().endsWith("/tools"))
      return route.fulfill({ json: { agentVersion: 2, tools: [] } });
    return route.fulfill({ json: graph });
  });
  await page.route(`**/api/projects/${PROJECT}/canvas**`, async (route) => {
    if (route.request().url().endsWith("/initialize")) {
      // Strict Mode can replay effects. Fail the actual layer until the retry,
      // rather than depending on a particular network request number.
      const documentMounted =
        (await page.getByLabel("无限白板", { exact: true }).count()) > 0;
      if (
        initializationBlocked &&
        (options.failInitialize === "project" || documentMounted)
      )
        return route.fulfill({
          status: 503,
          json: { message: "暂时无法连接白板服务，请重试" },
        });
    }
    if (route.request().url().endsWith("/commands")) {
      const command = route.request().postDataJSON() as CanvasCommand;
      commands.push(command);
      const replay = commandReplies.get(command.mutationId);
      if (replay) return route.fulfill({ json: replay });
      if (
        command.type !== "create_material" &&
        command.type !== "update_material"
      )
        throw new Error("Unexpected business command");
      const nodeId =
        command.type === "create_material"
          ? `material-${commandReplies.size + 1}`
          : options.forkOnUpdate ? `${command.nodeId}-revision-${commandReplies.size + 1}` : command.nodeId;
      const node =
        command.type === "create_material"
          ? material(
              nodeId,
              command.materialType,
              command.payload,
              command.title,
            )
          : {
              ...present(graph.nodes.find((node) => node.id === command.nodeId)),
              id: nodeId,
              payload: command.payload,
              ...(command.title ? { title: command.title } : {}),
            };
      graph = {
        ...graph,
        revision: graph.revision + 1,
        nodes: [...graph.nodes.filter((node) => node.id !== nodeId), node],
      };
      document = {
        ...document,
        revision: document.revision + 1,
        bindings: [
          ...document.bindings.filter(
            (binding) => binding.shapeId !== command.shapeId,
          ),
          {
            shapeId: command.shapeId ?? `shape:canvas-${nodeId}`,
            nodeId,
            removed: false,
          },
        ],
      };
      const response = structuredClone({ nodeId, graph, canvas: document });
      commandReplies.set(command.mutationId, response);
      if (failMaterial) {
        failMaterial = false;
        return route.fulfill({
          status: 503,
          json: { message: "素材回执丢失，请重试保存" },
        });
      }
      if (materialDelay) {
        const delay = materialDelay;
        materialDelay = null;
        await delay;
      }
      return route.fulfill({ json: response });
    }
    if (route.request().method() === "PATCH") {
      const save = route.request().postDataJSON() as CanvasSave;
      saves.push(save);
      const replay = saveReplies.get(save.mutationId);
      if (replay) return route.fulfill({ json: replay });
      if (save.baseRevision !== document.revision)
        return route.fulfill({
          status: 409,
          json: { message: "布局版本冲突" },
        });
      const records =
        (
          save.snapshot.document as
            | {
                store?: Record<
                  string,
                  { type?: string; props?: { label?: string } }
                >;
              }
            | undefined
        )?.store ?? {};
      for (const binding of save.bindings) {
        const shape = records[binding.shapeId];
        const node = graph.nodes.find((node) => node.id === binding.nodeId);
        if (
          shape?.type === "fashion-swatch" &&
          shape.props?.label !== node?.title
        )
          inconsistentLayouts.push(save.mutationId);
      }
      document = {
        ...document,
        revision: document.revision + 1,
        snapshot: save.snapshot,
        bindings: save.bindings.map((binding) => ({
          ...binding,
          removed: false,
        })),
      };
      saveReplies.set(save.mutationId, structuredClone(document));
      if (failLayout) {
        failLayout = false;
        return route.fulfill({
          status: 503,
          json: { message: "布局回执丢失，请重试保存" },
        });
      }
    }
    return route.fulfill({ json: document });
  });
  return {
    commands,
    saves,
    graph: () => graph,
    document: () => document,
    graphWrites: () => graphWrites,
    inconsistentLayouts,
    allowInitialization: () => {
      initializationBlocked = false;
    },
    loseMaterialReceipt: () => {
      failMaterial = true;
    },
    loseLayoutReceipt: () => {
      failLayout = true;
    },
    delayMaterialReceipt: () => {
      let release = () => {};
      materialDelay = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    records: () =>
      Object.values(
        (
          document.snapshot.document as
            | {
                store?: Record<
                  string,
                  {
                    id: string;
                    type: string;
                    x: number;
                    y: number;
                    isLocked?: boolean;
                    meta?: Record<string, unknown>;
                    props: Record<string, unknown>;
                  }
                >;
              }
            | undefined
        )?.store ?? {},
      ),
  };
}

async function renamePalette(page: Page, name: string) {
  await page.getByRole("button", { name: /^重命名颜色 / }).first().click();
  await page.getByRole("textbox", { name: "颜色名称", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "颜色名称", exact: true }).press("Enter");
}

async function selectCanvasObject(page: Page, shapeId: string) {
  await openCanvasFunction(page, "画布对象");
  const objects = page.getByRole("region", { name: "画布对象", exact: true });
  await objects.locator(`[data-canvas-object-id="${shapeId}"]`).getByRole("button", { name: /^选择/ }).click();
  await objects.getByRole("button", { name: "关闭画布对象", exact: true }).click();
}

test("白板工具栏与功能目录承接现行素材入口", async ({ page }) => {
  const fixture = await canvasFixture(page);
  const legacyWrites: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" && /\/boards\//.test(request.url())) legacyWrites.push(request.url());
  });
  await page.goto(`/${PROJECT}`);
  const rail = page.getByRole("complementary", { name: "工具条", exact: true });
  await expect(rail).toHaveCount(1);
  for (const name of ["添加节点", "选择工具", "新建廓形草图", "添加色卡", "打开面料库", "全部功能模块"]) {
    await expect(rail.getByRole("button", { name, exact: true })).toBeEnabled();
  }
  await expect(page.getByRole("button", { name: "添加灵感便签", exact: true })).toHaveCount(0);
  await rail.getByRole("button", { name: "添加节点", exact: true }).click();
  const add = page.getByRole("group", { name: "添加节点选项", exact: true });
  for (const name of ["文本", "图片", "视频", "上传", "从已有资源选择"]) await expect(add.getByRole("button", { name, exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  const functions = rail.getByRole("button", { name: "全部功能模块", exact: true });
  await functions.click();
  const catalog = page.getByRole("dialog", { name: "全部功能模块", exact: true });
  for (const name of ["图片", "实验", "工作台", "研究", "画布管理"]) await expect(catalog.getByRole("heading", { name, exact: true })).toBeAttached();
  for (const name of ["图片创作", "时尚趋势", "系列工作台", "画布对象", "导出画布 PNG"]) await expect(catalog.getByRole("button", { name, exact: true })).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(functions).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "返回画布", exact: true }).click();
  await functions.click();
  await expect(catalog).toBeInViewport({ ratio: 1 });
  const selectBounds = present(await rail.getByRole("button", { name: "选择工具", exact: true }).boundingBox());
  expect(selectBounds.width).toBeGreaterThanOrEqual(44);
  expect(selectBounds.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  expect(fixture.commands).toHaveLength(0);
  expect(fixture.graphWrites()).toBe(0);
  expect(legacyWrites).toHaveLength(0);
});

for (const failedLayer of ["project", "document"] as const) {
  test(`${failedLayer === "project" ? "项目" : "白板文档"}初始化失败后可在原界面重试`, async ({
    page,
  }) => {
    const fixture = await canvasFixture(page, { failInitialize: failedLayer });
    await page.goto(`/${PROJECT}`);
    await expect(
      page.getByRole("heading", { name: "暂时无法打开白板" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "重试载入白板", exact: true }),
    ).toBeVisible();
    if (failedLayer === "document")
      await expect(
        page.getByRole("button", { name: "添加色卡", exact: true }),
      ).toBeDisabled();
    fixture.allowInitialization();
    await page
      .getByRole("button", { name: "重试载入白板", exact: true })
      .click();
    await expect(
      page.getByRole("group", { name: "藏蓝通勤外套", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "添加色卡", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "暂时无法打开白板" }),
    ).toHaveCount(0);
    expect(fixture.commands).toHaveLength(0);
    expect(fixture.graphWrites()).toBe(0);
  });
}

test("新增色卡回执重试使用原编号，后续颜色更新同步到后台", async ({ page }) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  await page.goto(`/${PROJECT}`);
  fixture.loseMaterialReceipt();
  await page.getByRole("button", { name: "添加色卡", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeVisible();
  expect(fixture.commands).toHaveLength(1);
  const mutation = present(fixture.commands[0]).mutationId;
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect.poll(() => fixture.commands.length).toBe(2);
  expect(present(fixture.commands[1]).mutationId).toBe(mutation);
  expect(fixture.graph().nodes).toHaveLength(1);
  await renamePalette(page, "秋日燕麦");
  await expect.poll(() => fixture.graph().nodes[0]?.title).toBe("秋日燕麦");
  await expect.poll(() => fixture.records().find(record => record.type === "fashion-swatch")?.props.label).toBe("秋日燕麦");
  await expect(page.getByLabel("画布保存状态", { exact: true })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "重命名颜色 秋日燕麦", exact: true })).toBeVisible();
  expect(fixture.graph().nodes).toHaveLength(1);
  expect(fixture.graph().edges).toHaveLength(0);
});

test("旧布局回执恢复后继续保存较新的移动，不显示虚假的已保存", async ({
  page,
}) => {
  const fixture = await canvasFixture(page);
  await page.goto(`/${PROJECT}`);
  const image = page.getByRole("group", { name: "藏蓝通勤外套", exact: true });
  await expect(image).toBeVisible();
  const box = await image.boundingBox();
  if (!box) throw new Error("图片没有布局");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => fixture.saves.length).toBeGreaterThan(0);
  fixture.loseLayoutReceipt();
  const drag = async (dx: number) => {
    const bounds = await image.boundingBox();
    if (!bounds) throw new Error("图片没有布局");
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2 + 35;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + 10, { steps: 5 });
    await page.mouse.up();
  };
  await drag(35);
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toBeVisible();
  const failed = present(fixture.saves.at(-1));
  await drag(45);
  await expect
    .poll(
      () =>
        fixture.saves.filter((save) => save.mutationId === failed.mutationId)
          .length,
    )
    .toBe(2);
  await expect
    .poll(() => new Set(fixture.saves.map((save) => save.mutationId)).size)
    .toBe(3);
  const savedX = fixture
    .records()
    .find((record) => record.type === "fashion-image")?.x;
  const latest = present(fixture.saves.at(-1));
  expect(latest.mutationId).not.toBe(failed.mutationId);
  const oldStore = (
    failed.snapshot.document as {
      store: Record<string, { type: string; x: number }>;
    }
  ).store;
  expect(savedX).toBeGreaterThan(
    present(Object.values(oldStore).find((record) => record.type === "fashion-image"))
      .x,
  );
  await expect(page.getByLabel("画布保存状态", { exact: true })).toBeHidden();
  const savedShape = present(fixture.records().find(record => record.type === "fashion-image"));
  const savedView = present(await image.boundingBox());
  await page.reload();
  await expect(image).toBeVisible();
  const restoredView = present(await image.boundingBox());
  expect(restoredView.width).toBe(savedView.width);
  expect(restoredView.height).toBe(savedView.height);
  expect(fixture.records().find(record => record.type === "fashion-image")).toMatchObject({ x: savedShape.x, y: savedShape.y });
  expect(fixture.commands).toHaveLength(0);
});

test("保存过程中继续编辑，必须先提交最新色卡再确认布局已保存", async ({ page }) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  await page.goto(`/${PROJECT}`);
  const release = fixture.delayMaterialReceipt();
  await page.getByRole("button", { name: "添加色卡", exact: true }).click();
  await expect.poll(() => fixture.commands.length).toBe(1);
  await renamePalette(page, "第二版燕麦");
  release();
  await expect.poll(() => fixture.graph().nodes[0]?.title).toBe("第二版燕麦");
  await expect.poll(() => fixture.records().find(record => record.type === "fashion-swatch")?.props.label).toBe("第二版燕麦");
  expect(fixture.inconsistentLayouts).toEqual([]);
  expect(fixture.graph().nodes).toHaveLength(1);
  await expect(page.getByLabel("画布保存状态", { exact: true })).toBeHidden();
});

test("累计引用记住具体素材副本，刷新后编辑新版本先同步预览再发送", async ({ page }) => {
  const fixture = await canvasFixture(page, {
    nodes: [material("brief", "swatch", { color: "#c8ab84", colors: [{ hex: "#c8ab84", name: "第一版领口" }] }, "第一版领口"), candidate],
    forkOnUpdate: true,
  });
  const requests: { referencedNodeIds: string[] }[] = [];
  await page.route("**/api/agent-conversations/visual-chat/workflow-messages", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { message: "测试已记录提交" } });
  });
  await page.goto(`/${PROJECT}`);
  const noteShape = page.locator('.tl-shape[data-shape-id="shape:canvas-brief"]');
  await noteShape.click({ position: { x: 14, y: 12 } });
  await page.keyboard.press("Control+d");
  await expect(page.getByRole("button", { name: "重命名颜色 第一版领口", exact: true })).toHaveCount(2);
  await expect.poll(() => fixture.records().filter(record => record.type === "fashion-swatch").length).toBe(2);
  const copyId = present(fixture.records().find(record => record.type === "fashion-swatch" && record.id !== "shape:canvas-brief")).id;
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(page.getByLabel("正在讨论", { exact: true })).toContainText("第一版领口");
  await selectCanvasObject(page, "shape:canvas-candidate");
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await input.fill("比较色卡要求与外套");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(input).toHaveValue("比较色卡要求与外套");
  await page.locator(`.tl-shape[data-shape-id="${copyId}"]`).getByRole("button", { name: "重命名颜色 第一版领口", exact: true }).click();
  await page.getByRole("textbox", { name: "颜色名称", exact: true }).fill("第二版方领");
  await page.getByRole("textbox", { name: "颜色名称", exact: true }).press("Enter");
  await expect.poll(() => fixture.graph().nodes.some(node => node.title === "第二版方领")).toBe(true);
  // A new unrelated selection must not replace the saved placement identity.
  await selectCanvasObject(page, "shape:canvas-candidate");
  const send = page.getByRole("button", { name: "发送需求", exact: true });
  await send.click();
  await expect(page.getByRole("alert").filter({ hasText: "引用素材已更新，预览已同步。" })).toBeVisible();
  expect(requests).toEqual([]);
  const discussion = page.getByLabel("正在讨论", { exact: true });
  await expect(discussion).toContainText("第二版方领");
  await expect(discussion).toContainText("藏蓝通勤外套");
  await expect(discussion).not.toContainText("第一版领口");
  await send.click();
  await expect.poll(() => requests.length).toBe(1);
  const revised = present(fixture.graph().nodes.find(node => node.title === "第二版方领"));
  expect(requests[0]?.referencedNodeIds).toEqual([revised.id, "candidate"]);
  expect(fixture.graph().nodes.find(node => node.id === "brief")?.title).toBe("第一版领口");
});

test("平移视野会恢复，收起助手及切换窄屏保持画布中心且不修改业务记录", async ({
  page,
}) => {
  const fixture = await canvasFixture(page);
  await page.goto(`/${PROJECT}`);
  const image = page.getByRole("group", { name: "藏蓝通勤外套", exact: true });
  const workspace = page.getByLabel("无限白板", { exact: true });
  await expect(image).toBeVisible();
  const imageShape = page.locator('.tl-shape[data-shape-id="shape:canvas-candidate"]');
  const originalTransform = await imageShape.evaluate(element => (element as HTMLElement).style.transform);
  await workspace.click({ position: { x: 30, y: 120 } });
  await page.keyboard.down("Space");
  const box = await image.boundingBox();
  if (!box) throw new Error("图片没有布局");
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect
    .poll(async () => Math.round(present(await image.boundingBox()).x - box.x))
    .toBe(45);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some((key) =>
          key.startsWith("fashion:canvas-view:"),
        ),
      ),
    )
    .toBe(true);
  const centerOffset = async () => {
    const shape = present(await image.boundingBox()),
      bounds = present(await workspace.boundingBox());
    return {
      x: shape.x + shape.width / 2 - bounds.x - bounds.width / 2,
      y: shape.y + shape.height / 2 - bounds.y - bounds.height / 2,
      width: shape.width,
    };
  };
  const original = await centerOffset();
  await page.reload();
  await expect(image).toBeVisible();
  await expect
    .poll(async () => Math.round((await centerOffset()).x))
    .toBe(Math.round(original.x));
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect
    .poll(async () => Math.round((await centerOffset()).x))
    .toBe(Math.round(original.x));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => Math.round((await centerOffset()).x))
    .toBe(Math.round(original.x));
  await expect
    .poll(async () => Math.round((await centerOffset()).y))
    .toBe(Math.round(original.y));
  expect((await centerOffset()).width).toBeCloseTo(original.width, 0);
  await expect(
    page.getByRole("button", { name: "更多白板操作", exact: true }),
  ).toBeInViewport();
  const more = await page
    .getByRole("button", { name: "更多白板操作", exact: true })
    .boundingBox();
  expect(present(more).width).toBeGreaterThanOrEqual(44);
  expect(present(more).height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await imageShape.evaluate(element => (element as HTMLElement).style.transform)).toBe(originalTransform);
  expect(fixture.commands).toHaveLength(0);
  expect(fixture.graphWrites()).toBe(0);
});

test("绘制设置、撤销重做及只整理画框不提前创建草图节点", async ({ page }) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  let uploads = 0;
  await page.route("**/api/files/sign-upload", (route) => {
    uploads++;
    return route.fulfill({
      json: {
        deduplicated: true,
        upload: null,
        file: {
          id: "canvas-sketch",
          status: "READY",
          thumbnail1024Url: "/visual-garment.svg",
          thumbnail256Url: "/visual-garment.svg",
        },
      },
    });
  });
  await page.goto(`/${PROJECT}`);
  await canvasAction(page, "自由手绘");
  await expect(page.getByLabel("绘制设置", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "蓝色", exact: true }).click();
  await page.getByRole("button", { name: "粗", exact: true }).click();
  await page.mouse.move(480, 450);
  await page.mouse.down();
  await page.mouse.move(580, 550, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(
      () =>
        fixture.records().find((record) => record.type === "draw")?.props.color,
    )
    .toBe("blue");
  expect(
    fixture.records().find((record) => record.type === "draw")?.props.size,
  ).toBe("l");
  expect(fixture.commands).toHaveLength(0);
  await canvasAction(page, "撤销白板操作");
  await expect
    .poll(
      () => fixture.records().filter((record) => record.type === "draw").length,
    )
    .toBe(0);
  await canvasAction(page, "重做白板操作");
  await expect
    .poll(
      () => fixture.records().filter((record) => record.type === "draw").length,
    )
    .toBe(1);
  await canvasAction(page, "画框");
  await page.mouse.move(420, 390);
  await page.mouse.down();
  await page.mouse.move(650, 620, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => fixture.records().some((record) => record.type === "frame"))
    .toBe(true);
  // Creating a container is layout, not an implicit request to upload its strokes.
  expect(fixture.commands).toHaveLength(0);
  expect(fixture.graph().nodes).toHaveLength(0);
  expect(uploads).toBe(0);
  // A later explicit selection does freeze the strokes and make them referenceable.
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await page.mouse.click(530, 500);
  await expect.poll(() => fixture.graph().nodes[0]?.type).toBe("sketch");
  expect(uploads).toBe(1);
  expect(fixture.graph().nodes[0]?.payload.canvasStrokeVersion).toMatchObject({
    version: 1,
    color: "blue",
    size: "l",
  });
  // Selection prepares the sketch, but only this explicit action adds it to chat.
  await expect(page.getByLabel("正在讨论", { exact: true }).getByRole("button", { name: /移除引用/ })).toHaveCount(0);
  await page.getByRole("button", { name: "引用到助手", exact: true }).click();
  await expect(page.getByLabel("正在讨论", { exact: true })).toContainText(
    "白板草图",
  );
});

test("手绘在素材回执到达前锁定和隐藏，元数据与新版图片投影仍保留状态", async ({ page }) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  let uploads = 0;
  await page.route("**/api/files/sign-upload", route => {
    uploads++;
    return route.fulfill({ json: { deduplicated: true, upload: null, file: {
      id: "locked-canvas-sketch", status: "READY", thumbnail1024Url: "/visual-garment.svg", thumbnail256Url: "/visual-garment.svg",
    } } });
  });
  await page.goto(`/${PROJECT}`);
  await canvasAction(page, "自由手绘");
  await page.mouse.move(480, 450); await page.mouse.down();
  await page.mouse.move(580, 550, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => fixture.records().some(record => record.type === "draw")).toBe(true);
  const id = present(fixture.records().find(record => record.type === "draw")).id;
  const release = fixture.delayMaterialReceipt();
  await page.getByRole("button", { name: "选择工具", exact: true }).click();
  await page.mouse.click(530, 500);
  await expect.poll(() => fixture.commands.length).toBe(1);
  await openCanvasFunction(page, "画布对象");
  const objects = page.getByRole("region", { name: "画布对象", exact: true });
  const target = objects.locator(`[data-canvas-object-id="${id}"]`);
  await target.getByRole("button", { name: /^锁定/ }).click();
  await expect(target).toHaveAttribute("data-locked", "true");
  await target.getByRole("button", { name: /^隐藏/ }).click();
  await expect(target).toHaveAttribute("data-hidden", "true");
  release();
  await expect.poll(() => fixture.records().find(record => record.id === id)?.meta?.canvasFileAssetId).toBe("locked-canvas-sketch");
  expect(fixture.records().find(record => record.id === id)?.isLocked).toBe(true);
  const original = present(fixture.records().find(record => record.id === id));
  const updatedNode = present(fixture.graph().nodes[0]);
  updatedNode.title = "已经调整的廓形";
  updatedNode.payload = { ...updatedNode.payload, fileAssetId: "new-sketch-version", imageUrl: "/visual-garment.svg", imageWidth: 600, imageHeight: 800 };
  fixture.graph().revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("fashion-workflow:refresh")));
  await expect(target).toContainText("已经调整的廓形");
  await expect(target).toHaveAttribute("data-locked", "true");
  await expect.poll(() => fixture.records().find(record => record.id === id)?.type).toBe("fashion-image");
  const projected = present(fixture.records().find(record => record.id === id));
  expect(projected).toMatchObject({ x: original.x, y: original.y, isLocked: true, meta: {
    canvasNodeId: updatedNode.id, canvasFileAssetId: "new-sketch-version", originalCanvasStroke: { type: "draw" }, canvasHidden: true,
  } });
  await page.reload();
  await openCanvasFunction(page, "画布对象");
  await expect(target).toContainText("已经调整的廓形");
  await expect(target).toHaveAttribute("data-locked", "true");
  await expect(target).toHaveAttribute("data-hidden", "true");
  await target.getByRole("button", { name: /^显示/ }).click();
  await expect(page.locator(`.tl-shape[data-shape-id="${id}"]`)).toBeVisible();
  expect(uploads).toBe(1); expect(fixture.commands).toHaveLength(1);
});

test("布局回执丢失期间新增色卡，旧回执不能倒退版本或产生自身冲突", async ({ page }) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  await page.goto(`/${PROJECT}`);
  fixture.loseLayoutReceipt();
  await canvasAction(page, "画框");
  await page.mouse.move(420, 390); await page.mouse.down();
  await page.mouse.move(650, 620, { steps: 6 }); await page.mouse.up();
  await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeVisible();
  const original = present(fixture.saves[0]);
  await page.getByRole("button", { name: "添加色卡", exact: true }).click();
  await expect.poll(() => fixture.commands.length).toBe(1);
  await expect.poll(() => fixture.saves.filter(save => save.mutationId === original.mutationId).length).toBe(2);
  await expect.poll(() => fixture.records().some(record => record.type === "fashion-swatch")).toBe(true);
  await expect(page.getByLabel("画布保存状态", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "导出草稿并载入最新", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "重命名颜色 OAT", exact: true })).toBeVisible();
  expect(fixture.graph().nodes).toHaveLength(1);
});

test("色卡素材回执丢失后刷新仍恢复同一操作，不重复创建素材", async ({ page }) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  await page.goto(`/${PROJECT}`);
  fixture.loseMaterialReceipt();
  await page.getByRole("button", { name: "添加色卡", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeVisible();
  const original = present(fixture.commands[0]);
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.getByRole("button", { name: "重命名颜色 OAT", exact: true })).toBeVisible();
  // Reload may confirm the committed server binding without re-sending the receipt.
  expect(fixture.commands.every(command => command.mutationId === original.mutationId)).toBe(true);
  expect(fixture.graph().nodes).toHaveLength(1);
  await expect(page.getByLabel("画布保存状态", { exact: true })).toBeHidden();
});

test("多色色卡可以添加和键盘重命名，手机工具菜单可用", async ({ page }) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  await page.goto(`/${PROJECT}`);
  await page.getByRole("button", { name: "添加色卡", exact: true }).click();
  await expect.poll(() => fixture.graph().nodes[0]?.type).toBe("swatch");
  await page.getByRole("button", { name: "添加颜色", exact: true }).click();
  await expect
    .poll(() => (fixture.graph().nodes[0]?.payload.colors as unknown[])?.length)
    .toBe(2);
  const rename = page.getByRole("button", {
    name: "重命名颜色 OAT",
    exact: true,
  });
  await rename.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "颜色名称", exact: true })
    .fill("秋日燕麦");
  await page
    .getByRole("textbox", { name: "颜色名称", exact: true })
    .press("Enter");
  await expect
    .poll(
      () =>
        (fixture.graph().nodes[0]?.payload.colors as { name: string }[])?.[0]
          ?.name,
    )
    .toBe("秋日燕麦");
  await expect(
    page.getByRole("button", { name: "重命名颜色 秋日燕麦", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "返回画布", exact: true }).click();
  await page.getByRole("button", { name: "更多白板操作", exact: true }).click();
  await page.getByRole("button", { name: "白板操作提示", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "白板操作提示", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "关闭白板操作提示", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(fixture.graph().edges).toHaveLength(0);
  await canvasAction(page, "查看全图");
  await page.mouse.move(12, 350);
  await page.screenshot({
    path: "output/playwright/canvas-palette-mobile.png",
    fullPage: true,
  });
});

test("首次恢复旧自由白板保留图片原尺寸和位置", async ({ page }) => {
  const fixture = await canvasFixture(page, {
    nodes: [candidate],
    legacyRecords: [{ id: "shape:canvas-candidate", type: "fashion-image", x: 120, y: 80,
      props: { w: 260, h: 210, url: "/visual-garment.svg", title: "藏蓝通勤外套", role: "reference" } }],
  });
  await page.goto(`/${PROJECT}`);
  await expect(page.getByRole("group", { name: "藏蓝通勤外套", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "选择工具", exact: true }).click();
  await page.keyboard.press("Control+a");
  await expect.poll(() => fixture.records().find(record => record.type === "fashion-image")?.x).toBe(120);
  expect(fixture.records().find(record => record.type === "fashion-image")).toMatchObject({ y: 80, props: { w: 260, h: 210 } });
  expect(fixture.commands).toHaveLength(0);
  expect(fixture.graph().edges).toHaveLength(0);
});

test("只读项目不恢复退役便签，多色色卡显示原内容且不提供编辑控件", async ({ page }) => {
  const fixture = await canvasFixture(page, {
    canEdit: false,
    nodes: [
      material("note", "reference_text", { text: "只读灵感" }),
      material("palette", "swatch", {
        color: "#c8ab84",
        colors: [
          { hex: "#c8ab84", name: "燕麦" },
          { hex: "#223344", name: "藏蓝" },
        ],
      }),
    ],
  });
  await page.goto(`/${PROJECT}`);
  await expect(page.getByRole("textbox", { name: "备注内容", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("燕麦 颜色", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "重命名颜色 燕麦", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "添加颜色", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "添加灵感便签", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "新建廓形草图", exact: true }),
  ).toBeDisabled();
  expect(fixture.saves).toHaveLength(0);
  expect(fixture.commands).toHaveLength(0);
});
