import { atom, useValue, type TLShapeId } from "tldraw";

const previews = atom<Record<string, string>>("board-upload-previews", {});

export function setUploadPreview(shapeId: TLShapeId, url: string): void {
  previews.update((current) => ({ ...current, [shapeId]: url }));
}

export function clearUploadPreview(shapeId: TLShapeId): void {
  const url = previews.get()[shapeId];
  if (url) {
    URL.revokeObjectURL(url);
  }
  previews.update((current) =>
    Object.fromEntries(
      Object.entries(current).filter(([key]) => key !== shapeId),
    ),
  );
}

export function clearAllUploadPreviews(): void {
  for (const url of Object.values(previews.get())) {
    URL.revokeObjectURL(url);
  }
  previews.set({});
}

if (typeof window !== "undefined") {
  window.addEventListener("fashion:session-changed", clearAllUploadPreviews);
}

export function useUploadPreview(shapeId: TLShapeId): string {
  return useValue(
    `upload-preview-${shapeId}`,
    () => previews.get()[shapeId] ?? "",
    [shapeId],
  );
}
