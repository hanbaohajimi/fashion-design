import { expect, type Page } from "@playwright/test";
import {
  canvasCommandSchema,
  type CanvasCommand,
} from "../../packages/shared/src";
import { prepareImageOrientation } from "./image-orientation-fixture";
import { PROJECT, NOW } from "../visual/fixtures";

type EditCommand = Extract<CanvasCommand, { type: "run_tool" }>;

/** Controlled task receipts; output images are fixtures, never model output. */
export async function prepareImageEditing(page: Page, width = 1440, height = 900, count = 1) {
  const state = await prepareImageOrientation(page, width, height, count);
  const commands: EditCommand[] = [];
  const masks: Buffer[] = [];
  const receipts = new Map<string, string>();
  let loseResponse = false;
  let hold: Promise<void> | null = null;
  let release: (() => void) | undefined;
  let uploadFailure = false;
  const file = {
    id: "edit-mask",
    name: "局部修改蒙版.png",
    mimeType: "image/png",
    size: 1024,
    width: 600,
    height: 800,
    status: "READY",
    error: null,
    thumbnail1024Url: null,
    thumbnail256Url: null,
  };
  await page.route("**/api/files/sign-upload", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      projectId: PROJECT,
      mimeType: "image/png",
    });
    return route.fulfill({
      json: {
        deduplicated: false,
        file: { ...file, status: "PENDING" },
        upload: {
          method: "PUT",
          url: "http://127.0.0.1:3000/__test-image-mask",
          headers: { "Content-Type": "image/png" },
        },
      },
    });
  });
  await page.route("**/__test-image-mask", (route) => {
    const png = route.request().postDataBuffer();
    if (!png) throw new Error("蒙版上传必须包含图片");
    masks.push(png);
    if (uploadFailure) {
      uploadFailure = false;
      return route.fulfill({ status: 503, body: "上传暂不可用" });
    }
    return route.fulfill({ status: 200 });
  });
  await page.route("**/api/files/edit-mask/complete", (route) =>
    route.fulfill({ json: file }),
  );
  await page.route(
    `**/api/projects/${PROJECT}/canvas/commands`,
    async (route) => {
      const parsed = canvasCommandSchema.parse(route.request().postDataJSON());
      if (parsed.type !== "run_tool" || parsed.toolKey !== "edit_design")
        throw new Error("图片编辑应使用现有编辑命令");
      commands.push(parsed);
      if (hold) {
        const waiting = hold;
        hold = null;
        await waiting;
      }
      let nodeId = receipts.get(parsed.mutationId);
      if (!nodeId) {
        nodeId = `edit-tool-${receipts.size + 1}`;
        const resultId = `edit-result-${receipts.size + 1}`;
        const graph = state.getGraph();
        const sourceNode = graph.nodes.find(
          (node) => node.id === parsed.inputs[0]?.nodeId,
        );
        if (!sourceNode) throw new Error("编辑命令必须引用现有图片");
        expect(sourceNode?.payload.assetId).toBe("look-0");
        const bytes = state.assets.get("look-0");
        if (!bytes) throw new Error("原图缺失");
        state.assets.set(resultId, bytes);
        state.replaceGraph({
          ...graph,
          revision: graph.revision + 1,
          nodes: [
            ...graph.nodes,
            {
              id: nodeId,
              kind: "tool",
              type: "edit_design",
              title: parsed.title,
              status: "completed",
              x: 400,
              y: 0,
              createdAt: NOW,
              updatedAt: NOW,
              payload: { params: parsed.parameters },
            },
            {
              id: resultId,
              kind: "asset",
              type: "candidate",
              title: "局部编辑新版本",
              status: "completed",
              x: 700,
              y: 0,
              createdAt: NOW,
              updatedAt: NOW,
              payload: {
                assetId: resultId,
                parentAssetId: "look-0",
                rootAssetId: "look-0",
                executionId: parsed.mutationId,
                imageUrl: `/api/design-assets/${resultId}/content`,
                imageWidth: 600,
                imageHeight: 800,
              },
            },
          ],
          edges: [
            ...graph.edges,
            {
              id: `${nodeId}-input`,
              sourceNodeId: sourceNode.id,
              targetNodeId: nodeId,
              sourcePort: "out",
              targetPort: "source",
            },
            {
              id: `${nodeId}-output`,
              sourceNodeId: nodeId,
              targetNodeId: resultId,
              sourcePort: "out",
              targetPort: "source",
            },
          ],
        });
        receipts.set(parsed.mutationId, nodeId);
      }
      if (loseResponse) {
        loseResponse = false;
        return route.fulfill({
          status: 503,
          json: { message: "暂未收到任务确认，请继续原操作" },
        });
      }
      return route.fulfill({
        json: { nodeId, graph: state.getGraph(), canvas: state.getCanvas() },
      });
    },
  );
  return {
    ...state,
    commands,
    masks,
    receipts,
    loseNextResponse: () => {
      loseResponse = true;
    },
    failNextUpload: () => {
      uploadFailure = true;
    },
    holdNextSubmission: () => {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseSubmission: () => {
      release?.();
    },
  };
}
