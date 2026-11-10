import { BadRequestException } from "@nestjs/common";
import type { ImageCommentMarker, ImageFeedback } from "@fashion/shared";

/** Freeze the selected comments and their visible numbers in the execution snapshot. */
export function buildImageFeedbackRequest(feedback: ImageFeedback, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length)
    throw new BadRequestException("请选择修改意见");
  const requested = new Set(ids);
  const selected = feedback.comments.flatMap((comment, index) =>
    requested.has(comment.id) ? [{ comment, number: index + 1 }] : []);
  if (selected.length !== requested.size)
    throw new BadRequestException("选中的修改意见已变化，请重新选择后提交");
  const linked = new Set(selected.flatMap(({ comment }) => comment.annotationIds));
  const markers: ImageCommentMarker[] = selected.flatMap(({ comment, number }) =>
    comment.point ? [{ number, point: comment.point }] : []);
  return {
    annotations: feedback.annotations.filter(annotation => linked.has(annotation.id)),
    markers,
    instructions: "\n修改意见（编号与附图一致，坐标为原图宽高的比例）：\n" + selected.map(({ comment, number }) =>
      `意见 ${number}${comment.point ? `，标记 ${number} (${comment.point.x.toFixed(3)},${comment.point.y.toFixed(3)})` : "，整张图片"}：${comment.text}`).join("\n") +
      "\n附图中的编号和彩色标注仅用于指示修改位置，不要将它们绘制在最终图片里。第一张图片是未加标记的原图。",
  };
}
