import { readFile } from "node:fs/promises";
import sharp from "../../apps/worker/node_modules/sharp";
import { expect, type Page } from "@playwright/test";
import {
  imageTransformSchema,
  canvasCommandSchema,
  type CanvasCommand,
  type CanvasDocumentView,
  type CanvasSave,
} from "../../packages/shared/src";
import type {
  WorkflowGraph,
  WorkflowNode,
} from "../../apps/web/src/modules/board/workflow/workflow-api";
import { transformImage } from "../../apps/worker/src/processors/transform-image";
import { prepareZhiya, loadZhiya } from "./zhiya-fixture";
import { PROJECT, NOW } from "../visual/fixtures";

export async function prepareImageOrientation(
  page: Page,
  width = 1440,
  height = 900,
  count = 1,
) {
  const state = await prepareZhiya(page, {
    count,
    viewport: { width, height },
    realClock: true,
  });
  const source = await sharp(
    await readFile(
      "apps/web/public/prototype-assets/impeccable/coat-original.png",
    ),
  )
    .resize(600, 800, { fit: "contain", background: "#fff" })
    .png()
    .toBuffer();
  const assets = new Map([["look-0", source]]);
  const commands: Extract<CanvasCommand, { type: "run_tool" }>[] = [];
  const placementRequests: Extract<CanvasCommand, { type: "create_material" }>[] = [];
  const placements = new Map<string, string>();
  let losePlacement = false;
  const results = new Map<string, string>();
  let failNext = false;
  let graph: WorkflowGraph = {
    projectId: PROJECT,
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: false,
    nodes: [
      {
        id: "material-0",
        kind: "asset",
        type: "candidate",
        title: "藏蓝通勤外套",
        status: "completed",
        canDelete: false,
        canEditPayload: false,
        canForkPayload: false,
        x: 0,
        y: 0,
        createdAt: NOW,
        updatedAt: NOW,
        payload: {
          assetId: "look-0",
          imageUrl: "/api/design-assets/look-0/content",
          imageWidth: 600,
          imageHeight: 800,
        },
      },
      ...Array.from({ length: count - 1 }, (_, offset): WorkflowNode => {
        const index = offset + 1;
        const type =
          index % 10 < 3
            ? "candidate"
            : index % 10 === 9
              ? "swatch"
              : "reference_text";
        assets.set(`look-${index}`, source);
        return {
          id: `material-${index}`,
          kind: "asset",
          type,
          title: `参考素材 ${index}`,
          status: "completed",
          x: (index % 10) * 280,
          y: Math.floor(index / 10) * 290,
          createdAt: NOW,
          updatedAt: NOW,
          payload:
            type === "candidate"
              ? {
                  assetId: `look-${index}`,
                  imageUrl: `/api/design-assets/look-${index}/content`,
                  imageWidth: 600,
                  imageHeight: 800,
                }
              : type === "swatch"
                ? {
                    colors: [{ hex: "#53644b", name: "苔绿" }],
                    color: "#53644b",
                  }
                : { text: "宽松廓形与轻盈结构，保留织物肌理。" },
        };
      }),
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
    bindings: graph.nodes.map((node) => ({
      shapeId: `shape:canvas-${node.id}`,
      nodeId: node.id,
      removed: false,
    })),
  };
  await page.route(
    /\/api\/design-assets\/[^/]+\/(?:content|thumbnail|file)(?:\?.*)?$/,
    (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
      const body = assets.get(id);
      return body
        ? route.fulfill({ contentType: "image/png", body })
        : route.fulfill({ status: 404 });
    },
  );
  await page.route(`**/api/projects/${PROJECT}/workflow**`, (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/tools")
        ? { agentVersion: 2, tools: [] }
        : graph,
    }),
  );
  await page.route(`**/api/projects/${PROJECT}/canvas**`, async (route) => {
    if (route.request().url().endsWith("/creations")) return route.fulfill({ json: { items: [], canEdit: document.canEdit } });
    if (route.request().url().endsWith("/commands")) {
      const body = route.request().postDataJSON() as CanvasCommand;
      if (body.type === "create_material" && body.materialType === "candidate") {
        canvasCommandSchema.parse(body);
        placementRequests.push(body);
        if (!assets.has(String(body.payload.assetId))) return route.fulfill({ status: 400, json: { message: "导入作品必须引用本项目中真实存在的资产" } });
        let nodeId = placements.get(body.mutationId);
        if (!nodeId) {
          nodeId = body.clientMaterialId ?? `placement-${placementRequests.length}`;
          placements.set(body.mutationId, nodeId);
          graph = { ...graph, revision: graph.revision + 1, nodes: [...graph.nodes, { id: nodeId, kind: "asset", type: "candidate", title: body.title, status: "completed", payload: body.payload, x: 0, y: 0, createdAt: NOW, updatedAt: NOW }] };
          document = { ...document, revision: document.revision + 1, bindings: [...document.bindings, { shapeId: `shape:canvas-${nodeId}`, nodeId, removed: false }] };
        }
        if (losePlacement) { losePlacement = false; return route.fulfill({ status: 503, json: { message: "图片已收到，放置结果尚未确认" } }); }
        return route.fulfill({ json: { nodeId, graph, canvas: document } });
      }
      if (body.type !== "run_tool" || body.toolKey !== "transform_image")
        throw new Error("方向调整只应提交基础图片变换");
      commands.push(body);
      if (failNext) {
        failNext = false;
        return route.fulfill({
          status: 503,
          json: { message: "暂时未收到服务器确认，请重试原操作" },
        });
      }
      let assetId = results.get(body.mutationId);
      if (!assetId) {
        const params = imageTransformSchema.parse(body.parameters);
        const sourceNode = graph.nodes.find(
          (node) => node.id === body.inputs[0]?.nodeId,
        );
        const bytes = assets.get(String(sourceNode?.payload.assetId));
        if (!bytes) throw new Error("缺少图片来源");
        assetId = `edited-${results.size + 1}`;
        assets.set(assetId, await transformImage(bytes, params));
        results.set(body.mutationId, assetId);
        const toolId = `tool-${body.mutationId}`;
        const tool: WorkflowNode = {
          id: toolId,
          kind: "tool",
          type: "transform_image",
          title: body.title,
          x: 500,
          y: 0,
          status: "completed",
          createdAt: NOW,
          updatedAt: NOW,
          payload: { toolKey: "transform_image", params },
        };
        const result: WorkflowNode = {
          id: assetId,
          kind: "asset",
          type: "candidate",
          title: `外套调整 ${results.size}`,
          x: 800,
          y: 0,
          status: "completed",
          createdAt: NOW,
          updatedAt: NOW,
          payload: {
            assetId,
            parentAssetId: sourceNode?.payload.assetId,
            rootAssetId: "look-0",
            executionId: body.mutationId,
            imageUrl: `/api/design-assets/${assetId}/content`,
            imageWidth: params.width,
            imageHeight: params.height,
          },
        };
        graph = {
          ...graph,
          revision: graph.revision + 1,
          nodes: [...graph.nodes, tool, result],
          edges: [
            ...graph.edges,
            {
              id: `${toolId}-in`,
              sourceNodeId: body.inputs[0]?.nodeId ?? "",
              targetNodeId: toolId,
              sourcePort: "out",
              targetPort: "source",
            },
            {
              id: `${toolId}-out`,
              sourceNodeId: toolId,
              targetNodeId: assetId,
              sourcePort: "out",
              targetPort: "source",
            },
          ],
        };
        document = {
          ...document,
          bindings: [
            ...document.bindings,
            {
              shapeId: `shape:canvas-${assetId}`,
              nodeId: assetId,
              removed: false,
            },
          ],
        };
      }
      return route.fulfill({
        json: { nodeId: `tool-${body.mutationId}`, graph, canvas: document },
      });
    }
    if (route.request().method() === "PATCH") {
      const save = route.request().postDataJSON() as CanvasSave;
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
  await loadZhiya(page);
  const open = async () => {
    const image = page.getByRole("group", {
      name: "藏蓝通勤外套",
      exact: true,
    });
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    if (!box) throw new Error("白板图片尚未布局");
    // Short screens reposition the selected image and composer after the first
    // click. Open from the revealed upper area after that layout has settled.
    if (height < 700) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.getByRole("region", { name: "图片创作框", exact: true })).toBeVisible();
      const selected = await image.boundingBox();
      if (!selected) throw new Error("所选图片不可见");
      await page.mouse.dblclick(selected.x + selected.width / 2, selected.y + Math.min(80, selected.height / 4));
    } else await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(
      page.getByRole("dialog", { name: "图片工作区" }),
    ).toBeVisible();
  };
  return {
    ...state,
    assets,
    commands,
    placementRequests,
    getGraph: () => structuredClone(graph),
    getCanvas: () => structuredClone(document),
    setCanEdit: (canEdit: boolean) => { document = { ...document, canEdit }; },
    replaceGraph: (next: WorkflowGraph) => {
      graph = next;
      document = { ...document, bindings: next.nodes.filter(node => node.kind === "asset").map(node => ({ shapeId: `shape:canvas-${node.id}`, nodeId: node.id, removed: false })) };
    },
    removeSourceFromGraph: () => { graph = { ...graph, revision: graph.revision + 1, nodes: [] }; document = { ...document, snapshot: {}, bindings: [] }; },
    removeSourcePlacement: () => { document = { ...document, revision: document.revision + 1, snapshot: {}, bindings: document.bindings.map(binding => ({ ...binding, removed: true })) }; },
    loseNextPlacementResponse: () => { losePlacement = true; },
    results,
    open,
    failNextSubmission: () => {
      failNext = true;
    },
  };
}
