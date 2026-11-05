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
          : command.nodeId;
      const node =
        command.type === "create_material"
          ? material(
              nodeId,
              command.materialType,
              command.payload,
              command.title,
            )
          : {
              ...graph.nodes.find((node) => node.id === nodeId)!,
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
                  { type?: string; props?: { text?: string } }
                >;
              }
            | undefined
        )?.store ?? {};
      for (const binding of save.bindings) {
        const shape = records[binding.shapeId];
        const node = graph.nodes.find((node) => node.id === binding.nodeId);
        if (
          shape?.type === "fashion-note" &&
          shape.props?.text !== node?.payload.text
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
                    props: Record<string, unknown>;
                  }
                >;
              }
            | undefined
        )?.store ?? {},
      ),
  };
}

test("原白板工具栏承接节点设计工具与素材入口", async ({ page }) => {
  const fixture = await canvasFixture(page);
  await page.route("**/api/collections?**", route => route.fulfill({ json: [] }));
  const legacyWrites: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" && /\/boards\//.test(request.url())) legacyWrites.push(request.url());
  });
  await page.goto(`/${PROJECT}`);
  const rail = page.getByRole("complementary", { name: "工具条", exact: true });
  await expect(rail).toHaveCount(1);
  await expect(page.getByRole("toolbar", { name: "白板工具", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "＋ 添加素材", exact: true })).toHaveCount(0);
  for (const name of ["选择工具", "抓手工具", "新建廓形草图", "上传图片", "文本工具", "箭头工具", "添加灵感便签", "添加色卡", "固定素材", "打开面料库", "打开系列工作台", "打开趋势分析"]) {
    await expect(rail.getByRole("button", { name, exact: true })).toBeEnabled();
  }
  await rail.getByRole("button", { name: "使用设计工具", exact: true }).click();
  const menu = page.locator("[data-workflow-add-menu]");
  await expect(menu.getByRole("button")).toHaveCount(6);
  await page.screenshot({ path: "output/playwright/canvas-original-toolbar.png", fullPage: true });
  await page.getByRole("button", { name: "关闭菜单", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await rail.getByRole("button", { name: "上传图片", exact: true }).click();
  await (await chooser).setFiles([]);
  await rail.getByRole("button", { name: "箭头工具", exact: true }).click();
  await page.mouse.move(425, 180);
  await page.mouse.down();
  await page.mouse.move(525, 220, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => fixture.records().some(record => record.type === "arrow")).toBe(true);
  await rail.getByRole("button", { name: "固定素材", exact: true }).click();
  const imageBounds = await page.getByRole("group", { name: "藏蓝通勤外套", exact: true }).boundingBox();
  if (!imageBounds) throw new Error("素材没有布局");
  await page.mouse.click(imageBounds.x + imageBounds.width / 2, imageBounds.y + imageBounds.height / 2);
  await expect.poll(() => (fixture.records().find(record => record.type === "fashion-image")?.props.mounts as unknown[] | undefined)?.length).toBe(1);
  await rail.getByRole("button", { name: "选择工具", exact: true }).click();
  for (const name of ["需求分析", "方案生成", "服装评估", "局部修改", "调整图片尺寸"]) {
    await rail.getByRole("button", { name: "使用设计工具", exact: true }).click();
    await menu.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(menu).toHaveCount(0);
    await page.getByRole("button", { name: "← 返回画布", exact: true }).click();
  }
  await rail.getByRole("button", { name: "新建廓形草图", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "绘制廓形草图", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  for (const [button, dialog] of [["打开面料库", "选择面料"], ["打开趋势分析", "选择趋势"]] as const) {
    await rail.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByRole("dialog", { name: dialog, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await rail.getByRole("button", { name: "打开系列工作台", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "系列工作台", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await canvasAction(page, "添加设计素材");
  for (const name of ["设计需求", "文字参考", "上传图片", "色彩参考", "廓形草图", "趋势档案", "面料库"]) {
    await expect(menu.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(fixture.commands).toHaveLength(0);
  expect(fixture.graphWrites()).toBe(0);
  expect(legacyWrites).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await rail.getByRole("button", { name: "使用设计工具", exact: true }).click();
  await expect(menu).toBeInViewport();
  const selectBounds = await rail.getByRole("button", { name: "选择工具", exact: true }).boundingBox();
  expect(selectBounds!.width).toBeGreaterThanOrEqual(44);
  expect(selectBounds!.height).toBeGreaterThanOrEqual(44);
  await menu.getByRole("button", { name: /^局部修改/ }).click();
  await expect(page.getByRole("heading", { name: "局部修改", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← 返回画布", exact: true }).click();
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
        page.getByRole("button", { name: "添加灵感便签", exact: true }),
      ).toBeDisabled();
    fixture.allowInitialization();
    await page
      .getByRole("button", { name: "重试载入白板", exact: true })
      .click();
    await expect(
      page.getByRole("group", { name: "藏蓝通勤外套", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "添加灵感便签", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "暂时无法打开白板" }),
    ).toHaveCount(0);
    expect(fixture.commands).toHaveLength(0);
    expect(fixture.graphWrites()).toBe(0);
  });
}

test("空白便签只保存布局，素材回执重试使用原编号，清空内容同步到后台", async ({
  page,
}) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  await page.goto(`/${PROJECT}`);
  await expect(
    page.getByRole("heading", { name: "从一份素材开始" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加灵感便签", exact: true }).click();
  const note = page.getByRole("textbox", { name: "备注内容", exact: true });
  await expect(note).toHaveValue("");
  await expect
    .poll(() =>
      fixture.records().some((record) => record.type === "fashion-note"),
    )
    .toBe(true);
  expect(fixture.commands).toHaveLength(0);
  fixture.loseMaterialReceipt();
  await note.fill("保留宽松轮廓");
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toBeVisible();
  expect(fixture.commands).toHaveLength(1);
  const mutation = fixture.commands[0]!.mutationId;
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect.poll(() => fixture.commands.length).toBe(2);
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toHaveCount(0);
  expect(fixture.commands[1]!.mutationId).toBe(mutation);
  expect(fixture.graph().nodes).toHaveLength(1);
  await note.fill("");
  await expect.poll(() => fixture.graph().nodes[0]?.payload.text).toBe("");
  await expect
    .poll(
      () =>
        fixture.records().find((record) => record.type === "fashion-note")
          ?.props.text,
    )
    .toBe("");
  await page.reload();
  await expect(note).toHaveValue("");
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
  const failed = fixture.saves.at(-1)!;
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
  const latest = fixture.saves.at(-1)!;
  expect(latest.mutationId).not.toBe(failed.mutationId);
  const oldStore = (
    failed.snapshot.document as {
      store: Record<string, { type: string; x: number }>;
    }
  ).store;
  expect(savedX).toBeGreaterThan(
    Object.values(oldStore).find((record) => record.type === "fashion-image")!
      .x,
  );
  await expect(page.getByLabel("画布保存状态", { exact: true })).toHaveText(
    "已保存",
  );
  expect(fixture.commands).toHaveLength(0);
});

test("保存过程中继续编辑，必须先提交最新素材再确认布局已保存", async ({
  page,
}) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  await page.goto(`/${PROJECT}`);
  await page.getByRole("button", { name: "添加灵感便签", exact: true }).click();
  const note = page.getByRole("textbox", { name: "备注内容", exact: true });
  const release = fixture.delayMaterialReceipt();
  await note.fill("第一版领口");
  await expect.poll(() => fixture.commands.length).toBe(1);
  await note.fill("第二版方领");
  release();
  await expect
    .poll(() => fixture.graph().nodes[0]?.payload.text)
    .toBe("第二版方领");
  await expect
    .poll(
      () =>
        fixture.records().find((record) => record.type === "fashion-note")
          ?.props.text,
    )
    .toBe("第二版方领");
  expect(fixture.inconsistentLayouts).toEqual([]);
  expect(fixture.graph().nodes).toHaveLength(1);
  await expect(page.getByLabel("画布保存状态", { exact: true })).toHaveText(
    "已保存",
  );
});

test("平移视野会恢复，收起助手及切换窄屏保持画布中心且不修改业务记录", async ({
  page,
}) => {
  const fixture = await canvasFixture(page);
  await page.goto(`/${PROJECT}`);
  const image = page.getByRole("group", { name: "藏蓝通勤外套", exact: true });
  const workspace = page.getByLabel("无限白板", { exact: true });
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: "抓手工具", exact: true }).click();
  const box = await image.boundingBox();
  if (!box) throw new Error("图片没有布局");
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y + 30, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await image.boundingBox())!.x - box.x))
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
    const shape = (await image.boundingBox())!,
      bounds = (await workspace.boundingBox())!;
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
  expect(more!.width).toBeGreaterThanOrEqual(44);
  expect(more!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(fixture.saves).toHaveLength(0);
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
  await expect(page.getByLabel("正在讨论", { exact: true })).toContainText(
    "白板草图",
  );
});

test("布局回执丢失期间新增素材，旧回执不能倒退版本或产生自身冲突", async ({
  page,
}) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  await page.goto(`/${PROJECT}`);
  fixture.loseLayoutReceipt();
  await page.getByRole("button", { name: "添加灵感便签", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toBeVisible();
  const original = fixture.saves[0]!;
  await page.screenshot({
    path: "output/playwright/canvas-save-recovery.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "备注内容", exact: true })
    .fill("新素材仍要正确保存");
  await expect.poll(() => fixture.commands.length).toBe(1);
  await expect
    .poll(
      () =>
        fixture.saves.filter((save) => save.mutationId === original.mutationId)
          .length,
    )
    .toBe(2);
  await expect
    .poll(
      () =>
        fixture.records().find((record) => record.type === "fashion-note")
          ?.props.text,
    )
    .toBe("新素材仍要正确保存");
  await expect(page.getByLabel("画布保存状态", { exact: true })).toHaveText(
    "已保存",
  );
  await expect(
    page.getByRole("button", { name: "导出草稿并载入最新", exact: true }),
  ).toHaveCount(0);
});

test("素材回执丢失后刷新仍恢复同一操作，不重复创建素材", async ({ page }) => {
  const fixture = await canvasFixture(page, { nodes: [] });
  await page.goto(`/${PROJECT}`);
  await page.getByRole("button", { name: "添加灵感便签", exact: true }).click();
  await expect.poll(() => fixture.saves.length).toBeGreaterThan(0);
  fixture.loseMaterialReceipt();
  await page
    .getByRole("textbox", { name: "备注内容", exact: true })
    .fill("保留这份本机灵感");
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toBeVisible();
  const original = fixture.commands[0]!;
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "备注内容", exact: true }),
  ).toHaveValue("保留这份本机灵感");
  await expect.poll(() => fixture.commands.length).toBeGreaterThan(1);
  expect(
    fixture.commands.every(
      (command) => command.mutationId === original.mutationId,
    ),
  ).toBe(true);
  expect(fixture.graph().nodes).toHaveLength(1);
  await expect(page.getByLabel("画布保存状态", { exact: true })).toHaveText(
    "已保存",
  );
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
  await page.getByRole("button", { name: "画布", exact: true }).click();
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

test("首次恢复旧自由白板保留原素材尺寸和位置", async ({ page }) => {
  const fixture = await canvasFixture(page, {
    nodes: [material("legacy-note", "reference_text", { text: "历史灵感" })],
    legacyRecords: [
      {
        id: "shape:canvas-legacy-note",
        type: "fashion-note",
        x: 120,
        y: 80,
        props: { w: 260, h: 210, text: "历史灵感" },
      },
    ],
  });
  await page.goto(`/${PROJECT}`);
  await expect(
    page.getByRole("textbox", { name: "备注内容", exact: true }),
  ).toHaveValue("历史灵感");
  await page.getByRole("button", { name: "选择工具", exact: true }).click();
  await page.keyboard.press("Control+a");
  await expect
    .poll(
      () =>
        fixture.records().find((record) => record.type === "fashion-note")?.x,
    )
    .toBe(120);
  const note = fixture
    .records()
    .find((record) => record.type === "fashion-note");
  expect(note).toMatchObject({
    y: 80,
    props: { w: 260, h: 210, text: "历史灵感" },
  });
  expect(fixture.commands).toHaveLength(0);
  expect(fixture.graph().edges).toHaveLength(0);
});

test("只读项目的便签及多色色卡显示原内容且不提供编辑控件", async ({ page }) => {
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
  await expect(
    page.getByRole("textbox", { name: "备注内容", exact: true }),
  ).toHaveValue("只读灵感");
  await expect(
    page.getByRole("textbox", { name: "备注内容", exact: true }),
  ).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("燕麦 颜色", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "重命名颜色 燕麦", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "添加颜色", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "添加灵感便签", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "新建廓形草图", exact: true }),
  ).toBeDisabled();
  expect(fixture.saves).toHaveLength(0);
  expect(fixture.commands).toHaveLength(0);
});
