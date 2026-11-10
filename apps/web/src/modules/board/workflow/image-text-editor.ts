import {
  imageTextEditPrompt,
  imageTextEditsSchema,
  imageTextPixelRect,
  imageTextRectSchema,
  type ImageTextEdit,
  type ImageTextRect,
} from "@fashion/shared";
import type { ImageSize } from "./ImageViewer";

export interface ImageTextDraftRegion {
  id: string;
  original: string;
  replacement: string;
  rect: ImageTextRect;
}
export interface ImageTextDraft {
  regions: ImageTextDraftRegion[];
  selected: string | null;
  source: ImageSize | null;
}
export const emptyImageTextDraft: ImageTextDraft = {
  regions: [],
  selected: null,
  source: null,
};
export const imageTextDraftBaseline = JSON.stringify(emptyImageTextDraft);

export function parseImageTextDraft(value: unknown): ImageTextDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as ImageTextDraft;
  if (
    !Array.isArray(draft.regions) ||
    draft.regions.length > 24 ||
    !(draft.selected === null || typeof draft.selected === "string")
  )
    return null;
  if (
    draft.source !== null &&
    (!draft.source ||
      ![draft.source.width, draft.source.height].every(
        (v) => Number.isInteger(v) && v > 0 && v <= 2048,
      ))
  )
    return null;
  if (
    !draft.regions.every(
      (region) =>
        region &&
        typeof region.id === "string" &&
        typeof region.original === "string" &&
        region.original.length <= 300 &&
        typeof region.replacement === "string" &&
        region.replacement.length <= 300 &&
        imageTextRectSchema.safeParse(region.rect).success,
    )
  )
    return null;
  if (
    new Set(draft.regions.map((region) => region.id)).size !==
    draft.regions.length
  )
    return null;
  return draft;
}
export function changedImageText(
  regions: ImageTextDraftRegion[],
): ImageTextEdit[] {
  return regions
    .filter((region) => region.original !== region.replacement)
    .map(({ original, replacement, rect }) => ({
      original,
      replacement,
      rect,
    }));
}
export function imageTextEditProblem(
  draft: ImageTextDraft,
  size: ImageSize | null,
): string | null {
  if (!size) return "等待原图加载。";
  if (size.width > 2048 || size.height > 2048)
    return "原图长边超过 2048 px，请先缩放图片。";
  if (
    draft.source &&
    (draft.source.width !== size.width || draft.source.height !== size.height)
  )
    return "原图尺寸与文字草稿不一致，请清空区域后重新识别。";
  const changes = changedImageText(draft.regions);
  if (!changes.length) return "选择一处文字，输入要替换的新文案。";
  if (changes.length > 8) return "一次最多修改 8 个区域，请分次修改。";
  if (!imageTextEditsSchema.safeParse(changes).success)
    return "请检查原文、新文案和文字区域。";
  try {
    imageTextEditPrompt(changes);
  } catch {
    return "本次文字内容过长，请分次修改。";
  }
  return null;
}
export function moveImageTextRect(
  rect: ImageTextRect,
  x: number,
  y: number,
): ImageTextRect {
  return {
    ...rect,
    x: Math.max(0, Math.min(1 - rect.width, x)),
    y: Math.max(0, Math.min(1 - rect.height, y)),
  };
}
export function resizeImageTextRect(
  rect: ImageTextRect,
  width: number,
  height: number,
  size: ImageSize,
): ImageTextRect {
  return {
    ...rect,
    width: Math.min(1 - rect.x, Math.max(1 / size.width, width)),
    height: Math.min(1 - rect.y, Math.max(1 / size.height, height)),
  };
}
export async function imageTextMask(
  edits: ImageTextEdit[],
  size: ImageSize,
): Promise<Blob> {
  imageTextEditsSchema.parse(edits);
  if (
    ![size.width, size.height].every(
      (value) => Number.isInteger(value) && value > 0 && value <= 2048,
    )
  )
    throw new Error("原图尺寸不支持文字修改");
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法准备文字选区");
  context.fillStyle = "#000";
  context.fillRect(0, 0, size.width, size.height);
  for (const edit of edits) {
    const rect = imageTextPixelRect(edit.rect, size.width, size.height);
    context.clearRect(rect.left, rect.top, rect.width, rect.height);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("文字选区准备失败，请重试")),
      "image/png",
    ),
  );
}
