import { ensureWorkflowNodeVersions, prisma } from "@fashion/db";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

it("returns one current version after ten thousand historical versions", async () => {
  const user = await prisma.user.create({ data: { email: `versions-${randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Version query", projects: { create: { name: "History" } } } } },
    include: { ownedWorkspaces: { include: { projects: true } } } });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("Missing test project");
  const nodeId = randomUUID();
  try {
    await prisma.workflowGraph.create({ data: { projectId, nodes: { create: { id: nodeId, kind: "asset", type: "brief", title: "Current", payload: { text: "Current design" }, x: 0, y: 0 } } } });
    for (let batch = 0; batch < 20; batch++) await prisma.workflowNodeVersion.createMany({ data: Array.from({ length: 500 }, (_, index) => ({
      projectId, nodeId, version: batch * 500 + index + 1, graphRevision: batch * 500 + index, kind: "asset", type: "brief", title: "History", payload: { text: "Historical design" }, inputBindings: [], origin: "user",
    })) });
    const versions = await prisma.$transaction((tx) => ensureWorkflowNodeVersions(tx, projectId, 10000));
    expect(versions.size).toBe(1);
    expect(versions.get(nodeId)?.version).toBe(10000);
    expect(await prisma.workflowNodeVersion.count({ where: { projectId } })).toBe(10000);
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
});
