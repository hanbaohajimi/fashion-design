import type { Editor, TLShape, TLShapeId } from "tldraw";

const preparedImages = new WeakMap<Editor, ReadonlyMap<string, string>>();

/** Export copies use verified bytes; normal canvas rendering always uses its original URL. */
export function preparedCanvasImage(editor: Editor, source: string | undefined): string | undefined {
  return source ? preparedImages.get(editor)?.get(source) ?? source : source;
}

function imageSource(shape: TLShape, editor: Editor): { source: string; title: string } | null {
  const props = shape.props as unknown as Record<string, unknown>;
  const title = typeof props.title === "string" && props.title ? props.title.slice(0, 60) : "画布图片";
  let source: unknown;
  if (shape.type === "fashion-media") throw new Error(`媒体“${title}”不能导出为静态图片。请从媒体卡片下载原文件，或先隐藏媒体后导出画布。`);
  if (shape.type === "fashion-image") {
    source = props.url;
    if (!source) throw new Error(`图片“${title}”尚未就绪，请等待完成或隐藏后再导出。`);
  } else if (shape.type === "fashion-fabric") source = props.thumbnailUrl;
  else if (shape.type === "fashion-workflow-node") source = props.imageUrl;
  else if (shape.type === "image") source = shape.props.assetId ? editor.getAsset(shape.props.assetId)?.props.src : undefined;
  return typeof source === "string" && source ? { source, title } : null;
}

async function validatedImageData(source: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(source, { credentials: "same-origin", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
  if (!response.ok) throw new Error("图片读取失败");
  const blob = await response.blob();
  signal.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = objectUrl; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("图片无法解码");
  } finally { URL.revokeObjectURL(objectUrl); }
  signal.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片无法读取"));
    reader.onerror = () => reject(new Error("图片无法读取"));
    reader.readAsDataURL(blob);
  });
}

/** Fail before downloading if a source is missing; keep one image read per URL and per attempt. */
export async function renderCanvasExport(editor: Editor, ids: TLShapeId[], options: Parameters<Editor["toImage"]>[1], signal: AbortSignal) {
  const controller = new AbortController();
  const lifetime = AbortSignal.any([signal, controller.signal]);
  const sources = new Map<string, string>();
  const included = editor.getShapeAndDescendantIds(ids);
  for (const id of included) {
    const shape = editor.getShape(id);
    if (!shape || editor.isShapeHidden(shape)) continue;
    const entry = imageSource(shape, editor);
    if (entry) sources.set(entry.source, entry.title);
  }
  const resources = new Map<string, string>();
  const entries = [...sources.entries()];
  try {
    for (let start = 0; start < entries.length; start += 4) {
      await Promise.all(entries.slice(start, start + 4).map(async ([source, title]) => {
        try { resources.set(source, await validatedImageData(source, lifetime)); }
        catch (cause) {
          if (lifetime.aborted) throw cause;
          throw new Error(`图片“${title}”暂时无法导出，请重新加载图片后再试。`);
        }
      }));
    }
    lifetime.throwIfAborted();
    // A version update during loading must not silently export an unchecked new image.
    for (const id of included) {
      const shape = editor.getShape(id);
      if (!shape || editor.isShapeHidden(shape)) continue;
      const entry = imageSource(shape, editor);
      if (entry && !resources.has(entry.source)) throw new Error("图片已更新，请重新导出当前画布。");
    }
    preparedImages.set(editor, resources);
    const rendered = await editor.toImage(ids, options);
    lifetime.throwIfAborted();
    return rendered;
  } finally {
    controller.abort();
    if (preparedImages.get(editor) === resources) preparedImages.delete(editor);
  }
}
