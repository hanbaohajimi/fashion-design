import type { Fabric } from "../fabrics/fabric-types";

export const FABRIC_DRAG_MIME = "application/x-fashion-fabric";
const NATIVE_FILE_DRAG_MIME = "Files";

interface NativeFileDropControllerOptions {
  readonly onDraggingChange: (dragging: boolean) => void;
  readonly shouldIgnore?: (event: DragEvent) => boolean;
}

export interface NativeFileDropController {
  readonly onDragEnter: (event: DragEvent) => void;
  readonly onDragLeave: (event: DragEvent) => void;
  readonly onDragOver: (event: DragEvent) => void;
  readonly onDrop: (event: DragEvent) => void;
  readonly reset: () => void;
}

interface NativeFileContent {
  readonly files: readonly File[];
  readonly point?: { readonly x: number; readonly y: number };
}

interface NativeFileContentHandlerOptions {
  readonly getFallbackPoint: () => { readonly x: number; readonly y: number };
  readonly onFiles: (
    files: readonly File[],
    point: { readonly x: number; readonly y: number },
  ) => void;
}

export function createNativeFileContentHandler({
  getFallbackPoint,
  onFiles,
}: NativeFileContentHandlerOptions) {
  return ({ files, point }: NativeFileContent): void => {
    onFiles(files, point ?? getFallbackPoint());
  };
}

function carriesNativeFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(
    NATIVE_FILE_DRAG_MIME,
  );
}

/**
 * Tracks the native file drag lifecycle for the full-screen drop indicator.
 * The actual file insertion is owned by tldraw's `files` external-content
 * handler so local drops and the upload button share the same upload pipeline.
 */
export function createNativeFileDropController({
  onDraggingChange,
  shouldIgnore = () => false,
}: NativeFileDropControllerOptions): NativeFileDropController {
  let dragDepth = 0;
  let dragging = false;

  const setDragging = (next: boolean): void => {
    if (dragging === next) return;
    dragging = next;
    onDraggingChange(next);
  };
  const reset = (): void => {
    dragDepth = 0;
    setDragging(false);
  };

  return {
    onDragEnter(event) {
      if (shouldIgnore(event) || !carriesNativeFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      setDragging(true);
    },
    onDragLeave() {
      if (!dragging) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragging(false);
    },
    onDragOver(event) {
      if (
        shouldIgnore(event) ||
        !carriesNativeFiles(event) ||
        !event.dataTransfer
      )
        return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDrop(event) {
      if (shouldIgnore(event)) {
        reset();
        return;
      }
      const files = [...(event.dataTransfer?.files ?? [])];
      reset();
      if (files.length === 0) return;
    },
    reset,
  };
}

export interface FabricDragPayload {
  readonly fabricId: string;
  readonly fabricTags: readonly string[];
  readonly thumbnailUrl: string;
}

function isFabricDragPayload(value: unknown): value is FabricDragPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fabricId === "string" &&
    candidate.fabricId.length > 0 &&
    Array.isArray(candidate.fabricTags) &&
    candidate.fabricTags.length > 0 &&
    candidate.fabricTags.every(
      (tag) => typeof tag === "string" && tag.trim().length > 0,
    ) &&
    typeof candidate.thumbnailUrl === "string"
  );
}

export function fabricToDragPayload(fabric: Fabric): FabricDragPayload {
  return {
    fabricId: fabric.id,
    fabricTags: fabric.tags,
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
    fabricId: payload.fabricId,
    fabricTags: payload.fabricTags,
    // Landscape: typical offcuts are wider than tall.
    h: 174,
    role: "fabric_ref",
    thumbnailUrl: payload.thumbnailUrl,
    w: 260,
  } as const;
}
