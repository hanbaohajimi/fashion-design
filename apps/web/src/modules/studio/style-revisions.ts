import type { StudioStyleInput, StudioStyleRevisionView, StudioStyleView } from "@fashion/shared";
import { mergeSavedRecords } from "./studio-records";

export function findStyleRevision(styles: readonly StudioStyleView[], revisionId?: string) {
  if (!revisionId) return undefined;
  for (const style of styles) {
    const revision = [style.currentRevision, ...style.revisions].find(item => item.id === revisionId);
    if (revision) return { style, revision };
  }
  return undefined;
}

/** A confirmed mutation remains usable even if a following list read is stale or fails. */
export function mergeSavedStyles(styles: readonly StudioStyleView[], saved: readonly StudioStyleView[]) {
  return mergeSavedRecords(styles, saved);
}

export function editableStylePayload(payload: StudioStyleInput): StudioStyleInput {
  return { ...payload, status: payload.status === "APPROVED" ? "REVIEW" : payload.status };
}

export function continueStyleRevision(revision: StudioStyleRevisionView, assetId?: string): StudioStyleInput {
  const payload = editableStylePayload(revision.payload);
  if (!assetId || assetId === payload.sourceAssetId) {
    return { ...payload, changeNote: `基于 r${revision.revision} 继续修改` };
  }
  return {
    ...payload,
    sourceAssetId: assetId,
    views: payload.views.map(view => view.assetId === payload.sourceAssetId ? { ...view, assetId, reviewed: false } : view),
    changeNote: `基于 r${revision.revision} 更新主设计图`,
  };
}
