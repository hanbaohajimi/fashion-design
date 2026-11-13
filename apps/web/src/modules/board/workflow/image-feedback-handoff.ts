import type { ImageAnnotation, ImageComment } from "@fashion/shared";

export const MAX_IMAGE_FEEDBACK_HANDOFF_LENGTH = 3_200;

export interface ImageFeedbackHandoffInput {
  readonly title: string;
  readonly revision: number;
  readonly comments: readonly ImageComment[];
  readonly annotations: readonly ImageAnnotation[];
}

export interface ImageFeedbackHandoff {
  readonly prompt: string;
  readonly commentIds: readonly string[];
}

/**
 * Turns saved, anchored image feedback into a review-first assistant draft.
 * The user's comment text is kept verbatim; only the surrounding instructions
 * make the desired confirmation boundary explicit.
 */
export function createImageFeedbackHandoff(
  input: ImageFeedbackHandoffInput,
): ImageFeedbackHandoff {
  if (!input.comments.length) throw new Error("请先选择至少一条图片意见");

  const annotationNumbers = new Map(
    input.annotations.map((annotation, index) => [annotation.id, index + 1]),
  );
  const lines = input.comments.map((comment, index) => {
    const location = comment.point
      ? `位置：原图横向 ${Math.round(comment.point.x * 100)}%，纵向 ${Math.round(comment.point.y * 100)}%`
      : "范围：整张图片";
    const annotations = comment.annotationIds
      .map((id) => annotationNumbers.get(id))
      .filter((number): number is number => number !== undefined)
      .map((number) => `画面标注 ${number}`)
      .join("、");
    return `意见 ${index + 1}（${location}${annotations ? `；关联 ${annotations}` : ""}）：${comment.text}`;
  });
  const prompt = [
    "请把下面这组已保存的图片审阅意见整理成一份可执行的修订计划。",
    `目标图片：「${input.title}」；图片意见版本 r${input.revision}。`,
    "请逐条检查图片中的对应位置，先区分“必须修改”“保持不变”“需要人工确认”，再给出修订顺序、验证标准和可能风险。",
    "在我确认修订计划前不要生成图片、提交任务或修改画布。",
    "图片意见：",
    ...lines,
  ].join("\n");
  if (prompt.length > MAX_IMAGE_FEEDBACK_HANDOFF_LENGTH)
    throw new Error("选中的意见文字较长，请减少选中条目后再交给设计助手整理。");
  return { prompt, commentIds: input.comments.map((comment) => comment.id) };
}
