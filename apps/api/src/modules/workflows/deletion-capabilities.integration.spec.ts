import { prisma } from "@fashion/db";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { WorkflowsService } from "./workflows.service";

it("删除能力与服务端执行冻结及归档规则一致", async () => {
  const user = await prisma.user.create({ data: { email: `delete-capability-${randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Capabilities", projects: { create: { name: "Deletion" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("测试项目缺失");
  const workflows = new WorkflowsService(prisma);
  const assetId = randomUUID(), toolId = randomUUID();
  try {
    let graph = await workflows.patch(user.id, projectId, { mode: "semantic", baseRevision: 0, mutationId: randomUUID(), operations: [
      { type: "add_node", node: { id: assetId, kind: "asset", type: "brief", title: "需求", payload: { text: "通勤风衣" }, x: 0, y: 0 } },
      { type: "add_node", node: { id: toolId, kind: "tool", type: "analyze_brief", title: "分析", payload: { toolKey: "analyze_brief", toolVersion: "1", params: { prompt: "分析需求" } }, x: 300, y: 0 } },
      { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: assetId, targetNodeId: toolId, sourcePort: "out", targetPort: "goal" } },
    ] });
    expect(graph.nodes.every((node) => node.canDelete)).toBe(true);
    graph = await workflows.applySystemMutation(projectId, { mode: "semantic", baseRevision: graph.revision, mutationId: randomUUID(), operations: [{ type: "update_node", nodeId: toolId, status: "running" }] });
    expect(graph.nodes.find((node) => node.id === toolId)).toMatchObject({ canDelete: false });
    expect(graph.nodes.find((node) => node.id === assetId)).toMatchObject({ canDelete: false, deleteDisabledReason: "该素材已被执行工具引用，需要保留历史路径" });
    await expect(workflows.patch(user.id, projectId, { mode: "semantic", baseRevision: graph.revision, mutationId: randomUUID(), operations: [{ type: "remove_node", nodeId: assetId }] })).rejects.toThrow("已被执行工具使用的素材不能删除");
    await prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    expect((await workflows.get(user.id, projectId)).nodes.every((node) => node.canDelete === false)).toBe(true);
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
});
