import { prisma, type Prisma } from "@fashion/db";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DesignContextService } from "../design-context/design-context.service";
import type { GenerationCreateRequest } from "../generation/generation.schemas";
import { WorkflowsService } from "../workflows/workflows.service";
import { workflowActionSchema, type WorkflowAction } from "./workflow-planner";
import { WorkflowRuntimeService } from "./workflow-runtime.service";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function fixture() {
  const user = await prisma.user.create({ data: { email: `workflow-action-v2-${randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Action verification", projects: { create: { name: "Atomic action" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  const project = user.ownedWorkspaces[0]?.projects[0];
  if (!project) throw new Error("action project missing");
  const workflows = new WorkflowsService(prisma);
  const contexts = new DesignContextService(prisma, workflows);
  const generation = {
    createFromAgent: vi.fn(async (userId: string, request: GenerationCreateRequest, key: string) => {
      const id = `verification-${createHash("sha256").update(key).digest("hex")}`;
      await prisma.generationTask.upsert({ where: { id }, update: {}, create: { id, userId, projectId: request.projectId ?? null, taskType: request.taskType, input: json(request) } });
      return { taskId: id };
    }),
    get: async (_userId: string, id: string) => {
      const task = await prisma.generationTask.findUniqueOrThrow({ where: { id } });
      return { id: task.id, status: task.status.toLowerCase(), output: task.output, compiledPrompt: task.compiledPrompt, error: null };
    },
  };
  const model = { generateJson: vi.fn() };
  const storage = { createDownloadUrl: vi.fn(async (key: string) => `https://storage.test/${encodeURIComponent(key)}`) };
  const runtime = new WorkflowRuntimeService(prisma, workflows, generation as never, model as never, storage as never, {} as never, contexts);
  const constraint = randomUUID(), referenceA = randomUUID(), referenceB = randomUUID(), tool = randomUUID();
  const files = await Promise.all(["A", "B", "mask"].map((name) => prisma.fileAsset.create({ data: {
    ownerId: user.id, originalName: `${name}.png`, mimeType: "image/png", sizeBytes: 12, sha256: randomUUID(), objectKey: `verification/${randomUUID()}/${name}.png`, status: "READY",
  } })));
  const fileA = files[0], fileB = files[1], maskFile = files[2];
  if (!fileA || !fileB || !maskFile) throw new Error("reference fixture missing");
  await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: randomUUID(), baseRevision: 0, operations: [
    { type: "add_node", node: { id: constraint, kind: "asset", type: "constraint", title: "本分支约束", payload: { text: "保持立领和银色" }, x: 0, y: 0 } },
    { type: "add_node", node: { id: referenceA, kind: "asset", type: "reference_image", title: "同名参考", payload: { fileAssetId: fileA.id, role: "style_ref", roleSource: "manual" }, x: 0, y: 300 } },
    { type: "add_node", node: { id: referenceB, kind: "asset", type: "reference_image", title: "同名参考", payload: { fileAssetId: fileB.id, role: "detail_ref", roleSource: "manual" }, x: 0, y: 600 } },
    { type: "add_node", node: { id: tool, kind: "tool", type: "generate_design", title: "原方案", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "原提示词", count: 1 } }, x: 400, y: 0 } },
    { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: constraint, targetNodeId: tool, sourcePort: "out", targetPort: "constraint" } },
    { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: referenceA, targetNodeId: tool, sourcePort: "out", targetPort: "reference" } },
  ] });
  await contexts.build(user.id, project.id);
  const conversation = await prisma.agentConversation.create({ data: { projectId: project.id, createdById: user.id, mode: "workflow", title: "执行归属" } });
  return { user, project, workflows, contexts, runtime, generation, model, storage, constraint, referenceA, referenceB, tool, fileA, fileB, maskFile, conversation,
    cleanup: async () => { await prisma.workflowAttempt.deleteMany({ where: { projectId: project.id } }); await prisma.user.delete({ where: { id: user.id } }); } };
}

async function proposalFor(f: Awaited<ReturnType<typeof fixture>>, action: WorkflowAction) {
  const graph = await f.workflows.get(f.user.id, f.project.id);
  const profile = await f.contexts.get(f.user.id, f.project.id);
  return f.runtime.prepareAction(f.user.id, f.project.id, { content: "应用这些明确修改", referencedNodeIds: action.inputs.map((input) => input.nodeId), mutationId: randomUUID(), graphRevision: graph.revision, contextRevision: profile.revision, conversationId: f.conversation.id, action });
}

async function configuredAction(f: Awaited<ReturnType<typeof fixture>>) {
  const version = await prisma.workflowNodeVersion.findFirstOrThrow({ where: { projectId: f.project.id, nodeId: f.tool }, orderBy: { version: "desc" } });
  return workflowActionSchema.parse({ type: "configure_tool", toolKey: "generate_design", toolVersion: "1", targetNodeId: f.tool, targetNodeVersionId: version.id, title: "细节调整", parameters: {
    prompt: "仅调整袖口，保持立领和银色", negativePrompt: "不要更改领型", count: 3, width: 1024, height: 1024, quality: "medium", taskType: "t2i",
    referenceInputs: [{ nodeId: f.referenceB, role: "detail_ref", weight: 0.4 }],
  }, inputs: [{ nodeId: f.constraint, port: "constraint" }, { nodeId: f.referenceB, port: "reference" }], rationale: "按明确要求改参数和替换输入", preserve: ["立领", "银色"] });
}

describe("Fig. 8 action and execution integration", () => {
  it("does not silently drop the last explicitly connected image when an edit exceeds its total image budget", async () => {
    const f = await fixture();
    try {
      const assetId = randomUUID(), source = randomUUID(), editTool = randomUUID();
      await prisma.designAsset.create({ data: { id: assetId, projectId: f.project.id, rootAssetId: assetId, operation: "IMPORTED", url: `s3://verification/${assetId}.png` } });
      const extraReferences = Array.from({ length: 15 }, () => randomUUID());
      const graph = await f.workflows.get(f.user.id, f.project.id);
      await f.workflows.patch(f.user.id, f.project.id, { mode: "semantic", baseRevision: graph.revision, mutationId: randomUUID(), operations: [
        { type: "add_node", node: { id: source, kind: "asset", type: "candidate", title: "实际母图", payload: { assetId }, x: 700, y: 0 } },
        { type: "add_node", node: { id: editTool, kind: "tool", type: "edit_design", title: "完整参考编辑", payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: "遵守所有明确参考" } }, x: 1000, y: 0 } },
        ...extraReferences.map((id) => ({ type: "add_node" as const, node: { id, kind: "asset" as const, type: "reference_image" as const, title: "明确图片参考", payload: { fileAssetId: f.fileB.id, role: "style_ref", roleSource: "manual" }, x: 0, y: 900 } })),
        { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: source, targetNodeId: editTool, sourcePort: "out", targetPort: "source" } },
        ...[f.referenceA, ...extraReferences].map((id) => ({ type: "add_edge" as const, edge: { id: randomUUID(), sourceNodeId: id, targetNodeId: editTool, sourcePort: "out" as const, targetPort: "reference" as const } })),
      ] });
      await expect(f.runtime.execute(f.user.id, f.project.id, editTool, { mutationId: randomUUID() })).rejects.toThrow("不会静默忽略参考");
      expect(f.generation.createFromAgent).not.toHaveBeenCalled();
      expect(await prisma.workflowAttempt.count({ where: { toolNodeId: editTool } })).toBe(0);
    } finally { await f.cleanup(); }
  });

  it("refuses an overlong combined request before reserving attempts instead of dropping connected requirements", async () => {
    const f = await fixture();
    try {
      const graph = await f.workflows.get(f.user.id, f.project.id);
      await f.workflows.patch(f.user.id, f.project.id, { mode: "semantic", baseRevision: graph.revision, mutationId: randomUUID(), operations: [
        { type: "update_node", nodeId: f.tool, payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "本轮描述".repeat(1_000), count: 1 } } },
      ] });
      await expect(f.runtime.execute(f.user.id, f.project.id, f.tool, { mutationId: randomUUID() })).rejects.toThrow("不会静默截掉设计要求");
      expect(f.generation.createFromAgent).not.toHaveBeenCalled();
      expect(await prisma.workflowAttempt.count({ where: { projectId: f.project.id } })).toBe(0);
      expect(await prisma.workflowExecution.count({ where: { projectId: f.project.id } })).toBe(0);
      expect(await prisma.workflowNode.findUnique({ where: { id: f.tool } })).toMatchObject({ status: "ready" });
    } finally { await f.cleanup(); }
  });

  it("configures the same draft card with a new immutable version and freezes exactly the confirmed generation parameters", async () => {
    const f = await fixture();
    try {
      const action = await configuredAction(f);
      const before = await prisma.workflowNodeVersion.findMany({ where: { nodeId: f.tool } });
      const proposal = await proposalFor(f, action);
      expect(object(proposal.evidence).preview).toMatchObject({ before: { parameters: { count: 1 }, inputs: expect.arrayContaining([{ nodeId: f.referenceA, port: "reference" }]) }, after: { parameters: { count: 3 }, inputs: expect.arrayContaining([{ nodeId: f.referenceB, port: "reference" }]) } });
      const accepted = await f.runtime.accept(f.user.id, f.project.id, proposal.id, { baseRevision: proposal.baseRevision, mutationId: randomUUID() });
      expect(accepted.nodes.filter((node) => node.kind === "tool").map((node) => node.id)).toEqual([f.tool]);
      expect(f.generation.createFromAgent).not.toHaveBeenCalled();
      expect(await prisma.generationTask.count({ where: { projectId: f.project.id } })).toBe(0);
      const after = await prisma.workflowNodeVersion.findMany({ where: { nodeId: f.tool }, orderBy: { version: "asc" } });
      expect(after).toHaveLength(2);
      expect(after[0]).toEqual(before[0]);
      expect(after[1]).toMatchObject({ previousVersionId: before[0]?.id, version: 2, inputBindings: expect.arrayContaining([expect.objectContaining({ sourceNodeId: f.referenceB, sourceNodeVersionId: expect.any(String) })]) });
      await f.runtime.execute(f.user.id, f.project.id, f.tool, { mutationId: randomUUID(), conversationId: f.conversation.id });
      expect(f.generation.createFromAgent).toHaveBeenCalledTimes(3);
      const execution = await prisma.workflowExecution.findFirstOrThrow({ where: { projectId: f.project.id } });
      expect(execution).toMatchObject({ expectedAttempts: 3, nodeVersionId: after[1]?.id, conversationId: f.conversation.id, status: "running" });
      const attempts = await prisma.workflowAttempt.findMany({ where: { executionId: execution.id } });
      expect(attempts).toHaveLength(3);
      for (const attempt of attempts) {
        expect(attempt.nodeVersionId).toBe(after[1]?.id);
        expect(attempt.requestSnapshot).toMatchObject({ params: action.parameters, inputNodeIds: expect.arrayContaining([f.constraint, f.referenceB]), request: {
          width: 1024, height: 1024, quality: "medium", negativePrompt: "不要更改领型",
          referenceImages: [{ role: "detail_ref", weight: 0.4, url: `https://storage.test/${encodeURIComponent(f.fileB.objectKey)}` }],
        } });
        expect(JSON.stringify(attempt.requestSnapshot)).not.toContain(f.fileA.objectKey);
        expect(JSON.stringify(attempt.requestSnapshot)).not.toContain(encodeURIComponent(f.fileA.objectKey));
      }
      expect(f.model.generateJson).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it("keeps the approved parent and mask in every inpaint snapshot without generating on acceptance", async () => {
    const f = await fixture();
    try {
      const assetId = randomUUID();
      const asset = await prisma.designAsset.create({ data: { id: assetId, projectId: f.project.id, rootAssetId: assetId, operation: "IMPORTED", url: `s3://verification/${assetId}.png` } });
      const candidate = randomUUID(), edit = randomUUID();
      const graph = await f.workflows.get(f.user.id, f.project.id);
      await f.workflows.patch(f.user.id, f.project.id, { mode: "semantic", mutationId: randomUUID(), baseRevision: graph.revision, operations: [
        { type: "add_node", node: { id: candidate, kind: "asset", type: "candidate", title: "实际母图", payload: { assetId }, x: 700, y: 0 } },
        { type: "add_node", node: { id: edit, kind: "tool", type: "edit_design", title: "修改母图", payload: { toolKey: "edit_design", toolVersion: "1", params: { prompt: "仅修改袖口", taskType: "i2i" } }, x: 1000, y: 0 } },
        { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: candidate, targetNodeId: edit, sourcePort: "out", targetPort: "source" } },
      ] });
      const version = await prisma.workflowNodeVersion.findFirstOrThrow({ where: { nodeId: edit }, orderBy: { version: "desc" } });
      const action = workflowActionSchema.parse({ type: "configure_tool", toolKey: "edit_design", toolVersion: "1", targetNodeId: edit, targetNodeVersionId: version.id, title: "袖口局部重绘", parameters: {
        prompt: "只重绘蒙版区域", count: 2, negativePrompt: "不要改衣领", taskType: "inpaint", mask: { fileAssetId: f.maskFile.id }, width: 1024, height: 1536, quality: "high", palette: [{ hex: "#C0C0C0", name: "银色" }],
      }, inputs: [{ nodeId: candidate, port: "source" }], rationale: "只操作已指定的母图和蒙版" });
      const proposal = await proposalFor(f, action);
      await f.runtime.accept(f.user.id, f.project.id, proposal.id, { baseRevision: proposal.baseRevision, mutationId: randomUUID() });
      expect(f.generation.createFromAgent).not.toHaveBeenCalled();
      await f.runtime.execute(f.user.id, f.project.id, edit, { mutationId: randomUUID(), conversationId: f.conversation.id });
      const attempts = await prisma.workflowAttempt.findMany({ where: { projectId: f.project.id, toolNodeId: edit } });
      expect(attempts).toHaveLength(2);
      for (const attempt of attempts) expect(attempt.requestSnapshot).toMatchObject({ params: { mask: { fileAssetId: f.maskFile.id }, count: 2 }, request: {
        taskType: "inpaint", parentAssetId: asset.id, referenceImageUrl: asset.url,
        maskImageUrl: `https://storage.test/${encodeURIComponent(f.maskFile.objectKey)}`, palette: [{ hex: "#C0C0C0", name: "银色" }], width: 1024, height: 1536,
      } });
    } finally { await f.cleanup(); }
  });

  it("forks an executed tool while preserving its original parameters and execution, and acceptance creates no task", async () => {
    const f = await fixture();
    try {
      await f.runtime.execute(f.user.id, f.project.id, f.tool, { mutationId: randomUUID(), conversationId: f.conversation.id });
      const original = await prisma.workflowNode.findUniqueOrThrow({ where: { id: f.tool } });
      const attempts = await prisma.workflowAttempt.findMany({ where: { toolNodeId: f.tool } });
      const action = await configuredAction(f);
      const proposal = await proposalFor(f, { ...action, type: "fork_tool" });
      const beforeCalls = f.generation.createFromAgent.mock.calls.length;
      const accepted = await f.runtime.accept(f.user.id, f.project.id, proposal.id, { baseRevision: proposal.baseRevision, mutationId: randomUUID() });
      expect(await prisma.workflowNode.findUniqueOrThrow({ where: { id: f.tool } })).toEqual(original);
      expect(await prisma.workflowAttempt.findMany({ where: { toolNodeId: f.tool } })).toEqual(attempts);
      const branch = accepted.nodes.find((node) => node.kind === "tool" && node.id !== f.tool);
      expect(branch).toMatchObject({ status: "ready", payload: { params: { count: 3 } } });
      const branchVersion = await prisma.workflowNodeVersion.findFirstOrThrow({ where: { nodeId: branch?.id ?? "missing" } });
      expect(branchVersion).toMatchObject({ version: 1, baseline: false, origin: "proposal", payload: {
        forkedFromNodeId: f.tool, forkedFromNodeVersionId: action.targetNodeVersionId,
      } });
      expect(await prisma.workflowAttempt.count({ where: { toolNodeId: branch?.id ?? "missing" } })).toBe(0);
      expect(f.generation.createFromAgent).toHaveBeenCalledTimes(beforeCalls);
    } finally { await f.cleanup(); }
  });

  it("expires a pending in-place change when the designer starts that draft first", async () => {
    const f = await fixture();
    try {
      const proposal = await proposalFor(f, await configuredAction(f));
      await f.runtime.execute(f.user.id, f.project.id, f.tool, { mutationId: randomUUID(), conversationId: f.conversation.id });
      await expect(f.runtime.accept(f.user.id, f.project.id, proposal.id, { baseRevision: proposal.baseRevision, mutationId: randomUUID() })).rejects.toMatchObject({ status: 409 });
      expect((await prisma.workflowNode.findUniqueOrThrow({ where: { id: f.tool } })).payload).toMatchObject({ params: { prompt: "原提示词", count: 1 } });
      expect(await prisma.workflowNodeVersion.count({ where: { nodeId: f.tool } })).toBe(1);
      expect(await prisma.workflowAttempt.count({ where: { toolNodeId: f.tool } })).toBe(1);
    } finally { await f.cleanup(); }
  });
});
