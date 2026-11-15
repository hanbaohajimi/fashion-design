import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@fashion/db";
import {
  assistantCanvasEnvelopeSchema,
  assistantCanvasObservationSchema,
  assistantShapeStamp,
  ASSISTANT_CANVAS_ACTION_LABELS,
  ASSISTANT_CANVAS_PANEL_LABELS,
  canvasCreationDraftSchema,
  type CanvasCreation,
  type AssistantCanvasAction,
  type AssistantCanvasEnvelope,
  type AssistantCanvasObservation,
  type AssistantCanvasProof,
  type AssistantCanvasResult,
  type CreationInputBinding,
} from "@fashion/shared";
import { WORKFLOW_RUNTIME_DB } from "./workflow-runtime.tokens";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import {
  CanvasService,
  canvasJson,
  canvasObject,
} from "../canvas/canvas.service";
import { CanvasCommandService } from "./canvas-command.service";
import { CanvasCreationsService } from "./canvas-creations.service";
import {
  actionShapeIds,
  canvasRecordProtected,
  canvasShapeRecords,
  readAssistantCanvasContext,
} from "./canvas-action-context";
import { directMutationId } from "./direct-execution";
import { WorkflowsService } from "../workflows/workflows.service";
import { canvasResultTargets } from "./canvas-action-result";

type ActionData = {
  material?: {
    materialType: "swatch" | "fabric";
    title: string;
    payload: Record<string, unknown>;
    nodeId?: string;
  };
  inputs?: CreationInputBinding[];
  fabricUpdatedAt?: string;
  materialUpdatedAt?: string;
  materialGraphRevision?: number;
  targetTitle?: string;
};
type Message = Awaited<
  ReturnType<PrismaClient["agentMessage"]["findUniqueOrThrow"]>
>;
export type AssistantCanvasServerResult =
  | Awaited<ReturnType<CanvasCommandService["execute"]>>
  | { creation: CanvasCreation };

@Injectable()
export class AssistantCanvasActionsService {
  constructor(
    @Inject(WORKFLOW_RUNTIME_DB) private readonly database: PrismaClient,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(CanvasService) private readonly canvas: CanvasService,
    @Inject(CanvasCommandService)
    private readonly commands: CanvasCommandService,
    @Inject(CanvasCreationsService)
    private readonly creations: CanvasCreationsService,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
  ) {}

  async prepare(
    userId: string,
    projectId: string,
    conversationId: string,
    messageId: string,
    turnId: string,
    intentEpoch: number,
    action: AssistantCanvasAction,
    observation: AssistantCanvasObservation | undefined,
  ) {
    await this.access.require(
      userId,
      projectId,
      action.type === "open_panel" ? "read" : "edit",
    );
    const current = await readAssistantCanvasContext(
      this.database,
      userId,
      projectId,
      observation,
    );
    if (!current)
      throw new ConflictException("画布未连接，请回到当前项目画布后再操作。");
    const ids = actionShapeIds(action);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException("目标对象编号重复，请重新选择。");
    const targets = ids.map((id) =>
      current.objects.find((item) => item.id === id),
    );
    if (targets.some((item) => !item || item.hidden || item.locked))
      throw new ConflictException("目标已变化、隐藏或锁定，请重新选择。");
    const envelope: AssistantCanvasEnvelope = {
      id: directMutationId(`canvas-action:${turnId}`),
      projectId,
      conversationId,
      messageId,
      clientId: current.clientId,
      intentEpoch,
      action,
      observation: assistantCanvasObservationSchema.parse({
        clientId: current.clientId,
        sequence: current.sequence,
        revision: current.revision,
        objects: current.objects,
        selectedIds: current.selectedIds,
        omitted: current.omitted,
        viewport: current.viewport,
      }),
      state: "pending",
    };
    const data: ActionData = {};
    if (action.type === "create_swatch")
      data.material = {
        materialType: "swatch",
        title: action.title,
        payload: { colors: action.colors, color: action.colors[0]?.hex },
      };
    if (action.type === "update_swatch") {
      const target = targets[0];
      const node = target?.nodeId
        ? await this.database.workflowNode.findFirst({
            where: { id: target.nodeId, projectId, type: "swatch" },
          })
        : null;
      if (!node) throw new BadRequestException("请选择真实色卡对象。");
      data.material = {
        materialType: "swatch",
        nodeId: node.id,
        title: action.title ?? node.title,
        payload: {
          ...canvasObject(node.payload),
          colors: action.colors,
          color: action.colors[0]?.hex,
        },
      };
      data.materialUpdatedAt = node.updatedAt.toISOString();
      data.materialGraphRevision = (
        await this.database.workflowGraph.findUniqueOrThrow({
          where: { projectId },
          select: { revision: true },
        })
      ).revision;
    }
    if (action.type === "add_fabric") {
      const fabric = await this.database.fabric.findFirst({
        where: {
          id: action.fabricId,
          status: "active",
          OR: [{ scope: "PRESET" }, { ownerId: userId, scope: "USER" }],
        },
        include: { mainFile: true },
      });
      if (
        !fabric ||
        fabric.mainFile.status !== "READY" ||
        !fabric.mainFile.thumbnail1024Key ||
        !fabric.mainFile.mimeType.startsWith("image/")
      )
        throw new BadRequestException("面料不存在、无权访问或图片尚未就绪。");
      const details = canvasObject(fabric.details);
      data.material = {
        materialType: "fabric",
        title: String(details.name ?? fabric.tags[0] ?? "面料").slice(0, 160),
        payload: {
          fabricId: fabric.id,
          fileAssetId: fabric.mainFileId,
          imageUrl: `/api/files/${encodeURIComponent(fabric.mainFileId)}/thumbnail/1024`,
          text: String(details.name ?? ""),
          tags: fabric.tags,
        },
      };
      data.fabricUpdatedAt = fabric.updatedAt.toISOString();
    }
    if (
      action.type === "group_objects" &&
      new Set(targets.map((item) => item?.parentId)).size !== 1
    )
      throw new BadRequestException("请先选择同一层级的对象再组合。");
    if (
      action.type === "ungroup_objects" &&
      targets.some((item) => item?.type !== "group")
    )
      throw new BadRequestException("取消组合只适用于组合对象。");
    if (
      action.type === "connect_inputs" ||
      action.type === "disconnect_inputs"
    ) {
      const target = await this.database.canvasCreation.findFirst({
        where: { id: action.targetCreationId, projectId, removedAt: null },
      });
      if (
        !target ||
        ["video", "analysis", "evaluation"].includes(target.module)
      )
        throw new BadRequestException("该创作目标不存在或不支持输入连接。");
      if (
        !current.objects.some(
          (item) =>
            item.creationId === target.id && !item.locked && !item.hidden,
        )
      )
        throw new ConflictException("目标未在当前画布中就绪，或已锁定／隐藏。");
      const draft = canvasCreationDraftSchema.parse(target.draft);
      data.targetTitle = target.title;
      envelope.targetDraft = draft;
      envelope.targetRevision = target.revision;
      if (action.type === "connect_inputs") {
        const sourceCreations = await this.database.canvasCreation.findMany({
          where: {
            projectId,
            id: {
              in: targets.flatMap((item) =>
                item?.creationId ? [item.creationId] : [],
              ),
            },
            removedAt: null,
          },
          select: { id: true, module: true },
        });
        const additions = targets.map((item, index): CreationInputBinding => {
          if (!item?.creationId && !item?.nodeId)
            throw new BadRequestException("素材尚未保存，不能连接。");
          if (
            item.type === "fashion-media" ||
            (item.creationId &&
              sourceCreations.find((source) => source.id === item.creationId)
                ?.module === "video")
          )
            throw new BadRequestException("当前模型不支持视频输入。");
          if (
            item.creationId &&
            !sourceCreations.some((source) => source.id === item.creationId)
          )
            throw new BadRequestException("来源创作目标不存在。");
          return {
            id: directMutationId(`${envelope.id}:input:${index}`),
            ...(item.creationId ? { creationId: item.creationId } : {}),
            ...(item.nodeId ? { nodeId: item.nodeId } : {}),
          };
        });
        const keys = new Set(
          draft.inputs.map((item) => item.creationId ?? item.nodeId),
        );
        data.inputs = [
          ...draft.inputs,
          ...additions.filter((item) => {
            const key = item.creationId ?? item.nodeId;
            if (keys.has(key)) return false;
            keys.add(key);
            return true;
          }),
        ];
        if (data.inputs.length > 16)
          throw new BadRequestException("合并后超过16项引用，原连接保留。");
      } else {
        if (
          action.inputIds.some(
            (id) => !draft.inputs.some((input) => input.id === id),
          )
        )
          throw new BadRequestException("连接已变化，请重新读取目标输入。");
        data.inputs = draft.inputs.filter(
          (input) => !action.inputIds.includes(input.id),
        );
      }
    }
    return { envelope, data };
  }

  private async owned(
    userId: string,
    conversationId: string,
    messageId: string,
    readOnly = false,
  ) {
    const message = await this.database.agentMessage.findFirst({
      where: {
        id: messageId,
        conversationId,
        role: "ASSISTANT",
        conversation: {
          createdById: userId,
          archivedAt: null,
          project: { deletedAt: null },
        },
      },
    });
    if (!message)
      throw new NotFoundException("画布操作不存在或不属于当前会话。");
    const context = canvasObject(message.context);
    const parsed = assistantCanvasEnvelopeSchema.safeParse(
      context.canvasAction,
    );
    if (
      !parsed.success ||
      parsed.data.messageId !== messageId ||
      parsed.data.conversationId !== conversationId
    )
      throw new BadRequestException("画布操作回执无效。");
    await this.access.require(
      userId,
      parsed.data.projectId,
      readOnly || parsed.data.action.type === "open_panel" ? "read" : "edit",
    );
    return {
      message,
      context,
      envelope: parsed.data,
      data: canvasObject(context.canvasActionData) as ActionData,
    };
  }

  async claim(
    userId: string,
    conversationId: string,
    messageId: string,
    clientId: string,
  ): Promise<Message> {
    return this.database.$transaction(async (tx) => {
      await tx.agentConversation.updateMany({
        where: { id: conversationId, createdById: userId },
        data: { updatedAt: new Date() },
      });
      const value = await this.owned(userId, conversationId, messageId);
      if (value.envelope.clientId !== clientId)
        throw new ConflictException("请在发起操作的浏览器画布中继续。");
      const conversation = await tx.agentConversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      if (["succeeded", "failed"].includes(value.envelope.state))
        return value.message;
      if (
        value.envelope.state === "applying" &&
        (await tx.canvasMutation.findUnique({
          where: {
            projectId_mutationId: {
              projectId: value.envelope.projectId,
              mutationId: value.envelope.id,
            },
          },
        }))
      )
        return {
          ...value.message,
          context: canvasJson({
            ...value.context,
            canvasAction: { ...value.envelope, serverApplied: true },
          }) as Prisma.JsonObject,
        };
      if (conversation.intentEpoch !== value.envelope.intentEpoch)
        throw new ConflictException(
          "已有新的用户请求，旧操作不再执行，请重新发起。",
        );
      return tx.agentMessage.update({
        where: { id: messageId },
        data: {
          context: canvasJson({
            ...value.context,
            canvasAction: { ...value.envelope, state: "applying" },
          }),
        },
      });
    });
  }

  async applyServer(
    userId: string,
    conversationId: string,
    messageId: string,
    clientId: string,
  ): Promise<AssistantCanvasServerResult> {
    const value = await this.owned(userId, conversationId, messageId);
    const { envelope, data } = value;
    if (envelope.clientId !== clientId || envelope.state !== "applying")
      throw new ConflictException("操作尚未领取或已结束。");
    const prior = await this.database.canvasMutation.findUnique({
      where: {
        projectId_mutationId: {
          projectId: envelope.projectId,
          mutationId: envelope.id,
        },
      },
    });
    if (prior) {
      if (data.material)
        return {
          nodeId: String(canvasObject(prior.result).nodeId ?? ""),
          canvas: await this.canvas.read(userId, envelope.projectId),
          graph: await this.databaseGraph(userId, envelope.projectId),
        };
      if ("targetCreationId" in envelope.action)
        return {
          creation: await this.creations.read(
            userId,
            envelope.projectId,
            envelope.action.targetCreationId,
          ),
        };
    }
    const conversation =
      await this.database.agentConversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
    if (conversation.intentEpoch !== envelope.intentEpoch)
      throw new ConflictException("新请求已替代此操作。");
    await this.checkTargets(envelope);
    if (data.material) {
      if (envelope.action.type === "add_fabric") {
        const fabric = await this.database.fabric.findFirst({
          where: {
            id: envelope.action.fabricId,
            status: "active",
            OR: [{ scope: "PRESET" }, { ownerId: userId, scope: "USER" }],
          },
        });
        if (fabric?.updatedAt.toISOString() !== data.fabricUpdatedAt)
          throw new ConflictException("面料资料已变化，请重新选择。");
      }
      const position =
        "position" in envelope.action ? envelope.action.position : undefined;
      return this.commands.execute(
        userId,
        envelope.projectId,
        data.material.nodeId
          ? {
              type: "update_material",
              mutationId: envelope.id,
              nodeId: data.material.nodeId,
              shapeId:
                envelope.action.type === "update_swatch"
                  ? envelope.action.shapeId
                  : "",
              title: data.material.title,
              payload: data.material.payload,
              baseGraphRevision: data.materialGraphRevision,
            }
          : {
              type: "create_material",
              mutationId: envelope.id,
              clientMaterialId: directMutationId(`material:${envelope.id}`),
              materialType: data.material.materialType,
              title: data.material.title,
              payload: data.material.payload,
              shapeId: `shape:assistant-${envelope.id}`,
              position: position ?? {
                x:
                  envelope.observation.viewport.x +
                  envelope.observation.viewport.w / 2 -
                  160,
                y:
                  envelope.observation.viewport.y +
                  envelope.observation.viewport.h / 2 -
                  100,
              },
            },
        undefined,
        (tx) => this.guardCommit(tx, userId, envelope, data),
      );
    }
    if ("targetCreationId" in envelope.action && data.inputs) {
      const target = await this.creations.read(
        userId,
        envelope.projectId,
        envelope.action.targetCreationId,
      );
      const draft = {
        ...target.draft,
        inputs: data.inputs,
        basedOnInputId: data.inputs.some(
          (input) => input.id === target.draft.basedOnInputId,
        )
          ? target.draft.basedOnInputId
          : null,
      };
      return {
        creation: await this.creations.update(
          userId,
          envelope.projectId,
          target.id,
          {
            mutationId: envelope.id,
            expectedRevision: envelope.targetRevision ?? -1,
            draft,
          },
          (tx) => this.guardCommit(tx, userId, envelope, data),
        ),
      };
    }
    throw new BadRequestException("该操作需要当前画布客户端执行。");
  }

  private databaseGraph(
    userId: string,
    projectId: string,
  ): ReturnType<WorkflowsService["get"]> {
    return this.workflows.get(userId, projectId);
  }
  private async guardCommit(
    tx: Prisma.TransactionClient,
    userId: string,
    envelope: AssistantCanvasEnvelope,
    data: ActionData,
  ) {
    const claimed = await tx.agentConversation.updateMany({
      where: {
        id: envelope.conversationId,
        projectId: envelope.projectId,
        createdById: userId,
        intentEpoch: envelope.intentEpoch,
        archivedAt: null,
      },
      data: { updatedAt: new Date() },
    });
    if (claimed.count !== 1)
      throw new ConflictException("新请求已替代此操作。");
    await tx.agentMessage.updateMany({
      where: {
        id: envelope.messageId,
        conversationId: envelope.conversationId,
      },
      data: { updatedAt: new Date() },
    });
    const message = await tx.agentMessage.findUniqueOrThrow({
      where: { id: envelope.messageId },
    });
    if (
      canvasObject(canvasObject(message.context).canvasAction).state !==
      "applying"
    )
      throw new ConflictException("操作已结束，未重复应用。");
    await this.checkTargets(envelope, tx);
    if (data.material?.nodeId) {
      const node = await tx.workflowNode.findFirst({
        where: { projectId: envelope.projectId, id: data.material.nodeId },
      });
      if (node?.updatedAt.toISOString() !== data.materialUpdatedAt)
        throw new ConflictException("色卡内容已更新，请重新读取后修改。");
    }
    if (envelope.action.type === "add_fabric") {
      const fabric = await tx.fabric.findFirst({
        where: {
          id: envelope.action.fabricId,
          status: "active",
          OR: [{ scope: "PRESET" }, { ownerId: userId, scope: "USER" }],
        },
        include: { mainFile: true },
      });
      if (
        !fabric ||
        fabric.updatedAt.toISOString() !== data.fabricUpdatedAt ||
        fabric.mainFile.status !== "READY" ||
        !fabric.mainFile.thumbnail1024Key
      )
        throw new ConflictException("面料资料或图片已变化，请重新选择。");
    }
  }
  private async checkTargets(
    envelope: AssistantCanvasEnvelope,
    database: Prisma.TransactionClient = this.database,
  ) {
    const document = await database.canvasDocument.findUnique({
      where: { projectId: envelope.projectId },
    });
    const records = canvasShapeRecords(document?.snapshot);
    if ("targetCreationId" in envelope.action) {
      const targetIds = envelope.observation.objects
        .filter(
          (item) =>
            item.creationId ===
            ("targetCreationId" in envelope.action
              ? envelope.action.targetCreationId
              : ""),
        )
        .map((item) => item.id);
      if (
        !targetIds.some(
          (id) => records[id] && !canvasRecordProtected(records, id),
        )
      )
        throw new ConflictException("目标已离开画布或被锁定／隐藏。");
    }
    if (
      actionShapeIds(envelope.action).some(
        (id) =>
          !records[id] ||
          canvasRecordProtected(records, id) ||
          assistantShapeStamp(records[id]) !==
            envelope.observation.objects.find((item) => item.id === id)?.stamp,
      )
    )
      throw new ConflictException("目标内容或位置已变化，未应用旧操作。");
  }

  async finish(
    userId: string,
    conversationId: string,
    messageId: string,
    clientId: string,
    status: "succeeded" | "failed",
    proof: AssistantCanvasProof,
    error?: string,
  ): Promise<Message> {
    return this.database.$transaction(
      async (tx) => {
        await tx.agentMessage.updateMany({
          where: { id: messageId, conversationId },
          data: { updatedAt: new Date() },
        });
        const value = await this.owned(userId, conversationId, messageId, true);
        const { envelope, data } = value;
        if (envelope.clientId !== clientId)
          throw new ConflictException("操作属于另一画布客户端。");
        if (["succeeded", "failed"].includes(envelope.state))
          return value.message;
        if (envelope.state !== "applying")
          throw new ConflictException("操作尚未开始。");
        let result: AssistantCanvasResult | undefined;
        if (status === "succeeded") {
          const document = await this.canvas.read(userId, envelope.projectId);
          const records = canvasShapeRecords(document.snapshot);
          result = { version: 1, actionId: envelope.id, targets: canvasResultTargets(envelope, records) };
          if (
            proof.shapes.some(
              (item) =>
                !records[item.id] ||
                assistantShapeStamp(records[item.id]) !== item.stamp,
            ) ||
            proof.removedShapeIds.some((id) => records[id])
          )
            throw new ConflictException(
              "画布保存结果尚未核实，请继续确认回执。",
            );
          if (envelope.action.type === "open_panel") {
            if (proof.panel !== envelope.action.panel)
              throw new BadRequestException("界面尚未确认打开。");
          } else if (data.material) {
            const receipt = await this.database.canvasMutation.findUnique({
              where: {
                projectId_mutationId: {
                  projectId: envelope.projectId,
                  mutationId: envelope.id,
                },
              },
            });
            const nodeId = canvasObject(receipt?.result).nodeId;
            if (
              typeof nodeId !== "string" ||
              !document.bindings.some(
                (binding) =>
                  binding.nodeId === nodeId &&
                  !binding.removed &&
                  proof.shapes.some((shape) => shape.id === binding.shapeId),
              )
            )
              throw new ConflictException("素材尚未显示并保存到画布。");
            const node = await tx.workflowNode.findFirst({ where: { id: nodeId, projectId: envelope.projectId }, select: { title: true } });
            result.targets = [{ id: nodeId, title: node?.title ?? data.material.title, kind: data.material.materialType }];
          } else if ("targetCreationId" in envelope.action) {
            const receipt = await this.database.canvasMutation.findUnique({
              where: {
                projectId_mutationId: {
                  projectId: envelope.projectId,
                  mutationId: envelope.id,
                },
              },
            });
            const target = await this.creations.read(
              userId,
              envelope.projectId,
              envelope.action.targetCreationId,
            );
            if (
              !receipt ||
              JSON.stringify(target.draft.inputs) !==
                JSON.stringify(data.inputs)
            )
              throw new ConflictException("输入连接尚未核实保存。");
            result.destination = { id: target.id, title: target.title, kind: "creation" };
            result.generation = target.runs.length === 0 && !target.currentResultNodeId ? "not_started" : "not_triggered";
          } else if (
            actionShapeIds(envelope.action).some(
              (id) =>
                !proof.shapes.some((shape) => shape.id === id) &&
                !proof.removedShapeIds.includes(id),
            )
          )
            throw new BadRequestException("缺少目标对象的已保存排版结果。");
        }
        const next = {
          ...envelope,
          state: status,
          ...(error ? { error: error.slice(0, 1000) } : {}),
        };
        const label = ASSISTANT_CANVAS_ACTION_LABELS[envelope.action.type];
        const action = envelope.action;
        const scope =
          action.type === "open_panel"
            ? `打开${ASSISTANT_CANVAS_PANEL_LABELS[action.panel]}`
            : action.type === "create_swatch" || action.type === "update_swatch"
              ? `${label}「${data.material?.title ?? "色卡"}」（${action.colors.length}色）`
              : action.type === "add_fabric"
                ? `添加面料「${data.material?.title ?? "面料"}」`
                : "targetCreationId" in action
                  ? `${label}，目标「${data.targetTitle ?? "创作节点"}」现有${data.inputs?.length ?? 0}项输入`
                  : "shapeIds" in action
                    ? `${label}（${action.shapeIds.length}个${action.type === "ungroup_objects" ? "组合" : "对象"}）`
                    : label;
        return tx.agentMessage.update({
          where: { id: messageId },
          data: {
            content:
              status === "succeeded"
                ? `已完成：${scope}。`
                : `未完成：${label}。${error?.slice(0, 800) ?? "请核对后重新发起。"}`,
            context: canvasJson({
              ...value.context,
              canvasAction: next,
              canvasActionProof: proof,
              ...(result ? { canvasActionResult: result } : {}),
            }),
            status: "COMPLETED",
          },
        });
      },
      { timeout: 15000 },
    );
  }
}
