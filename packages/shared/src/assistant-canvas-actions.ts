import { z } from "zod";
import { swatchColorsSchema } from "./sketch-document";
import { canvasCreationDraftSchema } from "./canvas-creations";

const id = z.string().trim().min(1).max(200);
const point = z
  .object({
    x: z.number().finite().min(-1e7).max(1e7),
    y: z.number().finite().min(-1e7).max(1e7),
  })
  .strict();
const ids = z.array(id).min(1).max(64);
export const ASSISTANT_FUNCTION_IDS = [
  "image",
  "color",
  "material",
  "detail",
  "patterns",
  "presentation",
  "collections",
  "trends",
  "image-inpaint",
  "image-erase",
  "image-remove_background",
  "image-crop",
  "image-outpaint",
  "image-orient",
  "image-adjust",
  "image-text_edit",
  "image-variation",
] as const;
export const assistantCanvasActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("create_swatch"),
      title: z.string().trim().min(1).max(160),
      colors: swatchColorsSchema,
      position: point.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_swatch"),
      shapeId: id,
      title: z.string().trim().min(1).max(160).optional(),
      colors: swatchColorsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("add_fabric"),
      fabricId: id,
      position: point.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("move_objects"), shapeIds: ids, offset: point })
    .strict(),
  z
    .object({
      type: z.literal("resize_objects"),
      shapeIds: ids,
      width: z.number().positive().max(100000),
      height: z.number().positive().max(100000),
      keepAspectRatio: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("align_objects"),
      shapeIds: ids.min(2),
      alignment: z.enum([
        "left",
        "center-horizontal",
        "right",
        "top",
        "center-vertical",
        "bottom",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("distribute_objects"),
      shapeIds: ids.min(3),
      axis: z.enum(["horizontal", "vertical"]),
    })
    .strict(),
  z.object({ type: z.literal("group_objects"), shapeIds: ids.min(2) }).strict(),
  z.object({ type: z.literal("ungroup_objects"), shapeIds: ids }).strict(),
  z
    .object({
      type: z.literal("reorder_objects"),
      shapeIds: ids,
      order: z.enum(["front", "forward", "backward", "back"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("open_panel"),
      panel: z.enum([
        "fabrics",
        "functions",
        "objects",
        ...ASSISTANT_FUNCTION_IDS,
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("connect_inputs"),
      targetCreationId: id,
      sourceShapeIds: ids.max(16),
    })
    .strict(),
  z
    .object({
      type: z.literal("disconnect_inputs"),
      targetCreationId: id,
      inputIds: z.array(id).min(1).max(16),
    })
    .strict(),
]);
export type AssistantCanvasAction = z.infer<typeof assistantCanvasActionSchema>;

export const canvasObjectObservationSchema = z
  .object({
    id,
    type: id,
    title: z.string().max(200),
    nodeId: id.nullable(),
    creationId: id.nullable(),
    stamp: z.string().max(3000),
    locked: z.boolean(),
    hidden: z.boolean(),
    parentId: id,
    bounds: point.extend({
      w: z.number().nonnegative().max(1e7),
      h: z.number().nonnegative().max(1e7),
    }),
  })
  .strict();
export const assistantCanvasObservationSchema = z
  .object({
    clientId: z.uuid(),
    sequence: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    selectedIds: z.array(id).max(64),
    objects: z.array(canvasObjectObservationSchema).max(200),
    omitted: z.number().int().nonnegative(),
    viewport: point.extend({
      w: z.number().positive().max(1e7),
      h: z.number().positive().max(1e7),
    }),
  })
  .strict();
export type AssistantCanvasObservation = z.infer<
  typeof assistantCanvasObservationSchema
>;

/** A stable geometry/identity signature; transient rendering status and camera are excluded. */
export function assistantShapeStamp(value: unknown): string {
  const shape =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const props =
    shape.props && typeof shape.props === "object"
      ? (shape.props as Record<string, unknown>)
      : {};
  const meta =
    shape.meta && typeof shape.meta === "object"
      ? (shape.meta as Record<string, unknown>)
      : {};
  return JSON.stringify([
    shape.id,
    shape.type,
    shape.parentId,
    shape.x,
    shape.y,
    shape.rotation ?? 0,
    shape.index,
    Boolean(shape.isLocked),
    props.w ?? null,
    props.h ?? null,
    props.creationId ?? null,
    props.assetId ?? null,
    meta.canvasNodeId ?? null,
  ]);
}
export const assistantCanvasEnvelopeSchema = z
  .object({
    id: z.uuid(),
    projectId: id,
    conversationId: id,
    messageId: id,
    clientId: z.uuid(),
    intentEpoch: z.number().int(),
    state: z.enum(["pending", "applying", "succeeded", "failed"]),
    action: assistantCanvasActionSchema,
    observation: assistantCanvasObservationSchema,
    targetRevision: z.number().int().nonnegative().optional(),
    targetDraft: canvasCreationDraftSchema.optional(),
    serverApplied: z.boolean().optional(),
    error: z.string().max(1000).optional(),
  })
  .strict();
export type AssistantCanvasEnvelope = z.infer<
  typeof assistantCanvasEnvelopeSchema
>;
export const assistantCanvasProofSchema = z
  .object({
    shapes: z
      .array(z.object({ id, stamp: z.string().max(3000) }).strict())
      .max(200)
      .default([]),
    removedShapeIds: z.array(id).max(200).default([]),
    panel: z.string().max(100).optional(),
  })
  .strict();
export type AssistantCanvasProof = z.infer<typeof assistantCanvasProofSchema>;
const canvasResultTargetSchema = z.object({
  id,
  title: z.string().max(200),
  kind: z.enum(["image", "creation", "swatch", "fabric", "group", "object"]),
}).strict();
/** Display facts written only after the existing action receipt has been verified. */
export const assistantCanvasResultSchema = z.object({
  version: z.literal(1),
  actionId: z.uuid(),
  targets: z.array(canvasResultTargetSchema).max(64),
  destination: canvasResultTargetSchema.optional(),
  generation: z.enum(["not_started", "not_triggered"]).optional(),
}).strict();
export type AssistantCanvasResult = z.infer<typeof assistantCanvasResultSchema>;
export const ASSISTANT_CANVAS_ACTION_LABELS: Record<
  AssistantCanvasAction["type"],
  string
> = {
  create_swatch: "创建色卡",
  update_swatch: "更新色卡",
  add_fabric: "添加面料",
  move_objects: "移动对象",
  resize_objects: "调整显示大小",
  align_objects: "对齐对象",
  distribute_objects: "均匀分布对象",
  group_objects: "组合对象",
  ungroup_objects: "取消组合",
  reorder_objects: "调整层级",
  open_panel: "打开功能面板",
  connect_inputs: "添加输入连接",
  disconnect_inputs: "移除输入连接",
};
export const ASSISTANT_CANVAS_PANEL_LABELS: Record<
  Extract<AssistantCanvasAction, { type: "open_panel" }>["panel"],
  string
> = {
  fabrics: "面料库",
  functions: "全部功能",
  objects: "画布对象",
  image: "图片创作",
  color: "换色实验",
  material: "换面料",
  detail: "改款实验",
  patterns: "印花工作台",
  presentation: "商品展示",
  collections: "系列工作台",
  trends: "时尚趋势",
  "image-inpaint": "局部重绘",
  "image-erase": "擦除",
  "image-remove_background": "移除背景",
  "image-crop": "裁剪图片",
  "image-outpaint": "扩展画面",
  "image-orient": "旋转与翻转",
  "image-adjust": "色彩与明暗",
  "image-text_edit": "修改文字",
  "image-variation": "生成变体",
};
export const ASSISTANT_CANVAS_TOOL_CATALOG = [
  {
    type: "create_swatch",
    description:
      "在画布创建1–12色具名色卡，不生成图片。提供明确hex和名称，位置为画布坐标，可省略。",
  },
  {
    type: "update_swatch",
    description: "更新指定色卡对象的全部颜色与可选名称；必须提供真实shapeId。",
  },
  {
    type: "add_fabric",
    description:
      "添加availableFabrics里用户可访问的已有面料，使用准确fabricId，重名先澄清，不创造面料事实。",
  },
  {
    type: "move_objects",
    description:
      "将指定对象按画布坐标offset移动；坐标来自canvas.objects.bounds与viewport，不能只凭同名猜测。",
  },
  {
    type: "resize_objects",
    description:
      "修改对象在画布上的显示宽高，默认等比；不裁剪原图、不改原文件像素，也不调用生图。",
  },
  {
    type: "align_objects",
    description: "对至少两个对象左/右/顶/底或中心对齐。",
  },
  {
    type: "distribute_objects",
    description: "至少三个对象水平或垂直均匀分布。",
  },
  {
    type: "group_objects",
    description: "将同一父级内至少两个对象组合，保留素材和生成输入。",
  },
  {
    type: "ungroup_objects",
    description: "取消指定group对象的组合，保留子对象。",
  },
  {
    type: "reorder_objects",
    description: "对象置顶、置底、上移一层或下移一层，不改变真实图片内容。",
  },
  {
    type: "open_panel",
    description:
      "打开面料库、全部功能、画布对象或给定功能ID对应界面；只打开，不运行生成。",
  },
  {
    type: "connect_inputs",
    description:
      "把sourceShapeIds对应的真实素材或创作目标追加为targetCreationId的输入；可连接尚无结果的目标，不执行生成，禁止自连/循环。",
  },
  {
    type: "disconnect_inputs",
    description:
      "按目标已有draft.inputs中的inputIds移除连接，保留其他引用与要求，不生成。",
  },
] as const;
