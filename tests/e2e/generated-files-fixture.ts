import type { Page } from "@playwright/test";
import type { ProjectGeneratedFile } from "../../packages/shared/src/project-generated-files";
import { prepareZhiya } from "./zhiya-fixture";
import { PROJECT } from "../visual/fixtures";

export async function generatedFilesFixture(page: Page, options: { count?: number; canvasCount?: number; canEdit?: boolean; width?: number } = {}) {
  const width = options.width ?? 1440;
  const base = await prepareZhiya(page, { count: options.canvasCount ?? 30, realClock: true, canEdit: options.canEdit ?? true, viewport: { width, height: width === 320 ? 568 : 900 } });
  const files: ProjectGeneratedFile[] = Array.from({ length: options.count ?? 67 }, (_, i) => {
    const kind = i % 10 === 3 ? "video" : i % 10 === 4 ? "audio" : i % 10 === 5 ? "document" : "image";
    const domain = kind === "image" ? "asset" : kind === "document" ? "export" : "runway";
    const id = i === 0 ? "look-0" : `result-${i}`;
    return { id: `${domain}:${id}`, domain, resourceId: id, kind, title: i === 0 ? "藏蓝通勤外套" : i === 1 ? "已移出画布的初稿" : kind === "image" ? `服装方案 ${i + 1}` : kind === "document" ? `秋冬技术包 ${i + 1}.pdf` : kind === "audio" ? `服装秀配乐 ${i + 1}` : `服装秀成片 ${i + 1}`,
      operation: domain === "asset" ? "生成设计" : domain === "export" ? "导出文件" : kind === "video" ? "成片" : "配乐",
      createdAt: new Date(Date.UTC(2026, 10, 9, 12) - i * 60_000).toISOString(), archived: i === 1, status: i === 5 ? "expired" : "ready",
      mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "application/pdf",
      width: kind === "image" || kind === "video" ? 600 : null, height: kind === "image" || kind === "video" ? 800 : null,
      durationMs: kind === "audio" || kind === "video" ? 8000 : null, sizeBytes: i === 1 ? null : 110000 + i,
      expiresAt: i === 5 ? "2026-01-01T00:00:00.000Z" : null,
      previewUrl: kind === "image" ? "/visual-garment.svg" : null,
      contentUrl: kind === "image" ? "/visual-garment.svg" : i === 5 ? null : `/generated-preview-${kind}`,
      sourceHref: domain === "export" ? `/${PROJECT}/studio?tab=tech&documentId=tech-${i}` : domain === "runway" ? `/${PROJECT}/studio?tab=runway&showId=show-${i}&runId=run-${i}` : null,
      nodeId: i === 0 ? "material-0" : null,
    };
  });
  const state = { ...base, files, requests: [] as string[], downloads: [] as string[], failFirst: false, failNext: false, failDownload: false, downloadUrl: "", holdDownload: null as Promise<void> | null, holdList: null as Promise<void> | null };
  await page.route(url => url.pathname.endsWith("/generated-files"), async route => {
    const url = new URL(route.request().url()); state.requests.push(url.search);
    if (state.holdList) await state.holdList;
    const cursor = url.searchParams.get("cursor"), q = url.searchParams.get("q") ?? "", kind = url.searchParams.get("kind") ?? "all";
    if (state.failFirst || cursor && state.failNext) return route.fulfill({ status: 503, json: { message: "文件列表暂时无法读取" } });
    const filtered = state.files.filter(file => (kind === "all" || file.kind === kind) && (!q || `${file.title} ${file.resourceId} ${file.operation}`.includes(q)));
    const start = cursor ? Number(cursor) : 0, items = filtered.slice(start, start + 30);
    return route.fulfill({ json: { items, nextCursor: start + 30 < filtered.length ? String(start + 30) : null } });
  });
  await page.route(url => url.pathname.includes("/generated-files/") && url.pathname.endsWith("/download"), async route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-2) ?? ""); state.downloads.push(id);
    if (state.holdDownload) await state.holdDownload;
    if (state.failDownload) return route.fulfill({ status: 503, json: { message: "文件暂时无法读取，请重试。" } });
    return route.fulfill({ json: { url: state.downloadUrl || `/generated-file-download/${id}`, fileName: `服装设计-${id}.png` } });
  });
  await page.route("**/generated-file-download/*", route => route.fulfill({ contentType: "image/png", headers: { "Content-Disposition": "attachment; filename=design.png" }, body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WkAAAAASUVORK5CYII=", "base64") }));
  await page.route("**/api/design-assets/*/path", route => {
    const assetId = new URL(route.request().url()).pathname.split("/").at(-2);
    return route.fulfill({ json: { assetId, incomplete: false, decisions: [], steps: [{ id: "original-step", version: 1, actor: "agent", tool: "t2i", intent: "保留原来的藏蓝色与宽松廓形", sources: [], constraints: { palette: [], notes: ["初稿设计要求"], avoidLabels: [], fabricTerms: [] }, parameters: {}, createdAt: "2026-11-08T12:00:00.000Z", status: "succeeded", snapshotAvailable: true, conversationId: null, outputs: [{ id: assetId, url: "/visual-garment.svg", thumbnailUrl: null, parentAssetId: null }] }] } });
  });
  await page.route("**/generated-preview-*", route => route.fulfill({ status: 503, body: "preview not available" }));
  return state;
}
