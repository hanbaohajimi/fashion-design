import type { Page, Route } from "@playwright/test";
import type { CanvasCommand } from "../../packages/shared/src/canvas-workspace";
import type {
  WorkflowGraph,
  WorkflowOperation,
} from "../../apps/web/src/modules/board/workflow/workflow-api";

/** Reuses each legacy fixture's in-memory graph/queue handlers as a mock business service. */
export async function canvasCommandFixture(page: Page, route: Route) {
  const body = route.request().postDataJSON() as CanvasCommand;
  const base = new URL(route.request().url()).pathname.replace(
    /\/canvas\/commands$/,
    "/workflow",
  );
  const result = await page.evaluate(
    async ({ body, base }) => {
      const request = async (path: string, method = "GET", data?: unknown) => {
        const response = await fetch(path, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(data ? { body: JSON.stringify(data) } : {}),
        });
        const json = await response.json();
        if (!response.ok) throw { status: response.status, json };
        return json as WorkflowGraph;
      };
      try {
        let graph = await request(`${base}/sync`);
        const nodeId =
          body.type === "import_materials"
            ? (body.materials[0]?.clientMaterialId ??
              `material-${body.mutationId}`)
            : body.type === "create_material"
              ? (body.clientMaterialId ?? `material-${body.mutationId}`)
              : body.type === "run_tool"
                ? `tool-${body.mutationId}`
                : "nodeId" in body
                  ? body.nodeId
                  : "";
        let operations: WorkflowOperation[] = [];
        if (
          body.type === "create_material" &&
          !graph.nodes.some((node) => node.id === nodeId)
        )
          operations = [
            {
              type: "add_node",
              node: {
                id: nodeId,
                kind: "asset",
                type: body.materialType,
                title: body.title,
                payload: body.payload,
                x: body.position?.x ?? 0,
                y: body.position?.y ?? 0,
              },
            },
          ];
        if (body.type === "import_materials")
          operations = body.materials
            .filter(
              (material) =>
                !graph.nodes.some(
                  (node) => node.id === material.clientMaterialId,
                ),
            )
            .map((material, index) => ({
              type: "add_node",
              node: {
                id:
                  material.clientMaterialId ??
                  `material-${body.mutationId}-${index}`,
                kind: "asset",
                type: material.materialType,
                title: material.title,
                payload: material.payload,
                x: material.position?.x ?? 0,
                y: material.position?.y ?? 0,
              },
            }));
        if (
          body.type === "run_tool" &&
          !graph.nodes.some((node) => node.id === nodeId)
        )
          operations = [
            {
              type: "add_node",
              node: {
                id: nodeId,
                kind: "tool",
                type: body.toolKey,
                title: body.title,
                payload: {
                  toolKey: body.toolKey,
                  toolVersion: "1",
                  params: body.parameters,
                },
                x: 740,
                y: 100,
              },
            },
            ...body.inputs.map((input, index): WorkflowOperation => ({
              type: "add_edge",
              edge: {
                id: `${nodeId}-input-${index}`,
                sourceNodeId: input.nodeId,
                targetNodeId: nodeId,
                sourcePort: "out",
                targetPort: input.port,
              },
            })),
          ];
        if (operations.length) {
          const next = await request(base, "PATCH", {
            mode: "semantic",
            baseRevision: graph.revision,
            mutationId: body.mutationId,
            operations,
          });
          graph = {
            ...graph,
            ...next,
            nodes: next.nodes ?? graph.nodes,
            edges: next.edges ?? graph.edges,
          };
        }
        if (
          (body.type === "run_tool" || body.type === "execute_tool") &&
          !["completed", "running"].includes(
            graph.nodes.find((node) => node.id === nodeId)?.status ?? "",
          )
        )
          graph = await request(`${base}/nodes/${nodeId}/execute`, "POST", {
            mutationId: body.mutationId,
            conversationId: body.conversationId,
          });
        return {
          status: 200,
          json: {
            nodeId,
            graph,
            canvas: {
              projectId: graph.projectId,
              mode: "node",
              revision: 0,
              formatVersion: 1,
              snapshot: {},
              bindings: [],
              initializedFrom: "workflow",
              canEdit: true,
            },
          },
        };
      } catch (error) {
        return error && typeof error === "object" && "status" in error
          ? (error as { status: number; json: unknown })
          : { status: 503, json: { message: "模拟响应丢失，请重试原操作" } };
      }
    },
    { body, base },
  );
  await route.fulfill({ status: result.status, json: result.json });
}

/** Existing graph-editor regressions explicitly exercise the supported rollback mode.
 * New canvas behavior is exercised by canvas-workspace.spec.ts and real-e2e.
 */
export async function seedNodeInteraction(page: Page) {
  await page.route("**/api/projects/*/canvas/commands", (route) =>
    canvasCommandFixture(page, route),
  );
  await page.route("**/api/projects/*/canvas/initialize", (route) => {
    const projectId = new URL(route.request().url()).pathname.split("/").at(-3);
    return route.fulfill({
      json: {
        projectId,
        revision: 0,
        formatVersion: 1,
        snapshot: {},
        bindings: [],
        initializedFrom: "workflow",
        mode: "node",
        canEdit: true,
      },
    });
  });
}
