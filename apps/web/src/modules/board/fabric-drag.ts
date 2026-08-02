import type { Fabric } from "../fabrics/fabric-types";

export const FABRIC_DRAG_MIME = "application/x-fashion-fabric";

export interface FabricDragPayload {
  readonly fabricCategory: string;
  readonly fabricId: string;
  readonly fabricName: string;
  readonly thumbnailUrl: string;
}

function isFabricDragPayload(value: unknown): value is FabricDragPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fabricCategory === "string" &&
    typeof candidate.fabricId === "string" &&
    candidate.fabricId.length > 0 &&
    typeof candidate.fabricName === "string" &&
    candidate.fabricName.length > 0 &&
    typeof candidate.thumbnailUrl === "string"
  );
}

export function fabricToDragPayload(fabric: Fabric): FabricDragPayload {
  return {
    fabricCategory: fabric.category,
    fabricId: fabric.id,
    fabricName: fabric.name,
    thumbnailUrl: fabric.mainImageUrl,
  };
}

export function decodeFabricDragPayload(raw: string): FabricDragPayload | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isFabricDragPayload(value) ? value : null;
  } catch {
    return null;
  }
}

export function fabricToShapeProps(payload: FabricDragPayload) {
  return {
    fabricCategory: payload.fabricCategory,
    fabricId: payload.fabricId,
    fabricName: payload.fabricName,
    h: 280,
    role: "fabric_ref",
    thumbnailUrl: payload.thumbnailUrl,
    w: 240,
  } as const;
}
