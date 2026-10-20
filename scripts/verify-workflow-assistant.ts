import "../apps/api/node_modules/reflect-metadata";
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NestFactory } from "../apps/api/node_modules/@nestjs/core";
import { Queue, Worker } from "../apps/api/node_modules/bullmq";
import sharp from "../apps/worker/node_modules/sharp";
import { AmuxClaudeClient, amuxClaudeClientConfigFromEnv, visualSummaryJobId } from "../packages/ai/src";
import { type VisualSummaryJobData } from "../packages/shared/src";
import { prisma } from "../packages/db/dist/src/client";
import { WorkflowsService } from "../apps/api/src/modules/workflows/workflows.service";
import { S3FileStorage } from "../apps/api/src/modules/files/storage.service";
import { DesignContextService } from "../apps/api/src/modules/design-context/design-context.service";
import { InformationIntegrationService } from "../apps/api/src/modules/design-context/information-integration.service";
import { VisualContextService } from "../apps/api/src/modules/design-context/visual-context.service";
import { WorkflowRuntimeModule } from "../apps/api/src/modules/workflow-runtime/workflow-runtime.module";
import { WorkflowRuntimeService } from "../apps/api/src/modules/workflow-runtime/workflow-runtime.service";
import { WorkflowAssistantService } from "../apps/api/src/modules/workflow-runtime/workflow-assistant.service";
import { WorkflowCoordinator } from "../apps/api/src/modules/workflow-runtime/workflow-coordinator";
import { createVisualSummaryProcessor } from "../apps/worker/src/processors/visual-summary.processor";

// Real configured model + PostgreSQL + isolated BullMQ queue + private object storage.
// No image generation is performed. The fixture and its private objects are removed in finally.
async function main() {
  // Keep background recovery scoped to this fixture; observe its execution explicitly below.
  process.env.NODE_ENV = "test";
  const app = await NestFactory.createApplicationContext(WorkflowRuntimeModule, { logger: ["error", "warn"] });
  const workflows = app.get(WorkflowsService);
  const contexts = app.get(DesignContextService);
  const runtime = app.get(WorkflowRuntimeService);
  const storage = app.get(S3FileStorage);
  const outputDir = resolve("output/workflow-assistant-verification");
  await mkdir(outputDir, { recursive: true });
  const responses: unknown[] = [];
  const model = new AmuxClaudeClient(amuxClaudeClientConfigFromEnv(), async (url, request) => {
    const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(request.timeoutMs), ...(request.signal ? [request.signal] : [])]),
      headers: { "anthropic-version": "2023-06-01", "Content-Type": "application/json", "x-api-key": request.apiKey }, body: JSON.stringify(request.body) });
    const payload: unknown = await response.json();
    // Isolated fixture output only: never persist requests, credentials, or image bytes.
    responses.push(payload);
    await writeFile(resolve(outputDir, "model-responses.json"), JSON.stringify(responses, null, 2), "utf8");
    if (!response.ok) throw new Error(`Verification model request failed (HTTP ${response.status})`);
    return payload;
  });
  const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const connection = { host: redis.hostname, port: Number(redis.port || 6379), password: redis.password || undefined, username: redis.username || undefined };
  const queueName = `verify-visual-${randomUUID()}`;
  const queue = new Queue<VisualSummaryJobData>(queueName, { connection });
  const processor = createVisualSummaryProcessor({ database: prisma,
    storage: { get: async (key) => Buffer.from(await storage.readPrefix(key, 7 * 1024 * 1024)) }, client: model });
  const worker = new Worker<VisualSummaryJobData>(queueName, async (job) => processor(job.data), { connection, concurrency: 1 });
  worker.on("error", (error) => console.error(`Visual verification worker: ${error.message}`));
  const visual = new VisualContextService(prisma, storage, {
    enqueue: async (data) => { await queue.add("describe", data, { jobId: visualSummaryJobId(data), attempts: 1 }); },
  });
  const coordinator = new WorkflowCoordinator(prisma, workflows, contexts, visual, model, app.get(InformationIntegrationService));
  const assistant = new WorkflowAssistantService(prisma, workflows, runtime, contexts, visual, model, coordinator);
  let userId: string | null = null;
  const keys: string[] = [];
  try {
    await worker.waitUntilReady();
    const user = await prisma.user.create({ data: { email: `assistant-real-${randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Assistant verification", projects: { create: { name: "持续设计理解验收" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
    userId = user.id;
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("Missing verification project");
    const conversation = await prisma.agentConversation.create({ data: { createdById: user.id, projectId: project.id, title: "真实助手验收", mode: "workflow" } });
    const imagePath = process.argv[2] ?? resolve("output/workflow-verification/real-candidate.png");
    const bytes = await sharp(await readFile(imagePath)).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).webp().toBuffer();
    const key = `verification/${randomUUID()}/thumbnail-1024.webp`;
    keys.push(key);
    await storage.uploadBuffer(key, bytes, "image/webp", createHash("sha256").update(bytes).digest("base64"));
    const assetId = randomUUID();
    await prisma.designAsset.create({ data: { id: assetId, projectId: project.id, rootAssetId: assetId, operation: "IMPORTED", url: `s3://${key}`, thumbnailUrl: `s3://${key}` } });
    const briefId = randomUUID(), analysisId = randomUUID(), candidateId = randomUUID();
    await workflows.patch(user.id, project.id, { mode: "semantic", baseRevision: 0, mutationId: randomUUID(), operations: [
      { type: "add_node", node: { id: briefId, kind: "asset", type: "brief", title: "通勤外套目标", payload: { text: "设计藏蓝色宽松通勤外套，只展示服装；保持原有领型与配色。防水性能需要规格资料确认。" }, x: 80, y: 100 } },
      { type: "add_node", node: { id: analysisId, kind: "tool", type: "analyze_brief", title: "整理设计需求", payload: { toolKey: "analyze_brief", toolVersion: "1", params: { prompt: "整理明确要求和未知项" } }, x: 420, y: 100 } },
      { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: briefId, targetNodeId: analysisId, sourcePort: "out", targetPort: "goal" } },
      { type: "add_node", node: { id: candidateId, kind: "asset", type: "candidate", title: "已导入的真实外套样本", payload: { assetId, text: "来自既有验收图片的导入样本；没有本次生成尝试，不可虚构生成历史。" }, x: 1100, y: 100 } },
    ] });
    await runtime.execute(user.id, project.id, analysisId, { mutationId: randomUUID() });
    const graph = await workflows.get(user.id, project.id);
    const constraint = graph.nodes.find((node) => node.type === "constraint");
    if (!constraint) throw new Error("Real requirement analysis did not produce constraints");
    await runtime.decide(user.id, project.id, candidateId, { assetId, kind: "rejected", reason: "袖子太宽，需要收窄，其他外观应保留", mutationId: randomUUID() });
    const first = await visual.enrich(user.id, project.id, graph.nodes, [candidateId]);
    const deadline = Date.now() + 11 * 60_000;
    let visualResult = first;
    while (visualResult.coverage.ready < 1 && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 2_000));
      visualResult = await visual.enrich(user.id, project.id, graph.nodes, [candidateId]);
      if (visualResult.coverage.failed) throw new Error("Real visual summary failed");
    }
    if (visualResult.coverage.ready !== 1 || visualResult.imageBindings[0]?.nodeId !== candidateId) throw new Error("Visual queue/asset binding verification failed");
    console.log(JSON.stringify({ phase: "visual", ready: 1, actualImageAttached: true, model: amuxClaudeClientConfigFromEnv().model }));
    const question = "请总结整个画布的目标、已经做过什么、这个候选为什么被否决；解释其图中可见服装特征，并说明哪些条件无法仅凭图片确认。此轮只讨论，不要创建工具。";
    // The compatibility endpoint now uses the same Coordinator; it is not a pre-refactor baseline.
    const summary = await assistant.send(user.id, conversation.id, { content: question, clientRequestId: randomUUID(), referencedNodeIds: [] });
    if (summary.assistantMessage.status !== "completed" || summary.assistantMessage.kind !== "reply" || summary.assistantMessage.proposal) throw new Error(`Whole-canvas explanation failed: ${JSON.stringify(summary.assistantMessage)}`);
    const proposal = await assistant.send(user.id, conversation.id, { content: "请为这件候选提出收窄袖子的下一步工具建议；保留领型、藏蓝色和其他外观，使用明确引用的设计约束。只提建议，不执行。", clientRequestId: randomUUID(), referencedNodeIds: [candidateId, constraint.id] });
    if (proposal.assistantMessage.kind !== "propose" || !proposal.assistantMessage.proposal) throw new Error(`Expected editing proposal: ${JSON.stringify(proposal.assistantMessage)}`);
    const prepared = proposal.assistantMessage.proposal;
    const after = await runtime.accept(user.id, project.id, prepared.id, { baseRevision: prepared.baseRevision, mutationId: randomUUID() });
    if (await prisma.generationTask.count({ where: { projectId: project.id } })) throw new Error("Proposal acceptance unexpectedly generated an image");
    const draft = after.nodes.find((node) => node.type === "edit_design" && node.status === "ready");
    if (!draft) throw new Error("Prepared editing tool missing");
    const configure = await assistant.send(user.id, conversation.id, { clientRequestId: randomUUID(), referencedNodeIds: [draft.id],
      content: "请直接配置这个尚未执行的修改工具，保留全部输入和收窄袖子的要求，数量改为4，width=1024、height=1536、quality=auto，negativePrompt为no lettering。提出原卡配置提案，不执行，也不另建工具。" });
    const configuredProposal = configure.assistantMessage.proposal;
    if (!configuredProposal || (configuredProposal.action as { type?: string } | undefined)?.type !== "configure_tool") {
      const diagnostics = await prisma.agentTurn.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true, error: true, budget: true } });
      throw new Error(`Expected configure_tool: ${JSON.stringify({ message: configure.assistantMessage, diagnostics })}`);
    }
    const configured = await runtime.accept(user.id, project.id, configuredProposal.id, { baseRevision: configuredProposal.baseRevision, mutationId: randomUUID() });
    const parameters = (configured.nodes.find((node) => node.id === draft.id)?.payload as { params?: Record<string, unknown> }).params;
    if (parameters?.count !== 4 || parameters.width !== 1024 || parameters.height !== 1536 || parameters.quality !== "auto" || parameters.negativePrompt !== "no lettering") throw new Error("Confirmed parameters differ from real model proposal");
    if (await prisma.workflowNodeVersion.count({ where: { nodeId: draft.id } }) < 2) throw new Error("Draft configuration did not preserve immutable history");
    if (await prisma.generationTask.count({ where: { projectId: project.id } })) throw new Error("Configuration unexpectedly generated an image");
    const evaluationId = randomUUID();
    await workflows.patch(user.id, project.id, { mode: "semantic", baseRevision: configured.revision, mutationId: randomUUID(), operations: [
      { type: "add_node", node: { id: evaluationId, kind: "tool", type: "evaluate_design", title: "检查袖宽与保留项", payload: { toolKey: "evaluate_design", toolVersion: "1", params: { prompt: "重点说明袖宽问题以及领型与配色的保留条件；防水与成分只能标记为无法判断。" } }, x: 1450, y: 600 } },
      { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: candidateId, targetNodeId: evaluationId, sourcePort: "out", targetPort: "candidate" } },
      { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: constraint.id, targetNodeId: evaluationId, sourcePort: "out", targetPort: "constraint" } },
    ] });
    const evaluated = await runtime.execute(user.id, project.id, evaluationId, { mutationId: randomUUID(), conversationId: conversation.id });
    if (!evaluated.nodes.some((node) => node.id === evaluationId && node.status === "completed") || !evaluated.nodes.some((node) => node.type === "evaluation")) throw new Error("Real candidate evaluation failed");
    if (await prisma.generationTask.count({ where: { projectId: project.id } })) throw new Error("Candidate evaluation unexpectedly generated an image");
    const execution = await prisma.workflowExecution.findFirstOrThrow({ where: { projectId: project.id, toolNodeId: evaluationId } });
    const event = await prisma.workflowOutbox.findUniqueOrThrow({ where: { eventKey: `execution:${execution.id}:terminal` } });
    if (await assistant.observeExecution(event.id) !== "completed") throw new Error("Execution observation was not completed");
    await assistant.observeExecution(event.id);
    if (await prisma.agentMessage.count({ where: { executionId: execution.id, origin: "background_analysis" } }) !== 1) throw new Error("Background result analysis must appear exactly once");
    const profile = await assistant.getContext(user.id, conversation.id);
    await assistant.correctContext(user.id, conversation.id, { baseRevision: profile.revision, mutationId: randomUUID(), currentObjective: "继续开发藏蓝色通勤外套系列，优先处理袖宽" });
    const nextConversation = await prisma.agentConversation.create({ data: { createdById: user.id, projectId: project.id, title: "验证跨会话记忆", mode: "workflow" } });
    const inherited = await assistant.getContext(user.id, nextConversation.id);
    if (!inherited.currentObjective?.includes("优先处理袖宽")) throw new Error("Project context was not inherited");
    await writeFile(resolve(outputDir, "real-assistant.json"), JSON.stringify({
      model: amuxClaudeClientConfigFromEnv().model, visual: visualResult.index,
      baseline: { pairedComparison: "pending", reason: "Requires frozen pre-refactor results; compatibility endpoint already uses Fig8" },
      summary: summary.assistantMessage, proposal: proposal.assistantMessage,
      configuration: configure.assistantMessage, plan: await assistant.currentPlan(user.id, conversation.id),
      evaluation: evaluated.nodes.find((node) => node.type === "evaluation")?.payload,
      checks: { acceptedNodeCount: after.nodes.length, configuredInPlace: true, nodeVersionHistory: true, backgroundAnalysisOnce: true, generatedImages: 0, candidateEvaluation: true, crossConversationGoal: inherited.currentObjective },
    }, null, 2), "utf8");
    console.log(JSON.stringify({ phase: "collaboration", summary: "reply", nextStep: "propose", generatedImages: 0, candidateEvaluation: true, crossConversationMemory: true }));
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    for (const key of keys) {
      await prisma.imageVisualSummary.deleteMany({ where: { sourceKey: key } });
      await storage.delete(key);
    }
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await app.close();
    await prisma.$disconnect();
  }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Real assistant verification failed"); process.exitCode = 1; });
