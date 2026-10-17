import "../apps/api/node_modules/reflect-metadata";
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "../apps/worker/node_modules/sharp";
import { AmuxClaudeClient, amuxClaudeClientConfigFromEnv, describeImage, visualSummaryFingerprint, type AmuxClaudeTransportRequest } from "../packages/ai/src";
import { Prisma, prisma, type PrismaClient } from "../packages/db/dist/src/client";
import { VISUAL_SUMMARY_SCHEMA_VERSION } from "../packages/shared/src";
import { WorkflowsService } from "../apps/api/src/modules/workflows/workflows.service";
import { workflowEdgeInputSchema, workflowNodeInputSchema } from "../apps/api/src/modules/workflows/workflows.schemas";
import { DesignContextService } from "../apps/api/src/modules/design-context/design-context.service";
import { InformationIntegrationService } from "../apps/api/src/modules/design-context/information-integration.service";
import { VisualContextService } from "../apps/api/src/modules/design-context/visual-context.service";
import { S3FileStorage } from "../apps/api/src/modules/files/storage.service";
import { WorkflowCoordinator } from "../apps/api/src/modules/workflow-runtime/workflow-coordinator";
import type { ReadPolicy } from "../apps/api/src/modules/workflow-runtime/workflow-read-gateway";

// node --env-file=.env.example --env-file-if-exists=.env apps/api/node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json scripts/evaluate-workflow-fig8.ts
// Default: prepare 240 blinded cases without calling a model or changing the database.
// Add --run --max-cases=1 for a paid smoke test; the full experiment uses --max-cases=240.
// Supply FIG8_EVAL_INPUT_USD_PER_MILLION / FIG8_EVAL_OUTPUT_USD_PER_MILLION from the configured channel's actual tariff.
const args = new Set(process.argv.slice(2));
const option = (name: string, fallback: string) => [...args].find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const numberOption = (name: string, fallback: number) => {
  const value = Number(option(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须为正数`);
  return value;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const output = resolve(option("output", "output/workflow-fig8-evaluation"));
const modelConfig = amuxClaudeClientConfigFromEnv();
const maxCases = Math.min(240, Math.floor(numberOption("max-cases", 240)));
const maxCalls = Math.floor(numberOption("max-model-calls", 1200));
const maxUsd = numberOption("max-estimated-usd", 25);
const inputPrice = Number(process.env.FIG8_EVAL_INPUT_USD_PER_MILLION);
const outputPrice = Number(process.env.FIG8_EVAL_OUTPUT_USD_PER_MILLION);
const paid = args.has("--run");
const scenarios = [
  { id: "s01", title: "全图方向与进度", request: "不选择节点，请总结整张画布的两个方向、各自进度与尚未执行的步骤。不能把导入图片说成本次生成结果。", references: false, expected: ["区分两个约束分支", "未执行草稿不能声称已生成", "正确说明导入图片来源"] },
  { id: "s02", title: "同名候选分支隔离", request: "只修改明确引用的候选，收窄袖口并保留该分支要求，请提出下一步工具建议，不执行。另一个同名候选的红色要求不能混入。", references: true, expected: ["唯一正确母图", "保留A分支约束", "不引用B分支素材"] },
  { id: "s03", title: "否决原因与保留项", request: "这个候选为什么被否决？袖口修改要解决什么问题，哪些外观必须保留？此轮只讨论。", references: true, expected: ["命中袖口过宽的真实决定", "明确保留领型与配色", "区分评价与执行失败"] },
  { id: "s04", title: "草稿参数演变与隐含偏好", request: "结合这个分支连续修改的参数解释设计方向，再给出一条合适的下一步建议。推断不能成为所有方案的硬要求。", references: true, expected: ["引用真实版本变化", "偏好保持分支作用范围", "明确推断性质"] },
  { id: "s05", title: "项目目标修订与跨会话记忆", request: "这是新的讨论会话，请说明项目当前目标与最初目标的区别，再指出下一步。不要恢复已经停用的银色偏好。", references: true, expected: ["继承已修订项目目标", "不把会话任务替换为总目标", "停用推断不恢复"] },
  { id: "s06", title: "跳过提案后不重复", request: "上一条增加候选数量的建议已经跳过了。请解释这个决定，并给出不同的处理方式；没有明确理由的跳过不能被推成审美偏好。", references: true, expected: ["知道已拒绝建议", "不重复相同行动", "不虚构拒绝理由"] },
  { id: "s07", title: "图片不能确认生产性能", request: "判断这件衣服是否满足防水、羊毛成分和精确袖长60厘米的要求。请区分图片可以确认和必须补资料的内容。此轮只回答。", references: true, expected: ["不推测真实纤维成分", "不虚构精确尺寸", "防水性能须规格或测试资料"] },
  { id: "s08", title: "长消息尾部纠正与原文补读", request: "请按我上一条长消息末尾的最终纠正继续解释下一步。开头出现过的旧颜色已经被否定，必须核对原文，不能只靠摘要开头。", references: true, expected: ["读取尾部纠正或明确缺失", "保留最终藏蓝要求", "不能复述旧银色要求"] },
  { id: "s09", title: "技术失败不能变成审美反馈", request: "最近一次执行失败说明设计师不喜欢这个颜色吗？请解释失败来源，并建议合理的后续处理。此轮只讨论。", references: true, expected: ["技术超时不等于设计否决", "不从失败推断偏好", "真实说明没有生成结果"] },
  { id: "s10", title: "未执行配置与已尝试工具分支", request: "把这张工具的数量改为3、负向提示改为避免宽袖口，尺寸768×1024、质量high，保留输入。若它已经有执行尝试，应从历史版本派生分支；只提出原子提案。", references: true, expected: ["草稿原位配置或已尝试工具派生分支", "数量负向提示尺寸质量完整", "接受建议不自动执行"] },
] as const;
const factors: ReadPolicy[] = Array.from({ length: 8 }, (_, mask) => ({ trajectory: Boolean(mask & 4), dialog: Boolean(mask & 2), hiddenIntent: Boolean(mask & 1) }));
const cases = scenarios.flatMap((scenario) => factors.flatMap((policy) => [1, 2, 3].map((repeat) => ({
  caseId: `${scenario.id}-T${Number(policy.trajectory)}D${Number(policy.dialog)}H${Number(policy.hiddenIntent)}-r${repeat}`,
  scenarioId: scenario.id, policy, repeat,
}))));
const dimensions = ["意图理解", "流程感知", "建议合理性", "工具适用性"];
const caseBudget = { maxPlannerCalls: 5, maxReadRounds: 3, maxOutputTokens: 6_000, maxReadCharacters: 24_000, maxAttachedImages: 8, temperature: 0 };
interface Usage { inputTokens: number | null; outputTokens: number | null; estimatedUsd: number | null; elapsedMs: number; status: number }
const usages: Usage[] = [];
let estimatedUsd = 0;
let costUnknown = false;
let calls = 0;
async function transport(url: string, request: AmuxClaudeTransportRequest): Promise<unknown> {
  if (calls >= maxCalls) throw new Error("评估总模型调用预算已用尽");
  // Conservative local admission estimate, not a statement of provider billing rules.
  const messageText = JSON.stringify(request.body, (key, value) => key === "data" ? "[image bytes omitted]" : value);
  const imageCount = (messageText.match(/"type":"image"/gu) ?? []).length;
  const upperInput = messageText.length * 2 + imageCount * 8192;
  const admissionCost = (upperInput * inputPrice + Number(request.body.max_tokens ?? 6000) * outputPrice) / 1_000_000;
  if (costUnknown || estimatedUsd + admissionCost > maxUsd) throw new Error("评估费用上限不足或渠道未返回用量；停止后续付费调用");
  calls += 1;
  const started = Date.now();
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(request.timeoutMs),
    headers: { "anthropic-version": "2023-06-01", "Content-Type": "application/json", "x-api-key": request.apiKey }, body: JSON.stringify(request.body) });
  const payload: unknown = await response.json();
  const usage = object(object(payload).usage);
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens + Number(usage.cache_creation_input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) : typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : typeof usage.completion_tokens === "number" ? usage.completion_tokens : null;
  const cost = inputTokens === null || outputTokens === null || !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens < 0 || outputTokens < 0 ? null : (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
  if (cost === null) costUnknown = true; else estimatedUsd += cost;
  usages.push({ inputTokens, outputTokens, estimatedUsd: cost, elapsedMs: Date.now() - started, status: response.status });
  if (!response.ok) throw new Error(`模型请求失败 HTTP ${response.status}`);
  return payload;
}

async function createFixture(database: PrismaClient, workflows: WorkflowsService, contexts: DesignContextService, userId: string, wsId: string, scenarioId: string, imageKey: string) {
  const project = await database.project.create({ data: { wsId, name: `Fig8合成验收 ${scenarioId}`, workflowAgentVersion: 1 } });
  const conversation = await database.agentConversation.create({ data: { createdById: userId, projectId: project.id, mode: "workflow", title: "固定实验对话" } });
  const ids = { goal: randomUUID(), constraintA: randomUUID(), constraintB: randomUUID(), candidateA: randomUUID(), candidateB: randomUUID(), toolA: randomUUID(), toolB: randomUUID() };
  const assetA = randomUUID(), assetB = randomUUID();
  for (const id of [assetA, assetB]) await database.designAsset.create({ data: { id, projectId: project.id, rootAssetId: id, operation: "IMPORTED", url: `s3://${imageKey}`, thumbnailUrl: `s3://${imageKey}` } });
  const constraint = (text: string, quote: string) => ({ summary: text, constraints: [{ id: randomUUID(), requirement: text, dimension: "color", mode: "preserve", priority: "must", origin: "explicit", verification: "visual", evidenceIds: [ids.goal], sourceQuote: quote }], unknowns: ["真实纤维成分、精确尺寸与防水性能需要资料"] });
  const params = (prompt: string) => ({ prompt, negativePrompt: "", count: 1, width: 768, height: 1024, quality: "high", referenceInputs: [], taskType: "i2i", mask: null });
  const node = (id: string, kind: "asset" | "tool", type: string, title: string, payload: Record<string, unknown>, x: number) => ({ type: "add_node" as const, node: workflowNodeInputSchema.parse({ id, kind, type, title, payload, x, y: 100 }) });
  const edge = (sourceNodeId: string, targetNodeId: string, targetPort: string) => ({ type: "add_edge" as const, edge: workflowEdgeInputSchema.parse({ id: randomUUID(), sourceNodeId, targetNodeId, sourcePort: "out", targetPort }) });
  const fixedPrompt = "保留藏蓝色和原有领型，收窄袖口";
  await workflows.patch(userId, project.id, { mode: "semantic", baseRevision: 0, mutationId: randomUUID(), operations: [
    node(ids.goal, "asset", "brief", "通勤外套与机能分支", { text: "比较通勤外套两个分支；A保留藏蓝和领型，B探索红色。导入样本不是本次生成结果。" }, 0),
    node(ids.constraintA, "asset", "constraint", "A约束", { brief: constraint(scenarioId === "s04" ? "保留原有领型" : "保留藏蓝色和原有领型", "保留藏蓝和领型") }, 200),
    node(ids.constraintB, "asset", "constraint", "B约束", { brief: constraint("B分支红色探索", "B探索红色") }, 200),
    node(ids.candidateA, "asset", "candidate", "同名候选", { assetId: assetA, text: "固定导入图片样本A，非本实验生成；两个样本复用同一图片内容以固定视觉变量。" }, 400),
    node(ids.candidateB, "asset", "candidate", "同名候选", { assetId: assetB, text: "固定导入图片样本B，非本实验生成；只能沿B分支约束讨论。" }, 400),
    node(ids.toolA, "tool", "edit_design", "同名修改工具", { toolKey: "edit_design", toolVersion: "1", params: params(fixedPrompt) }, 700),
    node(ids.toolB, "tool", "edit_design", "同名修改工具", { toolKey: "edit_design", toolVersion: "1", params: params("B分支探索红色") }, 700),
    edge(ids.candidateA, ids.toolA, "source"), edge(ids.constraintA, ids.toolA, "constraint"), edge(ids.candidateB, ids.toolB, "source"), edge(ids.constraintB, ids.toolB, "constraint"),
  ] });
  for (const prompt of ["该分支尝试银色并收窄袖口", "该分支保留银色并进一步收窄袖口"]) {
    const graph = await workflows.get(userId, project.id);
    await workflows.patch(userId, project.id, { mode: "semantic", baseRevision: graph.revision, mutationId: randomUUID(), operations: [{ type: "update_node", nodeId: ids.toolA, payload: { toolKey: "edit_design", toolVersion: "1", params: params(prompt) } }] });
  }
  const versions = await database.workflowNodeVersion.findMany({ where: { projectId: project.id, nodeId: ids.toolA, origin: "user", baseline: false }, orderBy: { version: "desc" }, take: 2 });
  if (versions.length === 2) {
    const state = await contexts.get(userId, project.id);
    await contexts.patch(userId, project.id, { baseRevision: state.revision, mutationId: randomUUID(), operations: [{ type: "upsert_item", item: { id: "fixture-silver-inference", kind: "preference", text: "该分支两次改稿均尝试银色与窄袖口；仅是可纠正推断", origin: "inferred", priority: "prefer", scope: "branch", branchNodeIds: [ids.toolA], sourceNodeIds: [ids.toolA], sourceVersionIds: versions.map((version) => version.id), sourceQuote: "该分支保留银色并进一步收窄袖口" } }] });
  }
  await database.designAssetDecision.create({ data: { userId, assetId: assetA, kind: "rejected", reason: "袖口太宽；领型和藏蓝色应保留", clientRequestId: randomUUID() } });
  const currentGraph = await workflows.get(userId, project.id);
  await workflows.patch(userId, project.id, { mode: "semantic", baseRevision: currentGraph.revision, mutationId: randomUUID(), operations: [{ type: "update_node", nodeId: ids.candidateA, payload: { assetId: assetA, text: "固定导入图片，不存在本实验生成历史。", decision: { kind: "rejected", reason: "袖口太宽；领型和藏蓝色应保留" } } }] });
  await database.agentMessage.createMany({ data: [
    { conversationId: conversation.id, role: "USER", content: "当前只处理A分支，保留领型和藏蓝色。请不要混入B分支的红色。", createdAt: new Date("2026-01-01T00:00:00Z") },
    { conversationId: conversation.id, role: "ASSISTANT", kind: "reply", content: "A与B分支分别讨论；防水、成分和精确袖长仍需外部资料。", createdAt: new Date("2026-01-01T00:00:01Z") },
  ] });
  if (scenarioId === "s05") {
    const state = await contexts.get(userId, project.id);
    await contexts.patch(userId, project.id, { baseRevision: state.revision, mutationId: randomUUID(), operations: [{ type: "set_objective", text: "继续开发藏蓝色轻量通勤系列，优先解决袖宽" }, ...(state.state.preferences.length ? [{ type: "deactivate_item" as const, id: "fixture-silver-inference" }] : [])] });
  }
  if (scenarioId === "s06") await database.workflowProposal.create({ data: { projectId: project.id, userId, conversationId: conversation.id, baseRevision: 3, status: "rejected", diff: { operations: [] }, evidence: { action: { type: "configure_tool", targetNodeId: ids.toolA, parameters: { count: 4 }, rationale: "增加候选" } }, mutationId: randomUUID(), rejectionReason: null } });
  if (scenarioId === "s08") await database.agentMessage.create({ data: { conversationId: conversation.id, role: "USER", content: `旧讨论曾提到银色。${"过程记录与无关细节，".repeat(1400)}最终纠正：不要银色，只保留藏蓝色并收窄袖口。` } });
  if (["s09", "s10"].includes(scenarioId)) {
    const execution = await database.workflowExecution.create({ data: { projectId: project.id, userId, toolNodeId: ids.toolA, conversationId: conversation.id, nodeVersionId: versions[0]?.id ?? null, executionKey: randomUUID(), status: "failed", expectedAttempts: 1, requestSnapshot: { syntheticEvaluationFixture: true, errorCode: "FIXTURE_PROVIDER_TIMEOUT", note: "合成技术失败记录，没有生成资产，不是生产运行证据" }, completedAt: new Date() } });
    await database.workflowAttempt.create({ data: { projectId: project.id, toolNodeId: ids.toolA, ordinal: 1, executionKey: randomUUID(), executionId: execution.id, nodeVersionId: versions[0]?.id ?? null, status: "failed", requestSnapshot: { syntheticEvaluationFixture: true, params: params(fixedPrompt), inputNodeIds: [ids.candidateA, ids.constraintA] }, error: "FIXTURE_PROVIDER_TIMEOUT：合成评估记录，未生成资产" } });
  }
  return { project, conversation, ids };
}

async function main() {
  await mkdir(output, { recursive: true });
  const imagePath = resolve(option("image", "output/workflow-verification/real-candidate.png"));
  const bytes = await sharp(await readFile(imagePath)).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).webp().toBuffer();
  const imageHash = hash(bytes.toString("base64"));
  const fixtureSpecificationHash = hash({ scenarios, imageHash, version: "fig8-fixture/1" });
  const experimentHash = hash({ fixtureSpecificationHash, model: modelConfig.model, caseBudget });
  const runId = randomUUID();
  const blindCases = cases.map((item) => ({ ...item, blindId: hash(`${runId}:${item.caseId}`).slice(0, 16) })).sort((a, b) => a.blindId.localeCompare(b.blindId));
  if ((await readFile(resolve(output, "results.jsonl"), "utf8").catch(() => "")).trim() || (await readFile(resolve(output, "human-ratings.csv"), "utf8").catch(() => "")).split(/\r?\n/u).slice(1).some((row) => row.slice(row.indexOf(",") + 1).replace(/,/gu, "").trim())) throw new Error("该输出目录已有实验结果或人工评分，请使用新的 --output 目录以保留冻结结果");
  await writeFile(resolve(output, "manifest.json"), JSON.stringify({ version: "fig8-evaluation/1", model: modelConfig.model, temperature: 0, imageHash, fixtureSpecificationHash, experimentHash,
    dataset: "synthetic_context_fixtures_with_real_imported_image", facts: "所有图片为导入样本；无生图；技术失败记录明确标为合成实验数据；偏好为预先固定的实验条件，不用于评估miner自身准确率。",
    cases: blindCases, scenarios, budget: { plannedCases: 240, repetitions: 3, conditions: 8, ...caseBudget, maxCalls, maxEstimatedUsd: maxUsd, maxCases },
    dimensions, scoring: "四维各1–5分，盲评者填写；缺失/不适用留空。来源准确率、遗漏、串分支、术语与未知项另记；本脚本不生成主观评分。",
    costMethod: "transport原始usage；按显式渠道单价估计，不等于账单。未知用量记null并停止后续调用；图片准入估计仅为预算保护。",
    baseline: { path: option("baseline-results", "") || null, pairedComparison: option("baseline-results", "") ? "validate_frozen_results_after_run" : "pending_frozen_pre_refactor_results" },
  }, null, 2), "utf8");
  await writeFile(resolve(output, "human-ratings.csv"), ["blind_id,rater_id,intent_understanding_1_5,workflow_awareness_1_5,suggestion_rationality_1_5,tool_suitability_1_5,correct_sources,total_sources,omitted_conditions,branch_confusions,terminology_errors,unknowns_handled,notes", ...blindCases.map((item) => `${item.blindId},,,,,,,,,,,,`)].join("\n"), "utf8");
  if (!paid) { console.log(JSON.stringify({ mode: "plan_only", cases: cases.length, modelCalls: 0, output })); return; }
  if (!Number.isFinite(inputPrice) || inputPrice < 0 || !Number.isFinite(outputPrice) || outputPrice < 0) throw new Error("真实评估必须配置渠道输入/输出单价以执行费用上限；不能假定未知价格为零");
  if (!process.env.AMUX_API_KEY?.trim()) throw new Error("真实评估缺少 AMUX_API_KEY");
  const model = new AmuxClaudeClient(modelConfig, transport);
  const storage = new S3FileStorage();
  const workflows = new WorkflowsService(prisma);
  const contexts = new DesignContextService(prisma, workflows);
  const integration = new InformationIntegrationService(prisma, contexts);
  const visual = new VisualContextService(prisma, storage, { enqueue: async () => { throw new Error("固定评估只读取预先冻结的视觉摘要，不能异步改变实验条件"); } });
  const coordinator = new WorkflowCoordinator(prisma, workflows, contexts, visual, model, integration);
  const results: Record<string, unknown>[] = [];
  let userId: string | null = null;
  const key = `verification/fig8-${runId}/thumbnail-1024.webp`;
  try {
    await storage.uploadBuffer(key, bytes, "image/webp", createHash("sha256").update(bytes).digest("base64"));
    const fingerprint = visualSummaryFingerprint(bytes, modelConfig.model);
    const prior = await prisma.imageVisualSummary.findUnique({ where: { fingerprint } });
    let frozenSummary: unknown = prior?.status === "READY" ? prior.summary : null;
    if (!frozenSummary) {
      const summary = await describeImage(model, bytes);
      frozenSummary = json(summary);
      await prisma.imageVisualSummary.upsert({ where: { fingerprint }, create: { fingerprint, sourceKey: key, model: modelConfig.model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION, status: "READY", summary: json(summary) }, update: { status: "READY", summary: json(summary), error: null } });
    }
    const visualSummaryHash = hash(frozenSummary);
    await writeFile(resolve(output, "frozen-visual-summary.json"), JSON.stringify({ visualSummaryHash, fingerprint, imageHash, model: modelConfig.model, summary: frozenSummary }, null, 2), "utf8");
    const user = await prisma.user.create({ data: { email: `fig8-evaluation-${runId}@example.com`, ownedWorkspaces: { create: { name: "Isolated Fig8 evaluation" } } }, include: { ownedWorkspaces: true } });
    userId = user.id;
    const workspace = user.ownedWorkspaces[0];
    if (!workspace) throw new Error("Missing evaluation workspace");
    // Rebuild each case independently so one Planner response cannot influence another condition.
    for (const item of blindCases.slice(0, maxCases)) {
      if (calls >= maxCalls || costUnknown || estimatedUsd >= maxUsd) break;
      const scenario = scenarios.find((candidate) => candidate.id === item.scenarioId);
      if (!scenario) throw new Error("Unknown scenario");
      const fixture = await createFixture(prisma, workflows, contexts, user.id, workspace.id, scenario.id, key);
      const started = Date.now(), usageStart = usages.length;
      const references = scenario.references ? [fixture.ids.candidateA, fixture.ids.constraintA, ...(scenario.id === "s10" ? [fixture.ids.toolA] : [])] : [];
      const referenceSnapshot = await integration.integrate(user.id, fixture.project.id, { conversationId: fixture.conversation.id, referencedNodeIds: references });
      const referenceMessages = await prisma.agentMessage.findMany({ where: { conversationId: fixture.conversation.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, role: true, content: true } });
      const reference = { expectedChecks: scenario.expected, imageHash, nodeBindings: fixture.ids, context: referenceSnapshot.context, originalMessages: referenceMessages };
      let result: Record<string, unknown>;
      try {
        const reply = await coordinator.run({ userId: user.id, projectId: fixture.project.id, conversationId: fixture.conversation.id, request: scenario.request,
          referencedNodeIds: references, readPolicy: item.policy });
        const generatedImages = await prisma.generationTask.count({ where: { projectId: fixture.project.id } });
        if (generatedImages) throw new Error("评估意外创建了生成任务");
        result = { ...item, model: modelConfig.model, imageHash, fixtureSpecificationHash, experimentHash, visualSummaryHash, caseBudget, reference, status: "completed", decision: reply.decision, calls: reply.calls, readRounds: reply.readRounds,
          graphRevision: reply.snapshot.graphRevision, coverage: reply.built.context.coverage, generatedImages, humanEvaluation: null, elapsedMs: Date.now() - started, usage: usages.slice(usageStart) };
      } catch (error) {
        result = { ...item, model: modelConfig.model, imageHash, fixtureSpecificationHash, experimentHash, visualSummaryHash, caseBudget, reference, status: "failed", error: error instanceof Error ? error.message : "Evaluation failed", elapsedMs: Date.now() - started, usage: usages.slice(usageStart), humanEvaluation: null };
      }
      results.push(result);
      await appendFile(resolve(output, "results.jsonl"), `${JSON.stringify(result)}\n`, "utf8");
      await prisma.project.delete({ where: { id: fixture.project.id } });
      console.log(JSON.stringify({ phase: "case", caseId: item.caseId, status: result.status, completed: results.length, calls, estimatedUsd }));
    }
    const baselinePath = option("baseline-results", "");
    let paired: unknown = { status: "pending_frozen_pre_refactor_results", matchedCases: 0 };
    if (baselinePath) {
      const rows = (await readFile(resolve(baselinePath), "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => object(JSON.parse(line)));
      const matched = results.flatMap((result) => {
        const matches = rows.filter((row) => row.caseId === result.caseId && row.model === modelConfig.model && row.imageHash === imageHash && row.fixtureSpecificationHash === fixtureSpecificationHash && row.experimentHash === experimentHash && row.visualSummaryHash === visualSummaryHash && row.status === "completed");
        const baseline = matches.length === 1 ? matches[0] : undefined;
        return baseline ? [{ caseId: result.caseId, blindId: result.blindId, baseline, current: result, humanComparison: null }] : [];
      });
      paired = { status: matched.length === results.length ? "awaiting_blind_human_rating" : "incomplete_or_mismatched_baseline", matchedCases: matched.length };
      await writeFile(resolve(output, "paired-results.json"), JSON.stringify(matched, null, 2), "utf8");
    }
    await writeFile(resolve(output, "blind-responses.json"), JSON.stringify(results.map((result) => ({ blindId: result.blindId, question: scenarios.find((scenario) => scenario.id === result.scenarioId)?.request, response: object(result.decision).message ?? null, action: object(result.decision).action ?? null, reference: result.reference, status: result.status })), null, 2), "utf8");
    await writeFile(resolve(output, "report.json"), JSON.stringify({ model: modelConfig.model, plannedCases: 240, completedCases: results.filter((result) => result.status === "completed").length, failedCases: results.filter((result) => result.status === "failed").length, notRunCases: 240 - results.length, calls, estimatedUsd: costUnknown ? null : estimatedUsd, knownEstimatedUsd: estimatedUsd, costUnknown, usage: usages, paired, humanEvaluation: "pending", qualityImprovementClaim: null }, null, 2), "utf8");
  } finally {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.imageVisualSummary.deleteMany({ where: { sourceKey: key } });
    await storage.delete(key);
  }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Fig8 evaluation failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
