import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import sharp from "../../apps/worker/node_modules/sharp";
import type {
  CanvasCommand,
  CanvasDocumentView,
  CanvasSave,
} from "../../packages/shared/src";
import type {
  WorkflowGraph,
  WorkflowNode,
} from "../../apps/web/src/modules/board/workflow/workflow-api";
import type { DesignAssetVersion } from "../../apps/web/src/modules/board/generation/generation-types";
import { prepareZhiya, loadZhiya } from "./zhiya-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

export async function prepareImageComparison(
  page: Page,
  width = 1440,
  height = 900,
  third = false,
) {
  const state = await prepareZhiya(page, {
    viewport: { width, height },
    realClock: true,
  });
  const original = await sharp(
    await readFile(
      "apps/web/public/prototype-assets/impeccable/coat-original.png",
    ),
  )
    .resize(600, 800, { fit: "contain", background: "#fff" })
    .png()
    .toBuffer();
  const alternative = await sharp(
    await readFile("apps/web/public/prototype-assets/impeccable/coat-cuff.png"),
  )
    .resize(600, 800, { fit: "contain", background: "#fff" })
    .png()
    .toBuffer();
  const images = new Map([
    ["look-a", original],
    ["look-b", alternative],
    ["look-c", original],
    ["historic", alternative],
    ["older", original],
  ]);
  const candidate = (
    id: string,
    title: string,
    x: number,
    batch?: string,
  ): WorkflowNode => ({
    id,
    kind: "asset",
    type: "candidate",
    title,
    status: "completed",
    x,
    y: 0,
    createdAt: NOW,
    updatedAt: NOW,
    payload: {
      assetId: id,
      imageUrl: `/api/design-assets/${id}/content`,
      imageWidth: 600,
      imageHeight: 800,
      ...(batch ? { executionId: batch } : {}),
    },
  });
  let graph: WorkflowGraph = {
    projectId: PROJECT,
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: false,
    nodes: [
      candidate("look-a", "藏蓝通勤外套", 0, "batch"),
      candidate("look-b", "袖口细节方案", 300, "batch"),
    ],
    edges: [],
  };
  if (third)
    graph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        candidate("look-c", "第三张对照图", 600, "batch"),
      ],
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
  const version = (id: string): DesignAssetVersion => ({
    id,
    projectId: PROJECT,
    operation:
      id === "historic"
        ? "inpaint"
        : id === "older"
          ? "generated"
          : "transform",
    parentAssetId: id === "older" ? null : "older",
    restoredFromAssetId: null,
    width: 600,
    height: 800,
    url: `/api/design-assets/${id}/content`,
    thumbnailUrl: `/api/design-assets/${id}/thumbnail`,
    archivedAt: null,
    seed: null,
    createdAt:
      id === "historic"
        ? "2026-11-07T03:00:00Z"
        : id === "older"
          ? "2026-11-06T03:00:00Z"
          : NOW,
  });
  const restores: {
    target: string;
    currentAssetId: string;
    clientRequestId: string;
  }[] = [];
  const imports: {
    sourceNodeId: string;
    assetId: string;
    mutationId: string;
    operation: string;
  }[] = [];
  const commands: CanvasCommand[] = [];
  const created = new Map<string, DesignAssetVersion>();
  let failure: "restore" | "import" | null = null;
  let historyFails = false;
  let imageFails = false;
  await page.route(
    /\/api\/design-assets\/[^/]+\/(?:content|thumbnail)(?:\?.*)?$/,
    (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
      const body = images.get(id);
      return body && !(imageFails && id === "look-b")
        ? route.fulfill({ contentType: "image/png", body })
        : route.fulfill({ status: 404 });
    },
  );
  await page.route("**/api/design-assets/*/versions?*", (route) => {
    if (historyFails)
      return route.fulfill({
        status: 503,
        json: { message: "暂时读不到版本历史" },
      });
    const url = new URL(route.request().url());
    return route.fulfill({
      json: url.searchParams.has("cursor")
        ? { items: [version("older")], nextCursor: null }
        : {
            items: [version("look-a"), version("historic")],
            nextCursor: "older-page",
          },
    });
  });
  await page.route("**/api/design-assets/*/restore", (route) => {
    const target = new URL(route.request().url()).pathname.split("/")[3] ?? "";
    const body = route.request().postDataJSON() as {
      currentAssetId: string;
      clientRequestId: string;
    };
    restores.push({ target, ...body });
    let asset = created.get(body.clientRequestId);
    if (!asset) {
      const id = `restored-${created.size + 1}`;
      asset = {
        ...version(id),
        operation: "restore",
        parentAssetId: body.currentAssetId,
        restoredFromAssetId: target,
      };
      created.set(body.clientRequestId, asset);
      const source = images.get(target);
      if (!source) throw new Error("恢复来源图片不存在");
      images.set(id, source);
    }
    if (failure === "restore") {
      failure = null;
      return route.fulfill({
        status: 503,
        json: { message: "恢复结果暂未确认" },
      });
    }
    return route.fulfill({ json: asset });
  });
  await page.route(`**/api/projects/${PROJECT}/workflow**`, (route) => {
    if (route.request().url().endsWith("/tools"))
      return route.fulfill({ json: { agentVersion: 2, tools: [] } });
    if (route.request().url().endsWith("/import-asset")) {
      const body = route.request().postDataJSON() as (typeof imports)[number];
      imports.push(body);
      if (!graph.nodes.some((node) => node.payload.assetId === body.assetId)) {
        const node = candidate(body.assetId, "恢复的版本", 600);
        graph = {
          ...graph,
          revision: graph.revision + 1,
          nodes: [
            ...graph.nodes,
            {
              ...node,
              payload: {
                ...node.payload,
                parentAssetId: body.sourceNodeId,
                restoredFromAssetId: "historic",
              },
            },
          ],
        };
        document = {
          ...document,
          bindings: [
            ...document.bindings,
            {
              shapeId: `shape:canvas-${node.id}`,
              nodeId: node.id,
              removed: false,
            },
          ],
        };
      }
      if (failure === "import") {
        failure = null;
        return route.fulfill({
          status: 503,
          json: { message: "加入画布的响应暂未确认" },
        });
      }
    }
    return route.fulfill({ json: graph });
  });
  await page.route(`**/api/projects/${PROJECT}/canvas**`, (route) => {
    if (route.request().url().endsWith("/commands")) {
      commands.push(route.request().postDataJSON() as CanvasCommand);
      return route.fulfill({
        json: { nodeId: "edit-result", graph, canvas: document },
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
    if (!box) throw new Error("白板图片不可见");
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(
      page.getByRole("dialog", { name: "图片工作区" }),
    ).toBeVisible();
  };
  return {
    ...state,
    open,
    restores,
    imports,
    created,
    commands,
    failNext: (stage: typeof failure) => {
      failure = stage;
    },
    setHistoryFailure: (value: boolean) => {
      historyFails = value;
    },
    setImageFailure: (value: boolean) => {
      imageFails = value;
    },
  };
}
