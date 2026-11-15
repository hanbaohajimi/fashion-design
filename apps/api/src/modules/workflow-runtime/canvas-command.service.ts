import { randomUUID } from "node:crypto";
import { ensureWorkflowNodeVersions, type Prisma } from "@fashion/db";
import {
  type CanvasCommand,
  type CanvasDocumentView,
  canvasMediaPayloadSchema,
  canvasMediaUrl,
  parseWorkflowToolParameters,
  workflowToolKeySchema,
  isRetiredWorkflowTool,
} from "@fashion/shared";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CanvasService,
  canvasHash,
  canvasJson,
  canvasObject,
} from "../canvas/canvas.service";
import { WorkflowsService } from "../workflows/workflows.service";
import type { WorkflowSemanticPatchInput } from "../workflows/workflows.schemas";
import { compileWorkflowAction } from "./workflow-planner";
import { WorkflowRuntimeService } from "./workflow-runtime.service";
import { directMutationId } from "./direct-execution";
import { S3FileStorage } from "../files/storage.service";
import { visibleStudioAssets } from "../studio/studio-asset-visibility";
import { requireRestoreSourceFile } from "../design-assets/restore-source-file";
import { requireProjectFile } from "../files/project-file-access";
import { ProjectAccessPolicy } from "../studio/project-access.policy";

@Injectable()
export class CanvasCommandService {
  constructor(
    @Inject(CanvasService) private readonly canvas: CanvasService,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
    @Inject(WorkflowRuntimeService)
    private readonly runtime: WorkflowRuntimeService,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage = new S3FileStorage(),
  ) {}

  async execute(
    userId: string,
    projectId: string,
    command: CanvasCommand,
    guard?: { intentEpoch?: number; nodeVersions?: Record<string, string> },
    beforeApply?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<{
    nodeId: string;
    graph: Awaited<ReturnType<WorkflowsService["get"]>>;
    canvas: CanvasDocumentView;
  }> {
    await this.canvas.writable(userId, projectId);
    const database = this.canvas.database;
    const receipt = await database.$transaction(
      async (tx) => {
        await this.canvas.writable(userId, projectId, tx);
        await this.canvas.lock(tx, projectId);
        const previous = await tx.canvasMutation.findUnique({
          where: {
            projectId_mutationId: { projectId, mutationId: command.mutationId },
          },
        });
        if (previous) {
          if (previous.requestHash !== canvasHash(command))
            throw new ConflictException("请求编号已用于其他业务操作");
          return canvasObject(previous.result);
        }
        await beforeApply?.(tx);
        const graph = await this.workflows.get(userId, projectId);
        if (
          command.baseGraphRevision !== undefined &&
          command.baseGraphRevision !== graph.revision
        )
          throw new ConflictException("素材或设计意图已更新，请核对后重试");
        let nodeId = "nodeId" in command ? command.nodeId : "";
        let operations: WorkflowSemanticPatchInput["operations"] = [];
        let actualInputIds: string[] = [];
        const placements: {
          shapeId: string;
          nodeId: string;
          position?: { x: number; y: number };
        }[] = [];
        if (command.type === "place_canvas_material") {
          const source = graph.nodes.find(node => node.id === command.nodeId && node.kind === "asset" && !canvasObject(node.payload).retiredNote);
          if (!source) throw new BadRequestException("素材不存在或不属于当前项目");
          if (command.expectedUpdatedAt && source.updatedAt.toISOString() !== command.expectedUpdatedAt) throw new ConflictException("素材已更新，请重新选择");
          nodeId = source.id;
          if (command.placement !== "reference") placements.push({ shapeId: `shape:material-${command.mutationId}`, nodeId, ...(command.position ? { position: command.position } : {}) });
        } else if (command.type === "import_reference_video") {
          const file = await requireProjectFile(tx, new ProjectAccessPolicy(tx), userId, command.fileId, projectId, tx);
          if (file.status !== "READY" || !["video/mp4", "video/webm"].includes(file.mimeType)) throw new BadRequestException("视频尚未完成上传或格式不受支持");
          try { const head = await this.storage.head(file.objectKey); if (head.contentLength !== file.sizeBytes || head.contentType?.split(";")[0]?.trim().toLowerCase() !== file.mimeType) throw new Error("Video mismatch"); }
          catch { throw new ServiceUnavailableException("视频文件暂时不可用，请重试原操作"); }
          const existing = graph.nodes.find(node => node.type === "media" && canvasObject(node.payload).fileAssetId === file.id);
          nodeId = existing?.id ?? directMutationId(`video-upload:${projectId}:${command.mutationId}`);
          if (!existing) operations.push({ type: "add_node", node: { id: nodeId, kind: "asset", type: "media", title: file.originalName.slice(0, 160), status: "completed", x: command.position?.x ?? 0, y: command.position?.y ?? 0,
            payload: canvasMediaPayloadSchema.parse({ mediaId: file.id, fileAssetId: file.id, mediaKind: "video", mimeType: file.mimeType, mediaUrl: canvasMediaUrl(projectId, file.id, file.id), width: file.width, height: file.height, durationMs: null, ...(command.placement === "reference" ? { canvasPlacement: "manual" } : {}) }),
          } });
          if (command.placement === "canvas") placements.push({ shapeId: `shape:video-${command.mutationId}`, nodeId, ...(command.position ? { position: command.position } : {}) });
        } else if (command.type === "import_reference_image") {
          const file = await requireProjectFile(tx, new ProjectAccessPolicy(tx), userId, command.fileId, projectId, tx);
          if (file.status !== "READY" || !file.thumbnail1024Key || !file.width || !file.height || !file.mimeType.startsWith("image/")) throw new BadRequestException("参考图片尚未处理完成，请稍后重试。");
          await requireRestoreSourceFile(this.storage, `s3://${file.objectKey}`, { code: "REFERENCE_IMAGE_UNAVAILABLE", message: "参考原图暂时无法读取，尚未加入项目。请稍后继续添加。" });
          await this.canvas.writable(userId, projectId, tx);
          const existing = graph.nodes.find(node => node.type === "reference_image" && canvasObject(node.payload).fileAssetId === file.id);
          nodeId = existing?.id ?? directMutationId(`reference-upload:${projectId}:${command.mutationId}`);
          if (!existing) operations.push({ type: "add_node", node: { id: nodeId, kind: "asset", type: "reference_image",
            title: file.originalName.trim().slice(0, 200) || "上传参考图", x: command.position?.x ?? 0, y: command.position?.y ?? 0,
            payload: { fileAssetId: file.id, sourceName: file.originalName, imageUrl: `/api/files/${encodeURIComponent(file.id)}/thumbnail/1024`, width: file.width, height: file.height,
              ...(command.placement === "reference" ? { canvasPlacement: "manual" } : {}),
            },
          } });
          if (!existing && command.placement !== "reference") placements.push({ shapeId: `shape:canvas-${nodeId}`, nodeId, ...(command.position ? { position: command.position } : {}) });
        } else if (command.type === "place_reference_image") {
          const source = graph.nodes.find(node => node.id === command.nodeId && node.kind === "asset" && node.type === "reference_image");
          const fileId = source && canvasObject(source.payload).fileAssetId;
          if (!source || typeof fileId !== "string") throw new BadRequestException("参考图片不存在或无法访问，请重新打开图片。");
          const file = await requireProjectFile(tx, new ProjectAccessPolicy(tx), userId, fileId, projectId, tx);
          if (file.status !== "READY" || !file.thumbnail1024Key || !file.width || !file.height || !file.mimeType.startsWith("image/")) throw new BadRequestException("参考图片尚未处理完成，请稍后重试。");
          await requireRestoreSourceFile(this.storage, `s3://${file.objectKey}`, { code: "REFERENCE_IMAGE_UNAVAILABLE", message: "参考原图暂时无法读取，尚未放入白板。请稍后继续。" });
          await this.canvas.writable(userId, projectId, tx);
          nodeId = source.id;
          const existingPlacement = await tx.canvasObjectBinding.findFirst({ where: { projectId, nodeId, removedAt: null } });
          if (!existingPlacement) placements.push({ shapeId: `shape:reference-${command.mutationId}`, nodeId, ...(command.position ? { position: command.position } : {}) });
        } else if (command.type === "place_generated_media") {
          const media = await tx.runwayMedia.findFirst({ where: { id: command.mediaId, projectId }, include: { run: { select: { showId: true, show: { select: { title: true } } } } } });
          if (!media || canvasObject(media.source).input === true || !/^(video|audio)\//u.test(media.mimeType))
            throw new BadRequestException("生成媒体不存在或无法放入当前项目，请刷新文件列表。");
          try {
            const head = await this.storage.head(media.objectKey);
            if (head.contentLength < 1 || head.contentLength !== media.sizeBytes || head.contentType?.split(";")[0]?.trim().toLowerCase() !== media.mimeType.toLowerCase()) throw new Error("媒体文件与记录不一致");
          } catch {
            throw new ServiceUnavailableException("媒体原文件暂时无法读取，尚未放入白板。请稍后继续原操作。");
          }
          await this.canvas.writable(userId, projectId, tx);
          const payload = canvasMediaPayloadSchema.parse({
            mediaId: media.id, mediaKind: media.mimeType.startsWith("video/") ? "video" : "audio", mimeType: media.mimeType,
            mediaUrl: canvasMediaUrl(projectId, media.id), runId: media.runId, showId: media.run.showId,
            width: media.width, height: media.height, durationMs: media.durationMs,
            ...(command.placement === "reference" ? { canvasPlacement: "manual" } : {}),
          });
          const existing = graph.nodes.find(node => node.type === "media" && canvasObject(node.payload).mediaId === media.id);
          nodeId = existing?.id ?? directMutationId(`generated-media:${projectId}:${command.mutationId}`);
          if (!existing) operations.push({ type: "add_node", node: { id: nodeId, kind: "asset", type: "media", title: media.originalName.trim().slice(0, 160) || media.run.show.title, status: "completed", payload,
            x: command.position?.x ?? 0, y: command.position?.y ?? 0 } });
          if (command.placement !== "reference") placements.push({ shapeId: `shape:generated-media-${command.mutationId}`, nodeId, ...(command.position ? { position: command.position } : {}) });
        } else if (command.type === "place_generated_asset") {
          const source = await tx.designAsset.findFirst({
            where: { AND: [visibleStudioAssets(projectId), { id: command.assetId, operation: { not: "IMPORTED" } }] },
            include: { designStep: { select: { intent: true } } },
          });
          if (!source) throw new BadRequestException("生成图片不存在或无法访问，请刷新文件列表。");
          if (Boolean(source.archivedAt) !== command.archived) throw new BadRequestException("图片归档状态已变化，请刷新文件列表后重新选择。");
          await requireRestoreSourceFile(this.storage, source.url);
          await this.canvas.writable(userId, projectId, tx);
          const title = source.designStep?.intent.trim().slice(0, 160) || "生成图片";
          const asset = source.archivedAt ? await tx.designAsset.create({ data: {
            id: `restore_${directMutationId(`generated-file:${projectId}:${command.mutationId}`)}`,
            projectId, rootAssetId: source.rootAssetId, parentAssetId: source.id, restoredFromAssetId: source.id,
            operation: "RESTORE", url: source.url, thumbnailUrl: source.thumbnailUrl, width: source.width, height: source.height, seed: source.seed,
            designStep: { create: { projectId, actor: "manual", tool: "restore", intent: "从归档生成图片继续创作", inputSnapshot: { version: 1,
              sources: [{ elementId: source.id, assetId: source.id, role: "restore_source", title }],
              constraints: { palette: [], notes: [], avoidLabels: [], fabricTerms: [] }, parameters: {},
            } } },
          } }) : source;
          const existing = graph.nodes.find(node => node.type === "candidate" && canvasObject(node.payload).assetId === asset.id);
          nodeId = existing?.id ?? directMutationId(`generated-file-node:${projectId}:${command.mutationId}`);
          if (!existing) operations.push({ type: "add_node", node: {
            id: nodeId, kind: "asset", type: "candidate", title, status: "completed",
            payload: { assetId: asset.id, historicalImport: true, imageUrl: `/api/design-assets/${encodeURIComponent(asset.id)}/content`,
              ...(asset.width ? { imageWidth: asset.width } : {}), ...(asset.height ? { imageHeight: asset.height } : {}),
              ...(source.archivedAt ? { restoredFromAssetId: source.id, parentAssetId: source.id } : {}),
            }, x: command.position?.x ?? 0, y: command.position?.y ?? 0,
          } });
          placements.push({ shapeId: `shape:generated-file-${command.mutationId}`, nodeId, ...(command.position ? { position: command.position } : {}) });
        } else if (
          command.type === "create_material" ||
          command.type === "import_materials"
        ) {
          for (const material of command.type === "import_materials"
            ? command.materials
            : [command]) {
            const materialPayload =
              material.materialType === "candidate"
                ? { ...material.payload, historicalImport: true }
                : material.payload;
            if (
              material.materialType === "candidate" &&
              (typeof material.payload.assetId !== "string" ||
                !(await tx.designAsset.findFirst({
                  where: { id: material.payload.assetId, projectId },
                  select: { id: true },
                })))
            )
              throw new BadRequestException(
                "导入作品必须引用本项目中真实存在的资产",
              );
            const bound = material.shapeId
              ? await tx.canvasObjectBinding.findUnique({
                  where: {
                    projectId_shapeId: { projectId, shapeId: material.shapeId },
                  },
                })
              : null;
            const existing = bound
              ? graph.nodes.find((node) => node.id === bound.nodeId)
              : null;
            if (existing) {
              if (
                existing.type !== material.materialType ||
                canvasHash(existing.payload) !== canvasHash(materialPayload)
              )
                throw new ConflictException(
                  "此白板对象已有保存记录，请恢复绑定后再编辑",
                );
              nodeId = existing.id;
            } else {
              nodeId = material.clientMaterialId ?? randomUUID();
              operations.push({
                type: "add_node",
                node: {
                  id: nodeId,
                  kind: "asset",
                  type: material.materialType,
                  title: material.title,
                  payload: materialPayload,
                  x: 0,
                  y: 0,
                },
              });
            }
            placements.push({
              shapeId: material.shapeId ?? `shape:canvas-${nodeId}`,
              nodeId,
              ...(material.position ? { position: material.position } : {}),
            });
          }
          nodeId = placements[0]?.nodeId ?? "";
        } else if (command.type === "update_material") {
          const node = graph.nodes.find(
            (item) => item.id === command.nodeId && item.kind === "asset",
          );
          if (
            !node ||
            ![
              "brief",
              "reference_text",
              "reference_image",
              "sketch",
              "swatch",
              "trend",
              "fabric",
              "legacy",
            ].includes(node.type)
          )
            throw new BadRequestException(
              "只能编辑素材，作品修改请使用图片工具",
            );
          const consumed =
            node.status !== "ready" ||
            (await tx.workflowExecution.count({
              where: {
                projectId,
                requestSnapshot: {
                  path: ["inputNodeIds"],
                  array_contains: [node.id],
                },
              },
            })) > 0 ||
            graph.edges.some(
              (edge) =>
                edge.sourceNodeId === node.id &&
                graph.nodes.some(
                  (target) =>
                    target.id === edge.targetNodeId &&
                    target.status !== "ready",
                ),
            );
          if (consumed) {
            nodeId = randomUUID();
            operations = [
              {
                type: "add_node",
                node: {
                  id: nodeId,
                  kind: "asset",
                  type: node.type as "reference_image",
                  title: command.title ?? node.title,
                  payload: { ...command.payload, sourceNodeId: node.id },
                  x: 0,
                  y: 0,
                },
              },
            ];
          } else
            operations = [
              {
                type: "update_node",
                nodeId,
                title: command.title,
                payload: command.payload,
              },
            ];
        } else if (command.type === "run_tool") {
          if (isRetiredWorkflowTool(command.toolKey)) {
            const reserved = command.creationRunId ? await tx.canvasCreationRun.findFirst({ where: { id: command.creationRunId, projectId, actorId: userId, mutationId: command.mutationId, state: "preparing" } }) : null;
            if (!reserved || canvasObject(reserved.command).toolKey !== command.toolKey) throw new BadRequestException("旧分析和评估流程已退役，请在助手对话中讨论。");
          }
          const inputs = [...command.inputs];
          try {
            operations = compileWorkflowAction(
              graph,
              {
                type: "create_tool",
                toolKey: command.toolKey,
                toolVersion: "1",
                targetNodeId: null,
                targetNodeVersionId: null,
                title: command.title,
                parameters: command.parameters,
                inputs,
                newObjective: command.newObjective ?? null,
                rationale: "设计师明确执行",
                preserve: [],
                evidenceRefs: inputs.map((input) => input.nodeId),
              },
              inputs.map((input) => input.nodeId),
              {},
            );
          } catch (error) {
            throw new BadRequestException(
              error instanceof Error ? error.message : "工具参数无效",
            );
          }
          const tool = operations.find(
            (operation) =>
              operation.type === "add_node" && operation.node.kind === "tool",
          );
          if (tool?.type === "add_node") {
            nodeId = tool.node.id;
            if (command.creationRunId) {
              const run = await tx.canvasCreationRun.findFirst({ where: { id: command.creationRunId, projectId, actorId: userId, mutationId: command.mutationId } });
              if (!run) throw new BadRequestException("创作执行记录不存在或不属于本次请求");
              tool.node.payload = { ...tool.node.payload, canvasCreationId: run.creationId, canvasCreationRunId: run.id };
              await tx.canvasCreationRun.update({ where: { id: run.id }, data: { toolNodeId: nodeId } });
            }
          }
          actualInputIds = operations.flatMap((operation) =>
            operation.type === "add_edge" &&
            operation.edge.targetNodeId === nodeId
              ? [operation.edge.sourceNodeId]
              : [],
          );
        } else if (command.type === "configure_tool") {
          const node = graph.nodes.find(
            (item) => item.id === nodeId && item.kind === "tool",
          );
          if (node && isRetiredWorkflowTool(node.type)) throw new BadRequestException("此旧流程已退役，历史记录仍可查看。");
          if (
            !node ||
            node.status !== "ready" ||
            (await tx.workflowAttempt.count({
              where: { projectId, toolNodeId: nodeId },
            }))
          )
            throw new ConflictException(
              "已执行的工具不能改写参数，请创建新的操作",
            );
          let parameters;
          try {
            parameters = parseWorkflowToolParameters(
              workflowToolKeySchema.parse(node.type),
              command.parameters,
            );
          } catch {
            throw new BadRequestException("工具参数无效");
          }
          operations = [
            {
              type: "update_node",
              nodeId,
              payload: { ...canvasObject(node.payload), params: parameters },
            },
          ];
        } else if (command.type === "link_collection")
          operations = [
            {
              type: "link_collection",
              nodeId,
              collectionId: command.collectionId,
            },
          ];
        if (operations.length)
          await this.workflows.applySystemMutation(
            projectId,
            {
              mode: "semantic",
              mutationId: command.mutationId,
              baseRevision: graph.revision,
              operations,
            },
            undefined,
            undefined,
            tx,
            ["import_reference_image", "import_reference_video"].includes(command.type) ? userId : undefined,
          );
        if (command.type === "update_material") {
          const priorBinding = !command.shapeId
            ? await tx.canvasObjectBinding.findFirst({
                where: { projectId, nodeId: command.nodeId, removedAt: null },
                orderBy: { createdAt: "asc" },
              })
            : null;
          placements.push({
            shapeId:
              command.shapeId ??
              priorBinding?.shapeId ??
              `shape:canvas-${nodeId}`,
            nodeId,
          });
        }
        for (const placement of placements)
          await tx.canvasObjectBinding.upsert({
            where: {
              projectId_shapeId: { projectId, shapeId: placement.shapeId },
            },
            create: {
              projectId,
              shapeId: placement.shapeId,
              nodeId: placement.nodeId,
            },
            update: { nodeId: placement.nodeId, removedAt: null },
          });
        if (placements.length) {
          const document = await tx.canvasDocument.findUnique({
            where: { projectId },
          });
          if (document)
            await tx.canvasDocument.update({
              where: { projectId },
              data: {
                revision: { increment: 1 },
                snapshot: canvasJson({
                  ...canvasObject(document.snapshot),
                  placementHints: {
                    ...canvasObject(
                      canvasObject(document.snapshot).placementHints,
                    ),
                    ...Object.fromEntries(
                      placements.flatMap((placement) =>
                        placement.position
                          ? [[placement.shapeId, placement.position]]
                          : [],
                      ),
                    ),
                  },
                }),
              },
            });
        }
        const versions =
          command.type === "run_tool" || command.type === "execute_tool"
            ? await ensureWorkflowNodeVersions(tx, projectId, graph.revision)
            : new Map<string, { id: string }>();
        const inputIds =
          command.type === "run_tool"
            ? actualInputIds
            : graph.edges
                .filter((edge) => edge.targetNodeId === nodeId)
                .map((edge) => edge.sourceNodeId);
        const result = {
          nodeId,
          nodeVersions: Object.fromEntries(
            inputIds.flatMap((id) => {
              const version = versions.get(id);
              return version ? [[id, version.id]] : [];
            }),
          ),
        };
        await tx.canvasMutation.create({
          data: {
            projectId,
            mutationId: command.mutationId,
            requestHash: canvasHash(command),
            kind: command.type,
            result: canvasJson(result),
          },
        });
        return result;
      },
      { timeout: 30_000 },
    );
    let nodeId = String(receipt.nodeId ?? "");
    // The durable receipt is committed before queue submission. Replaying uses the same
    // execution id, including recovery after a process crash between these two steps.
    if (command.type === "run_tool" || command.type === "execute_tool")
      await this.runtime.execute(
        userId,
        projectId,
        nodeId,
        {
          mutationId: command.mutationId,
          ...(command.conversationId
            ? { conversationId: command.conversationId }
            : {}),
        },
        {
          ...guard,
          nodeVersions: {
            ...(canvasObject(receipt.nodeVersions) as Record<string, string>),
            ...guard?.nodeVersions,
          },
        },
      );
    else if (command.type === "decide")
      await this.runtime.decide(userId, projectId, nodeId, command);
    else if (command.type === "restore") {
      const restored = await this.runtime.importAsset(userId, projectId, {
        ...command,
        operation: "restore",
      });
      nodeId =
        restored.nodes.find(
          (node) =>
            node.type === "candidate" &&
            canvasObject(node.payload).assetId === command.assetId,
        )?.id ?? "";
      await database.canvasMutation.update({
        where: {
          projectId_mutationId: { projectId, mutationId: command.mutationId },
        },
        data: { result: canvasJson({ ...receipt, nodeId }) },
      });
    }
    return {
      nodeId,
      graph: await this.workflows.get(userId, projectId),
      canvas: await this.canvas.read(userId, projectId),
    };
  }
}
