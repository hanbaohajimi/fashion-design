import { imageOutpaintSchema } from "@fashion/shared";
import type { ImageRect, ImageSize } from "./ImageViewer";

export const defaultOutpaintPrompt =
  "自然延伸背景与光线，保持原图服装主体不变。";
export interface OutpaintDraft {
  kind: "resize" | "crop" | "outpaint";
  frame: ImageRect | null;
  prompt: string;
}
export const emptyOutpaintDraft: OutpaintDraft = {
  kind: "resize",
  frame: null,
  prompt: defaultOutpaintPrompt,
};
export const outpaintBaseline = JSON.stringify(emptyOutpaintDraft);
const align = (value: number) => Math.ceil(value / 16) * 16;

/** A usable starting frame; never shrink the original to satisfy a model limit. */
export function initialOutpaintFrame(size: ImageSize): ImageRect {
  if (size.width > 2048 || size.height > 2048)
    return { ...size, left: 0, top: 0 };
  let width = Math.min(2048, align(Math.max(256, size.width * 1.25)));
  let height = Math.min(2048, align(Math.max(256, size.height * 1.25)));
  width = Math.max(width, align(height / 3));
  height = Math.max(height, align(width / 3));
  while (width * height < 655360) {
    if (width <= height) width += 16;
    else height += 16;
  }
  return {
    width,
    height,
    left: Math.floor((width - size.width) / 2),
    top: Math.floor((height - size.height) / 2),
  };
}

export function moveOutpaintFrame(
  frame: ImageRect,
  size: ImageSize,
  left: number,
  top: number,
): ImageRect {
  return {
    ...frame,
    left: Math.round(Math.max(0, Math.min(frame.width - size.width, left))),
    top: Math.round(Math.max(0, Math.min(frame.height - size.height, top))),
  };
}

export function resizeOutpaintFrame(
  frame: ImageRect,
  size: ImageSize,
  width: number,
  height: number,
): ImageRect {
  return {
    ...frame,
    width: Math.max(
      align(frame.left + size.width),
      Math.min(2048, align(Math.max(256, width))),
    ),
    height: Math.max(
      align(frame.top + size.height),
      Math.min(2048, align(Math.max(256, height))),
    ),
  };
}

export function outpaintProblem(
  frame: ImageRect,
  size: ImageSize | null,
): string | null {
  if (!size) return "等待原图加载后再设置扩图。";
  if (size.width > 2048 || size.height > 2048)
    return "原图长边超过 2048 px，请先缩放尺寸再扩图。";
  if (size.width === 2048 && size.height === 2048)
    return "原图已达到扩图尺寸上限，请先缩放尺寸。";
  if (frame.width > 2048 || frame.height > 2048)
    return "画布长边不能超过 2048 px，请减小边距或尺寸。";
  if (
    frame.left + size.width > frame.width ||
    frame.top + size.height > frame.height
  )
    return "画布需要完整容纳原图，请增大尺寸或减小边距。";
  if (frame.width === size.width && frame.height === size.height)
    return "还没有扩展区域，请增大画布宽度或高度。";
  if (frame.width * frame.height < 655360)
    return "扩展后的画布太小，请增大宽度或高度（至少 65.5 万像素）。";
  if (
    Math.max(frame.width, frame.height) / Math.min(frame.width, frame.height) >
    3
  )
    return "画布过长，请增加短边，让长宽比不超过 3:1。";
  if (!imageOutpaintSchema.safeParse(frame).success)
    return "画布边长应为 256–2048 px 内 16 的倍数，边距应为非负整数。";
  return null;
}

/** Drafts may be incomplete; validate storage shape without treating them as jobs. */
export function readOutpaintDraft(value: unknown): OutpaintDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<OutpaintDraft>;
  if (
    !["resize", "crop", "outpaint"].includes(String(draft.kind)) ||
    typeof draft.prompt !== "string" ||
    draft.prompt.length > 1000
  )
    return null;
  if (draft.frame !== null) {
    if (!draft.frame || typeof draft.frame !== "object") return null;
    if (
      ![
        draft.frame.width,
        draft.frame.height,
        draft.frame.left,
        draft.frame.top,
      ].every(
        (n) =>
          typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 32768,
      )
    )
      return null;
  }
  return {
    kind: draft.kind as OutpaintDraft["kind"],
    prompt: draft.prompt,
    frame: draft.frame,
  };
}
