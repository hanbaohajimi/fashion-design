import type { StudioDocumentView, StudioSummary } from "@fashion/shared";

/** Confirmed responses must survive failed or stale list reads. */
export function mergeSavedRecords<T extends { id: string; version: number }>(records: readonly T[], saved: readonly T[]): T[] {
  const result = new Map(records.map(record => [record.id, record]));
  for (const record of saved) {
    const current = result.get(record.id);
    if (!current || record.version > current.version) result.set(record.id, record);
  }
  return [...result.values()];
}

export function mergeSavedDeliveryDocuments(data: StudioSummary, saved: readonly StudioDocumentView[]): StudioSummary {
  return {
    ...data,
    techPacks: mergeSavedRecords(data.techPacks, saved.filter(document => document.type === "TECH_PACK")),
    presentationSets: mergeSavedRecords(data.presentationSets, saved.filter(document => document.type === "PRESENTATION_SET")),
  };
}
