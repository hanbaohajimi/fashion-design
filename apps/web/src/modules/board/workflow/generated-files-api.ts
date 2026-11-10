import type { GeneratedFileFilter, ProjectGeneratedFile, ProjectGeneratedFilePage } from "@fashion/shared";
import { privateFetch, privateRequestSignal } from "../../auth/private-fetch";
import { readErrorMessage } from "../../auth/auth-api";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const nullableNumber = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value) && value >= 0;
function fileUrl(value: unknown): value is string {
  if (!text(value) || value.trim() !== value || value.includes("\\")) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
function sourceUrl(value: unknown, project: string) {
  if (value === null) return true;
  if (!fileUrl(value) || !value.startsWith("/")) return false;
  const path = new URL(value, "https://workspace.invalid").pathname;
  const base = `/${encodeURIComponent(project)}`;
  return path === base || path.startsWith(`${base}/`);
}
function validFile(value: unknown, project: string): value is ProjectGeneratedFile {
  if (!record(value)) return false;
  return text(value.resourceId) && value.id === `${value.domain}:${value.resourceId}`
    && text(value.domain) && ["asset", "runway", "export"].includes(value.domain)
    && text(value.kind) && ["image", "video", "audio", "document"].includes(value.kind)
    && text(value.status) && ["ready", "expired", "unavailable"].includes(value.status)
    && text(value.title) && text(value.operation) && typeof value.archived === "boolean" && date(value.createdAt)
    && (value.expiresAt === null || date(value.expiresAt))
    && (value.mimeType === null || text(value.mimeType)) && (value.nodeId === null || text(value.nodeId))
    && [value.width, value.height, value.sizeBytes, value.durationMs].every(nullableNumber)
    && [value.previewUrl, value.contentUrl].every(url => url === null || fileUrl(url)) && sourceUrl(value.sourceHref, project);
}

export async function fetchGeneratedFiles(project: string, kind: GeneratedFileFilter, q: string, cursor: string | undefined, signal: AbortSignal): Promise<ProjectGeneratedFilePage> {
  const query = new URLSearchParams({ kind, q, limit: "30" });
  if (cursor) query.set("cursor", cursor);
  const response = await privateFetch(`/api/projects/${encodeURIComponent(project)}/generated-files?${query}`, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) throw new Error(await readErrorMessage(response, "生成文件暂时无法读取，请重试。"));
  const page: unknown = await response.json();
  if (!record(page) || !Array.isArray(page.items) || !page.items.every(item => validFile(item, project)) || !(page.nextCursor === null || text(page.nextCursor))) throw new Error("生成文件响应无效，请重新读取。");
  return { items: page.items, nextCursor: page.nextCursor };
}

/** The API checks access and storage afresh; attachment downloads use the browser's streaming path. */
export async function downloadGeneratedFile(project: string, file: ProjectGeneratedFile, controller: AbortController): Promise<void> {
  const signal = privateRequestSignal(controller.signal);
  const response = await privateFetch(`/api/projects/${encodeURIComponent(project)}/generated-files/${file.domain}/${encodeURIComponent(file.resourceId)}/download`, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) throw new Error(await readErrorMessage(response, "下载暂未开始，请重试。"));
  const result: unknown = await response.json();
  signal.throwIfAborted();
  if (!record(result) || !fileUrl(result.url) || !text(result.fileName)) throw new Error("下载地址无效，请重试。");
  const url = new URL(result.url, location.origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("下载地址无效，请重试。");
  const anchor = document.createElement("a"); anchor.href = url.href; anchor.download = result.fileName; anchor.rel = "noreferrer";
  anchor.click();
}

export function generatedFileSize(size: number | null) {
  if (size === null || !Number.isFinite(size) || size < 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
