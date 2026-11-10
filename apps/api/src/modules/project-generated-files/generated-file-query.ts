import { BadRequestException } from "@nestjs/common";
import type { GeneratedFileDomain, GeneratedFileFilter, ProjectGeneratedFile } from "@fashion/shared";

export interface GeneratedFileQuery { kind: GeneratedFileFilter; q: string; limit: number; cursor?: string | undefined }
interface Cursor { project: string; kind: GeneratedFileFilter; q: string; date: string; domain: GeneratedFileDomain; id: string }
export const operationLabels: Record<string, string> = { GENERATED: "生成设计", VARIATION: "设计变体", INPAINT: "局部重绘", UPSCALE: "高清放大", TRANSFORM: "图片调整", REMOVE_BACKGROUND: "移除背景", ERASE: "智能擦除", OUTPAINT: "扩图", RESTORE: "恢复版本" };
export const mediaLabels: Record<string, string> = { model: "模特图", cloth: "服装图", background: "秀场背景", tryon: "试穿图", storyboard: "分镜图", video: "视频片段", silent_video: "无声成片", final_video: "成片", music: "配乐", poster: "海报" };
const descending = (a: string, b: string) => a === b ? 0 : a < b ? 1 : -1;

export function decodeGeneratedFileCursor(value: string | undefined, project: string, input: GeneratedFileQuery): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString()) as Cursor;
    if (cursor.project !== project || cursor.kind !== input.kind || cursor.q !== input.q ||
      !["asset", "runway", "export"].includes(cursor.domain) || typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 256 ||
      typeof cursor.date !== "string" || new Date(cursor.date).toISOString() !== cursor.date) throw new Error();
    return cursor;
  } catch { throw new BadRequestException("生成文件分页信息无效，请刷新列表。"); }
}

/** Matches merged ordering; deleted boundary records do not break pagination. */
export function generatedFileBoundary(cursor: Cursor | null, domain: GeneratedFileDomain) {
  if (!cursor) return {};
  const date = new Date(cursor.date);
  return { OR: [{ createdAt: { lt: date } }, ...(domain <= cursor.domain ? [{ createdAt: date, ...(domain === cursor.domain ? { id: { lt: cursor.id } } : {}) }] : [])] };
}

export function mergeGeneratedFiles(rows: ProjectGeneratedFile[], project: string, input: GeneratedFileQuery) {
  const sorted = [...rows].sort((a, b) => descending(a.createdAt, b.createdAt) || descending(a.id, b.id));
  const items = sorted.slice(0, input.limit), last = items.at(-1);
  return { items, nextCursor: sorted.length > input.limit && last ? Buffer.from(JSON.stringify({ project, kind: input.kind, q: input.q, date: last.createdAt, domain: last.domain, id: last.resourceId })).toString("base64url") : null };
}

export function fileView(domain: GeneratedFileDomain, id: string, createdAt: Date): ProjectGeneratedFile {
  return { id: `${domain}:${id}`, domain, resourceId: id, kind: "image", title: "生成图片", operation: "生成设计", createdAt: createdAt.toISOString(), archived: false, status: "ready", mimeType: null, width: null, height: null, durationMs: null, sizeBytes: null, expiresAt: null, previewUrl: null, contentUrl: null, sourceHref: null, nodeId: null };
}
