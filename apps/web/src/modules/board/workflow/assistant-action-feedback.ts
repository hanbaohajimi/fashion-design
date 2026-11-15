import {
  ASSISTANT_CANVAS_PANEL_LABELS,
  assistantCanvasResultSchema,
  type AssistantCanvasEnvelope,
  type AssistantCanvasResult,
  type CreationActivity,
} from "@fashion/shared";

export type AssistantFeedbackState =
  | "pending"
  | "succeeded"
  | "failed"
  | "partial_failed"
  | "canceled"
  | "unconfirmed";
export interface AssistantFeedbackModel {
  state: AssistantFeedbackState;
  title: string;
  names: string[];
  method?: string;
  destination?: string;
  note?: string;
  error?: string;
  block: boolean;
  waiting?: boolean;
  compact?: boolean;
}
const alignmentLabels = {
  left: "左边缘对齐",
  right: "右边缘对齐",
  top: "上边缘对齐",
  bottom: "下边缘对齐",
  "center-horizontal": "水平居中对齐",
  "center-vertical": "垂直居中对齐",
} as const;

/** Use recorded identities, never a later graph title or the model's success prose. */
function observedTargets(
  envelope: AssistantCanvasEnvelope,
): AssistantCanvasResult["targets"] {
  const action = envelope.action;
  const ids =
    "shapeIds" in action
      ? action.shapeIds
      : "sourceShapeIds" in action
        ? action.sourceShapeIds
        : "shapeId" in action
          ? [action.shapeId]
          : [];
  return [...new Set(ids)].flatMap((id) => {
    const item = envelope.observation.objects.find(
      (object) => object.id === id,
    );
    if (!item) return [];
    const kind =
      item.type === "fashion-image" || item.type === "image"
        ? ("image" as const)
        : item.type === "fashion-creation"
          ? ("creation" as const)
          : item.type === "group"
            ? ("group" as const)
            : ("object" as const);
    return [{ id, title: item.title === item.type ? "" : item.title, kind }];
  });
}

export function canvasActionFeedback(
  envelope: AssistantCanvasEnvelope,
  rawResult: unknown,
  options: { error?: string; awaitingConfirmation?: boolean } = {},
): AssistantFeedbackModel {
  const parsed = assistantCanvasResultSchema.safeParse(rawResult);
  const expectedIds =
    "shapeIds" in envelope.action
      ? envelope.action.shapeIds
      : "sourceShapeIds" in envelope.action
        ? envelope.action.sourceShapeIds
        : [];
  const candidate =
    envelope.state === "succeeded" &&
    parsed.success &&
    parsed.data.actionId === envelope.id
      ? parsed.data
      : null;
  const matchesTargets =
    !expectedIds.length ||
    (candidate?.targets.length === expectedIds.length &&
      candidate.targets.every((target) => expectedIds.includes(target.id)));
  const matchesDestination =
    !("targetCreationId" in envelope.action) ||
    candidate?.destination?.id === envelope.action.targetCreationId;
  const result = matchesTargets && matchesDestination ? candidate : null;
  const targets = result?.targets ?? observedTargets(envelope);
  const names = targets.map((target) => target.title.trim()).filter(Boolean);
  const action = envelope.action;
  const ids = "shapeIds" in action ? [...new Set(action.shapeIds)] : [];
  const count = ids.length;
  const images =
    count > 0 &&
    targets.length === count &&
    targets.every((target) => target.kind === "image");
  const noun = images
    ? names.length === count && names.every((name) => name.startsWith("参考图"))
      ? "张参考图"
      : "张图片"
    : "个对象";
  let operation = "画布操作",
    success = "画布操作已确认",
    pending = "正在处理画布操作",
    failed = "画布操作未完成";
  let method: string | undefined,
    destination: string | undefined,
    note: string | undefined;
  let block = count > 1;
  switch (action.type) {
    case "create_swatch":
    case "update_swatch": {
      const updating = action.type === "update_swatch";
      operation = updating ? "色卡更新" : "色卡创建";
      success = updating ? "色卡已更新" : "色卡已创建";
      pending = updating ? "正在更新色卡" : "正在创建色卡";
      failed = updating ? "色卡更新未完成" : "色卡创建未完成";
      if (!names.length && action.title) names.push(action.title);
      method = `${action.colors.length} 色`;
      block = action.colors.length > 1;
      break;
    }
    case "add_fabric":
      operation = "面料添加";
      success = "面料已加入画布";
      pending = "正在添加面料";
      failed = "面料添加未完成";
      break;
    case "move_objects":
      operation = "移动";
      success = `已移动 ${count} ${noun}`;
      pending = `正在移动 ${count} ${noun}`;
      failed = "移动未完成";
      method = [
        action.offset.x
          ? `${action.offset.x > 0 ? "右移" : "左移"} ${Math.abs(action.offset.x)}`
          : "",
        action.offset.y
          ? `${action.offset.y > 0 ? "下移" : "上移"} ${Math.abs(action.offset.y)}`
          : "",
      ]
        .filter(Boolean)
        .join("，");
      break;
    case "resize_objects":
      operation = "显示大小调整";
      success = `已调整 ${count} ${noun}的显示大小`;
      pending = "正在调整显示大小";
      failed = "显示大小调整未完成";
      method = action.keepAspectRatio ? "等比缩放" : "显示缩放";
      break;
    case "align_objects":
      operation = "对齐";
      success = `已对齐 ${count} ${noun}`;
      pending = `正在对齐 ${count} ${noun}`;
      failed = "对齐未完成";
      method = alignmentLabels[action.alignment];
      break;
    case "distribute_objects":
      operation = "等距排布";
      success = `已等距排布 ${count} ${noun}`;
      pending = "正在调整图片间距";
      failed = "等距排布未完成";
      method = action.axis === "horizontal" ? "水平等距分布" : "垂直等距分布";
      break;
    case "group_objects":
      operation = "组合";
      success = `已组合 ${count} ${noun}`;
      pending = "正在组合对象";
      failed = "组合未完成";
      break;
    case "ungroup_objects":
      operation = "取消组合";
      success = `已取消 ${count} 个组合`;
      pending = "正在取消组合";
      failed = "取消组合未完成";
      break;
    case "reorder_objects":
      operation = "层级调整";
      success = "对象层级已调整";
      pending = "正在调整对象层级";
      failed = "层级调整未完成";
      method = {
        front: "置于顶层",
        back: "置于底层",
        forward: "上移一层",
        backward: "下移一层",
      }[action.order];
      break;
    case "open_panel": {
      const name = ASSISTANT_CANVAS_PANEL_LABELS[action.panel];
      operation = name;
      success = `${name}已打开`;
      pending = `正在打开${name}`;
      failed = `${name}未能打开`;
      block = false;
      names.length = 0;
      break;
    }
    case "connect_inputs":
    case "disconnect_inputs": {
      const connecting = action.type === "connect_inputs";
      operation = "参考连接";
      success = connecting ? "参考连接已建立" : "参考连接已移除";
      pending = connecting ? "正在建立参考连接" : "正在移除参考连接";
      failed = "参考连接未能更新";
      destination =
        result?.destination?.title ??
        envelope.observation.objects.find(
          (object) => object.creationId === action.targetCreationId,
        )?.title;
      if (connecting && !names.length) names.push("来源名称未记录");
      if (!connecting) method = `移除 ${new Set(action.inputIds).size} 项引用`;
      // Generation is a verified receipt fact, not inferred from an empty source or a user instruction.
      if (result?.generation)
        note =
          result.generation === "not_started"
            ? "尚未开始生成"
            : "本次未触发生成";
      block = true;
      break;
    }
  }
  const terminal =
    envelope.state === "succeeded" || envelope.state === "failed";
  const unconfirmed =
    !terminal && Boolean(options.error || options.awaitingConfirmation);
  const state: AssistantFeedbackState =
    envelope.state === "succeeded"
      ? "succeeded"
      : envelope.state === "failed"
        ? "failed"
        : unconfirmed
          ? "unconfirmed"
          : "pending";
  return {
    state,
    title:
      state === "succeeded"
        ? success
        : state === "failed"
          ? failed
          : state === "unconfirmed"
            ? `${operation}结果待确认`
            : pending,
    names,
    ...(method ? { method } : {}),
    ...(destination ? { destination } : {}),
    ...(state === "succeeded" && note ? { note } : {}),
    ...(state === "failed"
      ? { error: envelope.error ?? "这次操作未完成，请核对后重新发起。" }
      : state === "unconfirmed" && options.error
        ? { error: options.error }
        : {}),
    block,
    ...(state === "succeeded" && ["move_objects", "resize_objects", "align_objects", "distribute_objects", "group_objects", "ungroup_objects", "reorder_objects"].includes(action.type) ? { compact: true } : {}),
  };
}

export function creationActivityFeedback(
  activity: CreationActivity,
): AssistantFeedbackModel {
  const state: AssistantFeedbackState =
    activity.status === "unconfirmed"
      ? "unconfirmed"
      : activity.status === "partial_failed"
      ? "partial_failed"
      : activity.status === "failed"
        ? "failed"
        : activity.status === "canceled"
          ? "canceled"
          : activity.status &&
              ["preparing", "queued", "running"].includes(activity.status)
            ? "pending"
            : activity.event === "submitted" && activity.status !== "completed"
              ? "pending"
              : "succeeded";
  const resultCount = new Set([
    ...(activity.resultNodeIds ?? []),
    ...(activity.resultNodeId ? [activity.resultNodeId] : []),
  ]).size;
  const title =
    state === "unconfirmed"
      ? "创作结果待确认"
      : state === "partial_failed"
      ? "创作部分完成"
      : state === "failed"
        ? "这次创作未完成"
        : state === "canceled"
          ? "创作已停止"
          : state === "pending"
            ? activity.status === "running"
              ? "正在创作"
              : "创作任务已提交"
            : activity.event === "adopted"
              ? "结果已采用"
              : activity.event === "module_saved"
                ? "创作记录已保存"
                : "创作已完成";
  return {
    state,
    title,
    names: activity.title ? [activity.title] : [],
    ...(resultCount ? { method: `${resultCount} 项成果` } : {}),
    block: state === "partial_failed" || state === "failed" || resultCount > 1,
    ...(state === "pending" && activity.status !== "running"
      ? { waiting: true }
      : {}),
  };
}

export function followsUserRequest(
  message: { role: string; replyToId?: string | null; origin?: string | null },
  previous: { role: string; id?: string } | undefined,
) {
  return (
    message.role === "assistant" &&
    previous?.role === "user" &&
    (message.replyToId
      ? message.replyToId === previous.id
      : ![
          "background_analysis",
          "creative_activity",
          "execution_result",
        ].includes(message.origin ?? ""))
  );
}
