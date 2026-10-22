import {
  DesignAssetOperation,
  FileStatus,
  Prisma,
  type DesignAsset,
  type DesignAssetDecision,
  type PrismaClient,
  type WorkflowAttempt,
  type WorkflowNodeVersion,
} from "@fashion/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  DESIGN_PATH_MAX_ASSETS,
  type DesignDecisionView,
  type DesignPathStep,
  type DesignPathView,
  type DesignStepSnapshot,
  type DesignSourceSnapshot,
} from "@fashion/shared";
import { ProjectAccessPolicy, type ProjectAction } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";
import { requireProjectFile } from "../files/project-file-access";
import {
  designDecisionSchema,
  designStepSnapshotSchema,
  type DesignDecisionInput,
} from "./design-path.schemas";

export const DESIGN_ASSETS_DB = Symbol("DESIGN_ASSETS_DB");

type DesignAssetDatabase = Pick<
  PrismaClient,
  "designAsset" | "designAssetDecision" | "fileAsset" | "project" | "workspaceMember"
> & Partial<Pick<PrismaClient, "workflowNode" | "workflowEdge" | "workflowAttempt" | "workflowNodeVersion" | "workflowExecution">>;

interface OwnedDesignAsset extends DesignAsset {
  readonly project: {
    readonly deletedAt: Date | null;
    readonly workspace: {
      readonly ownerId: string;
    };
  };
}

interface PathBudget {
  assetReads: number;
  versions: number;
  steps: number;
}
const createPathBudget = (): PathBudget => ({ assetReads: DESIGN_PATH_MAX_ASSETS, versions: DESIGN_PATH_MAX_ASSETS, steps: DESIGN_PATH_MAX_ASSETS });

export interface DesignAssetView {
  readonly id: string;
  readonly projectId: string;
  readonly parentAssetId: string | null;
  readonly restoredFromAssetId: string | null;
  readonly operation: Lowercase<keyof typeof DesignAssetOperation>;
  readonly url: string;
  readonly thumbnailUrl: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly seed: number | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

@Injectable()
export class DesignAssetsService {
  constructor(
    @Inject(DESIGN_ASSETS_DB)
    private readonly database: DesignAssetDatabase,
    @Inject(S3FileStorage)
    private readonly storage: S3FileStorage,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database),
  ) {}

  async importFile(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<DesignAssetView> {
    await this.access.require(userId, projectId, "edit");
    const file = await requireProjectFile(this.database, this.access, userId, fileId, projectId);
    if (file.status !== FileStatus.READY) {
      throw new BadRequestException({
        code: "FILE_NOT_READY",
        message: "图片仍在处理中，请稍后重试",
      });
    }

    const id = randomUUID();
    const imported = await this.database.designAsset.upsert({
      where: {
        projectId_sourceFileId: { projectId, sourceFileId: fileId },
      },
      update: {},
      create: {
        height: file.height,
        id,
        operation: DesignAssetOperation.IMPORTED,
        projectId,
        rootAssetId: id,
        sourceFileId: file.id,
        thumbnailUrl: file.thumbnail1024Key
          ? `s3://${file.thumbnail1024Key}`
          : file.thumbnail256Key
            ? `s3://${file.thumbnail256Key}`
            : null,
        url: `s3://${file.objectKey}`,
        width: file.width,
        designStep: {
          create: {
            projectId,
            actor: "manual",
            tool: "imported",
            intent: "导入设计素材",
            inputSnapshot: {
              version: 1,
              sources: [
                {
                  elementId: file.id,
                  fileAssetId: file.id,
                  role: "import_source",
                  title: file.originalName,
                },
              ],
              constraints: {
                palette: [],
                notes: [],
                avoidLabels: [],
                fabricTerms: [],
              },
              parameters: {},
            },
          },
        },
      },
    });
    return this.toView(imported);
  }

  async downloadUrl(
    userId: string,
    assetId: string,
    variant: "content" | "thumbnail",
  ): Promise<string> {
    const asset = await this.ownedAsset(userId, assetId);
    const stored =
      variant === "thumbnail" ? (asset.thumbnailUrl ?? asset.url) : asset.url;
    const objectKey = objectKeyFrom(stored);
    return objectKey ? this.storage.createDownloadUrl(objectKey, 60) : stored;
  }

  async versions(
    userId: string,
    assetId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{
    readonly items: readonly DesignAssetView[];
    readonly nextCursor: string | null;
  }> {
    const asset = await this.ownedAsset(userId, assetId);
    if (cursor) {
      const cursorAsset = await this.ownedAsset(userId, cursor);
      if (cursorAsset.rootAssetId !== asset.rootAssetId) {
        throw new BadRequestException({
          code: "INVALID_ASSET_CURSOR",
          message: "版本分页游标无效",
        });
      }
    }

    const records = await this.database.designAsset.findMany({
      where: { rootAssetId: asset.rootAssetId, projectId: asset.projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = records.slice(0, limit);
    return {
      items: page.map((record) => this.toView(record)),
      nextCursor: records.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async path(userId: string, assetId: string): Promise<DesignPathView> {
    const target = await this.ownedAsset(userId, assetId);
    const budget = createPathBudget();
    const workflowPath = await this.workflowPath(userId, target, budget);
    if (workflowPath) return workflowPath;
    return this.legacyPath(userId, target, budget);
  }

  private async legacyPath(userId: string, target: DesignAsset, budget: PathBudget): Promise<DesignPathView> {
    const assetId = target.id;
    const pending = [assetId];
    const visited = new Set<string>();
    const available = new Set<string>();
    const steps = new Map<string, DesignPathStep>();
    let incomplete = false;
    while (pending.length && visited.size < DESIGN_PATH_MAX_ASSETS) {
      if (budget.assetReads <= 0 || budget.steps <= 0) { incomplete = true; break; }
      const id = pending.shift();
      if (!id) continue;
      if (visited.has(id)) continue;
      visited.add(id);
      budget.assetReads -= 1;
      const asset = await this.database.designAsset.findFirst({
        where: { id, projectId: target.projectId },
        include: {
          designStep: true,
          generationTask: {
            include: {
              designStep: true,
              generatedAssets: { where: { projectId: target.projectId }, take: Math.max(1, budget.assetReads + 1), orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
              agentMessage: { select: { conversationId: true } },
              agentRunAttempt: {
                select: {
                  step: {
                    select: { run: { select: { conversationId: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!asset) {
        incomplete = true;
        continue;
      }
      available.add(asset.id);
      const recorded = asset.designStep ?? asset.generationTask?.designStep;
      const parsed = designStepSnapshotSchema.safeParse(
        recorded?.inputSnapshot,
      );
      const fallbackSources = [
        ...(asset.parentAssetId
          ? [
              {
                elementId: asset.parentAssetId,
                assetId: asset.parentAssetId,
                role: "edit_source",
                title: "上一设计版本",
              },
            ]
          : []),
        ...(asset.restoredFromAssetId
          ? [
              {
                elementId: asset.restoredFromAssetId,
                assetId: asset.restoredFromAssetId,
                role: "restore_source",
                title: "恢复来源",
              },
            ]
          : []),
        ...(asset.sourceFileId
          ? [
              {
                elementId: asset.sourceFileId,
                fileAssetId: asset.sourceFileId,
                role: "import_source",
                title: "原始上传素材",
              },
            ]
          : []),
      ];
      const snapshot: DesignStepSnapshot = parsed.success
        ? parsed.data
        : {
            version: 1,
            sources: fallbackSources,
            constraints: {
              palette: [],
              notes: [],
              avoidLabels: [],
              fabricTerms: [],
            },
            parameters: {},
          };
      const recordedOutputs =
        asset.generationTask?.generatedAssets.filter(
          (output) => output.projectId === target.projectId,
        ) ?? [];
      const outputs = recordedOutputs.slice(0, budget.assetReads);
      budget.assetReads -= outputs.length;
      if (recordedOutputs.length > outputs.length) incomplete = true;
      for (const output of outputs) available.add(output.id);
      const stepId = recorded?.id ?? `legacy:${asset.id}`;
      if (!steps.has(stepId)) budget.steps -= 1;
      steps.set(stepId, {
        ...snapshot,
        id: stepId,
        tool: recorded?.tool ?? asset.operation.toLowerCase(),
        actor: recorded?.actor ?? "legacy",
        intent: recorded?.intent ?? "历史资产，仅保留已有血缘信息",
        createdAt: (recorded?.createdAt ?? asset.createdAt).toISOString(),
        status: asset.generationTask?.status.toLowerCase() ?? "succeeded",
        snapshotAvailable: parsed.success,
        outputs: (outputs.length ? outputs : [asset]).map((output) =>
          this.toView(output),
        ),
        conversationId:
          asset.generationTask?.agentMessage?.conversationId ??
          asset.generationTask?.agentRunAttempt?.step.run.conversationId ??
          null,
      });
      const dependencies = [
        asset.parentAssetId,
        asset.restoredFromAssetId,
        ...snapshot.sources.map((source) => source.assetId),
      ];
      for (const dependency of dependencies) {
        if (dependency && !visited.has(dependency)) pending.push(dependency);
      }
    }
    if (pending.some((id) => !visited.has(id))) incomplete = true;
    const decisions = await this.database.designAssetDecision.findMany({
      where: { assetId: { in: [...available] }, userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 101,
    });
    const ordered = orderDesignSteps([...steps.values()]);
    return {
      assetId,
      steps: ordered.steps,
      decisions: decisions.slice(0, 100).map(decisionView),
      incomplete: incomplete || ordered.cyclic || decisions.length > 100,
    };
  }

  private async workflowPath(userId: string, target: DesignAsset, budget: PathBudget): Promise<DesignPathView | null> {
    const versionStore = this.database.workflowNodeVersion;
    const attemptStore = this.database.workflowAttempt;
    if (!versionStore || !attemptStore) return null;
    // Start from the first recorded output, not a mutable reference to the asset on today's canvas.
    const targetVersion = await versionStore.findFirst({
      where: { projectId: target.projectId, kind: "asset", payload: { path: ["assetId"], equals: target.id } },
      orderBy: [{ graphRevision: "asc" }, { version: "asc" }, { id: "asc" }],
    });
    budget.versions -= 1;
    if (!targetVersion) return null;
    const versions = new Map<string, WorkflowNodeVersion>([[targetVersion.id, targetVersion]]);
    const visited = new Set<string>();
    const producers = new Map<string, Set<string>>();
    const producerTasks = new Map<string, Set<string>>();
    const pending = [targetVersion];
    let incomplete = false;
    while (pending.length) {
      const version = pending.pop();
      if (!version) break;
      if (visited.has(version.id)) continue;
      if (visited.size >= DESIGN_PATH_MAX_ASSETS) { incomplete = true; break; }
      visited.add(version.id);
      const versionBindings = pathBindings(version.inputBindings);
      if (!Array.isArray(version.inputBindings) || versionBindings.length !== version.inputBindings.length) incomplete = true;
      for (const binding of versionBindings) {
        let source = versions.get(binding.versionId);
        if (!source) {
          if (budget.versions <= 0) { incomplete = true; break; }
          budget.versions -= 1;
          source = await versionStore.findFirst({ where: { id: binding.versionId, projectId: target.projectId } }) ?? undefined;
        }
        if (!source || source.nodeId !== binding.nodeId || source.graphRevision > version.graphRevision || source.id === version.id) {
          incomplete = true;
          continue;
        }
        versions.set(source.id, source);
        if (source.kind === "tool") {
          const attemptId = pathString(pathObject(version.payload).attemptId);
          if (attemptId) producers.set(source.id, new Set([...(producers.get(source.id) ?? []), attemptId]));
          const taskId = pathString(pathObject(version.payload).generationTaskId) || (pathObject(version.payload).assetId === target.id ? target.generationTaskId : null);
          if (taskId) producerTasks.set(source.id, new Set([...(producerTasks.get(source.id) ?? []), taskId]));
        }
        pending.push(source);
      }
    }
    const tools = [...versions.values()].filter((version) => visited.has(version.id) && version.kind === "tool");
    if (!tools.length) {
      if (!incomplete) return null;
      const fallback = await this.legacyPath(userId, target, budget);
      return { ...fallback, incomplete: true };
    }
    const steps = new Map<string, DesignPathStep>();
    const versionSteps = new Map<string, Set<string>>();
    const outputIds = new Set<string>([target.id]);
    for (const tool of tools) {
      if (budget.steps <= 0) { incomplete = true; break; }
      const hintedIds = [...(producers.get(tool.id) ?? [])];
      const taskHints = [...(producerTasks.get(tool.id) ?? [])];
      const attempts: WorkflowAttempt[] = await attemptStore.findMany({ where: {
        projectId: target.projectId, toolNodeId: tool.nodeId, nodeVersionId: tool.id, status: "completed",
        ...(hintedIds.length ? { id: { in: hintedIds } } : {}),
        ...(taskHints.length ? { generationTaskId: { in: taskHints } } : {}),
      }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: budget.steps + 1 });
      // An unlinked retry must never be guessed to be the producer of an old result.
      const groups = new Map(attempts.map((attempt) => [attempt.executionId ?? attempt.id, attempt]));
      if (groups.size > budget.steps || !hintedIds.length && groups.size > 1) incomplete = true;
      const selected: (WorkflowAttempt | undefined)[] = !hintedIds.length && groups.size > 1 ? [] : [...groups.values()].slice(0, budget.steps);
      if (!selected.length) { incomplete = true; selected.push(undefined); }
      for (const attempt of selected) {
        const stepId = attempt?.executionId ?? attempt?.id ?? tool.id;
        if (steps.has(stepId)) continue;
        if (budget.steps <= 0) { incomplete = true; break; }
        budget.steps -= 1;
        versionSteps.set(tool.id, new Set([...(versionSteps.get(tool.id) ?? []), stepId]));
        const snapshot = pathObject(attempt?.requestSnapshot);
        const bindings = pathBindings(tool.inputBindings);
        const recordedInputs = Array.isArray(snapshot.inputSnapshot) ? snapshot.inputSnapshot.map(pathObject) : [];
        const hasSnapshot = Array.isArray(snapshot.inputSnapshot) && bindings.every((binding) => recordedInputs.some((input) => input.id === binding.nodeId && input.nodeVersionId === binding.versionId)) &&
          recordedInputs.every((input) => bindings.some((binding) => input.id === binding.nodeId && input.nodeVersionId === binding.versionId));
        const recordedStep = designStepSnapshotSchema.safeParse(snapshot.designStepSnapshot);
        const inputs = bindings.flatMap((binding) => {
          const recorded = recordedInputs.find((input) => input.id === binding.nodeId && input.nodeVersionId === binding.versionId);
          if (recorded) return [recorded];
          const source = versions.get(binding.versionId);
          return source ? [{ id: source.nodeId, type: source.type, title: source.title, payload: source.payload }] : [];
        });
        if (!hasSnapshot) incomplete = true;
        const sources: readonly DesignSourceSnapshot[] = recordedStep.success ? recordedStep.data.sources : inputs.map((input) => {
          const payload = pathObject(input.payload);
          const ref = (key: string): Record<string, string> => typeof payload[key] === "string" ? { [key]: payload[key] } : {};
          return { elementId: pathString(input.id), title: pathString(input.title), role: bindings.find((binding) => binding.nodeId === input.id)?.port ?? "unrecorded",
            ...ref("assetId"), ...ref("fileAssetId"), ...ref("fabricId"), ...ref("trendItemId"), ...ref("text"),
            ...(typeof payload.color === "string" ? { colors: [payload.color] } : {}) };
        });
        const params = pathObject(snapshot.params ?? pathObject(tool.payload).params);
        const request = pathObject(snapshot.request);
        const parameters: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries({ ...params, ...Object.fromEntries(
          ["prompt", "negativePrompt", "taskType", "width", "height", "quality", "outputFormat", "background"].filter((key) => request[key] !== undefined).map((key) => [key, request[key]])), toolVersion: snapshot.toolVersion ?? pathObject(tool.payload).toolVersion })) {
          if (!/url|token|key|secret/iu.test(key) && ["string", "number", "boolean"].includes(typeof value)) parameters[key] = value as string | number | boolean;
        }
        const siblings = attempt?.executionId ? await attemptStore.findMany({ where: {
          projectId: target.projectId, executionId: attempt.executionId, toolNodeId: tool.nodeId, nodeVersionId: tool.id,
        }, orderBy: [{ ordinal: "asc" }], take: DESIGN_PATH_MAX_ASSETS + 1 }) : attempt ? [attempt] : [];
        if (siblings.length > DESIGN_PATH_MAX_ASSETS) incomplete = true;
        const taskIds = siblings.slice(0, DESIGN_PATH_MAX_ASSETS).flatMap((item) => item.generationTaskId ? [item.generationTaskId] : []);
        const explicitIds = siblings.slice(0, DESIGN_PATH_MAX_ASSETS).flatMap((item) => {
          const id = pathObject(item.requestSnapshot).outputAssetId; return typeof id === "string" ? [id] : [];
        });
        if (!attempt) for (const version of versions.values()) {
          const assetId = pathObject(version.payload).assetId;
          if (version.kind === "asset" && typeof assetId === "string" && pathBindings(version.inputBindings).some((binding) => binding.versionId === tool.id)) explicitIds.push(assetId);
        }
        const outputs = taskIds.length || explicitIds.length ? await this.database.designAsset.findMany({ where: { projectId: target.projectId,
          OR: [...(taskIds.length ? [{ generationTaskId: { in: taskIds } }] : []), ...(explicitIds.length ? [{ id: { in: explicitIds } }] : [])] },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: budget.assetReads + 1 }) : [];
        const includedOutputs = outputs.slice(0, budget.assetReads);
        budget.assetReads -= includedOutputs.length;
        if (outputs.length > includedOutputs.length) incomplete = true;
        for (const output of includedOutputs) outputIds.add(output.id);
        const execution = attempt?.executionId && this.database.workflowExecution ? await this.database.workflowExecution.findFirst({
          where: { id: attempt.executionId, projectId: target.projectId, toolNodeId: tool.nodeId, nodeVersionId: tool.id }, select: { conversationId: true },
        }) : null;
        steps.set(stepId, { version: 1, id: stepId, tool: tool.type, actor: tool.origin === "proposal" ? "agent" : "manual",
          intent: pathString(request.prompt ?? params.prompt) || tool.title, createdAt: (attempt?.createdAt ?? tool.createdAt).toISOString(),
          status: attempt ? "succeeded" : "history_missing", snapshotAvailable: hasSnapshot, sources, parameters,
          constraints: recordedStep.success ? recordedStep.data.constraints : { palette: sources.flatMap((source) => source.colors ?? []),
            notes: sources.flatMap((source) => source.text ? [source.text] : []), avoidLabels: [],
            fabricTerms: inputs.filter((input) => input.type === "fabric").map((input) => pathString(input.title)) },
          outputs: includedOutputs.map((output) => this.toView(output)), conversationId: execution?.conversationId ?? null });
      }
    }
    const legacyRootIds = [...new Set([...versions.values()].filter((version) => visited.has(version.id) && version.kind === "asset" && !pathBindings(version.inputBindings).length)
      .flatMap((version) => { const id = pathObject(version.payload).assetId; return typeof id === "string" ? [id] : []; }).concat(
        [...steps.values()].flatMap((step) => step.sources.flatMap((source) => source.assetId && !outputIds.has(source.assetId) ? [source.assetId] : []))))];
    const allDecisions = new Map<string, DesignDecisionView>();
    for (const id of legacyRootIds) {
      if (budget.assetReads <= 0 || budget.steps <= 0) { incomplete = true; break; }
      budget.assetReads -= 1;
      const root = await this.database.designAsset.findFirst({ where: { id, projectId: target.projectId } });
      if (!root) { incomplete = true; continue; }
      const legacy = await this.legacyPath(userId, root, budget);
      for (const step of legacy.steps) { steps.set(step.id, step); for (const output of step.outputs) outputIds.add(output.id); }
      for (const decision of legacy.decisions) allDecisions.set(decision.id, decision);
      incomplete ||= legacy.incomplete;
    }
    const decisions = await this.database.designAssetDecision.findMany({ where: { assetId: { in: [...outputIds] }, userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101 });
    for (const decision of decisions.slice(0, 100)) allDecisions.set(decision.id, decisionView(decision));
    incomplete ||= decisions.length > 100;
    const dependencies = new Map<string, string[]>();
    const ancestorSteps = new Map<string, string[]>();
    const sourceSteps = (versionId: string, seen: Set<string>): string[] => {
      if (seen.has(versionId)) { incomplete = true; return []; }
      const cached = ancestorSteps.get(versionId);
      if (cached) return cached;
      const version = versions.get(versionId);
      if (!version) return [];
      const direct = versionSteps.get(versionId);
      if (direct) return [...direct];
      const result = [...new Set(pathBindings(version.inputBindings).flatMap((binding) => sourceSteps(binding.versionId, new Set([...seen, versionId]))))];
      ancestorSteps.set(versionId, result);
      return result;
    };
    for (const tool of tools) for (const stepId of versionSteps.get(tool.id) ?? []) {
      dependencies.set(stepId, pathBindings(tool.inputBindings).flatMap((binding) => sourceSteps(binding.versionId, new Set([tool.id]))));
    }
    const ordered = orderDesignSteps([...steps.values()], dependencies);
    return { assetId: target.id, steps: ordered.steps, decisions: [...allDecisions.values()], incomplete: incomplete || ordered.cyclic };
  }

  async decide(
    userId: string,
    assetId: string,
    input: DesignDecisionInput,
  ): Promise<DesignDecisionView> {
    await this.ownedAsset(userId, assetId, "edit");
    const parsed = designDecisionSchema.parse(input);
    const decision = await this.database.designAssetDecision
      .upsert({
        where: {
          assetId_clientRequestId: {
            assetId,
            clientRequestId: parsed.clientRequestId,
          },
        },
        update: {},
        create: { ...parsed, assetId, userId },
      })
      .catch((error: unknown) => {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        )
          throw error;
        return this.database.designAssetDecision.findUniqueOrThrow({
          where: {
            assetId_clientRequestId: {
              assetId,
              clientRequestId: parsed.clientRequestId,
            },
          },
        });
      });
    if (
      decision.kind !== parsed.kind ||
      decision.reason !== parsed.reason ||
      decision.userId !== userId
    ) {
      throw new ConflictException({
        code: "DECISION_REQUEST_REUSED",
        message: "该请求已用于另一项设计决策，请刷新后重试",
      });
    }
    return decisionView(decision);
  }

  async restore(
    userId: string,
    targetAssetId: string,
    currentAssetId: string,
    clientRequestId?: string,
  ): Promise<DesignAssetView> {
    const [target, current] = await Promise.all([
      this.ownedAsset(userId, targetAssetId, "edit"),
      this.ownedAsset(userId, currentAssetId, "edit"),
    ]);
    if (
      target.projectId !== current.projectId ||
      target.rootAssetId !== current.rootAssetId
    ) {
      throw new BadRequestException({
        code: "ASSET_LINEAGE_MISMATCH",
        message: "只能恢复同一资产链中的版本",
      });
    }

    const restoredId = clientRequestId ? `restore_${createHash("sha256").update(`${userId}:${clientRequestId}`).digest("hex").slice(0, 40)}` : randomUUID();
    const assertRestore = (asset: DesignAsset): void => {
      if (asset.operation !== DesignAssetOperation.RESTORE || asset.parentAssetId !== current.id || asset.restoredFromAssetId !== target.id || asset.projectId !== current.projectId)
        throw new ConflictException({ code: "RESTORE_REQUEST_REUSED", message: "该请求编号已用于另一项版本恢复" });
    };
    if (clientRequestId) {
      const replay = await this.database.designAsset.findUnique({ where: { id: restoredId } });
      if (replay) { assertRestore(replay); return this.toView(replay); }
    }
    const restored = await this.database.designAsset.create({
      data: {
        id: restoredId,
        archivedAt: null,
        generationTaskId: null,
        height: target.height,
        operation: DesignAssetOperation.RESTORE,
        parentAssetId: current.id,
        projectId: current.projectId,
        restoredFromAssetId: target.id,
        rootAssetId: current.rootAssetId,
        seed: target.seed,
        thumbnailUrl: target.thumbnailUrl,
        url: target.url,
        width: target.width,
        designStep: {
          create: {
            projectId: current.projectId,
            tool: "restore",
            actor: "manual",
            intent: "恢复已有结果为新版本",
            inputSnapshot: {
              version: 1,
              sources: [
                {
                  elementId: current.id,
                  assetId: current.id,
                  role: "edit_source",
                  title: "恢复前版本",
                },
                {
                  elementId: target.id,
                  assetId: target.id,
                  role: "restore_source",
                  title: "恢复来源",
                },
              ],
              constraints: {
                palette: [],
                notes: [],
                avoidLabels: [],
                fabricTerms: [],
              },
              parameters: {},
            },
          },
        },
      },
    }).catch(async (error: unknown) => {
      if (!clientRequestId || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const replay = await this.database.designAsset.findUniqueOrThrow({ where: { id: restoredId } });
      assertRestore(replay);
      return replay;
    });
    return this.toView(restored);
  }

  private async ownedAsset(
    userId: string,
    assetId: string,
    action: ProjectAction = "read",
  ): Promise<OwnedDesignAsset> {
    const asset = await this.database.designAsset.findUnique({
      where: { id: assetId },
      include: {
        project: {
          select: {
            deletedAt: true,
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!asset || asset.project.deletedAt) {
      throw new NotFoundException({
        code: "DESIGN_ASSET_NOT_FOUND",
        message: "设计资产不存在",
      });
    }
    await this.access.require(userId, asset.projectId, action);
    return asset;
  }

  private toView(asset: DesignAsset): DesignAssetView {
    return {
      archivedAt: asset.archivedAt,
      createdAt: asset.createdAt,
      height: asset.height,
      id: asset.id,
      operation: asset.operation.toLowerCase() as DesignAssetView["operation"],
      parentAssetId: asset.parentAssetId,
      projectId: asset.projectId,
      restoredFromAssetId: asset.restoredFromAssetId,
      seed: asset.seed === null ? null : Number(asset.seed),
      thumbnailUrl: asset.thumbnailUrl
        ? displayAssetUrl(asset.id, "thumbnail", asset.thumbnailUrl)
        : null,
      url: displayAssetUrl(asset.id, "content", asset.url),
      width: asset.width,
    };
  }
}

function pathObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pathString(value: unknown): string { return typeof value === "string" ? value : ""; }

function pathBindings(value: unknown) {
  return (Array.isArray(value) ? value : []).map(pathObject).map((binding) => ({
    nodeId: pathString(binding.sourceNodeId), versionId: pathString(binding.sourceNodeVersionId), port: pathString(binding.targetPort),
  })).filter((binding) => binding.nodeId && binding.versionId);
}

function objectKeyFrom(value: string): string | null {
  return value.startsWith("s3://") ? value.slice("s3://".length) : null;
}

function orderDesignSteps(steps: DesignPathStep[], dependencies: ReadonlyMap<string, readonly string[]> = new Map()): {
  steps: DesignPathStep[];
  cyclic: boolean;
} {
  const byAsset = new Map(
    steps.flatMap((step) =>
      step.outputs.map((output) => [output.id, step] as const),
    ),
  );
  const visiting = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visited = new Set<string>();
  const ordered: DesignPathStep[] = [];
  let cyclic = false;
  const visit = (step: DesignPathStep) => {
    if (visited.has(step.id)) return;
    if (visiting.has(step.id)) {
      cyclic = true;
      return;
    }
    visiting.add(step.id);
    for (const id of dependencies.get(step.id) ?? []) {
      const source = byId.get(id);
      if (source) visit(source);
    }
    const sourceIds = [
      ...step.sources.map((source) => source.assetId),
      ...step.outputs.map((output) => output.parentAssetId),
    ];
    for (const id of sourceIds) {
      const source = id ? byAsset.get(id) : undefined;
      if (source) visit(source);
    }
    visiting.delete(step.id);
    visited.add(step.id);
    ordered.push(step);
  };
  steps
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
    .forEach(visit);
  return { steps: ordered, cyclic };
}

function decisionView(decision: DesignAssetDecision): DesignDecisionView {
  return {
    id: decision.id,
    assetId: decision.assetId,
    kind: designDecisionSchema.shape.kind.parse(decision.kind),
    reason: decision.reason,
    createdAt: decision.createdAt.toISOString(),
  };
}

function displayAssetUrl(
  assetId: string,
  variant: "content" | "thumbnail",
  stored: string,
): string {
  return objectKeyFrom(stored)
    ? `/api/design-assets/${encodeURIComponent(assetId)}/${variant}`
    : stored;
}
