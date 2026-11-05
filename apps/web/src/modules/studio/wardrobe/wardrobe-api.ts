import type { OutfitSaveInput, OutfitSnapshotView, OutfitTrialInput, OutfitView, WardrobeConfirmInput, WardrobeItemView, WardrobeMaterialAlphaInput, WardrobeMaterialMaskInput, WardrobeMaterialProbeInput, WardrobePreparationView, WardrobePrepareInput, WardrobePresentationInput, WardrobeSummary, WardrobeTryOnView } from "@fashion/shared";
import { privateFetch } from "../../auth/private-fetch";
import { readErrorMessage } from "../../auth/auth-api";

export class WardrobeApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(projectId: string, path = "", init?: RequestInit): Promise<T> {
  const response = await privateFetch(`/api/projects/${encodeURIComponent(projectId)}/wardrobe${path}`, {
    credentials: "include", cache: "no-store", ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new WardrobeApiError(await readErrorMessage(response, "衣橱操作未完成，请重试"), response.status);
  return response.json() as Promise<T>;
}
const post = <T>(projectId: string, path: string, body: unknown) => request<T>(projectId, path, { method: "POST", body: JSON.stringify(body) });
export const wardrobeApi = {
  summary: (projectId: string, signal?: AbortSignal) => request<WardrobeSummary>(projectId, "", signal ? { signal } : undefined),
  prepare: (projectId: string, input: WardrobePrepareInput) => post<WardrobePreparationView>(projectId, "/prepare", input),
  materialProbe: (projectId: string, input: WardrobeMaterialProbeInput) => post<{ taskId: string }>(projectId, "/material-alpha/probe", input),
  materialAlpha: (projectId: string, input: WardrobeMaterialAlphaInput) => post<WardrobePreparationView>(projectId, "/material-alpha", input),
  materialMask: (projectId: string, input: WardrobeMaterialMaskInput, signal: AbortSignal) => request<{ assetId: string; url: string }>(projectId, "/material-alpha/mask", { method: "POST", body: JSON.stringify(input), signal }),
  confirm: (projectId: string, input: WardrobeConfirmInput) => post<WardrobeItemView>(projectId, "/confirm", input),
  presentation: (projectId: string, itemId: string, input: WardrobePresentationInput) => request<WardrobeItemView>(projectId, `/items/${encodeURIComponent(itemId)}/presentation`, { method: "PATCH", body: JSON.stringify(input) }),
  save: (projectId: string, input: OutfitSaveInput) => post<OutfitView>(projectId, "/outfits", input),
  trial: (projectId: string, input: OutfitTrialInput) => post<OutfitSnapshotView>(projectId, "/snapshots", input),
  reference: (projectId: string, snapshotId: string, requestKey = crypto.randomUUID()) => post<OutfitSnapshotView>(projectId, `/snapshots/${encodeURIComponent(snapshotId)}/reference`, { requestKey }),
  tryOn: (projectId: string, snapshotId: string, modelAssetId: string, requestKey = crypto.randomUUID()) => post<WardrobeTryOnView>(projectId, "/tryon", { requestKey, snapshotId, modelAssetId }),
  archive: (projectId: string, item: WardrobeItemView, archived: boolean) => request<WardrobeItemView>(projectId, `/items/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ requestKey: crypto.randomUUID(), expectedVersion: item.version, archived }) }),
};
