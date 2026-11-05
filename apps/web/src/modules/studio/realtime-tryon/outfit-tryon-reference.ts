import type { OutfitSnapshotView, WardrobeCapabilities } from "@fashion/shared";
import { loadTryOnGarment } from "./tryon-asset-flow";
import type { TryOnGarment } from "./realtime-tryon-types";

/** A saved outfit is never silently reduced to one garment when support is unavailable. */
export function outfitTryOnUnavailableReason(snapshot: OutfitSnapshotView | null, capabilities?: WardrobeCapabilities): string | null {
  if (!snapshot?.items.length) return "请先保存当前搭配，再进入本人试穿。";
  if (!capabilities?.enabled || !capabilities.realtimeOutfitEnabled) return "完整搭配实时试穿尚未启用，已保留当前搭配。仍可使用本地镜头预览。";
  if (snapshot.items.length > 1 && !capabilities.realtimeMultiItemVerified) return "多件搭配的实时还原效果尚未验证，当前搭配已保留，暂不能发送到实时试穿。";
  if (snapshot.items.some((item) => !capabilities.realtimeCategories.includes(item.category))) return "当前搭配包含尚未验证的服装或配饰类别，暂不能开始实时试穿。";
  if (!snapshot.referenceAssetId) return "请先为当前搭配准备参考图，再开始本人试穿。";
  return null;
}

const clean = (value: string, length: number) => value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, length).trim();

export function compileOutfitTryOnPrompt(snapshot: OutfitSnapshotView): string {
  const items = [...snapshot.items].sort((a, b) => a.layer - b.layer).map((item) =>
    `${item.category}: ${clean(item.name, 120)}, layer ${item.layer}${item.wearNote ? `, ${clean(item.wearNote, 300)}` : ""}`);
  return [
    "Apply the complete outfit shown in the reference image to the person. This is the entire desired outfit, replacing the previous outfit state.",
    "Preserve each selected garment and accessory, their colors, silhouette, closures, pattern placement and the specified layering order.",
    "Do not omit selected items or keep items removed from the previous selection. Keep the person's identity, pose and background unchanged.",
    `Selected outfit: ${items.join("; ")}.`,
  ].join(" ");
}

export async function loadTryOnOutfit(snapshot: OutfitSnapshotView, maxBytes: number, signal?: AbortSignal): Promise<TryOnGarment> {
  if (!snapshot.referenceAssetId) throw new Error("当前搭配尚未准备参考图");
  const reference = await loadTryOnGarment(snapshot.referenceAssetId, maxBytes, signal);
  return { ...reference, outfitSnapshotId: snapshot.id, outfitPrompt: compileOutfitTryOnPrompt(snapshot) };
}
