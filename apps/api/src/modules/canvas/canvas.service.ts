import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@fashion/db";
import type { CanvasDocumentView, CanvasSave } from "@fashion/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import type { WorkflowSemanticPatchInput } from "../workflows/workflows.schemas";

export const CANVAS_DB = Symbol("CANVAS_DB");
export const canvasObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const canvasHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const canvasJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
const materialTypes = new Set([
  "brief",
  "reference_text",
  "reference_image",
  "swatch",
  "sketch",
  "candidate",
  "trend",
  "fabric",
  "legacy",
]);

@Injectable()
export class CanvasService {
  constructor(
    @Inject(CANVAS_DB) readonly database: PrismaClient,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
  ) {}

  async initialize(
    userId: string,
    projectId: string,
  ): Promise<CanvasDocumentView> {
    const permission = await this.access.require(userId, projectId);
    // Initialization is a projection. A viewer cannot migrate or change the project's mode.
    if (!permission.capabilities.edit || permission.archived)
      return this.read(userId, projectId);
    await this.database.$transaction(
      async (tx) => {
        await this.writable(userId, projectId, tx);
        await this.lock(tx, projectId);
        if (await tx.canvasDocument.findUnique({ where: { projectId } }))
          return;
        const nodes = await tx.workflowNode.findMany({ where: { projectId } });
        const existingBindings = await tx.canvasObjectBinding.findMany({
          where: { projectId },
          select: { nodeId: true },
        });
        const represented = new Set(
          existingBindings.map((binding) => binding.nodeId),
        );
        const old = await tx.boardSnapshot.findUnique({ where: { projectId } });
        const elements = nodes.length
          ? []
          : await tx.boardElement.findMany({
              where: { projectId, deletedAt: null },
            });
        const graph = await tx.workflowGraph.findUnique({
          where: { projectId },
        });
        // Never mix a current graph with an older board. Preserve the old document verbatim.
        const snapshot = nodes.length ? {} : canvasObject(old?.snapshot);
        const operations: WorkflowSemanticPatchInput["operations"] = [];
        const bindings: {
          projectId: string;
          shapeId: string;
          nodeId: string;
        }[] = [];
        const records = canvasObject(
          canvasObject(snapshot.document).store ?? snapshot.store,
        );
        const legacyRecords = new Map(
          Object.values(records)
            .map(canvasObject)
            .filter((record) => record.typeName === "shape")
            .map((record) => [String(record.id), record]),
        );
        for (const element of elements)
          if (element.record)
            legacyRecords.set(element.shapeId, canvasObject(element.record));
        if (elements.length) {
          if (snapshot.document)
            snapshot.document = {
              ...canvasObject(snapshot.document),
              store: { ...records, ...Object.fromEntries(legacyRecords) },
            };
          else if (snapshot.store)
            snapshot.store = {
              ...records,
              ...Object.fromEntries(legacyRecords),
            };
          else snapshot.legacyRecords = [...legacyRecords.values()];
        }
        for (const [shapeId, record] of legacyRecords) {
          const props = canvasObject(record.props);
          const type = record.type;
          if (
            ![
              "fashion-image",
              "fashion-note",
              "fashion-swatch",
              "fashion-fabric",
            ].includes(String(type))
          )
            continue;
          const nodeId = randomUUID();
          const payload =
            type === "fashion-note"
              ? { text: String(props.text ?? ""), historicalImport: true }
              : type === "fashion-swatch"
                ? {
                    color: props.color,
                    ...(Array.isArray(props.colors) && props.colors.length
                      ? {
                          colors: props.colors.map((color) => {
                            const item = canvasObject(color);
                            return {
                              hex: item.hex ?? item.color,
                              name:
                                String(item.name ?? item.label ?? "色彩").slice(
                                  0,
                                  48,
                                ) || "色彩",
                            };
                          }),
                        }
                      : {}),
                    historicalImport: true,
                  }
                : type === "fashion-fabric"
                  ? { fabricId: props.fabricId, historicalImport: true }
                  : {
                      ...(props.assetId ? { assetId: props.assetId } : {}),
                      ...(props.fileId ? { fileAssetId: props.fileId } : {}),
                      historicalImport: true,
                    };
          // Unknown image references stay visible in the old document, not fabricated as usable inputs.
          if (type === "fashion-image" && !props.assetId && !props.fileId)
            continue;
          operations.push({
            type: "add_node",
            node: {
              id: nodeId,
              kind: "asset",
              type:
                type === "fashion-note"
                  ? "reference_text"
                  : type === "fashion-swatch"
                    ? "swatch"
                    : type === "fashion-fabric"
                      ? "fabric"
                      : "reference_image",
              title:
                String(props.title ?? props.label ?? "历史导入").slice(
                  0,
                  200,
                ) || "历史导入",
              payload: canvasObject(canvasJson(payload)),
              x: 0,
              y: 0,
            },
          });
          bindings.push({ projectId, shapeId, nodeId });
        }
        if (operations.length > 300)
          throw new BadRequestException(
            "历史素材超过当前图容量，请先分项目整理；原白板仍保留",
          );
        let revision = graph?.revision ?? 0;
        // Graph mutation batches are bounded; all batches share the same transaction.
        for (let i = 0; i < operations.length; i += 100) {
          const result = await this.workflows.applySystemMutation(
            projectId,
            {
              mode: "semantic",
              mutationId: randomUUID(),
              baseRevision: revision,
              operations: operations.slice(i, i + 100),
            },
            undefined,
            undefined,
            tx,
          );
          revision = result.revision;
        }
        bindings.push(
          ...nodes
            .filter(
              (node) =>
                node.kind === "asset" &&
                materialTypes.has(node.type) &&
                !represented.has(node.id),
            )
            .map((node) => ({
              projectId,
              shapeId: `shape:canvas-${node.id}`,
              nodeId: node.id,
            })),
        );
        await tx.canvasDocument.create({
          data: {
            projectId,
            snapshot: canvasJson(snapshot),
            initializedFrom: nodes.length
              ? "workflow"
              : old || elements.length
                ? "legacy"
                : "empty",
            sourceGraphRevision: revision,
          },
        });
        if (bindings.length)
          await tx.canvasObjectBinding.createMany({ data: bindings });
        await tx.project.update({
          where: { id: projectId },
          data: { canvasInteractionMode: "canvas" },
        });
      },
      { timeout: 30_000 },
    );
    return this.read(userId, projectId);
  }

  async read(userId: string, projectId: string): Promise<CanvasDocumentView> {
    const permission = await this.access.require(userId, projectId);
    return this.database.$transaction(async (tx) => {
      await this.lock(tx, projectId);
      let document = await tx.canvasDocument.findUnique({
        where: { projectId },
      });
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { canvasInteractionMode: true },
      });
      let bindings = await tx.canvasObjectBinding.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      });
      if (document) {
        const represented = new Set(bindings.map((binding) => binding.nodeId));
        const nodes = await tx.workflowNode.findMany({
          where: { projectId, kind: "asset", type: { in: [...materialTypes] } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        const additions = nodes
          .filter((node) => !represented.has(node.id))
          .map((node) => ({
            projectId,
            shapeId: `shape:canvas-${node.id}`,
            nodeId: node.id,
          }));
        if (additions.length) {
          await tx.canvasObjectBinding.createMany({ data: additions });
          document = await tx.canvasDocument.update({
            where: { projectId },
            data: { revision: { increment: 1 } },
          });
          bindings = await tx.canvasObjectBinding.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
          });
        }
      }
      return {
        projectId,
        revision: document?.revision ?? 0,
        formatVersion: document?.formatVersion ?? 1,
        snapshot: canvasObject(document?.snapshot),
        initializedFrom: document?.initializedFrom ?? "uninitialized",
        bindings: bindings.map((binding) => ({
          shapeId: binding.shapeId,
          nodeId: binding.nodeId,
          removed: Boolean(binding.removedAt),
        })),
        mode: project.canvasInteractionMode === "canvas" ? "canvas" : "node",
        canEdit: permission.capabilities.edit && !permission.archived,
      };
    });
  }

  async save(userId: string, projectId: string, input: CanvasSave) {
    await this.writable(userId, projectId);
    await this.database.$transaction(async (tx) => {
      await this.writable(userId, projectId, tx);
      await this.lock(tx, projectId);
      const replay = await tx.canvasMutation.findUnique({
        where: {
          projectId_mutationId: { projectId, mutationId: input.mutationId },
        },
      });
      if (replay) {
        if (replay.requestHash !== canvasHash(input))
          throw new ConflictException("请求编号已用于其他白板操作");
        return;
      }
      const document = await tx.canvasDocument.findUnique({
        where: { projectId },
      });
      if (!document || document.revision !== input.baseRevision)
        throw new ConflictException({
          code: "CANVAS_REVISION_CONFLICT",
          message: "白板已更新，本地草稿仍保留，请重新载入后再保存",
        });
      const nodeIds = [
        ...new Set(input.bindings.map((binding) => binding.nodeId)),
      ];
      const nodes = await tx.workflowNode.findMany({
        where: { projectId, id: { in: nodeIds }, kind: "asset" },
        select: { id: true },
      });
      if (nodes.length !== nodeIds.length)
        throw new BadRequestException("白板引用包含未保存或不属于本项目的素材");
      const records = canvasObject(
        canvasObject(input.snapshot.document).store ?? input.snapshot.store,
      );
      for (const binding of input.bindings)
        if (canvasObject(records[binding.shapeId]).typeName !== "shape")
          throw new BadRequestException("素材绑定缺少对应的白板对象");
      await tx.canvasObjectBinding.updateMany({
        where: {
          projectId,
          removedAt: null,
          shapeId: { notIn: input.bindings.map((binding) => binding.shapeId) },
        },
        data: { removedAt: new Date() },
      });
      for (const binding of input.bindings)
        await tx.canvasObjectBinding.upsert({
          where: { projectId_shapeId: { projectId, shapeId: binding.shapeId } },
          create: { projectId, ...binding },
          update: { nodeId: binding.nodeId, removedAt: null },
        });
      await tx.canvasDocument.update({
        where: { projectId },
        data: {
          snapshot: canvasJson(input.snapshot),
          revision: { increment: 1 },
        },
      });
      await tx.canvasMutation.create({
        data: {
          projectId,
          mutationId: input.mutationId,
          requestHash: canvasHash(input),
          kind: "layout",
          result: { revision: input.baseRevision + 1 },
        },
      });
    });
    return this.read(userId, projectId);
  }

  async setMode(userId: string, projectId: string, mode: "canvas" | "node") {
    await this.database.$transaction(async (tx) => {
      await this.lock(tx, projectId);
      const permission = await this.access.require(userId, projectId, "manage", tx);
      if (permission.archived) throw new ForbiddenException("项目已归档，请先恢复项目");
      await tx.project.update({ where: { id: projectId }, data: { canvasInteractionMode: mode } });
    });
    return this.read(userId, projectId);
  }

  async writable(
    userId: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const permission = await this.access.require(userId, projectId, "edit", tx);
    if (permission.archived)
      throw new ForbiddenException("项目已归档，请先恢复项目");
  }

  async lock(tx: Prisma.TransactionClient, projectId: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${projectId}), hashtext('canvas-document'))`;
  }
}
