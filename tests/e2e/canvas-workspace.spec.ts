import { expect, test } from "@playwright/test";
import { seedVisualApp, PROJECT, NOW } from "../visual/fixtures";
import type {
  CanvasCommand,
  CanvasDocumentView,
  CanvasSave,
} from "../../packages/shared/src/canvas-workspace";
import type { WorkflowGraph } from "../../apps/web/src/modules/board/workflow/workflow-api";

test("自由白板保留外壳、选择引用、整理容器与只读流程", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await seedVisualApp(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.name !== "NetworkError") errors.push(error.message);
  });
  let graph: WorkflowGraph = {
    projectId: PROJECT,
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: false,
    nodes: [
      {
        id: "candidate",
        kind: "asset",
        type: "candidate",
        title: "藏蓝通勤外套",
        status: "completed",
        x: 900,
        y: 0,
        createdAt: NOW,
        updatedAt: NOW,
        payload: { assetId: "visual-look", imageUrl: "/visual-garment.svg" },
      },
    ],
    edges: [],
  };
  let document: CanvasDocumentView = {
    projectId: PROJECT,
    mode: "canvas",
    revision: 0,
    formatVersion: 1,
    initializedFrom: "workflow",
    canEdit: true,
    snapshot: {},
    bindings: [
      {
        shapeId: "shape:canvas-candidate",
        nodeId: "candidate",
        removed: false,
      },
    ],
  };
  const commands: CanvasCommand[] = [];
  const saves: CanvasSave[] = [];
  let graphWrites = 0;
  await page.route(`**/api/projects/${PROJECT}/workflow**`, (route) => {
    if (route.request().method() === "PATCH") graphWrites++;
    if (route.request().url().endsWith("/tools"))
      return route.fulfill({ json: { agentVersion: 2, tools: [] } });
    return route.fulfill({ json: graph });
  });
  await page.route(`**/api/projects/${PROJECT}/canvas**`, (route) => {
    if (route.request().url().endsWith("/commands")) {
      const command = route.request().postDataJSON() as CanvasCommand;
      commands.push(command);
      if (command.type !== "create_material")
        throw new Error("Unexpected command");
      const nodeId = `material-${commands.length}`;
      graph = {
        ...graph,
        revision: graph.revision + 1,
        nodes: [
          ...graph.nodes,
          {
            id: nodeId,
            kind: "asset",
            type: command.materialType,
            title: command.title,
            payload: command.payload,
            x: 0,
            y: 0,
            status: "ready",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      };
      document = {
        ...document,
        revision: document.revision + 1,
        bindings: [
          ...document.bindings,
          {
            shapeId: command.shapeId ?? `shape:canvas-${nodeId}`,
            nodeId,
            removed: false,
          },
        ],
      };
      return route.fulfill({ json: { nodeId, graph, canvas: document } });
    }
    if (route.request().method() === "PATCH") {
      const save = route.request().postDataJSON() as CanvasSave;
      saves.push(save);
      document = {
        ...document,
        revision: document.revision + 1,
        snapshot: save.snapshot,
        bindings: save.bindings.map((binding) => ({
          ...binding,
          removed: false,
        })),
      };
    }
    return route.fulfill({ json: document });
  });
  await page.goto(`/${PROJECT}`);
  await expect(page.getByRole("toolbar", { name: "白板工具" })).toBeVisible();
  const image = page.getByRole("group", { name: "藏蓝通勤外套", exact: true });
  await expect(image).toBeVisible();
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error("Canvas image has no bounds");
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(page.getByLabel("正在讨论", { exact: true })).toContainText(
    "藏蓝通勤外套",
  );
  const beforeDrag = saves.length;
  await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + bounds.height / 2 + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 70, bounds.y + bounds.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await image.boundingBox())?.x).not.toBe(bounds.x);
  await expect.poll(() => saves.length).toBeGreaterThan(beforeDrag);
  expect(commands).toHaveLength(0);
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.keyboard.press("Control+c");
  // Copy resolves assets and writes the clipboard asynchronously. Wait for the
  // actual native clipboard payload before issuing the separate paste gesture.
  await expect.poll(() => page.evaluate(async () => {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes("text/html")) {
        const html = await (await item.getType("text/html")).text();
        if (html.includes("data-tldraw")) return true;
      }
    }
    return false;
  })).toBe(true);
  await page.keyboard.press("Control+v");
  await expect(image).toHaveCount(2);
  await expect.poll(() => document.bindings.filter(binding => binding.nodeId === "candidate" && !binding.removed).length).toBe(2);
  expect(commands).toHaveLength(0);
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "分组", exact: true }).click();
  await expect.poll(() => Object.values((document.snapshot.document as { store?: Record<string, { type?: string }> } | undefined)?.store ?? {}).some(record => record.type === "group")).toBe(true);
  await expect(page.getByLabel("正在讨论", { exact: true }).getByRole("button", { name: /移除/ })).toHaveCount(1);
  await page.getByRole("button", { name: "解除分组", exact: true }).click();
  await page.getByRole("button", { name: "便签", exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  const nodeCount = graph.nodes.length;
  await page.getByRole("button", { name: "分组", exact: true }).click();
  await page.getByRole("button", { name: "解除分组", exact: true }).click();
  expect(graph.nodes).toHaveLength(nodeCount);
  expect(graph.edges).toHaveLength(0);
  await page.getByRole("button", { name: "流程画布", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "白板工具" })).toBeHidden();
  await expect(page.locator("[data-workflow-port]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "＋ 添加素材", exact: true }),
  ).toBeHidden();
  const flowNode = page.getByRole("group", { name: "设计节点 藏蓝通勤外套", exact: true });
  const flowBounds = await flowNode.boundingBox();
  if (!flowBounds) throw new Error("流程节点不可见");
  // tldraw routes canvas hit testing through its overlay, so exercise a real pointer.
  await page.mouse.click(flowBounds.x + flowBounds.width / 2, flowBounds.y + flowBounds.height / 2);
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+v");
  await expect(flowNode).toHaveCount(1);
  expect(graphWrites).toBe(0);
  await page.getByRole("button", { name: "设计工作台", exact: true }).click();
  await expect(image.first()).toBeVisible();
  const workspace = page.getByLabel("无限白板", { exact: true });
  const beforeCollapse = await workspace.boundingBox();
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await expect.poll(async () => (await workspace.boundingBox())?.width ?? 0).toBeGreaterThan(beforeCollapse?.width ?? 0);
  await page.screenshot({
    path: "output/playwright/canvas-workspace.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("toolbar", { name: "白板工具" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "output/playwright/canvas-workspace-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  // A large selection is rejected as a whole, with no silent truncation or model call.
  const beforeLimit = commands.length;
  const extras: WorkflowGraph["nodes"] = Array.from({ length: 17 }, (_, index) => ({ id: `extra-${index}`, kind: "asset", type: "reference_text", title: `参考 ${index}`, payload: { text: `参考 ${index}` }, status: "ready", x: 0, y: 0, createdAt: NOW, updatedAt: NOW }));
  graph = { ...graph, nodes: [...graph.nodes, ...extras] };
  document = { ...document, bindings: [...document.bindings, ...extras.map(node => ({ shapeId: `shape:${node.id}`, nodeId: node.id, removed: false }))] };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  const firstImage = image.first();
  await expect(firstImage).toBeVisible();
  const firstBounds = await firstImage.boundingBox();
  if (!firstBounds) throw new Error("素材不可见");
  await page.mouse.click(firstBounds.x + firstBounds.width / 2, firstBounds.y + firstBounds.height / 2);
  await page.keyboard.press("Control+a");
  await expect(page.getByRole("alert").filter({ hasText: "每次最多引用 16 项" })).toBeVisible();
  expect(commands).toHaveLength(beforeLimit);
});
