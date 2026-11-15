import { randomUUID } from "node:crypto";
import { ensureWorkflowNodeVersions, Prisma } from "@fashion/db";
import {
  canvasCreationDraftSchema,
  canvasCreationModuleSchema,
  canvasMediaPayloadSchema,
  canvasMediaUrl,
  parseWorkflowToolParameters,
  isRetiredWorkflowTool,
  type CanvasCommand,
  type CanvasCreation,
  type CanvasCreationDraft,
  type CreateCanvasCreationInput,
  type CreationInputBinding,
  type CreationResultView,
  type CreationRunView,
  type RunCanvasCreationInput,
  type UpdateCanvasCreationInput,
} from "@fashion/shared";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CanvasService, canvasHash, canvasJson, canvasObject } from "../canvas/canvas.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import { CanvasCommandService } from "./canvas-command.service";
import { directMutationId } from "./direct-execution";
import type { PlannerDecision } from "./workflow-planner";
import { readCreationResource, snapshotCreationResource, type ResourceSnapshot } from "./canvas-creation-resources";

type Graph = Awaited<ReturnType<WorkflowsService["get"]>>;
type CreationRecord = Prisma.CanvasCreationGetPayload<{ include: { runs: true } }>;
type RunRecord = CreationRecord["runs"][number];
const valueText = (value: unknown): string => typeof value === "string" ? value : "";
const numberOrNull = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export function creationResults(graph: Pick<Graph, "nodes" | "edges"> & { projectId?: string }, toolNodeId: string | null, runId?: string): CreationResultView[] {
  const outputIds = new Set(toolNodeId ? graph.edges.filter((edge) => edge.sourceNodeId === toolNodeId).map((edge) => edge.targetNodeId) : graph.nodes.filter((node) => runId && canvasObject(node.payload).canvasCreationRunId === runId).map((node) => node.id));
  return graph.nodes.filter((node) => outputIds.has(node.id) && node.kind === "asset" && node.status === "completed").map((node) => {
    const payload = canvasObject(node.payload);
    const assetId = valueText(payload.assetId) || null;
    const brief = canvasObject(payload.brief);
    const media = node.type === "media" ? canvasMediaPayloadSchema.safeParse(payload) : null;
    return {
      nodeId: node.id, assetId, title: node.title,
      ...(typeof payload.sourceNodeId === "string" ? { sourceNodeId: payload.sourceNodeId } : {}),
      imageUrl: assetId ? `/api/design-assets/${encodeURIComponent(assetId)}/content` : null,
      text: assetId || media?.success ? null : valueText(payload.text) || valueText(payload.summary) || valueText(brief.summary) || valueText(brief.intent) || "已生成分析结果",
      ...(media?.success && media.data.mediaUrl === canvasMediaUrl(graph.projectId ?? "", media.data.mediaId, media.data.fileAssetId) ? { media: { url: media.data.mediaUrl, mimeType: media.data.mimeType, durationMs: media.data.durationMs } } : {}),
      width: numberOrNull(payload.width ?? payload.imageWidth), height: numberOrNull(payload.height ?? payload.imageHeight),
    };
  });
}

function executionStatus(status: string | undefined, error: string | null): CreationRunView["status"] {
  if (!status) return error ? "failed" : "preparing";
  if (status === "completed" || status === "succeeded") return "completed";
  if (status === "partial_failed") return "partial_failed";
  if (status === "canceled") return "canceled";
  if (["failed", "moderation_failed", "not_admitted"].includes(status)) return "failed";
  if (status === "queued") return "queued";
  return "running";
}

/** The target is persistent; queue/execution records remain the source of task truth. */
@Injectable()
export class CanvasCreationsService {
  constructor(
    @Inject(CanvasService) private readonly canvas: CanvasService,
    @Inject(CanvasCommandService) private readonly commands: CanvasCommandService,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
  ) {}

  private get database() { return this.canvas.database; }

  async executeToolCommand(userId: string, projectId: string, command: Extract<CanvasCommand, { type: "run_tool" }>, guard?: { intentEpoch: number; nodeVersions: Record<string, string> }) {
    if (command.creationRunId) return this.commands.execute(userId, projectId, command);
    await this.canvas.writable(userId, projectId);
    const prior = await this.database.canvasCreationRun.findUnique({ where: { projectId_mutationId: { projectId, mutationId: command.mutationId } } });
    const legacy = await this.database.canvasMutation.findUnique({ where: { projectId_mutationId: { projectId, mutationId: command.mutationId } } });
    if (legacy && !prior) return this.commands.execute(userId, projectId, command);
    const parameters = parseWorkflowToolParameters(command.toolKey, command.parameters);
    const ordered = Array.isArray(parameters.referenceInputs) ? parameters.referenceInputs.map((value) => valueText(canvasObject(value).nodeId)) : [];
    const source = command.inputs.find((binding) => binding.port === "source");
    const bindings = [...command.inputs].sort((a, b) => {
      if (source && !ordered.length) return Number(b === source) - Number(a === source);
      const left = ordered.indexOf(a.nodeId), right = ordered.indexOf(b.nodeId);
      return (left < 0 ? ordered.length : left) - (right < 0 ? ordered.length : right);
    });
    const draft = canvasCreationDraftSchema.parse({ prompt: valueText(parameters.prompt) || command.newObjective || command.title,
      inputs: bindings.map((binding, index) => ({ id: `input-${index + 1}`, nodeId: binding.nodeId })), basedOnInputId: source ? `input-${bindings.indexOf(source) + 1}` : null,
      operation: { toolKey: command.toolKey, parameters },
      parameters: Object.fromEntries(["width", "height", "quality", "count", "negativePrompt"].flatMap((key) => parameters[key] === undefined ? [] : [[key, parameters[key]]])),
    });
    const target = await this.create(userId, projectId, { id: directMutationId(`tool-target:${command.mutationId}`), mutationId: directMutationId(`tool-target-create:${command.mutationId}`), title: command.title,
      module: command.toolKey === "generate_text" ? "text" : command.toolKey === "analyze_brief" ? "analysis" : command.toolKey === "evaluate_design" ? "evaluation" : "image", draft });
    const result = await this.run(userId, projectId, target.id, { mutationId: command.mutationId, expectedRevision: prior?.draftRevision ?? target.revision, ...(command.conversationId ? { conversationId: command.conversationId } : {}) }, guard);
    const run = result.runs.find((item) => item.id === prior?.id) ?? result.runs[0];
    if (!run?.toolNodeId) throw new ConflictException("执行回执尚未确认，请继续原操作");
    return { nodeId: run.toolNodeId, graph: await this.workflows.get(userId, projectId), canvas: await this.canvas.read(userId, projectId) };
  }

  async list(userId: string, projectId: string): Promise<{ items: CanvasCreation[]; canEdit: boolean }> {
    const permission = await this.access.require(userId, projectId, "read");
    const [records, initialGraph] = await Promise.all([
      this.database.canvasCreation.findMany({ where: { projectId }, include: { runs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      this.workflows.get(userId, projectId),
    ]);
    let graph = initialGraph;
    const resources = new Map<string, Awaited<ReturnType<typeof readCreationResource>>>();
    for (const record of records) for (const run of record.runs) {
      const snapshot = canvasObject(run.command).resourceSnapshot;
      if (snapshot) resources.set(run.id, await readCreationResource(this.database, projectId, snapshot as ResourceSnapshot));
    }
    const operations: Parameters<WorkflowsService["applySystemMutation"]>[1]["operations"] = [];
    for (const record of records) for (const run of record.runs) {
      const resource = resources.get(run.id);
      if (!resource) continue;
      const outputs = resource.assets.length ? resource.assets.map((asset) => ({ id: directMutationId(`creation-resource:${run.id}:${asset.id}`), asset }))
        : resource.status === "completed" ? [{ id: directMutationId(`creation-resource:${run.id}:text`), asset: null }] : [];
      for (const output of outputs) if (!graph.nodes.some((node) => node.id === output.id)) operations.push({ type: "add_node", node: {
        id: output.id, kind: "asset", type: output.asset ? "candidate" : "reference_text", title: record.title, status: "completed", x: 0, y: 0,
        payload: { ...(output.asset ? { assetId: output.asset.id, imageUrl: `/api/design-assets/${output.asset.id}/content`, width: output.asset.width, height: output.asset.height } : { text: resource.text }),
          canvasCreationId: record.id, canvasCreationRunId: run.id, canvasPlacement: "manual", resource: { kind: canvasObject(canvasObject(run.command).resourceSnapshot).kind, id: canvasObject(canvasObject(run.command).resourceSnapshot).id, revision: canvasObject(canvasObject(run.command).resourceSnapshot).revision } },
      } });
    }
    if (operations.length && !permission.archived) {
      try {
        graph = await this.workflows.applySystemMutation(projectId, { mode: "semantic", mutationId: randomUUID(), baseRevision: graph.revision, operations });
      } catch (cause) {
        if (!(cause instanceof ConflictException)) throw cause;
        graph = await this.workflows.get(userId, projectId);
      }
    }
    const toolIds = records.flatMap((record) => record.runs.flatMap((run) => run.toolNodeId ? [run.toolNodeId] : []));
    const executions = toolIds.length ? await this.database.workflowExecution.findMany({ where: { projectId, toolNodeId: { in: toolIds } }, orderBy: { createdAt: "desc" } }) : [];
    return {
      canEdit: permission.capabilities.edit && !permission.archived,
      items: records.map((record) => {
        const runs: CreationRunView[] = record.runs.map((run) => {
          const execution = executions.find((item) => item.toolNodeId === run.toolNodeId);
          const draft = canvasCreationDraftSchema.parse(run.draftSnapshot);
          const resource = resources.get(run.id);
          return {
            id: run.id, creationId: record.id, executionId: execution?.id ?? null, toolNodeId: run.toolNodeId,
            conversationId: run.actorId === userId ? run.conversationId : null, status: run.state === "manual" ? "completed" : resource?.status ?? executionStatus(execution?.status, run.error),
            draft, inputSnapshot: draft.inputs, results: creationResults(graph, run.toolNodeId, run.id), error: resource?.error ?? run.error, createdAt: run.createdAt.toISOString(),
            ...(resource ? { moduleRecord: resource.moduleRecord } : {}),
          };
        });
        const allResults = runs.flatMap((run) => run.results);
        const currentResult = (record.currentResultNodeId ? allResults.find((result) => result.nodeId === record.currentResultNodeId) : allResults[0]) ?? null;
        const position = canvasObject(record.position);
        const resource = canvasObject(record.resource);
        const kind = resource.kind;
        return {
          id: record.id, projectId, title: record.title, module: canvasCreationModuleSchema.parse(record.module), revision: record.revision,
          draft: canvasCreationDraftSchema.parse(record.draft), position: typeof position.x === "number" && typeof position.y === "number" ? { x: position.x, y: position.y } : null,
          currentResultNodeId: currentResult?.nodeId ?? null, currentResult, runs,
          resource: ["experiment", "pattern", "presentation", "collection", "trend"].includes(String(kind)) && typeof resource.id === "string" ? { kind: kind as NonNullable<CanvasCreation["resource"]>["kind"], id: resource.id } : null,
          removed: Boolean(record.removedAt), createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
        };
      }),
    };
  }

  async read(userId: string, projectId: string, id: string): Promise<CanvasCreation> {
    const item = (await this.list(userId, projectId)).items.find((creation) => creation.id === id);
    if (!item) throw new NotFoundException("创作节点不存在或已不可访问");
    return item;
  }

  async create(userId: string, projectId: string, input: CreateCanvasCreationInput) {
    await this.canvas.initialize(userId, projectId);
    const hash = canvasHash(input);
    await this.database.$transaction(async (tx) => {
      await this.canvas.writable(userId, projectId, tx);
      await this.canvas.lock(tx, projectId);
      const replay = await tx.canvasMutation.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } });
      if (replay) {
        if (replay.requestHash !== hash) throw new ConflictException("操作编号已用于其他创作请求");
        return;
      }
      if (["analysis", "evaluation"].includes(input.module)) throw new BadRequestException("旧分析和评估流程已退役，请在助手对话中讨论，或主动使用提示词增强。");
      if (await tx.canvasCreation.findUnique({ where: { id: input.id } })) throw new ConflictException("创作节点编号已被使用");
      await this.validateInputs(tx, projectId, input.id, input.draft.inputs);
      const layout = await tx.canvasDocument.findUnique({ where: { projectId }, select: { snapshot: true } });
      const snapshot = canvasObject(layout?.snapshot);
      const shapes = Object.values(canvasObject(canvasObject(snapshot.document).store ?? snapshot.store)).map(canvasObject).filter((record) => record.typeName === "shape");
      const position = input.position ?? { x: shapes.length ? Math.max(...shapes.map((shape) => numberOrNull(shape.x) ?? 0).map((x, index) => x + (numberOrNull(canvasObject(shapes[index]?.props).w) ?? 340))) + 100 : 0, y: 0 };
      await tx.canvasCreation.create({ data: {
        id: input.id, projectId, createdById: userId, title: input.title, module: input.module, draft: canvasJson(input.draft),
        position: canvasJson(position),
      } });
      await tx.canvasMutation.create({ data: { projectId, mutationId: input.mutationId, requestHash: hash, kind: "creation_create", result: { creationId: input.id } } });
    });
    return this.read(userId, projectId, input.id);
  }

  async update(userId: string, projectId: string, id: string, input: UpdateCanvasCreationInput, beforeApply?: (tx: Prisma.TransactionClient) => Promise<void>) {
    const hash = canvasHash({ id, ...input });
    const source = input.currentResultNodeId ? await this.read(userId, projectId, id) : null;
    const adoptedRun = source?.runs.find((run) => run.results.some((result) => result.nodeId === input.currentResultNodeId));
    if (input.currentResultNodeId && !adoptedRun) throw new BadRequestException("只能采用该节点真实生成过的结果");
    await this.database.$transaction(async (tx) => {
      await this.canvas.writable(userId, projectId, tx);
      await this.canvas.lock(tx, projectId);
      const replay = await tx.canvasMutation.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } });
      if (replay) {
        if (replay.requestHash !== hash) throw new ConflictException("操作编号已用于其他创作请求");
        return;
      }
      await beforeApply?.(tx);
      const creation = await tx.canvasCreation.findFirst({ where: { id, projectId } });
      if (!creation) throw new NotFoundException("创作节点不存在");
      if (creation.removedAt && input.removed !== false) throw new NotFoundException("创作节点已移出画布");
      if (creation.revision !== input.expectedRevision) throw new ConflictException("创作节点已更新，当前草稿仍保留，请重新载入后继续");
      if (input.draft) await this.validateInputs(tx, projectId, id, input.draft.inputs);
      const resourceSnapshot = input.resource ? await snapshotCreationResource(tx, projectId, input.resource) : null;
      if (input.conversationId && !(await tx.agentConversation.findFirst({ where: { id: input.conversationId, projectId, createdById: userId } }))) throw new BadRequestException("会话不属于当前项目");
      const adoptedRecord = adoptedRun ? await tx.canvasCreationRun.findUnique({ where: { id: adoptedRun.id } }) : null;
      const adoptedResource = canvasObject(canvasObject(adoptedRecord?.command).resourceSnapshot);
      let draft = adoptedRun?.draft ?? input.draft;
      if (input.publishText || input.mediaNodeId) {
        if (input.currentResultNodeId !== undefined) throw new BadRequestException("保存内容与恢复版本请分别操作");
        if (input.publishText && (creation.module !== "text" || input.mediaNodeId)) throw new BadRequestException("仅文本节点可以保存文本");
        if (input.mediaNodeId && creation.module !== "video") throw new BadRequestException("请选择视频节点承接该资源");
        const stored = canvasCreationDraftSchema.parse(draft ?? creation.draft);
        const runId = directMutationId(`creation-manual:${input.mutationId}`);
        const nodeId = directMutationId(`creation-manual-result:${input.mutationId}`);
        let payload: Record<string, unknown>;
        if (input.publishText) {
          if (!stored.textContent?.trim()) throw new BadRequestException("请先填写文本内容");
          payload = { text: stored.textContent };
          draft = { ...stored, textMode: "manual", textBaseNodeId: nodeId };
        } else {
          if (!input.mediaNodeId) throw new BadRequestException("请选择视频资源");
          const source = await tx.workflowNode.findFirst({ where: { id: input.mediaNodeId, projectId, kind: "asset", type: "media" } });
          const media = canvasMediaPayloadSchema.safeParse(source?.payload);
          if (!source || !media.success || media.data.mediaKind !== "video") throw new BadRequestException("视频资源不可用，请重新选择");
          payload = { ...media.data, sourceNodeId: source.id };
        }
        const graph = await tx.workflowGraph.findUniqueOrThrow({ where: { projectId } });
        await this.workflows.applySystemMutation(projectId, { mode: "semantic", mutationId: directMutationId(`creation-manual-output:${input.mutationId}`), baseRevision: graph.revision, operations: [{ type: "add_node", node: {
          id: nodeId, kind: "asset", type: input.publishText ? "reference_text" : "media", title: creation.title, status: "completed", x: 0, y: 0,
          payload: { ...payload, canvasCreationId: id, canvasCreationRunId: runId, canvasPlacement: "manual" },
        } }] }, undefined, undefined, tx, userId);
        await tx.canvasCreationRun.create({ data: { id: runId, creationId: id, projectId, actorId: userId, mutationId: runId, requestHash: hash, draftRevision: creation.revision + 1, draftSnapshot: canvasJson({ ...(draft ?? stored), inputs: [], basedOnInputId: null }), command: { manualResultId: nodeId }, state: "manual", conversationId: input.conversationId ?? null } });
        await tx.canvasCreation.update({ where: { id }, data: { currentResultNodeId: nodeId } });
        // Manual saves remain in the creation run history, without creating an assistant reply.
      }
      if (resourceSnapshot) {
        const assetId = valueText(resourceSnapshot.content.sourceAssetId ?? resourceSnapshot.content.heroAssetId);
        if (assetId) {
          const asset = await tx.designAsset.findFirst({ where: { id: assetId, projectId } });
          if (!asset) throw new BadRequestException("功能输入图片已不可用");
          let node = await tx.workflowNode.findFirst({ where: { projectId, kind: "asset", payload: { path: ["assetId"], equals: assetId } }, orderBy: { createdAt: "asc" } });
          if (!node) {
            const nodeId = directMutationId(`resource-source:${projectId}:${assetId}`);
            const graph = await tx.workflowGraph.findUniqueOrThrow({ where: { projectId } });
            await this.workflows.applySystemMutation(projectId, { mode: "semantic", mutationId: directMutationId(`resource-source-import:${projectId}:${assetId}`), baseRevision: graph.revision, operations: [{ type: "add_node", node: { id: nodeId, kind: "asset", type: "candidate", title: "功能输入图片", status: "completed", x: 0, y: 0, payload: { assetId, imageUrl: `/api/design-assets/${assetId}/content`, width: asset.width, height: asset.height, canvasPlacement: "manual" } } }] }, undefined, undefined, tx, userId);
            node = await tx.workflowNode.findUniqueOrThrow({ where: { id: nodeId } });
          }
          const stored = canvasCreationDraftSchema.parse(draft ?? creation.draft);
          const binding = { id: `source:${assetId}`, nodeId: node.id, assetId };
          draft = { ...stored, inputs: [binding], basedOnInputId: binding.id };
        }
      }
      await tx.canvasCreation.update({ where: { id }, data: {
        revision: { increment: 1 }, ...(input.title !== undefined ? { title: input.title } : {}),
        ...(draft ? { draft: canvasJson(draft) } : {}),
        ...(input.currentResultNodeId !== undefined ? { currentResultNodeId: input.currentResultNodeId } : {}),
        ...(input.removed !== undefined ? { removedAt: input.removed ? new Date() : null } : {}),
        ...(input.resource !== undefined ? { resource: input.resource ? canvasJson(input.resource) : Prisma.DbNull } : {}),
        ...(adoptedRun && typeof adoptedResource.kind === "string" && typeof adoptedResource.id === "string" ? { resource: { kind: adoptedResource.kind, id: adoptedResource.id } } : {}),
      } });
      await tx.canvasMutation.create({ data: {
        projectId, mutationId: input.mutationId, requestHash: hash, kind: adoptedRun ? "creation_adopt_result" : "creation_update",
        result: canvasJson({ creationId: id, actorId: userId, ...(adoptedRun ? { sourceRunId: adoptedRun.id, nodeId: input.currentResultNodeId, conversationId: input.conversationId ?? null } : {}) }),
      } });
      if (adoptedRun && input.conversationId) await tx.agentMessage.create({ data: {
        conversationId: input.conversationId, clientRequestId: `creation-adopt:${input.mutationId}`, role: "ASSISTANT", status: "COMPLETED", kind: "reply", origin: "creative_activity",
        content: `已采用「${creation.title}」的历史结果`, context: canvasJson({ fileAssetIds: [], shapeIds: [], creationActivity: { creationId: id, runId: adoptedRun.id, event: "adopted", title: creation.title, prompt: adoptedRun.draft.prompt, inputNodeIds: adoptedRun.inputSnapshot.flatMap((binding) => binding.nodeId ? [binding.nodeId] : []), resultNodeId: input.currentResultNodeId } }),
      } });
      if (resourceSnapshot) {
        const resourceHash = canvasHash(resourceSnapshot);
        const runId = directMutationId(`resource-run:${id}:${resourceHash}`);
        const resourceDraft = canvasCreationDraftSchema.parse(draft ?? creation.draft);
        const existing = await tx.canvasCreationRun.findUnique({ where: { id: runId } });
        if (!existing) {
          await tx.canvasCreationRun.create({ data: { id: runId, projectId, creationId: id, actorId: userId, mutationId: runId, requestHash: resourceHash,
            draftRevision: creation.revision + 1, draftSnapshot: canvasJson(resourceDraft), command: canvasJson({ resourceSnapshot }), state: "domain", conversationId: input.conversationId ?? null } });
          if (input.conversationId && resourceSnapshot.taskIds.length) await tx.agentMessage.create({ data: { conversationId: input.conversationId, clientRequestId: `creation-module:${runId}`, role: "ASSISTANT", status: "COMPLETED", kind: "reply", origin: "creative_activity", content: `提交创作「${resourceSnapshot.title}」`, context: canvasJson({ fileAssetIds: [], shapeIds: [], creationActivity: { creationId: id, runId, event: "submitted", task: true, title: creation.title, prompt: resourceDraft.prompt, inputNodeIds: resourceDraft.inputs.flatMap((binding) => binding.nodeId ? [binding.nodeId] : []), resultNodeId: null } }) } });
        }
      }
    });
    return this.read(userId, projectId, id);
  }

  async run(userId: string, projectId: string, id: string, input: RunCanvasCreationInput, guard?: { intentEpoch: number; nodeVersions: Record<string, string> }) {
    await this.canvas.writable(userId, projectId);
    const hash = canvasHash({ creationId: id, ...input });
    let reservation = await this.database.canvasCreationRun.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } });
    if (reservation && reservation.requestHash !== hash) throw new ConflictException("操作编号已用于其他生成请求");
    if (!reservation) {
      reservation = await this.database.$transaction(async (tx) => {
        await this.canvas.writable(userId, projectId, tx);
        await this.canvas.lock(tx, projectId);
        const replay = await tx.canvasCreationRun.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } });
        if (replay) {
          if (replay.requestHash !== hash) throw new ConflictException("操作编号已用于其他生成请求");
          return replay;
        }
        const creation = await tx.canvasCreation.findFirst({ where: { id, projectId, removedAt: null } });
        if (!creation) throw new NotFoundException("创作节点不存在或已移出画布");
        if (["analysis", "evaluation"].includes(creation.module)) throw new BadRequestException("此旧流程已退役，历史结果仍可查看；新需求请在助手对话中继续。");
        if (creation.revision !== input.expectedRevision) throw new ConflictException("创作要求已变化，请重新核对后生成");
        if (input.conversationId && !(await tx.agentConversation.findFirst({ where: { id: input.conversationId, projectId, createdById: userId, archivedAt: null } }))) throw new BadRequestException("会话不属于当前项目或已归档");
        if (!["image", "text", "analysis", "evaluation"].includes(creation.module)) throw new BadRequestException(creation.module === "video" ? "视频节点目前只支持导入与播放" : "请在该功能的专用界面中提交");
        const draft = canvasCreationDraftSchema.parse(creation.draft);
        if (draft.operation && !(creation.module === "image" ? ["generate_design", "edit_design", "transform_image"] : creation.module === "text" ? ["generate_text"] : creation.module === "analysis" ? ["analyze_brief"] : ["evaluate_design"]).includes(draft.operation.toolKey)) throw new BadRequestException("本次工具与创作目标不匹配");
        if (!draft.prompt.trim()) throw new BadRequestException("请先填写本次创作要求");
        const pending = await tx.canvasCreationRun.findMany({ where: { creationId: id, state: "preparing", error: null } });
        for (const prior of pending) {
          const execution = prior.toolNodeId ? await tx.workflowExecution.findFirst({ where: { projectId, toolNodeId: prior.toolNodeId }, orderBy: { createdAt: "desc" } }) : null;
          if (!execution || ["queued", "running", "dispatching"].includes(execution.status)) throw new ConflictException("该节点仍有未确认或执行中的任务，请先继续原操作");
        }
        const graph = {
          projectId, revision: (await tx.workflowGraph.findUnique({ where: { projectId } }))?.revision ?? 0,
          nodes: await tx.workflowNode.findMany({ where: { projectId } }), edges: await tx.workflowEdge.findMany({ where: { projectId } }),
        };
        const versions = await ensureWorkflowNodeVersions(tx, projectId, graph.revision);
        const resolved = await this.resolveInputs(tx, projectId, draft.inputs, graph, versions);
        if (resolved.some(binding => graph.nodes.find(node => node.id === binding.nodeId)?.type === "media")) throw new BadRequestException("当前创作模型不支持视频输入，请使用图片或文本参考");
        const frozen: CanvasCreationDraft = { ...draft, inputs: resolved };
        const base = draft.basedOnInputId ? resolved.find((binding) => binding.id === draft.basedOnInputId) : null;
        const runId = randomUUID();
        const toolKey = draft.operation?.toolKey ?? (creation.module === "text" ? "generate_text" : creation.module === "analysis" ? "analyze_brief" : creation.module === "evaluation" ? "evaluate_design" : base ? "edit_design" : "generate_design");
        const original = draft.operation?.parameters;
        const parameters = original ? toolKey === "transform_image" ? original : ["generate_design", "edit_design"].includes(toolKey) ? { ...original, ...draft.parameters, prompt: draft.prompt, referenceInputs: original.taskType === "inpaint" ? [] : resolved.map((binding) => ({ nodeId: binding.nodeId })) } : { prompt: draft.prompt }
          : creation.module === "image" ? { ...draft.parameters, prompt: draft.prompt, taskType: base ? "i2i" : "t2i", referenceInputs: resolved.map((binding) => ({ nodeId: binding.nodeId })) } : { prompt: draft.prompt };
        const command: Extract<CanvasCommand, { type: "run_tool" }> = {
          type: "run_tool", mutationId: input.mutationId, creationRunId: runId, toolKey, title: creation.title,
          parameters,
          inputs: resolved.map((binding) => ({ nodeId: binding.nodeId ?? "", port: creation.module === "evaluation" ? graph.nodes.find((node) => node.id === binding.nodeId)?.type === "constraint" ? "constraint" as const : "candidate" as const : base?.id === binding.id ? "source" as const : "reference" as const })),
          ...(creation.module === "analysis" ? { newObjective: draft.prompt } : {}),
          ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        };
        await tx.canvasCreation.update({ where: { id }, data: { currentResultNodeId: null } });
        if (input.conversationId) await tx.agentMessage.create({ data: {
          conversationId: input.conversationId, clientRequestId: `creation-run:${runId}`, role: "ASSISTANT", status: "COMPLETED", kind: "reply", origin: "creative_activity",
          content: `提交创作「${creation.title}」`, context: canvasJson({ fileAssetIds: [], shapeIds: [], creationActivity: { creationId: id, runId, event: "submitted", title: creation.title, prompt: draft.prompt, inputNodeIds: resolved.flatMap((binding) => binding.nodeId ? [binding.nodeId] : []), resultNodeId: null } }),
        } });
        return tx.canvasCreationRun.create({ data: {
          id: runId, projectId, creationId: id, actorId: userId, mutationId: input.mutationId, requestHash: hash,
          draftRevision: creation.revision, draftSnapshot: canvasJson(frozen), command: canvasJson(command), conversationId: input.conversationId ?? null,
        } });
      }, { timeout: 30_000 });
    }
    await this.dispatch(userId, reservation, guard);
    return this.read(userId, projectId, id);
  }

  private async dispatch(userId: string, run: RunRecord, guard?: { intentEpoch: number; nodeVersions: Record<string, string> }) {
    const frozen = canvasCreationDraftSchema.parse(run.draftSnapshot);
    try {
      await this.commands.execute(userId, run.projectId, run.command as unknown as CanvasCommand, {
        ...(guard ? { intentEpoch: guard.intentEpoch } : {}),
        nodeVersions: Object.fromEntries(frozen.inputs.flatMap((binding) => binding.nodeId && binding.nodeVersionId ? [[binding.nodeId, binding.nodeVersionId]] : [])),
      });
      await this.database.canvasCreationRun.update({ where: { id: run.id }, data: { error: null } });
      const bound = await this.database.canvasCreationRun.findUnique({ where: { id: run.id } });
      const execution = bound?.toolNodeId ? await this.database.workflowExecution.findFirst({ where: { projectId: run.projectId, toolNodeId: bound.toolNodeId }, orderBy: { createdAt: "desc" } }) : null;
      if (run.conversationId && execution) await this.database.agentMessage.updateMany({ where: { conversationId: run.conversationId, clientRequestId: `creation-run:${run.id}` }, data: { executionId: execution.id } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创作请求暂时未能确认，请重试原操作";
      await this.database.canvasCreationRun.update({ where: { id: run.id }, data: { error: message.slice(0, 2000) } });
      throw error;
    }
  }

  /** Assistant execution uses the same target/input/run commands as manual creation. */
  async prepareAssistant(userId: string, projectId: string, messageId: string, decision: PlannerDecision) {
    const action = decision.action;
    if (action && isRetiredWorkflowTool(action.toolKey)) throw new BadRequestException("旧分析和评估流程已退役。");
    if (!action || !decision.prepareOnly || decision.execution.requested) throw new BadRequestException("没有明确的画布准备操作");
    const target = decision.canvasTarget ? await this.read(userId, projectId, decision.canvasTarget.creationId) : null;
    const supplied = valueText(action.parameters.prompt);
    if (supplied && !decision.preparationQuote?.includes(supplied) && supplied !== target?.draft.prompt) throw new BadRequestException("准备操作只能保存用户原文或现有要求，不能自动扩写提示词");
    const source = action.inputs.findIndex((binding) => binding.port === "source");
    const draft = canvasCreationDraftSchema.parse({ ...(target?.draft ?? {}), prompt: action.parameters.prompt === undefined ? target?.draft.prompt ?? "" : supplied,
      inputs: action.inputs.map((binding, index) => ({ id: `input-${index + 1}`, nodeId: binding.nodeId })), basedOnInputId: source < 0 ? null : `input-${source + 1}`,
      parameters: { ...(!target && action.toolKey === "generate_design" && !action.inputs.length ? { width: 1536, height: 864 } : {}), ...(target?.draft.parameters ?? {}), ...Object.fromEntries(["width", "height", "quality", "count"].flatMap((key) => action.parameters[key] === undefined ? [] : [[key, action.parameters[key]]])) },
    });
    if (target && decision.canvasTarget && decision.canvasTarget.mode !== "branch") return this.update(userId, projectId, target.id, { mutationId: directMutationId(`prepare-target:${messageId}`), expectedRevision: decision.canvasTarget.revision, draft });
    return this.create(userId, projectId, { id: directMutationId(`prepare-target:${messageId}`), mutationId: directMutationId(`prepare-create:${messageId}`), module: action.toolKey === "generate_text" ? "text" : action.toolKey === "analyze_brief" ? "analysis" : action.toolKey === "evaluate_design" ? "evaluation" : "image", title: action.title, draft });
  }

  async executeAssistant(userId: string, projectId: string, conversationId: string, messageId: string, decision: PlannerDecision, guard: { intentEpoch: number; nodeVersions: Record<string, string> }) {
    const action = decision.action;
    if (!action || !decision.execution.requested) throw new BadRequestException("没有明确执行指令");
    const runMutation = directMutationId(`creation-agent-run:${messageId}`);
    const prior = await this.database.canvasCreationRun.findUnique({ where: { projectId_mutationId: { projectId, mutationId: runMutation } } });
    if (prior) {
      await this.dispatch(userId, prior, guard);
      return this.read(userId, projectId, prior.creationId);
    }
    if (isRetiredWorkflowTool(action.toolKey) || decision.execution.operation && isRetiredWorkflowTool(decision.execution.operation)) throw new BadRequestException("旧分析和评估流程已退役。");
    const module = decision.execution.operation === "generate_text" ? "text" : "image";
    const params = { ...action.parameters, ...decision.execution.parameters };
    const ordered = Array.isArray(params.referenceInputs) ? params.referenceInputs.map((item) => valueText(canvasObject(item).nodeId)) : [];
    const bindings = [...action.inputs].filter((input) => input.port !== "goal").sort((a, b) => {
      const aIndex = ordered.indexOf(a.nodeId), bIndex = ordered.indexOf(b.nodeId);
      return (aIndex < 0 ? ordered.length : aIndex) - (bIndex < 0 ? ordered.length : bIndex);
    });
    const inputs = bindings.map((binding, index) => ({ id: `input-${index + 1}`, nodeId: binding.nodeId, ...(guard.nodeVersions[binding.nodeId] ? { nodeVersionId: guard.nodeVersions[binding.nodeId] } : {}) }));
    const source = bindings.findIndex((binding) => binding.port === "source");
    const target = decision.canvasTarget ? await this.read(userId, projectId, decision.canvasTarget.creationId) : null;
    const explicitRequest = decision.execution.sourceQuote?.trim();
    if (module === "image" && !explicitRequest) throw new BadRequestException("生图需要本次明确的用户要求");
    const rerunOnly = target && decision.canvasTarget?.mode === "regenerate" && /^(?:请|帮我|再|按照原要求|按原要求|使用原要求|用原要求|重新|生成|重跑|一次|一张|这张图|这张|这个节点|当前节点|此图|\s|[，。！!])+$/u.test(explicitRequest ?? "");
    const prompt = module === "image" ? target && decision.canvasTarget?.mode === "regenerate" ? rerunOnly ? target.draft.prompt : `${target.draft.prompt}\n${explicitRequest}` : explicitRequest : params.prompt ?? action.newObjective ?? action.title;
    const toolKey = decision.execution.operation ?? action.toolKey;
    const operation = rerunOnly ? target.draft.operation : { toolKey, parameters: parseWorkflowToolParameters(toolKey, { ...params, prompt, ...(["generate_design", "edit_design"].includes(toolKey) ? { negativePrompt: target?.draft.parameters.negativePrompt ?? "" } : {}) }) };
    const draft = canvasCreationDraftSchema.parse({ prompt,
      inputs: rerunOnly ? target.draft.inputs : inputs, basedOnInputId: rerunOnly ? target.draft.basedOnInputId : source < 0 ? null : inputs[source]?.id ?? null,
      ...(operation ? { operation } : {}),
      parameters: { ...(target?.draft.parameters ?? {}), ...(!rerunOnly ? Object.fromEntries(["width", "height", "quality", "count"].flatMap((key) => params[key] === undefined ? [] : [[key, params[key]]])) : {}), negativePrompt: target?.draft.parameters.negativePrompt ?? "" } });
    const configureId = directMutationId(`creation-agent-configure:${messageId}`);
    const configurationReceipt = target ? await this.database.canvasMutation.findUnique({ where: { projectId_mutationId: { projectId, mutationId: configureId } } }) : null;
    if (target && target.revision !== decision.canvasTarget?.revision && !configurationReceipt) throw new ConflictException("创作目标已更新，请重新核对当前要求");
    let creation: CanvasCreation;
    if (target && decision.canvasTarget?.mode === "regenerate") {
      if (target.module !== module) throw new BadRequestException("重新生成不能更换目标的功能类型");
      creation = await this.update(userId, projectId, target.id, { mutationId: configureId, expectedRevision: decision.canvasTarget.revision, draft });
      if (creation.revision !== decision.canvasTarget.revision + 1) throw new ConflictException("配置后目标又有修改，尚未生成，请重新核对");
    } else {
      if (target && decision.canvasTarget?.mode === "branch" && !target.runs.some((run) => run.results.some((result) => inputs.some((input) => input.nodeId === result.nodeId)))) throw new BadRequestException("继续创作必须引用该目标的真实结果版本");
      creation = await this.create(userId, projectId, { mutationId: directMutationId(`creation-agent-create:${messageId}`), id: directMutationId(`creation-agent-target:${messageId}`), module, title: action.title, draft });
    }
    return this.run(userId, projectId, creation.id, { mutationId: runMutation, expectedRevision: creation.revision, conversationId }, guard);
  }

  private async validateInputs(tx: Prisma.TransactionClient, projectId: string, targetId: string, inputs: readonly CreationInputBinding[]) {
    const nodes = await tx.workflowNode.findMany({ where: { projectId, kind: "asset" }, select: { id: true, payload: true } });
    const creations = await tx.canvasCreation.findMany({ where: { projectId } });
    const ownerOf = (binding: CreationInputBinding) => binding.creationId ?? valueText(canvasObject(nodes.find((node) => node.id === binding.nodeId)?.payload).canvasCreationId);
    const keys = new Set<string>();
    for (const input of inputs) {
      if (ownerOf(input) === targetId) throw new BadRequestException("创作节点不能引用自身，请使用“基于此图继续”建立新分支");
      if (input.creationId && !creations.some((creation) => creation.id === input.creationId && !creation.removedAt)) throw new BadRequestException("引用的创作节点不存在或不属于本项目");
      if (input.nodeId && !nodes.some((node) => node.id === input.nodeId)) throw new BadRequestException("引用的素材不存在或不属于本项目");
      const key = input.nodeId ?? input.creationId ?? "";
      if (keys.has(key)) throw new BadRequestException("该素材已在本次引用中");
      keys.add(key);
    }
    const adjacency = new Map(creations.map((creation) => [creation.id, canvasCreationDraftSchema.parse(creation.draft).inputs.flatMap((binding) => ownerOf(binding) ? [ownerOf(binding)] : [])]));
    adjacency.set(targetId, inputs.flatMap((input) => ownerOf(input) ? [ownerOf(input)] : []));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeId: string): void => {
      if (visiting.has(nodeId)) throw new BadRequestException("该连接会形成循环，请创建后续分支");
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);
      for (const next of adjacency.get(nodeId) ?? []) visit(next);
      visiting.delete(nodeId);
      visited.add(nodeId);
    };
    visit(targetId);
  }

  private async resolveInputs(
    tx: Prisma.TransactionClient, projectId: string, inputs: readonly CreationInputBinding[],
    graph: Pick<Graph, "nodes" | "edges">, versions: Map<string, { id: string }>,
  ): Promise<CreationInputBinding[]> {
    const output: CreationInputBinding[] = [];
    for (const input of inputs) {
      let nodeId = input.nodeId;
      if (input.creationId) {
        const source = await tx.canvasCreation.findFirst({ where: { id: input.creationId, projectId }, include: { runs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } } });
        if (!source || source.removedAt) throw new BadRequestException("参考创作节点已不可用");
        const outputs = source.runs.flatMap((run) => creationResults(graph, run.toolNodeId, run.id));
        nodeId = input.nodeId ?? source.currentResultNodeId ?? outputs[0]?.nodeId;
        if (!nodeId || !outputs.some((result) => result.nodeId === nodeId)) throw new BadRequestException("参考节点尚无可用结果，请等待完成后再生成");
        const sourceDraft = canvasCreationDraftSchema.parse(source.draft);
        if (!input.nodeId && source.module === "text" && sourceDraft.textMode === "manual" && sourceDraft.textContent !== outputs.find(result => result.nodeId === nodeId)?.text) throw new BadRequestException("上游文本还有未保存的编辑，请先保存文本");
      }
      const node = graph.nodes.find((item) => item.id === nodeId && item.kind === "asset");
      if (!node || !nodeId || node.status === "proposed") throw new BadRequestException("参考素材已不可用，请重新选择");
      if (canvasObject(node.payload).retiredNote) throw new BadRequestException("引用的便签已删除，请移除该引用后重试");
      const version = versions.get(nodeId)?.id;
      if (!version) throw new ConflictException("参考素材尚未保存，请稍后重试");
      if (input.nodeVersionId && input.nodeVersionId !== version) throw new ConflictException("参考版本已更新，请重新核对后生成");
      const assetId = valueText(canvasObject(node.payload).assetId);
      if (input.assetId && input.assetId !== assetId) throw new ConflictException("参考图片已被替换，请重新选择准确版本");
      output.push({ ...input, nodeId, nodeVersionId: version, ...(assetId ? { assetId } : {}) });
    }
    return output;
  }

}
