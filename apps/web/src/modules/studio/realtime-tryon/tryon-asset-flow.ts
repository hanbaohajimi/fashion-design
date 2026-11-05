import type {
  RealtimeTryOnCapabilities,
  RealtimeTryOnCaptureResult,
  StudioAssetView,
} from "@fashion/shared";
import { privateFetch } from "../../auth/private-fetch";
import { readErrorMessage } from "../../auth/auth-api";
import { importDesignAsset } from "../../board/generation/collection-api";
import {
  signImageUpload,
  putOriginal,
  completeUpload,
  waitForThumbnail,
} from "../../board/file-upload-api";
import { fetchWorkflow, patchWorkflow } from "../../board/workflow/workflow-api";
import type { TryOnCapture, TryOnGarment } from "./realtime-tryon-types";

const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function fetchTryOnCapabilities(signal?: AbortSignal): Promise<RealtimeTryOnCapabilities> {
  const response = await privateFetch("/api/realtime-tryon/capabilities", {
    credentials: "include", cache: "no-store", ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "无法读取实时试穿配置，请重试"));
  return response.json() as Promise<RealtimeTryOnCapabilities>;
}

/** Decode the actual image before any media is sent to the provider. */
export async function validateGarment(file: File, maxBytes: number): Promise<void> {
  if (!TYPES.has(file.type)) throw new Error("服装参考仅支持 JPEG、PNG 或 WebP 图片");
  if (!file.size || file.size > maxBytes) throw new Error(`服装图片不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB`);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 32_000_000) {
      throw new Error("服装图片尺寸过大，请使用 8192 像素以内、总像素不超过 3200 万的图片");
    }
  } catch (cause) {
    throw cause instanceof Error && cause.message.startsWith("服装图片") ? cause : new Error("无法解码服装图片，请重新选择有效图片");
  } finally { URL.revokeObjectURL(url); }
}

export async function loadTryOnGarment(assetId: string, maxBytes: number, signal?: AbortSignal): Promise<TryOnGarment> {
  const response = await privateFetch(`/api/design-assets/${encodeURIComponent(assetId)}/content`, {
    credentials: "include", cache: "no-store", ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "服装图片读取失败，请重新选择"));
  const blob = await response.blob();
  const file = new File([blob], "garment", { type: blob.type });
  await validateGarment(file, maxBytes);
  signal?.throwIfAborted();
  return { assetId, file };
}

export async function uploadTryOnGarment(projectId: string, file: File, maxBytes: number, signal?: AbortSignal): Promise<StudioAssetView> {
  await validateGarment(file, maxBytes);
  const signed = await signImageUpload(projectId, file, signal);
  const processing = signed.upload
    ? await putOriginal(signed.upload, file, { ...(signal ? { signal } : {}) }).then(() => completeUpload(signed.file.id, signal))
    : signed.file;
  const ready = await waitForThumbnail(signed.file.id, processing, 60_000, signal);
  signal?.throwIfAborted();
  const asset = await importDesignAsset(projectId, ready.id);
  signal?.throwIfAborted();
  return { id: asset.id, url: `/api/design-assets/${encodeURIComponent(asset.id)}/content`, thumbnailUrl: ready.thumbnail256Url };
}

/** One user capture keeps its blob, upload progress and idempotency key across retries. */
export class PendingTryOnCapture {
  readonly key = crypto.randomUUID();
  private signed: Awaited<ReturnType<typeof signImageUpload>> | null = null;
  private processing: Awaited<ReturnType<typeof completeUpload>> | null = null;
  private fileReady = false;
  private result: RealtimeTryOnCaptureResult | null = null;
  private flight: Promise<RealtimeTryOnCaptureResult> | null = null;

  constructor(readonly capture: TryOnCapture, readonly projectId: string) {}

  save(signal?: AbortSignal): Promise<RealtimeTryOnCaptureResult> {
    if (this.result) return Promise.resolve(this.result);
    if (this.flight) return this.flight;
    this.flight = this.persist(signal).finally(() => { this.flight = null; });
    return this.flight;
  }

  private async persist(signal?: AbortSignal): Promise<RealtimeTryOnCaptureResult> {
    const file = new File([this.capture.blob], "实时试穿.png", { type: "image/png" });
    this.signed ??= await signImageUpload(this.projectId, file, signal);
    if (!this.processing) {
      if (this.signed.upload) {
        try { await putOriginal(this.signed.upload, file, { ...(signal ? { signal } : {}) }); }
        catch (cause) {
          // A failed/expired signature is refreshed on explicit retry; SHA deduplication is unchanged.
          this.signed = null;
          throw cause;
        }
      }
      this.processing = this.signed.upload ? await completeUpload(this.signed.file.id, signal) : this.signed.file;
    }
    if (!this.fileReady) {
      await waitForThumbnail(this.signed.file.id, this.processing, 60_000, signal);
      this.fileReady = true;
    }
    const { sessionId, garmentAssetId, outfitSnapshotId, garmentRevision, width, height, capturedAt } = this.capture;
    const response = await privateFetch(`/api/realtime-tryon/sessions/${encodeURIComponent(sessionId)}/captures`, {
      method: "POST", credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": this.key },
      body: JSON.stringify({ garmentAssetId, ...(outfitSnapshotId ? { outfitSnapshotId } : {}), garmentRevision, width, height, capturedAt, fileId: this.signed.file.id }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, "截图登记失败，画面已留在本页，可重试保存"));
    this.result = await response.json() as RealtimeTryOnCaptureResult;
    return this.result;
  }
}

export async function addTryOnCaptureToCanvas(projectId: string, asset: RealtimeTryOnCaptureResult): Promise<void> {
  const graph = await fetchWorkflow(projectId);
  if (graph.nodes.some((node) => node.payload.assetId === asset.assetId)) return;
  await patchWorkflow(projectId, {
    mode: "semantic", mutationId: `tryon-${asset.assetId}`, baseRevision: graph.revision,
    operations: [{ type: "add_node", node: {
      id: crypto.randomUUID(), kind: "asset", type: "candidate", title: "实时试穿截图",
      payload: { assetId: asset.assetId, imageUrl: asset.url, source: asset.source },
      x: graph.nodes.length ? Math.max(...graph.nodes.map((node) => node.x)) + 420 : 80,
      y: 80,
    } }],
  });
}
