import { createHash } from "node:crypto";
import { amuxClaudeClientConfigFromEnv, imageVisualDescriptionSchema, visualSummaryFingerprint, type AmuxClaudeJsonClient } from "@fashion/ai";
import { prisma } from "@fashion/db";
import { VISUAL_SUMMARY_SCHEMA_VERSION, workflowReferenceSummarySchema } from "@fashion/shared";
import sharp from "sharp";
import { afterAll, expect, it, vi } from "vitest";
import { DesignContextService } from "../design-context/design-context.service";
import { VisualContextService } from "../design-context/visual-context.service";
import { S3FileStorage } from "../files/storage.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { WorkflowAssistantService } from "./workflow-assistant.service";
import { WorkflowRuntimeService } from "./workflow-runtime.service";
import { parsePlannerDecision } from "./workflow-planner";

afterAll(async () => prisma.$disconnect());

it("真实私有图片经分析请求去重、补读和持久化引用记录，刷新不丢失先前图片", async () => {
  const token = crypto.randomUUID();
  const user = await prisma.user.create({ data: {
    email: `visual-context-${token}@example.com`,
    ownedWorkspaces: { create: { name: "视觉引用验证", projects: { create: { name: "多图参考" } } } },
  }, include: { ownedWorkspaces: { include: { projects: true } } } });
  const project = user.ownedWorkspaces[0]?.projects[0];
  if (!project) throw new Error("测试项目缺失");
  const storage = new S3FileStorage();
  const keys: string[] = [];
  const fingerprints: string[] = [];
  const fileIds: string[] = [];
  const bytesById = new Map<string, Buffer>();
  const summaryModel = amuxClaudeClientConfigFromEnv().model;
  try {
    // Real, different WebP files. Cached analysis is a fixture, never a model call.
    for (let i = 0; i < 9; i++) {
      const fileId = crypto.randomUUID();
      const key = `integration/visual-context/${token}/${fileId}.webp`;
      const bytes = await sharp({ create: { width: 32 + i, height: 48, channels: 3, background: { r: i * 25, g: 80, b: 170 } } }).webp().toBuffer();
      keys.push(key);
      await storage.uploadBuffer(key, bytes, "image/webp", createHash("sha256").update(bytes).digest("base64"));
      await prisma.fileAsset.create({ data: { id: fileId, ownerId: user.id, status: "READY", mimeType: "image/webp", sizeBytes: bytes.length,
        originalName: `参考-${i}.webp`, sha256: createHash("sha256").update(bytes).digest("hex"), objectKey: key, thumbnail1024Key: key } });
      const fingerprint = visualSummaryFingerprint(bytes, summaryModel);
      fingerprints.push(fingerprint);
      await prisma.imageVisualSummary.upsert({ where: { fingerprint }, update: {}, create: { fingerprint, sourceKey: key, model: summaryModel,
        schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION, status: "READY", summary: imageVisualDescriptionSchema.parse({ subject: `测试图片 ${i}`, silhouette: [], visibleStructure: [], colors: [], surfaceTexture: [], uncertainties: ["测试图块不能确认真实成分和尺寸"] }) } });
      fileIds.push(fileId);
      bytesById.set(fileId, bytes);
    }
    const workflows = new WorkflowsService(prisma);
    const contexts = new DesignContextService(prisma, workflows);
    const nodes = Array.from({ length: 16 }, (_, i) => {
      const fileAssetId = fileIds[i < 8 ? 0 : i - 7];
      if (!fileAssetId) throw new Error("测试文件缺失");
      return { id: crypto.randomUUID(), kind: "asset" as const, type: "reference_image" as const,
        title: i < 8 ? `同图副本 ${i + 1}` : `独立参考 ${i - 7}`, payload: { fileAssetId }, x: i * 120, y: 0, status: "ready" as const };
    });
    const lastNode = nodes.at(-1);
    if (!lastNode) throw new Error("补读节点缺失");
    await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0,
      operations: nodes.map(node => ({ type: "add_node", node })) });
    const conversation = await prisma.agentConversation.create({ data: { projectId: project.id, createdById: user.id, mode: "workflow", title: "多图参考" } });
    const jobs = { enqueue: vi.fn(async () => undefined) };
    const visual = new VisualContextService(prisma, storage, jobs);
    const calls: Parameters<AmuxClaudeJsonClient["generateJson"]>[0][] = [];
    const reply = parsePlannerDecision({ kind: "reply", message: "已记录本轮图片输入范围。", plan: null, objectiveUpdate: null, preferences: [] });
    const model = { generateJson: vi.fn(async (request: Parameters<AmuxClaudeJsonClient["generateJson"]>[0]) => {
      calls.push(request);
      return request.parse(calls.length === 1
        ? { ...reply, kind: "read", reads: [{ type: "images", ids: [lastNode.id] }] }
        : reply);
    }) };
    const generation = { createFromAgent: vi.fn() };
    const runtime = new WorkflowRuntimeService(prisma, workflows, generation as never, model as never, {} as never, {} as never);
    const assistant = new WorkflowAssistantService(prisma, workflows, runtime, contexts, visual, model as never);
    const result = await assistant.send(user.id, conversation.id, { clientRequestId: token, content: "比较这些参考，不生成图片", referencedNodeIds: nodes.map(node => node.id) });
    const turn = await prisma.agentTurn.findFirstOrThrow({ where: { conversationId: conversation.id }, select: { error: true } });
    expect(result.assistantMessage.status, turn.error ?? result.assistantMessage.content).toBe("completed");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.images).toHaveLength(8);
    expect(calls[1]?.images).toHaveLength(8);
    const first = JSON.parse(calls[0]?.prompt ?? "{}");
    expect(first.imageBindings).toHaveLength(15);
    expect(first.imageBindings.slice(0, 8).map((binding: { imageIndex: number }) => binding.imageIndex)).toEqual(Array(8).fill(0));
    for (const call of calls) {
      const prompt = JSON.parse(call.prompt);
      for (const binding of prompt.imageBindings as Array<{ fileAssetId: string; imageIndex: number }>) {
        const encoded = call.images?.[binding.imageIndex]?.url.split(",")[1];
        expect(encoded).toBe(bytesById.get(binding.fileAssetId)?.toString("base64"));
      }
    }
    expect(result.assistantMessage.context?.visualCoverage).toMatchObject({ attachedImageCount: 8, providedImageCount: 9, providedNodeIds: nodes.map(node => node.id) });
    expect(workflowReferenceSummarySchema.parse(result.assistantMessage.context?.referenceSummary).images).toEqual(nodes.map(node => ({ nodeId: node.id, title: node.title })));
    const reloaded = await assistant.messages(user.id, conversation.id, { limit: 50 });
    expect(reloaded.items.find(message => message.id === result.assistantMessage.id)?.context).toEqual(result.assistantMessage.context);
    expect(JSON.stringify(result.assistantMessage.context)).not.toContain("integration/visual-context");
    expect(JSON.stringify(result.assistantMessage.context)).not.toContain("base64");
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(generation.createFromAgent).not.toHaveBeenCalled();
    expect(await prisma.generationTask.count({ where: { projectId: project.id } })).toBe(0);
  } finally {
    for (const key of keys) await storage.delete(key);
    await prisma.imageVisualSummary.deleteMany({ where: { fingerprint: { in: fingerprints }, sourceKey: { in: keys } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}, 45_000);
