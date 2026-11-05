import type { StudioAssetView, WardrobeMaterialOperation } from "@fashion/shared";
import { signImageUpload, putOriginal, completeUpload, waitForThumbnail } from "../../board/file-upload-api";
import { importDesignAsset } from "../../board/generation/collection-api";
import { uploadTemporaryMaskReference } from "../../board/generation/generation-api";
import { fetchWorkflow, patchWorkflow } from "../../board/workflow/workflow-api";
import { wardrobeApi } from "./wardrobe-api";

async function uploadWardrobeImage(projectId: string, file: File, signal: AbortSignal, label: string): Promise<StudioAssetView> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error(`请选择 JPEG、PNG 或 WebP 格式的${label}图片。`);
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(`${label}图片需小于 10 MB。`);
  const signed = await signImageUpload(projectId, file, signal);
  const processing = signed.upload ? await putOriginal(signed.upload, file, { signal }).then(() => completeUpload(signed.file.id, signal)) : signed.file;
  const ready = await waitForThumbnail(signed.file.id, processing, 60_000, signal);
  signal.throwIfAborted();
  const asset = await importDesignAsset(projectId, ready.id);
  signal.throwIfAborted();
  return { id: asset.id, url: `/api/design-assets/${encodeURIComponent(asset.id)}/content`, thumbnailUrl: ready.thumbnail256Url };
}

export const uploadWardrobeModel = (projectId: string, file: File, signal: AbortSignal) => uploadWardrobeImage(projectId, file, signal, "模特");
export const uploadWardrobeSource = (projectId: string, file: File, signal: AbortSignal) => uploadWardrobeImage(projectId, file, signal, "来源");
export const uploadWardrobeMask = async (projectId: string, sourceAssetId: string, blob: Blob, signal: AbortSignal, operation: WardrobeMaterialOperation = "transparency"): Promise<{ id: string; url: string }> => {
  if (blob.type !== "image/png" || !blob.size || blob.size > 4 * 1024 * 1024) throw new Error("选区图片必须是小于 4 MB 的 PNG。");
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap; bitmap.close();
  signal.throwIfAborted();
  const uploaded = await uploadTemporaryMaskReference(projectId, blob, width, height, signal);
  signal.throwIfAborted();
  const asset = await wardrobeApi.materialMask(projectId, { requestKey: crypto.randomUUID(), sourceAssetId, maskId: uploaded.maskId, sha256: uploaded.sha256, operation }, signal);
  signal.throwIfAborted();
  return { id: asset.assetId, url: asset.url };
};

export async function addWardrobeResultToCanvas(projectId: string, result: { assetId: string; url: string }, snapshotId: string): Promise<void> {
  const graph = await fetchWorkflow(projectId);
  if (graph.nodes.some(node => node.payload.assetId === result.assetId)) return;
  await patchWorkflow(projectId, {
    mode: "semantic", mutationId: `wardrobe-result-${result.assetId}`, baseRevision: graph.revision,
    operations: [{ type: "add_node", node: {
      id: crypto.randomUUID(), kind: "asset", type: "candidate", title: "搭配试衣结果",
      payload: { assetId: result.assetId, imageUrl: result.url, source: "wardrobe-tryon", outfitSnapshotId: snapshotId },
      x: graph.nodes.length ? Math.max(...graph.nodes.map(node => node.x)) + 420 : 80, y: 80,
    } }],
  });
}
