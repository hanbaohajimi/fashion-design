import type { PrismaClient } from "@fashion/db";
import {
  assistantShapeStamp,
  ASSISTANT_CANVAS_PANEL_LABELS,
  canvasCreationDraftSchema,
  type AssistantCanvasAction,
  type AssistantCanvasObservation,
} from "@fashion/shared";
import { safeContextText } from "../design-context/design-context.projector";

export const canvasRecordObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function canvasShapeRecords(
  snapshot: unknown,
): Record<string, Record<string, unknown>> {
  const root = canvasRecordObject(snapshot);
  return Object.fromEntries(
    Object.entries(
      canvasRecordObject(canvasRecordObject(root.document).store ?? root.store),
    )
      .filter(([, value]) => canvasRecordObject(value).typeName === "shape")
      .map(([key, value]) => [key, canvasRecordObject(value)]),
  );
}
export function actionShapeIds(action: AssistantCanvasAction): string[] {
  return "shapeIds" in action
    ? action.shapeIds
    : "sourceShapeIds" in action
      ? action.sourceShapeIds
      : "shapeId" in action
        ? [action.shapeId]
        : [];
}
export function canvasRecordProtected(
  records: Record<string, Record<string, unknown>>,
  id: string,
) {
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current && records[current] && !seen.has(current)) {
    seen.add(current);
    const record: Record<string, unknown> | undefined = records[current];
    if (record?.isLocked || canvasRecordObject(record?.meta).canvasHidden)
      return true;
    current =
      typeof record?.parentId === "string" ? record.parentId : undefined;
  }
  return false;
}
export async function readAssistantCanvasContext(
  database: PrismaClient,
  userId: string,
  projectId: string,
  observation: AssistantCanvasObservation | undefined,
) {
  if (!observation) return null;
  const document = await database.canvasDocument.findUnique({
    where: { projectId },
  });
  if (!document) return null;
  const records = canvasShapeRecords(document.snapshot);
  const bindings = await database.canvasObjectBinding.findMany({
    where: { projectId, removedAt: null },
    select: { shapeId: true, nodeId: true },
  });
  const objects = observation.objects
    .filter(
      (item) =>
        records[item.id] &&
        assistantShapeStamp(records[item.id]) === item.stamp,
    )
    .map((item) => ({
      ...item,
      locked: canvasRecordProtected(records, item.id),
      hidden: canvasRecordObject(records[item.id]?.meta).canvasHidden === true,
      nodeId:
        bindings.find((binding) => binding.shapeId === item.id)?.nodeId ??
        (typeof canvasRecordObject(records[item.id]?.meta).canvasNodeId ===
        "string"
          ? String(canvasRecordObject(records[item.id]?.meta).canvasNodeId) ||
            null
          : null),
      creationId:
        typeof canvasRecordObject(records[item.id]?.props).creationId ===
        "string"
          ? String(canvasRecordObject(records[item.id]?.props).creationId) ||
            null
          : null,
    }));
  const fabrics = await database.fabric.findMany({
    where: {
      status: "active",
      OR: [{ scope: "PRESET" }, { ownerId: userId, scope: "USER" }],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 51,
    select: { id: true, details: true, tags: true },
  });
  const creationIds = objects.flatMap((item) =>
    item.creationId ? [item.creationId] : [],
  );
  const creations = creationIds.length
    ? await database.canvasCreation.findMany({
        where: { projectId, id: { in: creationIds }, removedAt: null },
        select: {
          id: true,
          title: true,
          module: true,
          revision: true,
          draft: true,
          currentResultNodeId: true,
        },
      })
    : [];
  return {
    ...observation,
    revision: document.revision,
    objects,
    selectedIds: observation.selectedIds.filter((id) =>
      objects.some((item) => item.id === id),
    ),
    omitted: observation.omitted + observation.objects.length - objects.length,
    creations: creations.map((item) => {
      const draft = canvasCreationDraftSchema.parse(item.draft);
      return {
        id: item.id,
        title: safeContextText(item.title, 160),
        module: item.module,
        revision: item.revision,
        prompt: safeContextText(draft.prompt, 2000),
        inputs: draft.inputs,
        currentResultNodeId: item.currentResultNodeId,
      };
    }),
    availableFabrics: fabrics.slice(0, 50).map((item) => ({
      id: item.id,
      name: safeContextText(canvasRecordObject(item.details).name, 160),
      tags: item.tags,
    })),
    fabricsHasMore: fabrics.length > 50,
  };
}
export function allowsAssistantCanvasAction(
  request: string,
  quote: string | undefined,
  action?: AssistantCanvasAction,
) {
  if (quote?.trim() !== request.trim()) return false;
  if (
    /假如|如果|假设|如何|怎么|是否|能否(?!帮我|为我|替我)|举例|解释|讨论|(?:不要|别|暂不|先不|不必|不用|无需|不需要|取消(?!组合|分组|连接))[^，。！？；,!?;]{0,10}(?:创建|新建|添加|做|制作|更新|修改|替换|移动|挪|对齐|排列|分布|组合|分组|解组|调整|缩小|放大|缩放|置顶|置底|打开|调出|展开|唤起|看看|看一下|浏览|连接|断开|移除)|\b(?:don't|do not|not yet|if|suppose|whether|how|(?:could|would)(?!\s+you\b)|explain)\b/iu.test(
      request,
    )
  )
    return false;
  if (!action)
    return /创建|新建|添加|更新|修改|移|挪|对齐|排列|分布|组合|分组|解组|调整|缩小|放大|置顶|置底|打开|连接|断开/iu.test(
      request,
    );
  // Natural requests still require an imperative/desire and the relevant tool noun.
  // This is a language boundary, not a requirement to repeat the internal action label.
  if (
    action.type === "create_swatch" &&
    /(?:^|[，。；\n])\s*(?:(?:(?:请|麻烦)(?:你)?(?:帮我)?|帮我|为我|给我|替我)?(?:做|制作|建|来)|我想要|我需要|请给我)[^，。！？；\n]{0,32}(?:色卡|调色板)/u.test(
      request,
    )
  )
    return true;
  if (
    action.type === "open_panel" &&
    /(?:^|[，。；\n])\s*(?:我想|请|让我|帮我)?(?:看看|看一下|浏览)/u.test(
      request,
    ) &&
    request.includes(ASSISTANT_CANVAS_PANEL_LABELS[action.panel])
  )
    return true;
  const verbs: Record<AssistantCanvasAction["type"], RegExp> = {
    create_swatch: /创建|新建|添加|放入|放置|放一|加一|\b(?:create|add)\b/iu,
    update_swatch:
      /修改|更新|替换|改成|改为|调整|\b(?:update|change|replace)\b/iu,
    add_fabric: /添加|放入|加入|放到|放置|\b(?:add|place)\b/iu,
    move_objects:
      /移动|移到|移至|移开|移出|[上下左右]移|挪|放到|放在|摆|排列|排开|排成|\b(?:move|place|arrange)\b/iu,
    resize_objects:
      /大小|尺寸|宽|高|缩小|放大|缩放|\b(?:resize|scale|width|height)\b/iu,
    align_objects: /对齐|齐平|\balign\b/iu,
    distribute_objects: /均匀|等距|分布|排列|\bdistribute\b/iu,
    group_objects: /组合|分组|成组|\bgroup\b/iu,
    ungroup_objects: /取消组合|取消分组|解组|拆开|拆分|\bungroup\b/iu,
    reorder_objects:
      /置顶|置底|层级|上移|下移|\b(?:front|back|forward|backward)\b/iu,
    open_panel: /打开|进入|显示|查看|切换|调出|展开|唤起|\bopen\b/iu,
    connect_inputs:
      /连接|连到|接到|作为.{0,12}输入|加入.{0,8}参考|\bconnect\b/iu,
    disconnect_inputs:
      /断开|取消连接|移除.{0,8}(?:引用|连接)|删除.{0,8}连接|\bdisconnect\b/iu,
  };
  if (
    (action.type === "group_objects" &&
      /取消组合|取消分组|解组|\bungroup\b/iu.test(request)) ||
    (action.type === "connect_inputs" &&
      /断开|取消连接|移除连接|\bdisconnect\b/iu.test(request))
  )
    return false;
  return verbs[action.type].test(request);
}
