import type { DraftScope } from "../../components/drafts/use-persistent-draft";
import { draftRepository } from "../../components/drafts/draft-repository";

/** Keep the old unsaved position reachable without sharing new drafts between series. */
export async function planningDraftKey(
  scope: DraftScope | null,
  collectionId: string,
) {
  if (scope) {
    const key = JSON.stringify([
      scope.accountId,
      scope.projectId,
      scope.editor,
      "new",
    ]);
    const record = await draftRepository.read<{ collectionId: string }>(key);
    const cached = draftRepository.memory<{ collectionId: string }>(key);
    const latest =
      cached && cached.updatedAt > (record?.updatedAt ?? 0) ? cached : record;
    if (latest?.value.collectionId === collectionId) return "new";
  }
  return `new:${collectionId}`;
}
