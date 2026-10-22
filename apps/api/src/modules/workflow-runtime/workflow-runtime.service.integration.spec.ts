import { prisma, type Prisma } from "@fashion/db";
import { describe, expect, it, vi } from "vitest";

import { WorkflowsService } from "../workflows/workflows.service";
import { projectCandidateEvaluationContext, WorkflowRuntimeService } from "./workflow-runtime.service";
import { DesignAssetsService } from "../design-assets/design-assets.service";
import { DesignContextService } from "../design-context/design-context.service";
import { WorkflowCoordinator } from "./workflow-coordinator";

const workflows = new WorkflowsService(prisma);
const visual = { enrich: async () => ({ index: [], images: [], imageBindings: [], coverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [], unreadNodeIds: [] } }) };

describe("WorkflowRuntimeService integration", () => {
  it("评价认知保留同分支真实历史和偏好，排除兄弟候选和全局目标", () => {
    const nodes = [
      { id: "constraint", type: "constraint", payload: {} },
      { id: "tool-a", type: "generate_design", payload: {} },
      { id: "tool-b", type: "generate_design", payload: {} },
      { id: "a", type: "candidate", payload: { assetId: "asset-a" } },
      { id: "b", type: "candidate", payload: { assetId: "asset-b" } },
    ];
    const built = { graph: { nodes, edges: [
      { sourceNodeId: "constraint", targetNodeId: "tool-a" }, { sourceNodeId: "tool-a", targetNodeId: "a" },
      { sourceNodeId: "constraint", targetNodeId: "tool-b" }, { sourceNodeId: "tool-b", targetNodeId: "b" },
    ] }, context: { graphRevision: 9, contextRevision: 2, currentObjective: "其他项目目标不能成为检查条件",
      attempts: [{ id: "attempt-a", toolNodeId: "tool-a" }, { id: "attempt-b", toolNodeId: "tool-b" }],
      decisions: [{ id: "decision-a", assetId: "asset-a", reason: "袖子太宽" }, { id: "decision-b", assetId: "asset-b" }],
      preferences: [
        { id: "pref-a", status: "active", scope: "branch", branchNodeIds: ["a"] },
        { id: "pref-b", status: "active", scope: "branch", branchNodeIds: ["b"] },
        { id: "project", status: "active", scope: "project", branchNodeIds: [] },
        { id: "disabled", status: "inactive", scope: "branch", branchNodeIds: ["a"] },
      ], coverage: { attempts: {}, decisions: {}, memory: {} },
    } } as unknown as Parameters<typeof projectCandidateEvaluationContext>[0];
    const projected = projectCandidateEvaluationContext(built, nodes[3] as Parameters<typeof projectCandidateEvaluationContext>[1], nodes[0] as Parameters<typeof projectCandidateEvaluationContext>[2]);
    expect(projected).toMatchObject({ graphRevision: 9, contextRevision: 2, candidateNodeId: "a", constraintNodeId: "constraint" });
    expect(projected.history.map((entry) => entry.id)).toEqual(["attempt-a"]);
    expect(projected.decisions.map((entry) => entry.id)).toEqual(["decision-a"]);
    expect(projected.preferences.map((entry) => entry.id)).toEqual(["pref-a"]);
    expect(projected).not.toHaveProperty("currentObjective");
  });
  it("reads historical multiple-source inputs but rejects execution before creating an attempt", async () => {
    const user = await prisma.user.create({ data: { email: `workflow-historical-${crypto.randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Historical inputs", projects: { create: { name: "Historical graph" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("test project missing");
    const a = crypto.randomUUID(), b = crypto.randomUUID(), tool = crypto.randomUUID();
    const runtime = new WorkflowRuntimeService(prisma, workflows, {} as never, {} as never, {} as never, {} as never);
    try {
      await workflows.applySystemMutation(project.id, { mode: "semantic", baseRevision: 0, mutationId: crypto.randomUUID(), operations: [
        { type: "add_node", node: { id: a, kind: "asset", type: "candidate", title: "A", payload: {}, x: 0, y: 0 } },
        { type: "add_node", node: { id: b, kind: "asset", type: "candidate", title: "B", payload: {}, x: 0, y: 300 } },
        { type: "add_node", node: { id: tool, kind: "tool", type: "generate_design", title: "旧工具", payload: { toolKey: "generate_design", toolVersion: "1", params: {} }, x: 400, y: 0 } },
        ...[a, b].map((id) => ({ type: "add_edge" as const, edge: { id: crypto.randomUUID(), sourceNodeId: id, targetNodeId: tool, sourcePort: "out" as const, targetPort: "source" as const } })),
      ] });
      expect((await workflows.get(user.id, project.id)).edges).toHaveLength(2);
      await expect(runtime.execute(user.id, project.id, tool, { mutationId: crypto.randomUUID() })).rejects.toThrow("整理连接");
      expect(await prisma.workflowAttempt.count({ where: { projectId: project.id } })).toBe(0);
      expect((await workflows.get(user.id, project.id)).nodes.find((node) => node.id === tool)?.status).toBe("ready");
    } finally { await prisma.user.delete({ where: { id: user.id } }); }
  });
  it("uses referenced tools as context and keeps candidate constraints on their own branch", async () => {
    const user = await prisma.user.create({
      data: {
        email: `workflow-proposal-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: { create: { name: "Proposal branches", projects: { create: { name: "Two design branches" } } } },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("test project missing");
    const constraintA = crypto.randomUUID();
    const constraintB = crypto.randomUUID();
    const generatorA = crypto.randomUUID();
    const generatorB = crypto.randomUUID();
    const candidateA = crypto.randomUUID();
    const candidateB = crypto.randomUUID();
    const model = { generateJson: vi.fn(async (request: { prompt: string; parse: (value: unknown) => unknown }) => {
      const input = JSON.parse(request.prompt);
      const cases: Record<string, { tool: string; inputs: { nodeId: string; port: string }[] }> = {
        "请评估这个生成节点的候选": { tool: "evaluate_design", inputs: [{ nodeId: candidateA, port: "candidate" }, { nodeId: constraintA, port: "constraint" }] },
        "请修改这件通勤风衣的袖口": { tool: "edit_design", inputs: [{ nodeId: candidateA, port: "source" }, { nodeId: constraintA, port: "constraint" }] },
        "请按通勤约束比较两个候选": { tool: "evaluate_design", inputs: [{ nodeId: candidateA, port: "candidate" }, { nodeId: candidateB, port: "candidate" }, { nodeId: constraintA, port: "constraint" }] },
        "请按运动约束修改这件通勤风衣": { tool: "edit_design", inputs: [{ nodeId: candidateA, port: "source" }, { nodeId: constraintB, port: "constraint" }] },
      };
      const selected = cases[input.request];
      return request.parse({ kind: selected ? "propose" : "clarify", message: selected ? "已按明确分支准备建议" : "请选择实际候选和本次比较约束", preferences: [], objectiveUpdate: null,
        plan: selected ? { ...selected, title: "下一步建议", prompt: "按指定分支继续设计", rationale: "遵循已引用的设计路径", newObjective: null } : null });
    }) };
    const contexts = new DesignContextService(prisma, workflows);
    const coordinator = new WorkflowCoordinator(prisma, workflows, contexts, visual as never, model as never);
    const runtime = new WorkflowRuntimeService(prisma, workflows, {} as never, model as never, {} as never, {} as never, contexts, coordinator);
    const proposedEdges = (proposal: Awaited<ReturnType<typeof runtime.propose>>) =>
      (proposal.operations as Array<{ type: string; edge?: { sourceNodeId: string; targetPort: string } }>)
        .filter((operation) => operation.type === "add_edge")
        .map((operation) => operation.edge);

    try {
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0,
        operations: [
          { type: "add_node", node: { id: constraintA, kind: "asset", type: "constraint", title: "通勤约束", payload: { text: "利落肩线" }, x: 100, y: 100 } },
          { type: "add_node", node: { id: constraintB, kind: "asset", type: "constraint", title: "运动约束", payload: { text: "宽松肩线" }, x: 100, y: 600 } },
          { type: "add_node", node: { id: generatorA, kind: "tool", type: "generate_design", title: "生成通勤方案", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "生成通勤风衣" } }, x: 430, y: 100 } },
          { type: "add_node", node: { id: generatorB, kind: "tool", type: "generate_design", title: "生成运动方案", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "生成运动风衣" } }, x: 430, y: 600 } },
          { type: "add_node", node: { id: candidateA, kind: "asset", type: "candidate", title: "通勤候选", payload: { text: "候选 A" }, x: 760, y: 100 } },
          { type: "add_node", node: { id: candidateB, kind: "asset", type: "candidate", title: "运动候选", payload: { text: "候选 B" }, x: 760, y: 600 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraintA, targetNodeId: generatorA, sourcePort: "out", targetPort: "constraint" } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: generatorA, targetNodeId: candidateA, sourcePort: "out", targetPort: "source" } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraintB, targetNodeId: generatorB, sourcePort: "out", targetPort: "constraint" } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: generatorB, targetNodeId: candidateB, sourcePort: "out", targetPort: "source" } },
        ],
      });

      const toolReferenced = await runtime.propose(user.id, project.id, {
        content: "请评估这个生成节点的候选", referencedNodeIds: [generatorA], mutationId: crypto.randomUUID(),
      });
      expect(proposedEdges(toolReferenced)).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceNodeId: candidateA, targetPort: "candidate" }),
        expect.objectContaining({ sourceNodeId: constraintA, targetPort: "constraint" }),
      ]));
      expect(proposedEdges(toolReferenced).some((edge) => edge?.sourceNodeId === generatorA)).toBe(false);
      expect(JSON.parse(model.generateJson.mock.calls[0]?.[0].prompt ?? "{}")).toMatchObject({
        context: expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ id: generatorA, type: "generate_design" })]) }),
      });

      await expect(runtime.propose(user.id, project.id, {
        content: "请评估这个约束节点", referencedNodeIds: [constraintA], mutationId: crypto.randomUUID(),
      })).rejects.toMatchObject({ status: 400 });

      const editA = await runtime.propose(user.id, project.id, {
        content: "请修改这件通勤风衣的袖口", referencedNodeIds: [candidateA], mutationId: crypto.randomUUID(),
      });
      expect(proposedEdges(editA)).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceNodeId: candidateA, targetPort: "source" }),
        expect.objectContaining({ sourceNodeId: constraintA, targetPort: "constraint" }),
      ]));
      expect(proposedEdges(editA).some((edge) => edge?.sourceNodeId === constraintB)).toBe(false);
      const proposedEditTool = (editA.operations as Array<{ type: string; node?: { type: string; x: number; y: number } }>).find((operation) => operation.node?.type === "edit_design")?.node;
      expect(proposedEditTool?.x).toBeGreaterThan(0);
      expect(proposedEditTool?.y).toBeGreaterThanOrEqual(0);
      expect((await workflows.get(user.id, project.id)).nodes.find((node) => node.id === generatorB)).toMatchObject({ x: 430, y: 600 });

      await expect(runtime.propose(user.id, project.id, {
        content: "请比较两个分支的候选", referencedNodeIds: [candidateA, candidateB], mutationId: crypto.randomUUID(),
      })).rejects.toMatchObject({ status: 400 });

      const explicitConstraint = await runtime.propose(user.id, project.id, {
        content: "请按通勤约束比较两个候选", referencedNodeIds: [candidateA, candidateB, constraintA], mutationId: crypto.randomUUID(),
      });
      expect(proposedEdges(explicitConstraint)).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceNodeId: candidateA, targetPort: "candidate" }),
        expect.objectContaining({ sourceNodeId: candidateB, targetPort: "candidate" }),
        expect.objectContaining({ sourceNodeId: constraintA, targetPort: "constraint" }),
      ]));

      const overrideConstraint = await runtime.propose(user.id, project.id, {
        content: "请按运动约束修改这件通勤风衣", referencedNodeIds: [candidateA, constraintB], mutationId: crypto.randomUUID(),
      });
      expect(proposedEdges(overrideConstraint)).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceNodeId: candidateA, targetPort: "source" }),
        expect.objectContaining({ sourceNodeId: constraintB, targetPort: "constraint" }),
      ]));
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("infers uploaded reference roles once and preserves a designer override during classification", async () => {
    const user = await prisma.user.create({
      data: {
        email: `workflow-role-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: { create: { name: "Role inference", projects: { create: { name: "Role workflow" } } } },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("test project missing");
    const file = await prisma.fileAsset.create({ data: {
      ownerId: user.id, originalName: "reference.png", mimeType: "image/png", sizeBytes: 12,
      sha256: crypto.randomUUID(), objectKey: `workflow-role/${crypto.randomUUID()}.png`,
      thumbnail1024Key: `workflow-role/${crypto.randomUUID()}.webp`, status: "READY",
    } });
    const imageId = crypto.randomUUID();
    const sketchId = crypto.randomUUID();
    let releaseModel: (() => void) | undefined;
    const modelGate = new Promise<void>((resolve) => { releaseModel = resolve; });
    const model = { generateJson: vi.fn(async (request: { parse: (value: unknown) => unknown }) => {
      await modelGate;
      return request.parse({ label: "garment_detail", confidence: 0.91, isFashion: true });
    }) };
    const storage = { readPrefix: vi.fn(async () => Buffer.from("thumbnail-image")) };
    const runtime = new WorkflowRuntimeService(prisma, workflows, {} as never, model as never, storage as never, {} as never);

    try {
      await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0, operations: [
        { type: "add_node", node: { id: imageId, kind: "asset", type: "reference_image", title: "参考图", payload: { fileAssetId: file.id, role: "style_ref", roleSource: "default", roleInferenceState: "pending" }, x: 100, y: 100 } },
        { type: "add_node", node: { id: sketchId, kind: "asset", type: "sketch", title: "草图", payload: { fileAssetId: file.id, role: "silhouette_ref", roleSource: "default" }, x: 100, y: 500 } },
      ] });

      const mutationId = crypto.randomUUID();
      const first = runtime.inferRole(user.id, project.id, imageId, { mutationId });
      await vi.waitFor(() => expect(model.generateJson).toHaveBeenCalledTimes(1));
      const duplicate = await runtime.inferRole(user.id, project.id, imageId, { mutationId });
      const concurrent = await runtime.inferRole(user.id, project.id, imageId, { mutationId: crypto.randomUUID() });
      expect((duplicate.nodes.find((node) => node.id === imageId)?.payload as { roleInferenceState?: string } | undefined)?.roleInferenceState).toBe("pending");
      expect((concurrent.nodes.find((node) => node.id === imageId)?.payload as { roleInferenceState?: string } | undefined)?.roleInferenceState).toBe("pending");
      expect(model.generateJson).toHaveBeenCalledTimes(1);
      expect((await runtime.sync(user.id, project.id)).proposals).toHaveLength(0);

      let graph = await workflows.get(user.id, project.id);
      await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision, operations: [
        { type: "update_node", nodeId: imageId, payload: { fileAssetId: file.id, role: "palette_ref", roleSource: "manual", roleInferenceState: "ready" } },
      ] });
      releaseModel?.();
      graph = await first;
      expect(graph.nodes.find((node) => node.id === imageId)?.payload).toMatchObject({ role: "palette_ref", roleSource: "manual" });
      await runtime.inferRole(user.id, project.id, imageId, { mutationId });
      expect(model.generateJson).toHaveBeenCalledTimes(1);

      const sketchMutationId = crypto.randomUUID();
      graph = await runtime.inferRole(user.id, project.id, sketchId, { mutationId: sketchMutationId });
      expect(graph.nodes.find((node) => node.id === sketchId)?.payload).toMatchObject({
        role: "detail_ref", roleSource: "inferred", roleLabel: "garment_detail", roleConfidence: 0.91, roleInferenceState: "ready",
      });
      await runtime.inferRole(user.id, project.id, sketchId, { mutationId: crypto.randomUUID() });
      await expect(runtime.inferRole(user.id, project.id, imageId, { mutationId: sketchMutationId })).rejects.toMatchObject({ status: 409 });
      await expect(runtime.inferRole(user.id, project.id, sketchId, { mutationId })).rejects.toMatchObject({ status: 409 });
      expect(model.generateJson).toHaveBeenCalledTimes(2);
      expect(storage.readPrefix).toHaveBeenCalledTimes(2);

      const emptyId = crypto.randomUUID();
      const oversizedId = crypto.randomUUID();
      graph = await workflows.get(user.id, project.id);
      await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision, operations: [
        { type: "add_node", node: { id: emptyId, kind: "asset", type: "reference_image", title: "空缩略图", payload: { fileAssetId: file.id }, x: 100, y: 700 } },
        { type: "add_node", node: { id: oversizedId, kind: "asset", type: "reference_image", title: "超限缩略图", payload: { fileAssetId: file.id }, x: 100, y: 900 } },
      ] });
      storage.readPrefix.mockResolvedValueOnce(Buffer.alloc(0)).mockResolvedValueOnce(Buffer.alloc(8 * 1024 * 1024 + 1));
      await expect(runtime.inferRole(user.id, project.id, emptyId, { mutationId: crypto.randomUUID() })).rejects.toMatchObject({ status: 400 });
      await expect(runtime.inferRole(user.id, project.id, oversizedId, { mutationId: crypto.randomUUID() })).rejects.toMatchObject({ status: 400 });
      expect(model.generateJson).toHaveBeenCalledTimes(2);
    } finally {
      releaseModel?.();
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("discards an expired classifier response after a newer inference completes", async () => {
    const user = await prisma.user.create({
      data: {
        email: `workflow-role-lease-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: { create: { name: "Role lease", projects: { create: { name: "Role lease workflow" } } } },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("test project missing");
    const file = await prisma.fileAsset.create({ data: {
      ownerId: user.id, originalName: "reference.png", mimeType: "image/png", sizeBytes: 12,
      sha256: crypto.randomUUID(), objectKey: `workflow-role/${crypto.randomUUID()}.png`,
      thumbnail1024Key: `workflow-role/${crypto.randomUUID()}.webp`, status: "READY",
    } });
    const nodeId = crypto.randomUUID();
    let releaseOld: () => void = () => undefined;
    let releaseNew: () => void = () => undefined;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const newGate = new Promise<void>((resolve) => { releaseNew = resolve; });
    let callCount = 0;
    const model = { generateJson: vi.fn(async (request: { parse: (value: unknown) => unknown }) => {
      const call = ++callCount;
      await (call === 1 ? oldGate : newGate);
      return request.parse({ label: call === 1 ? "garment_detail" : "color_palette", confidence: 0.92, isFashion: true });
    }) };
    const storage = { readPrefix: vi.fn(async () => Buffer.from("thumbnail-image")) };
    const runtime = new WorkflowRuntimeService(prisma, workflows, {} as never, model as never, storage as never, {} as never);

    try {
      await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0, operations: [
        { type: "add_node", node: { id: nodeId, kind: "asset", type: "reference_image", title: "参考图", payload: { fileAssetId: file.id, role: "style_ref", roleSource: "default", roleInferenceState: "pending" }, x: 100, y: 100 } },
      ] });
      const oldMutationId = crypto.randomUUID();
      const oldResponse = runtime.inferRole(user.id, project.id, nodeId, { mutationId: oldMutationId });
      await vi.waitFor(() => expect(model.generateJson).toHaveBeenCalledTimes(1));
      await prisma.workflowProposal.update({
        where: { projectId_mutationId: { projectId: project.id, mutationId: oldMutationId } },
        data: { updatedAt: new Date(Date.now() - 16 * 60_000) },
      });
      const newResponse = runtime.inferRole(user.id, project.id, nodeId, { mutationId: crypto.randomUUID() });
      await vi.waitFor(() => expect(model.generateJson).toHaveBeenCalledTimes(2));
      releaseNew();
      const newerGraph = await newResponse;
      expect(newerGraph.nodes.find((node) => node.id === nodeId)?.payload).toMatchObject({ role: "palette_ref", roleLabel: "color_palette" });
      releaseOld();
      const oldGraph = await oldResponse;
      expect(oldGraph.nodes.find((node) => node.id === nodeId)?.payload).toMatchObject({ role: "palette_ref", roleLabel: "color_palette" });
      expect((await prisma.workflowProposal.findUniqueOrThrow({ where: { projectId_mutationId: { projectId: project.id, mutationId: oldMutationId } } })).status).toBe("superseded");
      expect(model.generateJson).toHaveBeenCalledTimes(2);
    } finally {
      releaseOld();
      releaseNew();
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it.each(["i2i", "inpaint"] as const)("edits an uploaded reference directly with %s and preserves its imported lineage", async (taskType) => {
    const user = await prisma.user.create({
      data: { email: `workflow-upload-edit-${crypto.randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Upload edits", projects: { create: { name: "Direct editing" } } } } },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("test project missing");
    const file = await prisma.fileAsset.create({ data: {
      ownerId: user.id, originalName: "garment.png", mimeType: "image/png", sizeBytes: 12,
      sha256: crypto.randomUUID(), objectKey: `workflow-upload-edit/${crypto.randomUUID()}.png`, status: "READY", width: 768, height: 1024,
    } });
    const mask = await prisma.fileAsset.create({ data: {
      ownerId: user.id, originalName: "mask.png", mimeType: "image/png", sizeBytes: 12,
      sha256: crypto.randomUUID(), objectKey: `workflow-upload-mask/${crypto.randomUUID()}.png`, status: "READY",
    } });
    const imageId = crypto.randomUUID();
    const referenceId = crypto.randomUUID();
    const toolIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
    const createFromAgent = vi.fn(async (_userId: string, request: { projectId: string; taskType: string; parentAssetId?: string }) => {
      const task = await prisma.generationTask.create({ data: {
        userId: user.id, projectId: request.projectId, taskType: request.taskType, parentAssetId: request.parentAssetId ?? null,
        input: { prompt: "只收窄袖口" }, status: "QUEUED",
      } });
      return { taskId: task.id };
    });
    const generation = { createFromAgent, get: vi.fn(async (_userId: string, taskId: string) => {
      const task = await prisma.generationTask.findUniqueOrThrow({ where: { id: taskId } });
      return { id: task.id, status: task.status.toLowerCase(), output: task.output, error: null };
    }) };
    const storage = { createDownloadUrl: vi.fn(async (key: string) => `https://storage.example.test/${key}`) };
    const assets = new DesignAssetsService(prisma, storage as never);
    const runtime = new WorkflowRuntimeService(prisma, workflows, generation as never, {} as never, storage as never, assets);
    try {
      await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0, operations: [
        { type: "add_node", node: { id: imageId, kind: "asset", type: "reference_image", title: "上传服装", payload: { fileAssetId: file.id }, x: 0, y: 0 } },
        { type: "add_node", node: { id: referenceId, kind: "asset", type: "reference_image", title: "袖口参考", payload: { fileAssetId: mask.id, role: "detail_ref" }, x: 0, y: 350 } },
        ...toolIds.flatMap((id, index) => [
          { type: "add_node" as const, node: { id, kind: "tool" as const, type: "edit_design" as const, title: "直接修改上传图片", payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: "只收窄袖口", taskType, ...(taskType === "inpaint" ? { mask: { fileAssetId: mask.id } } : {}) } }, x: 400, y: index * 350 } },
          { type: "add_edge" as const, edge: { id: crypto.randomUUID(), sourceNodeId: imageId, targetNodeId: id, sourcePort: "out" as const, targetPort: "source" as const } },
          ...(taskType === "i2i" ? [{ type: "add_edge" as const, edge: { id: crypto.randomUUID(), sourceNodeId: referenceId, targetNodeId: id, sourcePort: "out" as const, targetPort: "reference" as const } }] : []),
        ]),
      ] });
      for (const toolId of toolIds) {
        const mutationId = crypto.randomUUID();
        await runtime.execute(user.id, project.id, toolId, { mutationId });
        await runtime.execute(user.id, project.id, toolId, { mutationId });
      }
      const imported = await prisma.designAsset.findUniqueOrThrow({ where: { projectId_sourceFileId: { projectId: project.id, sourceFileId: file.id } }, include: { designStep: true } });
      expect(imported).toMatchObject({ operation: "IMPORTED", rootAssetId: imported.id });
      expect(imported.designStep?.inputSnapshot).toMatchObject({ sources: [expect.objectContaining({ fileAssetId: file.id, role: "import_source" })] });
      expect(await prisma.designAsset.count({ where: { projectId: project.id, sourceFileId: file.id } })).toBe(1);
      expect(createFromAgent).toHaveBeenCalledTimes(2);
      for (const [, request] of createFromAgent.mock.calls) {
        expect(request).toMatchObject({ taskType, parentAssetId: imported.id, referenceImageUrl: `s3://${file.objectKey}` });
        if (taskType === "inpaint") expect(request).toHaveProperty("maskImageUrl", `https://storage.example.test/${mask.objectKey}`);
        else expect(request).toHaveProperty("referenceImages", [{ order: 0, role: "detail_ref", url: `https://storage.example.test/${mask.objectKey}`, weight: 0.7 }]);
      }
      const attempt = await prisma.workflowAttempt.findFirstOrThrow({ where: { toolNodeId: toolIds[0] } });
      expect(attempt.requestSnapshot).toMatchObject({ request: { parentAssetId: imported.id }, inputSnapshot: expect.arrayContaining([
        expect.objectContaining({ id: imageId, type: "reference_image", payload: { fileAssetId: file.id } }),
      ]) });
      if (!attempt.generationTaskId) throw new Error("generation task missing");
      const output = await prisma.designAsset.create({ data: {
        projectId: project.id, generationTaskId: attempt.generationTaskId, parentAssetId: imported.id, rootAssetId: imported.id,
        operation: taskType === "inpaint" ? "INPAINT" : "VARIATION", url: "s3://workflow-upload-edit/output.png", width: 768, height: 1024,
      } });
      await prisma.generationTask.update({ where: { id: attempt.generationTaskId }, data: { status: "SUCCEEDED", output: { images: [{ assetId: output.id }] } } });
      const synced = await runtime.sync(user.id, project.id);
      expect(synced.nodes).toContainEqual(expect.objectContaining({ type: "candidate", payload: expect.objectContaining({ assetId: output.id }) }));
      const path = await assets.path(user.id, output.id);
      expect(path.steps.flatMap((step) => step.sources)).toContainEqual(expect.objectContaining({ fileAssetId: file.id, role: "source" }));
      expect((await assets.versions(user.id, output.id, undefined, 20)).items.map((asset) => asset.id)).toEqual(expect.arrayContaining([imported.id, output.id]));
      expect((await workflows.get(user.id, project.id)).nodes.find((node) => node.id === imageId)).toMatchObject({ type: "reference_image", payload: { fileAssetId: file.id } });
    } finally { await prisma.user.delete({ where: { id: user.id } }); }
  });

  it.each(["missing", "processing", "not-image", "foreign"])("rejects an uploaded mother that is %s before creating a task", async (invalid) => {
    const user = await prisma.user.create({
      data: { email: `workflow-invalid-upload-${crypto.randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Invalid uploads", projects: { create: { name: "Upload checks" } } } } },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("test project missing");
    const foreign = invalid === "foreign" ? await prisma.user.create({ data: { email: `workflow-other-${crypto.randomUUID()}@example.com` } }) : null;
    const file = await prisma.fileAsset.create({ data: {
      ownerId: user.id, originalName: "garment.png", mimeType: "image/png", sizeBytes: 12,
      sha256: crypto.randomUUID(), objectKey: `workflow-invalid-upload/${crypto.randomUUID()}.png`, status: "READY",
    } });
    const imageId = crypto.randomUUID(), toolId = crypto.randomUUID();
    const createFromAgent = vi.fn();
    const runtime = new WorkflowRuntimeService(prisma, workflows, { createFromAgent } as never, {} as never, {} as never, new DesignAssetsService(prisma, {} as never));
    try {
      await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0, operations: [
        { type: "add_node", node: { id: imageId, kind: "asset", type: "reference_image", title: "上传服装", payload: { fileAssetId: file.id }, x: 0, y: 0 } },
        { type: "add_node", node: { id: toolId, kind: "tool", type: "edit_design", title: "修改上传图片", payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: "收窄袖口" } }, x: 400, y: 0 } },
        { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: imageId, targetNodeId: toolId, sourcePort: "out", targetPort: "source" } },
      ] });
      if (invalid === "missing") await prisma.fileAsset.delete({ where: { id: file.id } });
      else await prisma.fileAsset.update({ where: { id: file.id }, data: {
        ownerId: foreign?.id ?? user.id, status: invalid === "processing" ? "PROCESSING" : "READY",
        mimeType: invalid === "not-image" ? "text/plain" : "image/png",
      } });
      const expectedStatus = invalid === "missing" ? 404 : invalid === "foreign" ? 403 : 400;
      await expect(runtime.execute(user.id, project.id, toolId, { mutationId: crypto.randomUUID() })).rejects.toMatchObject({ status: expectedStatus });
      expect(createFromAgent).not.toHaveBeenCalled();
      expect(await prisma.workflowAttempt.count({ where: { projectId: project.id } })).toBe(0);
      expect(await prisma.designAsset.count({ where: { projectId: project.id } })).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
      if (foreign) await prisma.user.delete({ where: { id: foreign.id } });
    }
  });

  it("uses selected image roles and library summaries in the actual generation request", async () => {
    const user = await prisma.user.create({
      data: {
        email: `workflow-reference-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: { create: { name: "Generation references", projects: { create: { name: "Reference workflow" } } } },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("test project missing");
    const file = await prisma.fileAsset.create({ data: {
      ownerId: user.id, originalName: "reference.png", mimeType: "image/png", sizeBytes: 12,
      sha256: crypto.randomUUID(), objectKey: `workflow-reference/${crypto.randomUUID()}.png`, status: "READY",
    } });
    const fabric = await prisma.fabric.create({ data: { scope: "USER", ownerId: user.id, mainFileId: file.id, tags: ["wool", "commuter"] } });
    const trend = await prisma.trendItem.create({ data: {
      title: "都市通勤", summary: "低饱和都市通勤配色", platform: "test",
      sourceUrl: `https://example.test/trends/${crypto.randomUUID()}`, publishedAt: new Date(),
      category: "outerwear", coverFileId: file.id,
    } });
    const imageId = crypto.randomUUID();
    const trendId = crypto.randomUUID();
    const fabricId = crypto.randomUUID();
    const toolId = crypto.randomUUID();
    const obstacleId = crypto.randomUUID();
    const createFromAgent = vi.fn(async (_userId: string, request: { projectId: string; prompt: string }) => {
      const task = await prisma.generationTask.create({ data: {
        userId: user.id, projectId: request.projectId, taskType: "t2i",
        input: { prompt: request.prompt }, status: "QUEUED",
      } });
      return { taskId: task.id };
    });
    const generation = { createFromAgent, get: vi.fn(async (_userId: string, taskId: string) => {
      const task = await prisma.generationTask.findUniqueOrThrow({ where: { id: taskId } });
      return { id: task.id, status: task.status.toLowerCase(), output: task.output, error: null };
    }) };
    const storage = { createDownloadUrl: vi.fn(async (key: string) => `https://storage.example.test/${key}`) };
    const runtime = new WorkflowRuntimeService(prisma, workflows, generation as never, {} as never, storage as never, {} as never);

    try {
      await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0, operations: [
        { type: "add_node", node: { id: imageId, kind: "asset", type: "reference_image", title: "袖口细节参考", payload: { fileAssetId: file.id, role: "detail_ref", roleSource: "manual", roleInferenceState: "ready" }, x: 100, y: 100 } },
        { type: "add_node", node: { id: trendId, kind: "asset", type: "trend", title: trend.title, payload: { trendItemId: trend.id, text: trend.summary }, x: 100, y: 350 } },
        { type: "add_node", node: { id: fabricId, kind: "asset", type: "fabric", title: "羊毛混纺", payload: { fabricId: fabric.id, text: "羊毛混纺保暖面料" }, x: 100, y: 600 } },
        { type: "add_node", node: { id: toolId, kind: "tool", type: "generate_design", title: "生成风衣", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "生成秋冬通勤风衣", count: 1 } }, x: 500, y: 350 } },
        { type: "add_node", node: { id: obstacleId, kind: "asset", type: "reference_image", title: "已摆放的参考图", payload: { fileAssetId: file.id }, x: 840, y: 450 } },
        ...[
          { id: imageId, port: "reference" as const },
          { id: trendId, port: "reference" as const },
          { id: fabricId, port: "reference" as const },
        ].map(({ id, port }) => ({ type: "add_edge" as const, edge: { id: crypto.randomUUID(), sourceNodeId: id, targetNodeId: toolId, sourcePort: "out" as const, targetPort: port } })),
      ] });

      await runtime.execute(user.id, project.id, toolId, { mutationId: crypto.randomUUID() });
      expect(createFromAgent).toHaveBeenCalledTimes(1);
      const request = createFromAgent.mock.calls[0]?.[1] as { prompt: string; referenceImages: Array<{ role: string }> } | undefined;
      expect(request?.prompt).toContain(trend.summary);
      expect(request?.prompt).toContain("羊毛混纺保暖面料");
      expect(request?.referenceImages.map((reference) => reference.role)).toEqual(["detail_ref", "style_ref", "fabric_texture"]);
      const attempt = await prisma.workflowAttempt.findFirstOrThrow({ where: { projectId: project.id, toolNodeId: toolId } });
      expect((attempt.requestSnapshot as { request: { referenceImages: Array<{ role: string }> } }).request.referenceImages[0]?.role).toBe("detail_ref");
      if (!attempt.generationTaskId) throw new Error("generation task missing");
      const outputIds = [crypto.randomUUID(), crypto.randomUUID()];
      await prisma.designAsset.createMany({ data: outputIds.map((id) => ({
        id, projectId: project.id, generationTaskId: attempt.generationTaskId,
        rootAssetId: id, operation: "GENERATED" as const,
        url: `s3://workflow-layout/${id}.png`, thumbnailUrl: `s3://workflow-layout/${id}.webp`,
        width: 768, height: 1024,
      })) });
      await prisma.generationTask.update({ where: { id: attempt.generationTaskId }, data: {
        status: "SUCCEEDED", output: { images: outputIds.map((assetId) => ({ assetId, width: 768, height: 1024 })) },
      } });
      const projected = await runtime.sync(user.id, project.id);
      const outputs = projected.nodes.filter((node) => projected.edges.some((edge) => edge.sourceNodeId === toolId && edge.targetNodeId === node.id));
      expect(outputs).toHaveLength(2);
      expect(outputs[0]?.x).toBe(840);
      expect(outputs[0]?.y).toBeGreaterThanOrEqual(450 + 300 + 40);
      expect(outputs[1]?.y).toBeGreaterThanOrEqual((outputs[0]?.y ?? 0) + 300 + 40);
      expect(projected.nodes.find((node) => node.id === obstacleId)).toMatchObject({ x: 840, y: 450 });
    } finally {
      await prisma.workflowAttempt.deleteMany({ where: { projectId: project.id } });
      await prisma.trendItem.delete({ where: { id: trend.id } });
      await prisma.fabric.delete({ where: { id: fabric.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("runs analysis, two candidates, evaluation and an edit branch with durable attempts", async () => {
    const user = await prisma.user.create({
      data: {
        email: `workflow-runtime-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: { name: "Workflow runtime", projects: { create: { name: "Autumn coat" } } },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    expect(project).toBeDefined();
    if (!project) return;
    const briefId = crypto.randomUUID();

    const model = {
      generateJson: vi.fn(async (request: { schemaName: string; prompt: string; parse: (value: unknown) => unknown }) => {
        switch (request.schemaName) {
          case "fashion_workflow_collaboration": {
            const input = JSON.parse(request.prompt);
            const nodes = input.context.nodes as { id: string; type: string }[];
            const candidate = nodes.find((node) => node.type === "candidate");
            const constraint = nodes.find((node) => node.type === "constraint");
            return request.parse({ kind: "propose", message: "依据真实画布准备下一步", preferences: [], objectiveUpdate: null,
              plan: { tool: candidate ? "evaluate_design" : "analyze_brief", title: "下一步", prompt: "整理需求与参考", rationale: "依据设计需求提取约束", newObjective: null,
                inputs: candidate && constraint ? [{ nodeId: candidate.id, port: "candidate" }, { nodeId: constraint.id, port: "constraint" }] : [{ nodeId: briefId, port: "goal" }] } });
          }
          case "fashion_design_brief":
            return request.parse({
              summary: "秋冬通勤风衣，保留肩线",
              garmentType: "风衣",
              constraints: [{
                id: "shoulder", dimension: "structure", requirement: "保留肩线",
                mode: "preserve", priority: "must", origin: "explicit", verification: "visual",
                evidenceIds: [briefId], sourceQuote: "保留肩线",
              }],
              unknowns: [],
            });
          case "fashion_design_plan":
            return request.parse({
              steps: [{
                key: "create_coat", tool: "generate_design", title: "生成风衣",
                instruction: "生成符合约束的秋冬通勤风衣", prompt: "秋冬通勤风衣，保留肩线",
                negativePrompt: "", sourceAssetId: null, sourceStepKey: null,
              }],
              rationales: [{ stepKey: "create_coat", goal: "生成候选", constraintIds: ["shoulder"], acceptanceChecks: ["检查肩线"] }],
            });
          case "fashion_design_evaluation":
            return request.parse({
              summary: "肩线可见",
              checks: [{ constraintId: "shoulder", status: "met", observation: "图中肩线可见" }],
              nextActions: ["请设计师确认"],
            });
          default:
            throw new Error(`unexpected model schema ${request.schemaName}`);
        }
      }),
    };
    const createTask = async (
      _userId: string,
      request: { projectId: string; taskType: string; parentAssetId?: string; prompt: string; shapeIds?: readonly string[] },
      executionKey: string,
    ) => {
      const existing = await prisma.workflowAttempt.findUnique({ where: { executionKey } });
      if (existing?.generationTaskId) return { taskId: existing.generationTaskId };
      const assetId = crypto.randomUUID();
      const parent = request.parentAssetId
        ? await prisma.designAsset.findUniqueOrThrow({ where: { id: request.parentAssetId } })
        : null;
      const task = await prisma.generationTask.create({
        data: {
          userId: user.id,
          projectId: request.projectId,
          taskType: request.taskType,
          input: { prompt: request.prompt } as Prisma.InputJsonObject,
          status: "SUCCEEDED",
          output: { job: { model: "amux/image-model-at-run", provider: "amux" }, images: [{ assetId, width: 768, height: 1024 }] },
          ...(parent ? { parentAssetId: parent.id } : {}),
        },
      });
      await prisma.designAsset.create({
        data: {
          id: assetId,
          projectId: request.projectId,
          generationTaskId: task.id,
          rootAssetId: parent?.rootAssetId ?? assetId,
          ...(parent ? { parentAssetId: parent.id } : {}),
          operation: parent ? "INPAINT" : "GENERATED",
          url: `s3://workflow-integration/${assetId}.png`,
          thumbnailUrl: `s3://workflow-integration/${assetId}.webp`,
          width: 768,
          height: 1024,
        },
      });
      return { taskId: task.id };
    };
    // Match GenerationService's idempotency when execution and recovery submit the same key concurrently.
    const tasksByExecutionKey = new Map<string, ReturnType<typeof createTask>>();
    const createFromAgent = vi.fn((...args: Parameters<typeof createTask>) => {
      const existing = tasksByExecutionKey.get(args[2]);
      if (existing) return existing;
      const pending = createTask(...args);
      tasksByExecutionKey.set(args[2], pending);
      return pending;
    });
    const generation = {
      createFromAgent,
      get: vi.fn(async (_userId: string, taskId: string) => {
        const task = await prisma.generationTask.findUniqueOrThrow({ where: { id: taskId } });
        return { id: task.id, status: "succeeded", output: task.output, error: null };
      }),
    };
    const storage = {
      readPrefix: vi.fn(async () => Buffer.from("actual-stored-test-image")),
      createDownloadUrl: vi.fn(async (key: string) => `https://storage.example.test/${key}`),
    };
    const assets = new DesignAssetsService(prisma, storage as never);
    const runtime = new WorkflowRuntimeService(
      prisma,
      workflows,
      generation as never,
      model as never,
      storage as never,
      assets,
      new DesignContextService(prisma, workflows),
      new WorkflowCoordinator(prisma, workflows, new DesignContextService(prisma, workflows), visual as never, model as never),
    );

    try {
      await workflows.patch(user.id, project.id, {
        mode: "semantic",
        mutationId: crypto.randomUUID(),
        baseRevision: 0,
        operations: [{
          type: "add_node",
          node: {
            id: briefId, kind: "asset", type: "brief", title: "设计需求",
            payload: { text: "秋冬通勤风衣，保留肩线" }, x: 40, y: 120,
          },
        }],
      });

      const proposal = await runtime.propose(user.id, project.id, {
        content: "请先分析这款秋冬通勤风衣的需求",
        referencedNodeIds: [briefId],
        mutationId: crypto.randomUUID(),
      });
      const accepted = await runtime.accept(user.id, project.id, proposal.id, {
        baseRevision: proposal.baseRevision,
        mutationId: crypto.randomUUID(),
      });
      const duplicateAccept = await runtime.accept(user.id, project.id, proposal.id, {
        baseRevision: proposal.baseRevision,
        mutationId: crypto.randomUUID(),
      });
      expect(duplicateAccept.nodes.filter((node) => node.type === "analyze_brief")).toHaveLength(1);
      const analysis = accepted.nodes.find((node) => node.type === "analyze_brief");
      expect(analysis).toBeDefined();
      if (!analysis) return;
      await runtime.execute(user.id, project.id, analysis.id, { mutationId: crypto.randomUUID() });
      let graph = await workflows.get(user.id, project.id);
      const constraint = graph.nodes.find((node) => node.type === "constraint");
      expect(constraint).toBeDefined();
      expect(graph.edges.some((edge) => edge.sourceNodeId === analysis.id && edge.targetNodeId === constraint?.id)).toBe(true);
      if (!constraint) return;

      const generateId = crypto.randomUUID();
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [
          { type: "add_node", node: { id: generateId, kind: "tool", type: "generate_design", title: "方案生成", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "秋冬通勤风衣", count: 2 } }, x: 740, y: 120 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraint.id, targetNodeId: generateId, sourcePort: "out", targetPort: "constraint" } },
        ],
      });
      const generationMutationId = crypto.randomUUID();
      await runtime.execute(user.id, project.id, generateId, { mutationId: generationMutationId });
      graph = await workflows.get(user.id, project.id);
      const candidates = graph.nodes.filter((node) => node.type === "candidate");
      expect(candidates).toHaveLength(2);
      const firstCandidate = candidates[0];
      expect(firstCandidate).toBeDefined();
      if (!firstCandidate) return;
      expect(createFromAgent).toHaveBeenCalledTimes(2);
      expect(createFromAgent.mock.calls[0]?.[1].shapeIds).toEqual([]);
      const generationHistory = await runtime.history(user.id, project.id, generateId);
      expect(generationHistory.items).toHaveLength(2);
      expect(generationHistory.items[0]?.request).toMatchObject({ width: 768, height: 1024, quality: "high", taskType: "t2i" });
      expect(generationHistory.items[0]?.request.model).toBe("amux/image-model-at-run");
      const generationSnapshot = await prisma.workflowAttempt.findFirstOrThrow({ where: { projectId: project.id, toolNodeId: generateId } });
      expect((generationSnapshot.requestSnapshot as { model?: string }).model).toBe("amux/image-model-at-run");
      await prisma.workflowAttempt.update({ where: { id: generationSnapshot.id }, data: {
        requestSnapshot: { ...(generationSnapshot.requestSnapshot as Prisma.JsonObject), model: "different-current-model" },
      } });
      const frozenHistory = await runtime.history(user.id, project.id, generateId);
      expect(frozenHistory.items.find((item) => item.id === generationSnapshot.id)?.request.model).toBe("amux/image-model-at-run");
      await runtime.execute(user.id, project.id, generateId, { mutationId: generationMutationId });
      expect(createFromAgent).toHaveBeenCalledTimes(2);
      expect((await workflows.get(user.id, project.id)).nodes.filter((node) => node.type === "candidate")).toHaveLength(2);
      const generatedPath = await assets.path(user.id, (firstCandidate.payload as { assetId: string }).assetId);
      expect(generatedPath.steps.map((step) => step.tool)).toEqual(["analyze_brief", "generate_design"]);
      expect(generatedPath.steps[0]?.sources).toEqual(expect.arrayContaining([expect.objectContaining({ elementId: briefId, title: "设计需求" })]));
      expect(generatedPath.steps[1]?.outputs).toHaveLength(2);

      const evaluateId = crypto.randomUUID();
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [
          { type: "add_node", node: { id: evaluateId, kind: "tool", type: "evaluate_design", title: "候选评估", payload: { toolKey: "evaluate_design", toolVersion: "1", params: { prompt: "逐项检查约束" } }, x: 1300, y: 120 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraint.id, targetNodeId: evaluateId, sourcePort: "out", targetPort: "constraint" } },
          ...candidates.map((candidate) => ({ type: "add_edge" as const, edge: { id: crypto.randomUUID(), sourceNodeId: candidate.id, targetNodeId: evaluateId, sourcePort: "out" as const, targetPort: "candidate" as const } })),
        ],
      });
      await runtime.execute(user.id, project.id, evaluateId, { mutationId: crypto.randomUUID() });
      graph = await workflows.get(user.id, project.id);
      const report = graph.nodes.find((node) => node.type === "evaluation");
      expect(report).toBeDefined();
      expect((report?.payload as { report?: { evaluations?: unknown[] } }).report?.evaluations).toHaveLength(2);
      expect(storage.readPrefix).toHaveBeenCalledTimes(2);
      const evaluationCalls = model.generateJson.mock.calls.filter(([request]) => request.schemaName === "fashion_design_evaluation");
      expect(evaluationCalls).toHaveLength(2);
      for (const [request] of evaluationCalls) {
        const data = JSON.parse((request as unknown as { prompt: string }).prompt);
        expect(data.evaluationTask).toBe("逐项检查约束");
        expect(data.prompt).not.toBe(data.evaluationTask);
        expect(data.prompt).toBe((generationSnapshot.requestSnapshot as { request: { prompt: string } }).request.prompt);
        expect(data.step.prompt).toBe(data.prompt);
        expect(data.auxiliaryContext).toMatchObject({ constraintNodeId: constraint.id,
          producerAttemptId: expect.any(String), promptSource: "frozen_generation_request" });
        expect(data.auxiliaryContext.history.some((entry: { toolNodeId: string }) => entry.toolNodeId === generateId)).toBe(true);
      }
      const evaluationAttempt = await prisma.workflowAttempt.findFirstOrThrow({ where: { toolNodeId: evaluateId } });
      const snapshot = evaluationAttempt.requestSnapshot as { evaluationTask?: string; evaluationInputs?: { prompt: string; auxiliaryContext?: { graphRevision: number } }[] };
      expect(snapshot.evaluationTask).toBe("逐项检查约束");
      expect(snapshot.evaluationInputs).toHaveLength(2);
      expect(snapshot.evaluationInputs?.every((entry) => entry.auxiliaryContext?.graphRevision !== undefined)).toBe(true);

      const referenceOnlyEvaluationId = crypto.randomUUID();
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [
          { type: "add_node", node: { id: referenceOnlyEvaluationId, kind: "tool", type: "evaluate_design", title: "仅参考的候选", payload: { toolKey: "evaluate_design", toolVersion: "1", params: { prompt: "检查候选端口" } }, x: 1300, y: 900 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraint.id, targetNodeId: referenceOnlyEvaluationId, sourcePort: "out", targetPort: "constraint" } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: firstCandidate.id, targetNodeId: referenceOnlyEvaluationId, sourcePort: "out", targetPort: "reference" } },
        ],
      });
      await expect(runtime.execute(user.id, project.id, referenceOnlyEvaluationId, { mutationId: crypto.randomUUID() })).rejects.toMatchObject({ status: 400 });
      graph = await workflows.get(user.id, project.id);

      const editId = crypto.randomUUID();
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [
          { type: "add_node", node: { id: editId, kind: "tool", type: "edit_design", title: "收窄袖口", payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: "收窄袖口，保留肩线" } }, x: 740, y: 520 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: firstCandidate.id, targetNodeId: editId, sourcePort: "out", targetPort: "source" } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraint.id, targetNodeId: editId, sourcePort: "out", targetPort: "constraint" } },
        ],
      });
      await runtime.execute(user.id, project.id, editId, { mutationId: crypto.randomUUID() });
      graph = await workflows.get(user.id, project.id);
      expect(graph.nodes.filter((node) => node.type === "candidate")).toHaveLength(3);
      expect(graph.edges.filter((edge) => edge.sourceNodeId === generateId)).toHaveLength(2);
      expect(graph.edges.filter((edge) => edge.sourceNodeId === editId)).toHaveLength(1);
      const editHistory = await runtime.history(user.id, project.id, editId);
      expect(editHistory.items).toHaveLength(1);
      expect(editHistory.items[0]).toMatchObject({ status: "completed", request: { inputNodeIds: expect.arrayContaining([firstCandidate.id, constraint.id]) } });
      expect(createFromAgent).toHaveBeenCalledTimes(3);
      const editCandidate = graph.nodes.find((node) => node.type === "candidate" && graph.edges.some((edge) => edge.sourceNodeId === editId && edge.targetNodeId === node.id));
      if (!editCandidate) throw new Error("edit output missing");
      const secondCandidate = candidates.find((candidate) => candidate.id !== firstCandidate.id);
      if (!secondCandidate) throw new Error("second candidate missing");
      expect(editCandidate.x).toBe(secondCandidate.x);
      expect(editCandidate.y).toBeGreaterThanOrEqual(secondCandidate.y + 300 + 40);
      expect(graph.nodes.find((node) => node.id === secondCandidate.id)).toMatchObject({ x: secondCandidate.x, y: secondCandidate.y });
      const restored = await assets.restore(user.id, (firstCandidate.payload as { assetId: string }).assetId, (editCandidate.payload as { assetId: string }).assetId);
      const restoreMutation = crypto.randomUUID();
      graph = await runtime.importAsset(user.id, project.id, { sourceNodeId: editCandidate.id, assetId: restored.id, operation: "restore", mutationId: restoreMutation });
      await runtime.importAsset(user.id, project.id, { sourceNodeId: editCandidate.id, assetId: restored.id, operation: "restore", mutationId: restoreMutation });
      const restoredAgain = await runtime.importAsset(user.id, project.id, { sourceNodeId: editCandidate.id, assetId: restored.id, operation: "restore", mutationId: crypto.randomUUID() });
      const restoreTools = restoredAgain.nodes.filter((node) => node.type === "restore_version");
      const restoreOutputs = restoredAgain.nodes.filter((node) => node.type === "candidate" && (node.payload as { assetId?: string }).assetId === restored.id);
      expect(restoreTools).toHaveLength(1);
      expect(restoreOutputs).toHaveLength(1);
      const restoreTool = restoreTools[0];
      const restoreOutput = restoreOutputs[0];
      if (!restoreTool || !restoreOutput) throw new Error("restore graph projection missing");
      expect(restoredAgain.edges.filter((edge) => edge.sourceNodeId === editCandidate.id && edge.targetNodeId === restoreTool.id)).toHaveLength(1);
      expect(restoredAgain.edges.filter((edge) => edge.sourceNodeId === restoreTool.id && edge.targetNodeId === restoreOutput.id)).toHaveLength(1);
      expect(restoredAgain.nodes.filter((node) => node.type === "candidate")).toHaveLength(4);
      const restoreAttempts = await prisma.workflowAttempt.findMany({ where: { projectId: project.id, toolNodeId: restoreTool.id }, orderBy: { ordinal: "asc" } });
      expect(restoreAttempts.map((attempt) => attempt.ordinal)).toEqual([1, 2]);
      const originalRestoreAttempt = restoreAttempts[0];
      if (!originalRestoreAttempt) throw new Error("restore attempt missing");
      expect(restoreOutput.payload).toMatchObject({ attemptId: originalRestoreAttempt.id });
      const restoreVersion = await prisma.workflowNodeVersion.findUniqueOrThrow({ where: { id: originalRestoreAttempt.nodeVersionId ?? "missing" } });
      expect(restoreVersion).toMatchObject({ nodeId: restoreTool.id, type: "restore_version", payload: { params: { restoredFromAssetId: (firstCandidate.payload as { assetId: string }).assetId } } });
      const restoreOutputVersion = await prisma.workflowNodeVersion.findFirstOrThrow({ where: { nodeId: restoreOutput.id }, orderBy: { version: "desc" } });
      expect(restoreOutputVersion.inputBindings).toEqual([expect.objectContaining({ sourceNodeId: restoreTool.id, sourceNodeVersionId: restoreVersion.id })]);
      expect(originalRestoreAttempt.requestSnapshot).toMatchObject({
        inputBindings: restoreVersion.inputBindings,
        sources: expect.arrayContaining([
          expect.objectContaining({ assetId: (editCandidate.payload as { assetId: string }).assetId, role: "edit_source" }),
          expect.objectContaining({ assetId: (firstCandidate.payload as { assetId: string }).assetId, role: "restore_source" }),
        ]),
        designStepId: expect.any(String),
        inputSnapshot: [expect.objectContaining({ id: editCandidate.id, nodeVersionId: expect.any(String) })],
      });
      expect(await prisma.workflowExecution.findUniqueOrThrow({ where: { id: originalRestoreAttempt.executionId ?? "missing" } })).toMatchObject({ status: "completed", conversationId: null, nodeVersionId: restoreVersion.id });
      const restoredPath = await assets.path(user.id, restored.id);
      const restoredPathStep = restoredPath.steps.find((step) => step.tool === "restore_version" && step.outputs.some((output) => output.id === restored.id));
      expect(restoredPathStep).toMatchObject({ id: originalRestoreAttempt.executionId, snapshotAvailable: true, sources: expect.arrayContaining([
        expect.objectContaining({ assetId: (editCandidate.payload as { assetId: string }).assetId, role: "edit_source" }),
        expect.objectContaining({ assetId: (firstCandidate.payload as { assetId: string }).assetId, role: "restore_source" }),
      ]) });
      expect(await prisma.workflowOutbox.findUniqueOrThrow({ where: { eventKey: `execution:${originalRestoreAttempt.executionId}:terminal` } })).toMatchObject({ payload: { status: "completed" } });
      const anotherRestored = await assets.restore(user.id, (firstCandidate.payload as { assetId: string }).assetId, (editCandidate.payload as { assetId: string }).assetId);
      await expect(runtime.importAsset(user.id, project.id, {
        sourceNodeId: editCandidate.id, assetId: anotherRestored.id, operation: "restore", mutationId: restoreMutation,
      })).rejects.toMatchObject({ status: 409 });

      const beforeRestoreRollback = await workflows.get(user.id, project.id);
      const restoreRollbackMutation = crypto.randomUUID();
      const restoreExecutionCount = await prisma.workflowExecution.count({ where: { projectId: project.id } });
      const restoreVersionCount = await prisma.workflowNodeVersion.count({ where: { projectId: project.id } });
      const restoreOutboxCount = await prisma.workflowOutbox.count({ where: { projectId: project.id } });
      const finalizeBeforeRestoreRollback = runtime.finalizeExecutions.bind(runtime);
      const restoreRollback = vi.spyOn(runtime, "finalizeExecutions").mockImplementationOnce(async (...args) => {
        await finalizeBeforeRestoreRollback(...args);
        throw new Error("restore interrupted before receipt commit");
      });
      try {
        await expect(runtime.importAsset(user.id, project.id, { sourceNodeId: editCandidate.id, assetId: anotherRestored.id, operation: "restore", mutationId: restoreRollbackMutation })).rejects.toThrow("restore interrupted before receipt commit");
      } finally {
        restoreRollback.mockRestore();
      }
      const afterRestoreRollback = await workflows.get(user.id, project.id);
      expect(afterRestoreRollback.revision).toBe(beforeRestoreRollback.revision);
      expect(afterRestoreRollback.nodes).toHaveLength(beforeRestoreRollback.nodes.length);
      expect(await prisma.workflowAttempt.count({ where: { executionKey: `workflow:restore:${restoreRollbackMutation}` } })).toBe(0);
      expect(await prisma.workflowExecution.count({ where: { projectId: project.id } })).toBe(restoreExecutionCount);
      expect(await prisma.workflowNodeVersion.count({ where: { projectId: project.id } })).toBe(restoreVersionCount);
      expect(await prisma.workflowOutbox.count({ where: { projectId: project.id } })).toBe(restoreOutboxCount);
      await runtime.importAsset(user.id, project.id, { sourceNodeId: editCandidate.id, assetId: anotherRestored.id, operation: "restore", mutationId: restoreRollbackMutation });
      await runtime.importAsset(user.id, project.id, { sourceNodeId: editCandidate.id, assetId: anotherRestored.id, operation: "restore", mutationId: restoreRollbackMutation });
      expect(await prisma.workflowAttempt.count({ where: { executionKey: `workflow:restore:${restoreRollbackMutation}` } })).toBe(1);
      expect(await prisma.workflowExecution.count({ where: { executionKey: `workflow-restore:${project.id}:${restoreRollbackMutation}` } })).toBe(1);

      const sourceAsset = await prisma.designAsset.findUniqueOrThrow({ where: { id: (editCandidate.payload as { assetId: string }).assetId } });
      const historicalTarget = await prisma.designAsset.create({ data: { projectId: project.id, rootAssetId: sourceAsset.rootAssetId, operation: "IMPORTED", url: sourceAsset.url, thumbnailUrl: sourceAsset.thumbnailUrl } });
      const historicalRestore = await assets.restore(user.id, historicalTarget.id, sourceAsset.id);
      const beforeHistoricalRestore = await workflows.get(user.id, project.id);
      const historicalMutation = crypto.randomUUID();
      const afterHistoricalRestore = await runtime.importAsset(user.id, project.id, { sourceNodeId: editCandidate.id, assetId: historicalRestore.id, operation: "restore", mutationId: historicalMutation });
      expect(afterHistoricalRestore.nodes).toHaveLength(beforeHistoricalRestore.nodes.length + 2);
      expect(afterHistoricalRestore.nodes.some((node) => (node.payload as { assetId?: string }).assetId === historicalTarget.id)).toBe(false);
      const historicalAttempt = await prisma.workflowAttempt.findUniqueOrThrow({ where: { executionKey: `workflow:restore:${historicalMutation}` } });
      expect(historicalAttempt.requestSnapshot).toMatchObject({ sources: expect.arrayContaining([expect.objectContaining({ assetId: historicalTarget.id, role: "restore_source" })]), inputNodeIds: [editCandidate.id] });
      expect(createFromAgent).toHaveBeenCalledTimes(3);

      const stale = await runtime.propose(user.id, project.id, {
        content: "请评估现有候选",
        referencedNodeIds: [firstCandidate.id],
        mutationId: crypto.randomUUID(),
      });
      graph = await workflows.get(user.id, project.id);
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [{ type: "add_node", node: { id: crypto.randomUUID(), kind: "asset", type: "reference_text", title: "补充说明", payload: { text: "保留领型" }, x: 50, y: 700 } }],
      });
      await runtime.sync(user.id, project.id);
      await expect(runtime.accept(user.id, project.id, stale.id, {
        baseRevision: stale.baseRevision,
        mutationId: crypto.randomUUID(),
      })).rejects.toMatchObject({ status: 409 });

      graph = await workflows.get(user.id, project.id);
      const concurrentToolId = crypto.randomUUID();
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [
          { type: "add_node", node: { id: concurrentToolId, kind: "tool", type: "generate_design", title: "并发生成", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "并发测试", count: 2 } }, x: 1550, y: 100 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraint.id, targetNodeId: concurrentToolId, sourcePort: "out", targetPort: "constraint" } },
        ],
      });
      const concurrent = await Promise.allSettled([
        runtime.execute(user.id, project.id, concurrentToolId, { mutationId: crypto.randomUUID() }),
        runtime.execute(user.id, project.id, concurrentToolId, { mutationId: crypto.randomUUID() }),
      ]);
      expect(concurrent.some((item) => item.status === "fulfilled")).toBe(true);
      for (const item of concurrent) if (item.status === "rejected") expect(item.reason).toMatchObject({ status: 409 });
      expect(await prisma.workflowExecution.count({ where: { projectId: project.id, toolNodeId: concurrentToolId } })).toBe(1);
      expect((await runtime.history(user.id, project.id, concurrentToolId)).items).toHaveLength(2);
      expect(new Set(createFromAgent.mock.calls.map((call) => call[2])).size).toBe(5);
      expect(await prisma.generationTask.count({ where: { projectId: project.id } })).toBe(5);

      graph = await workflows.get(user.id, project.id);
      const retryToolId = crypto.randomUUID();
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [
          { type: "add_node", node: { id: retryToolId, kind: "tool", type: "generate_design", title: "可重试生成", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "重试后保留旧记录", count: 2 } }, x: 1550, y: 500 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraint.id, targetNodeId: retryToolId, sourcePort: "out", targetPort: "constraint" } },
        ],
      });
      const candidatesBeforeRetry = (await workflows.get(user.id, project.id)).nodes.filter((node) => node.type === "candidate").length;
      createFromAgent.mockRejectedValueOnce(new Error("transient provider failure"));
      await expect(runtime.execute(user.id, project.id, retryToolId, { mutationId: crypto.randomUUID() })).rejects.toThrow("transient provider failure");
      expect((await runtime.history(user.id, project.id, retryToolId)).items).toMatchObject([{ status: "failed" }, { status: "failed" }]);
      expect((await workflows.get(user.id, project.id)).nodes.filter((node) => node.type === "candidate")).toHaveLength(candidatesBeforeRetry);
      await runtime.execute(user.id, project.id, retryToolId, { mutationId: crypto.randomUUID() });
      expect((await runtime.history(user.id, project.id, retryToolId)).items).toHaveLength(4);
      expect((await workflows.get(user.id, project.id)).nodes.filter((node) => node.type === "candidate")).toHaveLength(candidatesBeforeRetry + 2);

      graph = await workflows.get(user.id, project.id);
      const recoveryToolId = crypto.randomUUID();
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [
          { type: "add_node", node: { id: recoveryToolId, kind: "tool", type: "generate_design", title: "回填恢复", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "恢复候选", count: 1 } }, x: 1900, y: 500 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraint.id, targetNodeId: recoveryToolId, sourcePort: "out", targetPort: "constraint" } },
        ],
      });
      graph = await workflows.get(user.id, project.id);
      await workflows.applySystemMutation(project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [{ type: "update_node", nodeId: recoveryToolId, status: "running" }],
      });
      const recoveryKey = `workflow:${project.id}:${recoveryToolId}:1`;
      const recoveryTask = await createFromAgent(user.id, { projectId: project.id, taskType: "t2i", prompt: "恢复候选" }, recoveryKey);
      await prisma.workflowAttempt.create({
        data: {
          projectId: project.id, toolNodeId: recoveryToolId, ordinal: 1,
          executionKey: recoveryKey, status: "running", generationTaskId: recoveryTask.taskId,
          requestSnapshot: { mutationId: crypto.randomUUID(), inputNodeIds: [constraint.id], graphRevision: graph.revision, toolVersion: "1" },
        },
      });
      const applyOriginal = workflows.applySystemMutation.bind(workflows);
      const lostAcknowledgement = vi.spyOn(workflows, "applySystemMutation").mockImplementationOnce(async (...args) => {
        await applyOriginal(...args);
        throw new Error("graph commit acknowledged late");
      });
      try {
        await expect(runtime.sync(user.id, project.id)).rejects.toThrow("graph commit acknowledged late");
      } finally {
        lostAcknowledgement.mockRestore();
      }
      const afterCrash = await workflows.get(user.id, project.id);
      const recoveredOutputs = afterCrash.edges.filter((edge) => edge.sourceNodeId === recoveryToolId);
      expect(recoveredOutputs).toHaveLength(0);
      expect(await prisma.workflowAttempt.findUniqueOrThrow({ where: { executionKey: recoveryKey } })).toMatchObject({ status: "running" });
      await runtime.sync(user.id, project.id);
      const afterReplay = await workflows.get(user.id, project.id);
      expect(afterReplay.edges.filter((edge) => edge.sourceNodeId === recoveryToolId)).toHaveLength(1);
      expect((await runtime.history(user.id, project.id, recoveryToolId)).items).toMatchObject([{ status: "completed" }]);

      const overlappingToolId = crypto.randomUUID();
      graph = await workflows.get(user.id, project.id);
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [
          { type: "add_node", node: { id: overlappingToolId, kind: "tool", type: "generate_design", title: "输出回填去重", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "候选来源验证" } }, x: 2200, y: 500 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraint.id, targetNodeId: overlappingToolId, sourcePort: "out", targetPort: "constraint" } },
        ],
      });
      graph = await workflows.get(user.id, project.id);
      await workflows.applySystemMutation(project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [{ type: "update_node", nodeId: overlappingToolId, status: "running" }],
      });
      const overlappingKey = `workflow:${project.id}:${overlappingToolId}:1`;
      const overlappingTask = await createFromAgent(user.id, { projectId: project.id, taskType: "t2i", prompt: "候选来源验证" }, overlappingKey);
      const taskRecord = await prisma.generationTask.findUniqueOrThrow({ where: { id: overlappingTask.taskId } });
      const taskImages = (taskRecord.output as { images: { assetId: string }[] }).images;
      const overlappingAssetId = taskImages[0]?.assetId;
      expect(overlappingAssetId).toBeDefined();
      if (!overlappingAssetId) return;
      await prisma.workflowAttempt.create({ data: {
        projectId: project.id, toolNodeId: overlappingToolId, ordinal: 1,
        executionKey: overlappingKey, status: "running", generationTaskId: overlappingTask.taskId,
        requestSnapshot: { mutationId: crypto.randomUUID(), inputNodeIds: [constraint.id], graphRevision: graph.revision, toolVersion: "1" },
      } });
      graph = await workflows.get(user.id, project.id);
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [{ type: "add_node", node: { id: crypto.randomUUID(), kind: "asset", type: "candidate", title: "独立候选引用", payload: { assetId: overlappingAssetId }, x: 2550, y: 800 } }],
      });
      const projected = await runtime.sync(user.id, project.id);
      expect(projected.edges.some((edge) => edge.sourceNodeId === overlappingToolId)).toBe(true);

      const analysisReplayId = crypto.randomUUID();
      graph = await workflows.get(user.id, project.id);
      await workflows.patch(user.id, project.id, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision,
        operations: [
          { type: "add_node", node: { id: analysisReplayId, kind: "tool", type: "analyze_brief", title: "崩溃恢复分析", payload: { toolKey: "analyze_brief", toolVersion: "1", params: { prompt: "分析输入" } }, x: 3200, y: 100 } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: briefId, targetNodeId: analysisReplayId, sourcePort: "out", targetPort: "goal" } },
        ],
      });
      const beforeResult = workflows.applySystemMutation.bind(workflows);
      let rejectedResult = false;
      const lateFailure = vi.spyOn(workflows, "applySystemMutation").mockImplementation(async (...args) => {
        const committed = await beforeResult(...args);
        if (!rejectedResult && args[1].operations.some((operation) => operation.type === "add_edge" && operation.edge.sourceNodeId === analysisReplayId)) {
          rejectedResult = true;
          throw new Error("result transaction interrupted after graph write");
        }
        return committed;
      });
      try {
        await expect(runtime.execute(user.id, project.id, analysisReplayId, { mutationId: crypto.randomUUID() })).rejects.toThrow("result transaction interrupted after graph write");
      } finally {
        lateFailure.mockRestore();
      }
      graph = await workflows.get(user.id, project.id);
      expect(graph.edges.filter((edge) => edge.sourceNodeId === analysisReplayId)).toHaveLength(0);
      const rolledBack = await prisma.workflowExecution.findFirstOrThrow({ where: { projectId: project.id, toolNodeId: analysisReplayId } });
      expect(rolledBack.status).toBe("failed");
      expect(await prisma.workflowOutbox.findUniqueOrThrow({ where: { eventKey: `execution:${rolledBack.id}:terminal` } })).toMatchObject({ payload: { status: "failed" } });
      await runtime.execute(user.id, project.id, analysisReplayId, { mutationId: crypto.randomUUID() });
      graph = await workflows.get(user.id, project.id);
      expect(graph.edges.filter((edge) => edge.sourceNodeId === analysisReplayId)).toHaveLength(1);
      const recoveredAnalysis = await prisma.workflowExecution.findFirstOrThrow({ where: { projectId: project.id, toolNodeId: analysisReplayId, status: "completed" } });
      expect(await prisma.workflowAttempt.findFirstOrThrow({ where: { executionId: recoveredAnalysis.id } })).toMatchObject({ status: "completed" });
      expect(await prisma.workflowOutbox.findUniqueOrThrow({ where: { eventKey: `execution:${recoveredAnalysis.id}:terminal` } })).toMatchObject({ payload: { status: "completed" } });

      const acknowledgedLateId = crypto.randomUUID();
      await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: graph.revision, operations: [
        { type: "add_node", node: { id: acknowledgedLateId, kind: "tool", type: "analyze_brief", title: "提交确认丢失", payload: { toolKey: "analyze_brief", toolVersion: "1", params: { prompt: "分析输入" } }, x: 3500, y: 100 } },
        { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: briefId, targetNodeId: acknowledgedLateId, sourcePort: "out", targetPort: "goal" } },
      ] });
      const transactionBeforeAck = prisma.$transaction;
      let lostAck = false;
      const acknowledgementFailure = vi.spyOn(prisma, "$transaction").mockImplementation((async (...args: unknown[]) => {
        const result = await Reflect.apply(transactionBeforeAck, prisma, args) as unknown;
        if (!lostAck && result && typeof result === "object" && "edges" in result && Array.isArray(result.edges)
          && result.edges.some((edge) => edge.sourceNodeId === acknowledgedLateId)) {
          lostAck = true;
          throw new Error("result committed but acknowledgement lost");
        }
        return result;
      }) as typeof prisma.$transaction);
      try {
        await expect(runtime.execute(user.id, project.id, acknowledgedLateId, { mutationId: crypto.randomUUID() })).resolves.toMatchObject({ projectId: project.id });
      } finally {
        acknowledgementFailure.mockRestore();
      }
      expect(lostAck).toBe(true);
      const acknowledgedExecution = await prisma.workflowExecution.findFirstOrThrow({ where: { projectId: project.id, toolNodeId: acknowledgedLateId } });
      expect(acknowledgedExecution.status).toBe("completed");
      expect(await prisma.workflowAttempt.count({ where: { executionId: acknowledgedExecution.id, status: "completed" } })).toBe(1);
      expect(await prisma.workflowOutbox.findUniqueOrThrow({ where: { eventKey: `execution:${acknowledgedExecution.id}:terminal` } })).toMatchObject({ payload: { status: "completed" } });
      const acknowledgedGraph = await workflows.get(user.id, project.id);
      expect(acknowledgedGraph.edges.filter((edge) => edge.sourceNodeId === acknowledgedLateId)).toHaveLength(1);
    } finally {
      await prisma.workflowAttempt.deleteMany({ where: { projectId: project.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
