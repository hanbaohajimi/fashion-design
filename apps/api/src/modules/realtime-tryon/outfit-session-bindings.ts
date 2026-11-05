import { BadRequestException } from "@nestjs/common";

export interface OutfitSessionBinding { outfitSnapshotId: string; garmentAssetId: string; garmentRevision: number }
interface SessionReferences { outfitSnapshotId?: string | null; garmentAssetId: string; observation: unknown }

export function outfitSessionBindings(session: SessionReferences): OutfitSessionBinding[] {
  const observation = session.observation;
  const stored = observation && typeof observation === "object" && "outfitBindings" in observation && Array.isArray(observation.outfitBindings)
    ? observation.outfitBindings.filter((value): value is OutfitSessionBinding => Boolean(value && typeof value === "object" && typeof value.outfitSnapshotId === "string" && typeof value.garmentAssetId === "string" && Number.isInteger(value.garmentRevision))) : [];
  return session.outfitSnapshotId ? [{ outfitSnapshotId: session.outfitSnapshotId, garmentAssetId: session.garmentAssetId, garmentRevision: 0 }, ...stored.filter((binding) => binding.garmentRevision !== 0)] : stored;
}

export function appendOutfitBinding(session: SessionReferences, next: OutfitSessionBinding): OutfitSessionBinding[] {
  const bindings = outfitSessionBindings(session);
  const existing = bindings.find((binding) => binding.garmentRevision === next.garmentRevision);
  if (existing) {
    if (existing.outfitSnapshotId !== next.outfitSnapshotId || existing.garmentAssetId !== next.garmentAssetId) throw new BadRequestException({ code: "TRYON_OUTFIT_REVISION_CONFLICT", message: "本次应用序号已关联其他搭配，请重新开启会话" });
    return bindings;
  }
  if (bindings.length >= 256) throw new BadRequestException({ code: "TRYON_OUTFIT_UPDATES_LIMIT", message: "本次会话搭配切换次数已达上限，请停止后重试" });
  return [...bindings, next];
}

export function assertOutfitCaptureBinding(session: SessionReferences, capture: OutfitSessionBinding): void {
  if (!outfitSessionBindings(session).some((binding) => binding.outfitSnapshotId === capture.outfitSnapshotId && binding.garmentAssetId === capture.garmentAssetId && binding.garmentRevision === capture.garmentRevision)) {
    throw new BadRequestException({ code: "TRYON_OUTFIT_CAPTURE_UNBOUND", message: "截图搭配未关联到本次会话的已应用状态" });
  }
}
