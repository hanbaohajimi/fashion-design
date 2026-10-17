import { Prisma, ensureWorkflowNodeVersions, type PrismaClient } from "@fashion/db";
import { getWorkflowToolCatalog } from "@fashion/shared";
import type { AmuxClaudeJsonClient } from "@fashion/ai";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { z } from "zod";
import { AMUX_CLAUDE_CLIENT } from "../ai/ai.tokens";
import { DesignContextService } from "../design-context/design-context.service";
import { InformationIntegrationService } from "../design-context/information-integration.service";
import { VisualContextService, type VisualContextResult } from "../design-context/visual-context.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { compileWorkflowAction, workflowActionFingerprint, parsePlannerDecision, plannerDecisionSchema, projectPlannerVisualIndex,
  WORKFLOW_PLANNER_INSTRUCTIONS, type PlannerDecision } from "./workflow-planner";
import { WORKFLOW_RUNTIME_DB } from "./workflow-runtime.tokens";
import { applyWorkflowReadPolicy, WorkflowReadGateway, type ReadPolicy } from "./workflow-read-gateway";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export type CoordinatorInput = {
  userId: string; projectId: string; conversationId?: string; request: string;
  referencedNodeIds: string[]; focusNodeIds?: string[]; trigger?: "user" | "observation";
  readPolicy?: ReadPolicy; previousPlan?: unknown;
  initialBudget?: { modelCalls: number; readRounds: number; repairUsed: boolean };
  reserveBudget?: (budget: { modelCalls: number; readRounds: number; repairUsed: boolean }) => Promise<void>;
};
const MAX_PLANNER_CALLS = 5;
const MAX_READ_ROUNDS = 3;

/** Fig.8: observe/integrate -> one planner -> bounded reads -> validated action preparation. */
@Injectable()
export class WorkflowCoordinator {
  constructor(
    @Inject(WORKFLOW_RUNTIME_DB) private readonly database: PrismaClient,
    @Inject(WorkflowsService) _workflows: WorkflowsService,
    @Inject(DesignContextService) private readonly contexts: DesignContextService,
    @Inject(VisualContextService) private readonly visual: VisualContextService,
    @Inject(AMUX_CLAUDE_CLIENT) private readonly model: AmuxClaudeJsonClient,
    @Optional() @Inject(InformationIntegrationService) private readonly integration?: InformationIntegrationService,
  ) {}

  async run(input: CoordinatorInput) {
    const built = await this.contexts.build(input.userId, input.projectId, {
      ...(input.conversationId ? { conversationId: input.conversationId } : {}), referencedNodeIds: input.referencedNodeIds,
      ...(input.focusNodeIds ? { focusNodeIds: input.focusNodeIds } : {}),
    });
    await this.database.$transaction(async (tx) => {
      const graph = await tx.workflowGraph.upsert({ where: { projectId: input.projectId }, create: { projectId: input.projectId }, update: {} });
      if (graph.revision !== built.graph.revision) throw new Error("画布已更新，请重新读取后再规划");
      await ensureWorkflowNodeVersions(tx, input.projectId, built.graph.revision, built.graph.nodes, built.graph.edges);
    });
    const [visual, profile, versions, attempts, declined] = await Promise.all([
      this.visual.enrich(input.userId, input.projectId, built.graph.nodes, [...input.referencedNodeIds, ...built.context.focusNodeIds]),
      this.contexts.get(input.userId, input.projectId),
      this.database.workflowNodeVersion.findMany({ where: { projectId: input.projectId }, orderBy: { version: "desc" } }),
      this.database.workflowAttempt.groupBy({ by: ["toolNodeId"], where: { projectId: input.projectId }, _count: true }),
      this.database.workflowProposal.findMany({ where: { projectId: input.projectId, status: "rejected", ...(input.conversationId ? { conversationId: input.conversationId } : {}) },
        orderBy: { createdAt: "desc" }, take: 30, select: { id: true, actionFingerprint: true, rejectionReason: true, evidence: true } }),
    ]);
    const eligibility: Record<string, { nodeVersionId: string; attemptCount: number }> = {};
    for (const version of versions) if (!eligibility[version.nodeId]) eligibility[version.nodeId] = { nodeVersionId: version.id,
      attemptCount: attempts.find((attempt) => attempt.toolNodeId === version.nodeId)?._count ?? 0 };
    const tools = getWorkflowToolCatalog();
    const integrated = this.integration ? await this.integration.integrate(input.userId, input.projectId, {
      built, ...(input.conversationId ? { conversationId: input.conversationId } : {}), visual, tools, currentStep: input.previousPlan,
    }) : { context: built.context, slots: undefined };
    const projected = projectPlannerVisualIndex(visual.index);
    const context = { ...integrated.context, nodes: built.context.nodes.map((node) => ({ ...node, nodeVersionId: eligibility[node.id]?.nodeVersionId ?? null,
      attemptCount: eligibility[node.id]?.attemptCount ?? 0 })),
      inactivePreferences: profile.state.preferences.filter((item) => item.status === "inactive"),
      visualIndex: projected.index, visualSummaryCoverage: projected.coverage, visualCoverage: visual.coverage, imageBindings: visual.imageBindings,
      declinedProposals: declined.map((proposal) => ({ id: proposal.id, reason: proposal.rejectionReason,
        action: object(proposal.evidence).action, status: "rejected" })),
    };
    const gateway = new WorkflowReadGateway(this.database, this.visual);
    const projectedContext = applyWorkflowReadPolicy(context, integrated.slots, input.previousPlan, input.readPolicy);
    const readResults: unknown[] = [];
    let attached = visual;
    let validationError: string | null = null;
    let repaired = input.initialBudget?.repairUsed ?? false;
    let readRounds = input.initialBudget?.readRounds ?? 0;
    let calls = input.initialBudget?.modelCalls ?? 0;
    const reserve = () => input.reserveBudget?.({ modelCalls: calls, readRounds, repairUsed: repaired });
    let decision: PlannerDecision | undefined;
    for (; calls < MAX_PLANNER_CALLS;) {
      calls += 1;
      await reserve();
      let parsed = false;
      try {
        decision = parsePlannerDecision(await this.model.generateJson({ schemaName: "fashion_workflow_collaboration",
          instructions: `${WORKFLOW_PLANNER_INSTRUCTIONS}\n遵守workflow-planner/2回复协议。read只请求项目内补读，不能执行设计工具。当前计划是可修订目标，只有下一项动作可以成为待审提案。\n后台observation只分析实际结果和提出下一步，不修改项目目标、焦点、已确认要求或偏好。`,
          jsonSchema: z.toJSONSchema(plannerDecisionSchema), maxTokens: 6_000, images: attached.images,
          prompt: JSON.stringify({ request: input.request, trigger: input.trigger ?? "user", context: { ...projectedContext.context, imageBindings: attached.imageBindings, visualCoverage: attached.coverage },
            contextSlots: projectedContext.slots, tools, previousPlan: projectedContext.previousPlan ?? null, readResults,
            imageBindings: attached.imageBindings, visualCoverage: attached.coverage,
            responseSchema: z.toJSONSchema(plannerDecisionSchema), validationError,
            budget: { remainingCalls: MAX_PLANNER_CALLS - calls, remainingReadRounds: MAX_READ_ROUNDS - readRounds },
            ...(validationError ? { correction: "仅修正所列格式或输入错误；不要增加新的设计要求。" } : {}),
          }), parse: parsePlannerDecision,
        }));
        parsed = true;
        if (decision.kind === "read") {
          if (readRounds >= MAX_READ_ROUNDS || calls >= MAX_PLANNER_CALLS) throw new Error("补读预算已用尽，请根据真实已读信息回答或澄清");
          if (!decision.reads.length || decision.reads.length > 4) throw new Error("每轮补读需要一至四个类型化请求");
          readRounds += 1;
          await reserve();
          for (const read of decision.reads) {
            const result = await gateway.read(input.userId, input.projectId, input.conversationId, built.graph, read, input.readPolicy);
            readResults.push(result.result);
            if (result.visual) attached = mergeVisual(result.visual, attached);
          }
          validationError = null;
          continue;
        }
        if ((decision.kind === "propose") !== Boolean(decision.action)) throw new Error("只有propose可以包含action，且propose必须提供action");
        if (decision.action) {
          const operations = compileWorkflowAction(built.graph, decision.action, [...new Set([...input.referencedNodeIds, ...built.context.focusNodeIds])], eligibility);
          const operation = operations.find((item) => item.type === "update_node" || item.type === "add_node" && item.node.kind === "tool");
          const parameters = operation?.type === "update_node" ? object(operation.payload).params
            : operation?.type === "add_node" ? object(operation.node.payload).params : decision.action.parameters;
          const fingerprint = workflowActionFingerprint({ ...decision.action, parameters: object(parameters) });
          if (declined.some((proposal) => proposal.actionFingerprint === fingerprint)) throw new Error("该相同动作已被设计师跳过；请回答、澄清或提出实质不同的动作，不能仅改标题和理由重复建议");
        }
        if (decision.objectiveUpdate && !input.request.includes(decision.objectiveUpdate.sourceQuote)) throw new Error("项目目标更新必须逐字引用当前用户的明确表达");
        validationError = null;
        break;
      } catch (error) {
        const repairable = parsed || error instanceof z.ZodError || error instanceof Error && /json|schema|结构|格式/iu.test(error.message);
        if (!repairable) throw error;
        if (repaired || calls >= MAX_PLANNER_CALLS) {
          if (!parsed) throw error;
          decision = parsePlannerDecision({ kind: "clarify", message: `当前动作尚不能准备：${error instanceof Error ? error.message.slice(0, 400) : "输入需要确认"}。请确认对应节点或修改范围。`, plan: null, objectiveUpdate: null, preferences: [] });
          validationError = null;
          break;
        }
        repaired = true;
        await reserve();
        validationError = error instanceof Error ? error.message.slice(0, 800) : "结构化结果无效";
      }
    }
    if (!decision || decision.kind === "read" || validationError) throw new Error("设计助手未在预算内形成有效回复");
    return { decision, built, profile, visual: attached, eligibility, calls, readRounds, repairUsed: repaired, readResults,
      coverage: "coverage" in integrated ? integrated.coverage : built.context.coverage,
      observation: { ...projectedContext.context, imageBindings: attached.imageBindings, visualCoverage: attached.coverage },
      snapshot: { graphRevision: built.graph.revision, contextRevision: built.context.contextRevision,
        summaryRevision: built.context.summaryRevision, toolVersions: tools.map((tool) => ({ key: tool.key, version: tool.version })) } };
  }
}

function mergeVisual(priority: VisualContextResult, previous: VisualContextResult): VisualContextResult {
  const selected = new Map<string, { binding: VisualContextResult["imageBindings"][number]; image: VisualContextResult["images"][number] }>();
  for (const source of [priority, previous]) for (const binding of source.imageBindings) {
    const image = source.images[binding.imageIndex];
    if (image && !selected.has(binding.nodeId) && selected.size < 8) selected.set(binding.nodeId, { binding, image });
  }
  const values = [...selected.values()];
  const index = [...new Map([...previous.index, ...priority.index].map((entry) => [entry.nodeId, entry])).values()];
  return { images: values.map((value) => value.image), imageBindings: values.map((value, imageIndex) => ({ ...value.binding, imageIndex })), index,
    coverage: { ...previous.coverage, attachedNodeIds: [...selected.keys()], unreadNodeIds: index.filter((entry) => !selected.has(entry.nodeId)).map((entry) => entry.nodeId) } };
}

export const coordinatorJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
