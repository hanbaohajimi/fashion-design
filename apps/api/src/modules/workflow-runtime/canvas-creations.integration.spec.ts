import { createHash, randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@fashion/db";
import { assistantCanvasEnvelopeSchema, assistantCanvasResultSchema, assistantShapeStamp, type AssistantCanvasAction, type AssistantCanvasObservation, canvasCreationDraftSchema, createCanvasCreationSchema } from "@fashion/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasService } from "../canvas/canvas.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import type { GenerationCreateRequest } from "../generation/generation.schemas";
import { WorkflowRuntimeService } from "./workflow-runtime.service";
import { CanvasCommandService } from "./canvas-command.service";
import { CanvasCreationsService } from "./canvas-creations.service";
import { WorkflowAssistantService } from "./workflow-assistant.service";
import { plannerDecisionSchema } from "./workflow-planner";
import type { AmuxClaudeJsonRequest } from "@fashion/ai";
import { AssistantCanvasActionsService } from "./assistant-canvas-actions.service";
import { DesignContextService } from "../design-context/design-context.service";
import { WorkflowCoordinator } from "./workflow-coordinator";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fixtures = new Map<string, { workspaceId: string; projectId: string; users: string[] }>();
async function cleanupFixture(ownerId: string) {
  const entry = fixtures.get(ownerId);
  if (!entry) return;
  const attempts = await prisma.workflowAttempt.findMany({ where: { projectId: entry.projectId }, select: { id: true } });
  await prisma.imageTransformResult.deleteMany({ where: { attemptId: { in: attempts.map((attempt) => attempt.id) } } });
  await prisma.workflowAttempt.deleteMany({ where: { projectId: entry.projectId } });
  await prisma.workspace.deleteMany({ where: { id: entry.workspaceId } });
  await prisma.fabric.deleteMany({ where: { ownerId: { in: entry.users } } });
  await prisma.user.deleteMany({ where: { id: { in: entry.users } } });
  fixtures.delete(ownerId);
}
afterEach(async () => { for (const ownerId of fixtures.keys()) await cleanupFixture(ownerId); });

it("删除的便签引用不能进入新的生成任务", async () => {
  const f = await fixture();
  const retiredId = randomUUID();
  await prisma.workflowNode.create({ data: { id: retiredId, projectId: f.project.id, kind: "asset", type: "legacy", title: "已删除便签", x: 0, y: 0, payload: { retiredNote: true, canvasPlacement: "manual" } } });
  const target = await f.creations.create(f.user.id, f.project.id, createCanvasCreationSchema.parse({ id: randomUUID(), mutationId: randomUUID(), module: "image", draft: { prompt: "生成图片", inputs: [{ id: "old-note", nodeId: retiredId }] } }));
  await expect(f.creations.run(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: target.revision })).rejects.toThrow("便签已删除");
  expect(f.generation.createFromAgent).not.toHaveBeenCalled();
});

async function fixture() {
  const user = await prisma.user.create({ data: { email: `creation-${randomUUID()}@example.test`, ownedWorkspaces: { create: { name: "创作节点验收", projects: { create: { name: "统一画布" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  const workspace = user.ownedWorkspaces[0];
  const project = workspace?.projects[0];
  if (!workspace || !project) throw new Error("测试项目创建失败");
  const cleanupEntry = { workspaceId: workspace.id, projectId: project.id, users: [user.id] };
  fixtures.set(user.id, cleanupEntry);
  const viewer = await prisma.user.create({ data: { email: `creation-viewer-${randomUUID()}@example.test` } });
  cleanupEntry.users.push(viewer.id);
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" } });
  const access = new ProjectAccessPolicy(prisma);
  const workflows = new WorkflowsService(prisma, access);
  const canvas = new CanvasService(prisma, access, workflows);
  const sourceId = randomUUID();
  const asset = await prisma.designAsset.create({ data: { projectId: project.id, rootAssetId: sourceId, operation: "IMPORTED", url: `https://assets.test/${sourceId}.png`, width: 768, height: 1024 } });
  const generation = {
    createFromAgent: vi.fn(async (userId: string, input: GenerationCreateRequest, key: string) => {
      const taskId = `creation-test-${createHash("sha256").update(key).digest("hex")}`;
      const resultId = `${taskId}-asset`;
      await prisma.generationTask.upsert({ where: { id: taskId }, update: {}, create: {
        id: taskId, userId, projectId: project.id, taskType: input.taskType, input: json(input), status: "SUCCEEDED", completedAt: new Date(),
        output: { images: [{ assetId: resultId, width: input.width, height: input.height }] },
      } });
      await prisma.designAsset.upsert({ where: { id: resultId }, update: {}, create: {
        id: resultId, projectId: project.id, generationTaskId: taskId, parentAssetId: asset.id, rootAssetId: sourceId, operation: "GENERATED",
        url: `https://assets.test/${resultId}.png`, width: input.width, height: input.height,
      } });
      return { taskId };
    }),
    get: async (_userId: string, id: string) => {
      const task = await prisma.generationTask.findUniqueOrThrow({ where: { id } });
      return { id: task.id, status: task.status.toLowerCase(), output: task.output, compiledPrompt: null, error: null };
    },
  };
  const model = { generateJson: vi.fn(async (request: AmuxClaudeJsonRequest<unknown>): Promise<unknown> => { void request; throw new Error("本测试不得调用语言模型或标签识别"); }) };
  const storage = { createDownloadUrl: async (key: string) => `https://storage.test/${key}` };
  const transforms = { enqueue: vi.fn(async (attemptId: string) => { await prisma.imageTransformResult.upsert({ where: { attemptId }, create: { attemptId, error: "受控图片处理失败" }, update: {} }); }) };
  const runtime = new WorkflowRuntimeService(prisma, workflows, generation as never, model as never, storage as never, {} as never, undefined, undefined, access, transforms as never);
  const commands = new CanvasCommandService(canvas, workflows, runtime, storage as never);
  const creations = new CanvasCreationsService(canvas, commands, workflows, access);
  await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: randomUUID(), baseRevision: 0, operations: [
    { type: "add_node", node: { id: sourceId, kind: "asset", type: "candidate", title: "同名素材", payload: { assetId: asset.id, imageUrl: `/api/design-assets/${asset.id}/content` }, x: 20, y: 30 } },
  ] });
  const draft = canvasCreationDraftSchema.parse({ prompt: "只修改袖口，其他部分保持", inputs: [{ id: "input-1", nodeId: sourceId, assetId: asset.id }], basedOnInputId: "input-1" });
  const create = (overrides: Record<string, unknown> = {}) => creations.create(user.id, project.id, createCanvasCreationSchema.parse({ id: randomUUID(), mutationId: randomUUID(), title: "袖口探索", draft, position: { x: 460, y: 30 }, ...overrides }));
  return { user, project, viewer, workspace, canvas, workflows, creations, generation, model, draft, create, sourceId, runtime, commands, access, asset, transforms,
    cleanup: () => cleanupFixture(user.id),
  };
}

async function actionScene(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown>[] = []) {
  const service = new AssistantCanvasActionsService(prisma, f.access, f.canvas, f.commands, f.creations, f.workflows);
  const conversation = await prisma.agentConversation.create({ data: { projectId: f.project.id, createdById: f.user.id, mode: "workflow", title: "画布操作验收" } });
  const source = { id: "shape:source", typeName: "shape", type: "fashion-image", parentId: "page:page", x: 20, y: 30, rotation: 0, index: "a1", isLocked: false, props: { w: 300, h: 400, assetId: f.asset.id }, meta: { canvasNodeId: f.sourceId } };
  const records = Object.fromEntries([source, ...extra].map(record => [String(record.id), record]));
  const bindings = [{ shapeId: source.id, nodeId: f.sourceId }];
  const initial = await f.canvas.initialize(f.user.id, f.project.id);
  const saved = await f.canvas.save(f.user.id, f.project.id, { mutationId: randomUUID(), baseRevision: initial.revision, snapshot: { store: records }, bindings });
  const observation: AssistantCanvasObservation = { clientId: randomUUID(), sequence: 1, revision: saved.revision, selectedIds: [source.id], omitted: 0, viewport: { x: 0, y: 0, w: 1400, h: 900 },
    objects: Object.values(records).map(record => ({ id: String(record.id), type: String(record.type), title: "测试对象", nodeId: record.id === source.id ? f.sourceId : null, creationId: typeof (record.props as Record<string, unknown>).creationId === "string" ? String((record.props as Record<string, unknown>).creationId) : null, stamp: assistantShapeStamp(record), locked: false, hidden: false, parentId: String(record.parentId), bounds: { x: Number(record.x), y: Number(record.y), w: 300, h: 400 } })) };
  const plan = async (action: AssistantCanvasAction) => {
    const messageId = randomUUID();
    const prepared = await service.prepare(f.user.id, f.project.id, conversation.id, messageId, randomUUID(), conversation.intentEpoch, action, observation);
    await prisma.agentMessage.create({ data: { id: messageId, conversationId: conversation.id, role: "ASSISTANT", status: "COMPLETED", content: "等待画布执行", context: json({ canvasAction: prepared.envelope, canvasActionData: prepared.data }) } });
    return prepared;
  };
  return { service, conversation, records, bindings, observation, plan };
}

describe("真实数据库的创作目标与执行绑定", () => {
  it("助手更新完整多色色卡并保护后续修改，已消费色卡派生保留历史", async () => {
    const f = await fixture(); const scene = await actionScene(f);
    const original = [{ hex: "#205b43", name: "深绿" }, { hex: "#b09a78", name: "亚麻" }];
    const material = await f.commands.execute(f.user.id, f.project.id, { type: "create_material", mutationId: randomUUID(), materialType: "swatch", title: "通勤配色", payload: { colors: original }, shapeId: "shape:swatch" });
    const record = { id: "shape:swatch", typeName: "shape", type: "fashion-swatch", parentId: "page:page", x: 400, y: 0, index: "a2", props: { w: 180, h: 180 }, meta: { canvasNodeId: material.nodeId } };
    const document = await f.canvas.save(f.user.id, f.project.id, { mutationId: randomUUID(), baseRevision: material.canvas.revision, snapshot: { store: { ...scene.records, [record.id]: record } }, bindings: [...scene.bindings, { shapeId: record.id, nodeId: material.nodeId }] });
    const observation: AssistantCanvasObservation = { ...scene.observation, revision: document.revision, selectedIds: [record.id], objects: [...scene.observation.objects, { id: record.id, type: record.type, title: "通勤配色", nodeId: material.nodeId, creationId: null, stamp: assistantShapeStamp(record), locked: false, hidden: false, parentId: record.parentId, bounds: { x: 400, y: 0, w: 180, h: 180 } }] };
    const colors = [...original, { hex: "#773d4a", name: "酒红" }];
    const prepare = async () => {
      const messageId = randomUUID();
      const prepared = await scene.service.prepare(f.user.id, f.project.id, scene.conversation.id, messageId, randomUUID(), 0, { type: "update_swatch", shapeId: record.id, colors }, observation);
      await prisma.agentMessage.create({ data: { id: messageId, conversationId: scene.conversation.id, role: "ASSISTANT", status: "COMPLETED", content: "等待更新色卡", context: json({ canvasAction: prepared.envelope, canvasActionData: prepared.data }) } });
      await scene.service.claim(f.user.id, scene.conversation.id, messageId, observation.clientId);
      return prepared;
    };
    const stale = await prepare();
    await prisma.workflowNode.update({ where: { id: material.nodeId }, data: { title: "用户后来改的名称" } });
    await expect(scene.service.applyServer(f.user.id, scene.conversation.id, stale.envelope.messageId, observation.clientId)).rejects.toThrow("色卡内容已更新");
    await prisma.workflowNode.update({ where: { id: material.nodeId }, data: { status: "completed" } });
    const current = await prepare();
    const result = await scene.service.applyServer(f.user.id, scene.conversation.id, current.envelope.messageId, observation.clientId);
    if (!("nodeId" in result)) throw new Error("缺少色卡更新回执");
    expect(result.nodeId).not.toBe(material.nodeId);
    expect((await prisma.workflowNode.findUniqueOrThrow({ where: { id: material.nodeId } })).payload).toMatchObject({ colors: original });
    expect((await prisma.workflowNode.findUniqueOrThrow({ where: { id: result.nodeId } })).payload).toMatchObject({ colors });
    expect(result.canvas.bindings.find(binding => binding.shapeId === record.id)?.nodeId).toBe(result.nodeId);
    expect(f.model.generateJson).not.toHaveBeenCalled(); expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  });
  it("真实助手发送只保存待执行动作，屏蔽模型抢先宣称完成，重复发送复用原操作", async () => {
    const f = await fixture(); const scene = await actionScene(f);
    await prisma.project.update({ where: { id: f.project.id }, data: { canvasInteractionMode: "canvas", workflowAgentVersion: 2 } });
    const content = "创建一张深绿与亚麻双色色卡";
    const decision = { kind: "canvas", message: "已经创建好了", canvasQuote: content, canvasAction: { type: "create_swatch", title: "通勤色卡", colors: [{ hex: "#205b43", name: "深绿" }, { hex: "#b09a78", name: "亚麻" }] } };
    const model = {
      generateJson: vi.fn(async (request: AmuxClaudeJsonRequest<unknown>) => request.parse(decision)),
      streamJson: vi.fn(async (request: AmuxClaudeJsonRequest<unknown>, onDelta: (value: { text: string; kind: string | null }) => Promise<void>) => { await onDelta({ text: "已经创建好了", kind: "canvas" }); return request.parse(decision); }),
    };
    const visual = { enrich: vi.fn(async () => ({ images: [], imageBindings: [], index: [], coverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [], unreadNodeIds: [] } })) };
    const contexts = new DesignContextService(prisma, f.workflows, f.access);
    const coordinator = new WorkflowCoordinator(prisma, f.workflows, contexts, visual as never, model as never);
    const assistant = new WorkflowAssistantService(prisma, f.workflows, f.runtime, contexts, visual as never, model as never, coordinator, f.access, f.commands, f.creations, scene.service);
    const input = { clientRequestId: randomUUID(), content, referencedNodeIds: [], canvasObservation: scene.observation };
    const observer = { accepted: vi.fn(async () => undefined), phase: vi.fn(async () => undefined), delta: vi.fn(async () => undefined), reset: vi.fn(async () => undefined) };
    const first = await assistant.send(f.user.id, scene.conversation.id, input, observer);
    expect((await prisma.agentTurn.findFirstOrThrow({ where: { conversationId: scene.conversation.id, clientRequestId: input.clientRequestId } })).error).toBeNull();
    expect(first.assistantMessage.error).toBeNull();
    expect(first.assistantMessage.status).toBe("completed");
    expect(first.assistantMessage.content).toBe("正在应用画布操作，完成后会核对保存结果。");
    const envelope = assistantCanvasEnvelopeSchema.parse(first.assistantMessage.context.canvasAction);
    expect(envelope.state).toBe("pending"); expect(first.assistantMessage.context.canvasActionData).toBeUndefined();
    expect(await prisma.workflowNode.count({ where: { projectId: f.project.id, type: "swatch" } })).toBe(0);
    expect(observer.delta).not.toHaveBeenCalled();
    const replay = await assistant.send(f.user.id, scene.conversation.id, input);
    expect(replay.assistantMessage.id).toBe(first.assistantMessage.id); expect(model.streamJson).toHaveBeenCalledOnce(); expect(model.generateJson).not.toHaveBeenCalled();
    await assistant.claimCanvasAction(f.user.id, scene.conversation.id, envelope.messageId, envelope.clientId);
    await assistant.applyCanvasAction(f.user.id, scene.conversation.id, envelope.messageId, envelope.clientId);
    expect(await prisma.workflowNode.count({ where: { projectId: f.project.id, type: "swatch" } })).toBe(1);
    await expect(assistant.finishCanvasAction(f.user.id, scene.conversation.id, envelope.messageId, envelope.clientId, "succeeded", { shapes: [], removedShapeIds: [] })).rejects.toThrow("尚未显示");
    expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  });
  it("助手添加真实已有面料，拒绝他人的私有面料和已变更的资料", async () => {
    const f = await fixture(); const scene = await actionScene(f);
    const createFabric = async (ownerId: string) => {
      const file = await prisma.fileAsset.create({ data: { ownerId, originalName: "亚麻.png", mimeType: "image/png", sizeBytes: 64, sha256: randomUUID(), objectKey: `test/${randomUUID()}`, status: "READY", width: 256, height: 256, thumbnail1024Key: `test/${randomUUID()}.webp` } });
      return prisma.fabric.create({ data: { scope: "USER", ownerId, mainFileId: file.id, details: { name: "自然亚麻" }, tags: ["亚麻"] } });
    };
    const fabric = await createFabric(f.user.id), foreign = await createFabric(f.viewer.id);
    await expect(scene.plan({ type: "add_fabric", fabricId: foreign.id })).rejects.toThrow("无权访问");
    const old = await scene.plan({ type: "add_fabric", fabricId: fabric.id });
    await scene.service.claim(f.user.id, scene.conversation.id, old.envelope.messageId, scene.observation.clientId);
    await prisma.fabric.update({ where: { id: fabric.id }, data: { details: { name: "更新后的亚麻" } } });
    await expect(scene.service.applyServer(f.user.id, scene.conversation.id, old.envelope.messageId, scene.observation.clientId)).rejects.toThrow("已变化");
    const prepared = await scene.plan({ type: "add_fabric", fabricId: fabric.id });
    await scene.service.claim(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId);
    const result = await scene.service.applyServer(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId);
    if (!("nodeId" in result)) throw new Error("缺少面料回执");
    const node = await prisma.workflowNode.findUniqueOrThrow({ where: { id: result.nodeId } });
    expect(node.type).toBe("fabric"); expect(node.payload).toMatchObject({ fabricId: fabric.id, fileAssetId: fabric.mainFileId });
    expect(f.model.generateJson).not.toHaveBeenCalled(); expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  });
  it("助手拒绝只读写入、锁定对象、过时操作和目标修改后的连接", async () => {
    const f = await fixture(); const target = await f.create({ draft: canvasCreationDraftSchema.parse({ prompt: "最新夹克要求" }) });
    const record = { id: "shape:target", typeName: "shape", type: "fashion-creation", parentId: "page:page", x: 500, y: 0, index: "a2", props: { w: 300, h: 200, creationId: target.id }, meta: {} };
    const scene = await actionScene(f, [record]);
    await expect(scene.service.prepare(f.viewer.id, f.project.id, scene.conversation.id, randomUUID(), randomUUID(), 0, { type: "create_swatch", title: "配色", colors: [{ hex: "#205b43", name: "深绿" }] }, scene.observation)).rejects.toThrow();
    const connection = await scene.plan({ type: "connect_inputs", targetCreationId: target.id, sourceShapeIds: ["shape:source"] });
    await scene.service.claim(f.user.id, scene.conversation.id, connection.envelope.messageId, scene.observation.clientId);
    await f.creations.update(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: target.revision, draft: { ...target.draft, prompt: "用户新编辑的草稿" } });
    await expect(scene.service.applyServer(f.user.id, scene.conversation.id, connection.envelope.messageId, scene.observation.clientId)).rejects.toThrow("已更新");
    expect((await f.creations.read(f.user.id, f.project.id, target.id)).draft.prompt).toBe("用户新编辑的草稿");
    const old = await scene.plan({ type: "create_swatch", title: "过时配色", colors: [{ hex: "#205b43", name: "深绿" }] });
    await prisma.agentConversation.update({ where: { id: scene.conversation.id }, data: { intentEpoch: { increment: 1 } } });
    await expect(scene.service.claim(f.user.id, scene.conversation.id, old.envelope.messageId, scene.observation.clientId)).rejects.toThrow("新的用户请求");
    const current = await f.canvas.read(f.user.id, f.project.id);
    const locked = { ...scene.records["shape:source"], isLocked: true };
    await f.canvas.save(f.user.id, f.project.id, { mutationId: randomUUID(), baseRevision: current.revision, snapshot: { store: { ...scene.records, "shape:source": locked } }, bindings: scene.bindings });
    const observed = { ...scene.observation, objects: scene.observation.objects.map(item => item.id === "shape:source" ? { ...item, stamp: assistantShapeStamp(locked) } : item) };
    await expect(scene.service.prepare(f.user.id, f.project.id, scene.conversation.id, randomUUID(), randomUUID(), 1, { type: "move_objects", shapeIds: ["shape:source"], offset: { x: 50, y: 0 } }, observed)).rejects.toThrow("锁定");
    expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  });
  it("助手色卡动作先领取、幂等创建、保存后才有成功回执", async () => {
    const f = await fixture(); const scene = await actionScene(f);
    const action: AssistantCanvasAction = { type: "create_swatch", title: "通勤配色", colors: [{ hex: "#205b43", name: "深绿" }, { hex: "#b09a78", name: "亚麻" }] };
    const prepared = await scene.plan(action);
    await expect(scene.service.applyServer(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId)).rejects.toThrow("尚未领取");
    await scene.service.claim(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId);
    const applied = await scene.service.applyServer(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId);
    const repeated = await scene.service.applyServer(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId);
    if (!("nodeId" in applied) || !("nodeId" in repeated)) throw new Error("缺少素材回执");
    expect(repeated.nodeId).toBe(applied.nodeId);
    const record = { id: `shape:assistant-${prepared.envelope.id}`, typeName: "shape", type: "fashion-swatch", parentId: "page:page", x: 200, y: 100, rotation: 0, index: "a2", isLocked: false, props: { w: 180, h: 100 }, meta: { canvasNodeId: applied.nodeId } };
    await f.canvas.save(f.user.id, f.project.id, { mutationId: randomUUID(), baseRevision: applied.canvas.revision, snapshot: { store: { ...scene.records, [record.id]: record } }, bindings: [...scene.bindings, { shapeId: record.id, nodeId: applied.nodeId }] });
    const proof = { shapes: [{ id: record.id, stamp: assistantShapeStamp(record) }], removedShapeIds: [] };
    const done = await scene.service.finish(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId, "succeeded", proof);
    expect(done.content).toContain("已完成");
    expect(assistantCanvasResultSchema.parse((done.context as { canvasActionResult: unknown }).canvasActionResult)).toMatchObject({ actionId: prepared.envelope.id, targets: [{ id: applied.nodeId, title: "通勤配色", kind: "swatch" }] });
    expect((await scene.service.finish(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId, "failed", proof, "迟到错误")).content).toBe(done.content);
    expect(await prisma.workflowNode.count({ where: { projectId: f.project.id, type: "swatch" } })).toBe(1);
    expect(f.model.generateJson).not.toHaveBeenCalled(); expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  });
  it("助手连接可引用空目标，保存要求不变；循环、跨客户端和过期回执被拒绝", async () => {
    const f = await fixture(); const upstream = await f.create({ draft: canvasCreationDraftSchema.parse({ prompt: "上游要求" }) });
    const target = await f.create({ draft: canvasCreationDraftSchema.parse({ prompt: "下游要求" }) });
    const extra = [{ id: "shape:upstream", typeName: "shape", type: "fashion-creation", parentId: "page:page", x: 10, y: 10, rotation: 0, index: "a2", props: { w: 300, h: 200, creationId: upstream.id }, meta: { canvasNodeId: "" } },
      { id: "shape:target", typeName: "shape", type: "fashion-creation", parentId: "page:page", x: 500, y: 10, rotation: 0, index: "a3", props: { w: 300, h: 200, creationId: target.id }, meta: { canvasNodeId: "" } }];
    const scene = await actionScene(f, extra);
    const prepared = await scene.plan({ type: "connect_inputs", targetCreationId: target.id, sourceShapeIds: [extra[0]?.id ?? ""] });
    await expect(scene.service.claim(f.user.id, scene.conversation.id, prepared.envelope.messageId, randomUUID())).rejects.toThrow("浏览器画布");
    await scene.service.claim(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId);
    const applied = await scene.service.applyServer(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId);
    if (!("creation" in applied)) throw new Error("缺少连接回执");
    expect(applied.creation.draft.prompt).toBe("下游要求"); expect(applied.creation.draft.inputs[0]?.creationId).toBe(upstream.id);
    const reclaimed = await scene.service.claim(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId);
    expect(assistantCanvasEnvelopeSchema.parse((reclaimed.context as { canvasAction: unknown }).canvasAction).serverApplied).toBe(true);
    const linked = await scene.service.finish(f.user.id, scene.conversation.id, prepared.envelope.messageId, scene.observation.clientId, "succeeded", { shapes: [], removedShapeIds: [] });
    expect(assistantCanvasResultSchema.parse((linked.context as { canvasActionResult: unknown }).canvasActionResult)).toMatchObject({ actionId: prepared.envelope.id, destination: { id: target.id, title: target.title, kind: "creation" }, generation: "not_started" });
    await expect(f.creations.update(f.user.id, f.project.id, upstream.id, { mutationId: randomUUID(), expectedRevision: upstream.revision, draft: { ...upstream.draft, inputs: [{ id: "cycle", creationId: target.id }] } })).rejects.toThrow("循环");
    const move = await scene.plan({ type: "move_objects", shapeIds: ["shape:source"], offset: { x: 100, y: 0 } });
    await scene.service.claim(f.user.id, scene.conversation.id, move.envelope.messageId, scene.observation.clientId);
    await expect(scene.service.finish(f.user.id, scene.conversation.id, move.envelope.messageId, scene.observation.clientId, "succeeded", { shapes: [], removedShapeIds: [] })).rejects.toThrow("缺少目标");
    expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  });
  it("新画布和旧命令入口直接生图，不调用需求分析或扩写模型", async () => {
    const f = await fixture();
    const target = await f.create({ draft: canvasCreationDraftSchema.parse({ prompt: "绿色夹克" }) });
    const result = await f.creations.run(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: target.revision });
    expect(result.currentResult?.assetId).toBeTruthy();
    await f.commands.execute(f.user.id, f.project.id, { type: "run_tool", mutationId: randomUUID(), toolKey: "generate_design", title: "图片生成", parameters: { prompt: "白色衬衫", count: 1 }, inputs: [] });
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(2); expect(f.model.generateJson).not.toHaveBeenCalled();
    const graph = await f.workflows.get(f.user.id, f.project.id);
    expect(graph.nodes.some(node => ["analyze_brief", "evaluate_design", "constraint", "evaluation"].includes(node.type))).toBe(false);
    expect(f.generation.createFromAgent.mock.calls.map(call => call[1].prompt)).toEqual(["绿色夹克", "白色衬衫"]);
  });
  it("退役工具拒绝新目标和新执行，已有分析结果及图片仍可读取", async () => {
    const f = await fixture();
    for (const module of ["analysis", "evaluation"]) await expect(f.create({ module })).rejects.toThrow("已退役");
    for (const toolKey of ["analyze_brief", "evaluate_design"] as const) await expect(f.commands.execute(f.user.id, f.project.id, { type: "run_tool", mutationId: randomUUID(), toolKey, title: "旧工具", parameters: { prompt: "旧要求" }, inputs: [] })).rejects.toThrow("已退役");
    const id = randomUUID(), runId = randomUUID(), nodeId = randomUUID();
    await prisma.canvasCreation.create({ data: { id, projectId: f.project.id, createdById: f.user.id, title: "旧分析", module: "analysis", draft: json(f.draft), currentResultNodeId: nodeId } });
    await prisma.canvasCreationRun.create({ data: { id: runId, projectId: f.project.id, creationId: id, actorId: f.user.id, mutationId: runId, requestHash: "legacy", draftRevision: 0, draftSnapshot: json(f.draft), command: {}, state: "manual" } });
    await prisma.workflowNode.create({ data: { id: nodeId, projectId: f.project.id, kind: "asset", type: "constraint", title: "原设计约束", payload: { text: "旧的立领要求", canvasCreationId: id, canvasCreationRunId: runId }, x: 0, y: 0, status: "completed" } });
    const saved = await f.creations.read(f.user.id, f.project.id, id);
    expect(saved.currentResult?.text).toBe("旧的立领要求"); expect(saved.runs).toHaveLength(1);
    await expect(f.creations.run(f.user.id, f.project.id, id, { mutationId: randomUUID(), expectedRevision: 0 })).rejects.toThrow("已退役");
    expect(await prisma.designAsset.findUnique({ where: { id: f.asset.id } })).toBeTruthy();
    expect(f.model.generateJson).not.toHaveBeenCalled(); expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  });
  it("助手明确生图直接复用创作命令，不启动旧分析或评估", async () => {
    const f = await fixture();
    const conversation = await prisma.agentConversation.create({ data: { projectId: f.project.id, createdById: f.user.id, mode: "workflow", title: "直接生图" } });
    const request = "生成一张蓝色外套";
    const decision = plannerDecisionSchema.parse({ kind: "propose", message: "提交图片生成", action: { type: "create_tool", toolKey: "generate_design", toolVersion: "1", title: "图片生成", parameters: { prompt: request, count: 1 }, inputs: [], rationale: "用户明确生成" }, execution: { requested: true, operation: "generate_design", sourceQuote: request, parameters: { count: 1 } } });
    const result = await f.creations.executeAssistant(f.user.id, f.project.id, conversation.id, randomUUID(), decision, { intentEpoch: conversation.intentEpoch, nodeVersions: {} });
    expect(result.currentResult?.assetId).toBeTruthy(); expect(f.generation.createFromAgent).toHaveBeenCalledTimes(1); expect(f.model.generateJson).not.toHaveBeenCalled();
    expect(f.generation.createFromAgent.mock.calls[0]?.[1].prompt).toBe(request);
    expect((await f.workflows.get(f.user.id, f.project.id)).nodes.some(node => ["analyze_brief", "evaluate_design"].includes(node.type))).toBe(false);
  });
  it("手动文本保存为真实版本，重放不重复，修改失败不覆盖正文", async () => {
    const f = await fixture();
    const conversation = await prisma.agentConversation.create({ data: { projectId: f.project.id, createdById: f.user.id, mode: "workflow", title: "保存记录隔离" } });
    const historical = await prisma.agentMessage.create({ data: { conversationId: conversation.id, role: "ASSISTANT", status: "COMPLETED", origin: "creative_activity", content: "原有保存历史" } });
    const draft = canvasCreationDraftSchema.parse({ textMode: "manual", textContent: "第一段手动文本" });
    const target = await f.create({ module: "text", draft });
    const packet = { mutationId: randomUUID(), expectedRevision: target.revision, draft, publishText: true, conversationId: conversation.id };
    const saved = await f.creations.update(f.user.id, f.project.id, target.id, packet);
    const replay = await f.creations.update(f.user.id, f.project.id, target.id, packet);
    expect(saved.currentResult?.text).toBe("第一段手动文本"); expect(saved.runs[0]?.status).toBe("completed"); expect(replay.runs).toHaveLength(1);
    await expect(f.creations.update(f.user.id, f.project.id, target.id, { ...packet, mutationId: randomUUID(), draft: { ...draft, textContent: "过期修改" } })).rejects.toMatchObject({ status: 409 });
    expect((await f.creations.read(f.user.id, f.project.id, target.id)).currentResult?.text).toBe("第一段手动文本");
    expect(f.model.generateJson).not.toHaveBeenCalled(); expect(f.generation.createFromAgent).not.toHaveBeenCalled();
    expect((await prisma.agentMessage.findMany({ where: { conversationId: conversation.id } })).map(item => item.id)).toEqual([historical.id]);
  });

  it("失败任务的完成回执携带真实失败状态，不伪装成创作成功", async () => {
    const f = await fixture();
    const conversation = await prisma.agentConversation.create({ data: { projectId: f.project.id, createdById: f.user.id, mode: "workflow", title: "失败回执" } });
    await f.creations.executeToolCommand(f.user.id, f.project.id, { type: "run_tool", mutationId: randomUUID(), toolKey: "transform_image", title: "旋转图片", parameters: { width: 3000, height: 2000, rotate: 90 }, inputs: [{ nodeId: f.sourceId, port: "source" }], conversationId: conversation.id });
    const event = await prisma.workflowOutbox.findFirstOrThrow({ where: { projectId: f.project.id, eventType: "execution.terminal" } });
    const assistant = new WorkflowAssistantService(prisma, f.workflows, f.runtime, {} as never, {} as never, f.model as never, undefined, f.access, f.commands, f.creations);
    await assistant.observeExecution(event.id);
    const page = await assistant.messages(f.user.id, conversation.id, { limit: 20 });
    const completed = page.items.find(item => item.origin === "execution_result");
    expect(completed?.context.creationActivity).toMatchObject({ event: "completed", status: "failed", task: true });
    expect(completed?.context.executionResult).toMatchObject({ status: "failed", images: [] });
    expect(f.model.generateJson).not.toHaveBeenCalled();
  });

  it("尚无执行回执的提交错误保持待确认，读取不重新发起任务", async () => {
    const f = await fixture();
    const conversation = await prisma.agentConversation.create({ data: { projectId: f.project.id, createdById: f.user.id, mode: "workflow", title: "未知回执" } });
    const target = await f.create();
    const run = await prisma.canvasCreationRun.create({ data: { id: randomUUID(), projectId: f.project.id, creationId: target.id, actorId: f.user.id, mutationId: randomUUID(), requestHash: "unknown-receipt", draftRevision: target.revision, draftSnapshot: json(target.draft), command: {}, conversationId: conversation.id, error: "网络回执丢失" } });
    await prisma.agentMessage.create({ data: { conversationId: conversation.id, role: "ASSISTANT", status: "COMPLETED", origin: "creative_activity", content: "提交创作", context: json({ creationActivity: { creationId: target.id, runId: run.id, event: "submitted", title: target.title, prompt: target.draft.prompt, inputNodeIds: [], resultNodeId: null } }) } });
    const assistant = new WorkflowAssistantService(prisma, f.workflows, f.runtime, {} as never, {} as never, f.model as never, undefined, f.access, f.commands, f.creations);
    const page = await assistant.messages(f.user.id, conversation.id, { limit: 20 });
    expect(page.items[0]?.context.creationActivity).toMatchObject({ status: "unconfirmed", runId: run.id });
    expect(f.generation.createFromAgent).not.toHaveBeenCalled();
    expect(f.model.generateJson).not.toHaveBeenCalled();
  });

  it("文本AI起草使用真实文本工具，原要求进入模型，幂等回执不重复调用", async () => {
    const f = await fixture();
    f.model.generateJson.mockImplementation(async request => request.parse({ text: "轻盈而克制的春夏系列文案。" }));
    const target = await f.create({ module: "text", draft: canvasCreationDraftSchema.parse({ prompt: "写一句春夏系列文案", textMode: "ai" }) });
    const packet = { mutationId: randomUUID(), expectedRevision: target.revision };
    const result = await f.creations.run(f.user.id, f.project.id, target.id, packet);
    expect(result.currentResult?.text).toBe("轻盈而克制的春夏系列文案。"); expect(result.runs[0]?.status).toBe("completed");
    await f.creations.run(f.user.id, f.project.id, target.id, packet);
    expect(f.model.generateJson).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.model.generateJson.mock.calls[0]?.[0].prompt ?? "{}")).toMatchObject({ request: "写一句春夏系列文案", references: [] });
    expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  });

  it("空节点可以预先连线，执行等待真实产物并冻结准确版本", async () => {
    const f = await fixture();
    const upstream = await f.create({ draft: canvasCreationDraftSchema.parse({ prompt: "生成原图" }) });
    const downstream = await f.create({ draft: canvasCreationDraftSchema.parse({ prompt: "根据参考修改", inputs: [{ id: "planned", creationId: upstream.id }] }) });
    await expect(f.creations.run(f.user.id, f.project.id, downstream.id, { mutationId: randomUUID(), expectedRevision: downstream.revision })).rejects.toThrow("尚无可用结果");
    expect(f.generation.createFromAgent).not.toHaveBeenCalled();
    const ready = await f.creations.run(f.user.id, f.project.id, upstream.id, { mutationId: randomUUID(), expectedRevision: upstream.revision });
    const output = await f.creations.run(f.user.id, f.project.id, downstream.id, { mutationId: randomUUID(), expectedRevision: downstream.revision });
    expect(output.runs[0]?.inputSnapshot[0]).toMatchObject({ creationId: upstream.id, nodeId: ready.currentResultNodeId });
    expect(output.runs[0]?.inputSnapshot[0]?.nodeVersionId).toBeTruthy();
  });

  it("视频目标不冒充可生成的工具", async () => {
    const f = await fixture(); const target = await f.create({ module: "video", draft: canvasCreationDraftSchema.parse({}) });
    await expect(f.creations.run(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: target.revision })).rejects.toThrow("只支持导入");
    expect(f.generation.createFromAgent).not.toHaveBeenCalled(); expect(f.model.generateJson).not.toHaveBeenCalled();
  });
  it("助手创建和接线只准备目标，不执行生成", async () => {
    const f = await fixture();
    const decision = plannerDecisionSchema.parse({ kind: "propose", message: "准备目标", prepareOnly: true, preparationQuote: "新建一个空节点，先不要生成", action: { type: "create_tool", toolKey: "generate_design", toolVersion: "1", title: "新图片", parameters: { prompt: "" }, inputs: [], rationale: "明确创建空目标" } });
    const messageId = randomUUID();
    const a = await f.creations.prepareAssistant(f.user.id, f.project.id, messageId, decision);
    const replay = await f.creations.prepareAssistant(f.user.id, f.project.id, messageId, decision);
    expect(replay.id).toBe(a.id); expect(a.draft.prompt).toBe(""); expect(a.runs).toEqual([]);
    if (!decision.action) throw new Error("测试缺少准备动作");
    const connected = await f.creations.prepareAssistant(f.user.id, f.project.id, randomUUID(), { ...decision, preparationQuote: "把这张图片连接到目标", canvasTarget: { creationId: a.id, revision: a.revision, mode: "regenerate" }, action: { ...decision.action, inputs: [{ nodeId: f.sourceId, port: "reference" }] } });
    expect(connected.draft.inputs[0]?.nodeId).toBe(f.sourceId); expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  });

  it("已有图片工具通过同一目标协议执行、重试和重跑，保留工具参数", async () => {
    const f = await fixture();
    const command = { type: "run_tool" as const, mutationId: randomUUID(), toolKey: "transform_image" as const, title: "旋转图片", parameters: { width: 3000, height: 2000, rotate: 90 }, inputs: [{ nodeId: f.sourceId, port: "source" as const }] };
    const response = await f.creations.executeToolCommand(f.user.id, f.project.id, command);
    const replay = await f.creations.executeToolCommand(f.user.id, f.project.id, command);
    expect(replay.nodeId).toBe(response.nodeId); expect(f.transforms.enqueue).toHaveBeenCalledTimes(1);
    const list = await f.creations.list(f.user.id, f.project.id); expect(list.items).toHaveLength(1);
    const target = list.items[0]; if (!target) throw new Error("没有创作目标");
    expect(target.draft.operation).toMatchObject({ toolKey: "transform_image", parameters: { rotate: 90, width: 3000, height: 2000 } });
    expect(target.runs[0]?.status).toBe("failed");
    const rerun = await f.creations.run(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: target.revision });
    expect(rerun.runs).toHaveLength(2); expect(rerun.id).toBe(target.id); expect(f.generation.createFromAgent).not.toHaveBeenCalled();
  }, 30_000);

  it("纯文字目标直接生成，助手与手工共用目标执行，事实回执不触发模型回复", async () => {
    const f = await fixture();
    const conversation = await prisma.agentConversation.create({ data: { projectId: f.project.id, createdById: f.user.id, title: "创作记录", mode: "workflow" } });
    const draft = canvasCreationDraftSchema.parse({ prompt: "生成一件米白色外套" });
    const target = await f.create({ draft });
    const executed = await f.creations.run(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: target.revision, conversationId: conversation.id });
    expect(executed.runs[0]?.status).toBe("completed");
    expect(f.model.generateJson).not.toHaveBeenCalled();
    const messages = await prisma.agentMessage.findMany({ where: { conversationId: conversation.id } });
    expect(messages).toHaveLength(1); expect(messages[0]?.origin).toBe("creative_activity");
    const event = await prisma.workflowOutbox.findFirstOrThrow({ where: { projectId: f.project.id, eventType: "execution.terminal" } });
    const assistant = new WorkflowAssistantService(prisma, f.workflows, f.runtime, {} as never, {} as never, f.model as never, undefined, f.access, f.commands, f.creations);
    expect(await assistant.observeExecution(event.id)).toBe("completed");
    expect(await assistant.observeExecution(event.id)).toBe("completed");
    expect(await prisma.agentMessage.count({ where: { conversationId: conversation.id, origin: "execution_result" } })).toBe(1);
    const page = await assistant.messages(f.user.id, conversation.id, { limit: 20 });
    const submission = page.items.find(item => item.origin === "creative_activity");
    expect(submission?.context.executionProgress).toMatchObject({ executionId: submission?.executionId, status: "completed" });
    expect(submission?.context.executionResult).toMatchObject({ executionId: submission?.executionId, status: "completed" });
    expect(submission?.context.creationActivity).toMatchObject({ status: "completed" });
    expect(page.items.find(item => item.origin === "execution_result")?.context.creationActivity).toMatchObject({ status: "completed", task: true });
    expect(f.model.generateJson).not.toHaveBeenCalled();
    const decision = plannerDecisionSchema.parse({ kind: "propose", message: "重新生成这张图", action: { type: "create_tool", toolKey: "generate_design", toolVersion: "1", title: "米白外套", parameters: { prompt: "生成一件米白色外套" }, inputs: [], rationale: "按本次要求" }, canvasTarget: { creationId: target.id, revision: executed.revision, mode: "regenerate" }, execution: { requested: true, operation: "generate_design", sourceQuote: "重新生成这张图", parameters: {} } });
    const messageId = randomUUID();
    const result = await f.creations.executeAssistant(f.user.id, f.project.id, conversation.id, messageId, decision, { intentEpoch: conversation.intentEpoch, nodeVersions: {} });
    const replay = await f.creations.executeAssistant(f.user.id, f.project.id, conversation.id, messageId, decision, { intentEpoch: conversation.intentEpoch, nodeVersions: {} });
    expect(result.id).toBe(target.id); expect(replay.runs).toHaveLength(2);
    expect(f.generation.createFromAgent).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("印花修订和实验任务适配真实成果，重复关联不重复创作记录", async () => {
    const f = await fixture();
    const conversation = await prisma.agentConversation.create({ data: { projectId: f.project.id, createdById: f.user.id, mode: "workflow", title: "资料保存隔离" } });
    const target = await f.create({ module: "patterns", draft: {} });
    const document = await prisma.studioDocument.create({ data: { projectId: f.project.id, ownerId: f.user.id, documentId: randomUUID(), type: "PRINT_PATTERN", revision: 1, payload: { name: "细密条纹", sourceAssetId: f.asset.id, scale: 1.2, rotation: 30, brightness: 1, notes: "保持原始色彩" } } });
    const linked = await f.creations.update(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: target.revision, resource: { kind: "pattern", id: document.id }, conversationId: conversation.id });
    expect(linked.runs).toHaveLength(1); expect(linked.runs[0]?.status).toBe("completed"); expect(linked.currentResult?.text).toContain("细密条纹");
    const repeated = await f.creations.update(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: linked.revision, resource: { kind: "pattern", id: document.id } });
    expect(repeated.runs).toHaveLength(1);
    expect(await prisma.agentMessage.count({ where: { conversationId: conversation.id } })).toBe(0);
    expect(f.generation.createFromAgent).not.toHaveBeenCalled();
    const next = await f.create({ draft: { prompt: "使用这份印花资料生成外套", inputs: [{ id: "reference", creationId: target.id, nodeId: linked.currentResult?.nodeId }] } });
    const generated = await f.creations.run(f.user.id, f.project.id, next.id, { mutationId: randomUUID(), expectedRevision: next.revision });
    expect(generated.runs[0]?.status).toBe("completed");
    expect(f.generation.createFromAgent.mock.calls[0]?.[1].prompt).toContain("细密条纹");
  }, 30_000);

  it("空目标可持久化，修改有版本保护，只读成员不能写入", async () => {
    const f = await fixture();
    try {
      const target = await f.create({ draft: {} });
      expect(target.currentResult).toBeNull();
      expect(target.runs).toEqual([]);
      expect(f.generation.createFromAgent).not.toHaveBeenCalled();
      const update = { mutationId: randomUUID(), expectedRevision: target.revision, draft: f.draft };
      const saved = await f.creations.update(f.user.id, f.project.id, target.id, update);
      expect(saved.revision).toBe(1);
      expect((await f.creations.update(f.user.id, f.project.id, target.id, update)).revision).toBe(1);
      await expect(f.creations.update(f.user.id, f.project.id, target.id, { ...update, mutationId: randomUUID() })).rejects.toMatchObject({ status: 409 });
      await expect(f.creations.update(f.viewer.id, f.project.id, target.id, { ...update, expectedRevision: 1, mutationId: randomUUID() })).rejects.toMatchObject({ status: 403 });
      expect((await f.creations.read(f.viewer.id, f.project.id, target.id)).draft.prompt).toBe(f.draft.prompt);
    } finally { await f.cleanup(); }
  });

  it("重复提交只生成一次，重跑保持目标身份、位置与先前结果", async () => {
    const f = await fixture();
    try {
      const target = await f.create();
      const request = { mutationId: randomUUID(), expectedRevision: target.revision };
      const first = await f.creations.run(f.user.id, f.project.id, target.id, request);
      const replay = await f.creations.run(f.user.id, f.project.id, target.id, request);
      expect(first.runs).toHaveLength(1);
      expect(replay.currentResult?.assetId).toBe(first.currentResult?.assetId);
      expect(first.runs[0]?.status).toBe("completed");
      expect(first.runs[0]?.inputSnapshot[0]?.nodeVersionId).toBeTruthy();
      expect(f.generation.createFromAgent).toHaveBeenCalledTimes(1);
      const changed = await f.creations.update(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: target.revision, draft: { ...f.draft, prompt: "这次改成宽袖口" } });
      const second = await f.creations.run(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: changed.revision });
      expect(second.id).toBe(target.id);
      expect(second.position).toEqual(target.position);
      expect(second.runs).toHaveLength(2);
      expect(second.currentResult?.assetId).not.toBe(first.currentResult?.assetId);
      expect(second.runs[1]?.draft.prompt).toBe(f.draft.prompt);
      expect(f.model.generateJson).not.toHaveBeenCalled();
      // Outputs belong to their target and are not also auto-placed as duplicates.
      const canvas = await f.canvas.read(f.user.id, f.project.id);
      expect(canvas.bindings.map((binding) => binding.nodeId)).toEqual([f.sourceId]);
      const adopted = await f.creations.update(f.user.id, f.project.id, target.id, { mutationId: randomUUID(), expectedRevision: second.revision, currentResultNodeId: first.currentResult?.nodeId });
      expect(adopted.currentResult?.assetId).toBe(first.currentResult?.assetId);
      expect(adopted.draft.prompt).toBe(f.draft.prompt);
    } finally { await f.cleanup(); }
  }, 30_000);

  it("连接只准备输入，不执行；拒绝自连、循环和跨项目素材", async () => {
    const f = await fixture();
    try {
      const a = await f.create({ draft: {} });
      const b = await f.create({ draft: { inputs: [{ id: "a", creationId: a.id }] } });
      await expect(f.creations.update(f.user.id, f.project.id, a.id, { mutationId: randomUUID(), expectedRevision: a.revision, draft: canvasCreationDraftSchema.parse({ inputs: [{ id: "b", creationId: b.id }] }) })).rejects.toThrow("循环");
      await expect(f.creations.update(f.user.id, f.project.id, a.id, { mutationId: randomUUID(), expectedRevision: a.revision, draft: canvasCreationDraftSchema.parse({ inputs: [{ id: "self", creationId: a.id }] }) })).rejects.toThrow("自身");
      await expect(f.create({ draft: { inputs: [{ id: "foreign", nodeId: randomUUID() }] } })).rejects.toThrow("不属于本项目");
      expect(f.generation.createFromAgent).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });
});
