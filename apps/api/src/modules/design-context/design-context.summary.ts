import { contextObject, contextText, safeContextText, stringIds } from "./design-context.projector";
import { mergeSemanticMemory } from "./design-context.semantic-memory";

export interface SummaryMessage { readonly id: string; readonly role: string; readonly content: string }
export interface SummaryEntry { messageId: string; role: string; text: string; contentTruncated: boolean }

/** Correction idempotency belongs to the conversation and survives derived cache replacement. */
export function summaryCorrectionMetadata(previous: unknown): { lastCorrection?: { mutationId: string; requestHash: string } } {
  const correction = contextObject(contextObject(previous).lastCorrection);
  return typeof correction.mutationId === "string" && typeof correction.requestHash === "string"
    ? { lastCorrection: { mutationId: correction.mutationId, requestHash: correction.requestHash } }
    : {};
}

/** Source-backed excerpts, not model-invented facts. The cursor is advanced by the caller only for processed rows. */
export function mergeDialogSummary(previous: unknown, messages: readonly SummaryMessage[]) {
  const old = contextObject(previous);
  const oldEntries: SummaryEntry[] = (Array.isArray(old.entries) ? old.entries : []).flatMap((value) => {
    const entry = contextObject(value);
    const messageId = contextText(entry.messageId, 128);
    return messageId ? [{ messageId, role: contextText(entry.role, 20), text: safeContextText(entry.text, 300), contentTruncated: entry.contentTruncated === true }] : [];
  });
  const hasStructuredEntries = Array.isArray(old.entries);
  const legacyText = safeContextText(hasStructuredEntries ? old.legacyText : old.text, 4_000);
  const legacySourceMessageIds = stringIds(hasStructuredEntries ? old.legacySourceMessageIds : old.sourceMessageIds);
  const known = new Set([...oldEntries.map((entry) => entry.messageId), ...legacySourceMessageIds]);
  const added: SummaryEntry[] = [];
  for (const message of messages) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    added.push({ messageId: message.id, role: contextText(message.role, 20), text: safeContextText(message.content, 300), contentTruncated: message.content.trim().length > 300 });
  }
  const candidates = [...oldEntries, ...added];
  let length = legacyText.length;
  const entries: SummaryEntry[] = [];
  // Preserve the first recorded intent and then prefer recent material under a fixed budget.
  const first = candidates[0];
  if (first) { entries.push(first); length += first.text.length + first.role.length + 3; }
  for (const entry of candidates.slice(1).reverse()) {
    const cost = entry.text.length + entry.role.length + 3;
    if (length + cost > 12_000 || entries.length + legacySourceMessageIds.length >= 200) continue;
    entries.push(entry); length += cost;
  }
  const kept = new Set(entries.map((entry) => entry.messageId));
  const chronological = candidates.filter((entry) => kept.has(entry.messageId));
  const previousOmitted = typeof old.omittedMessageCount === "number" ? old.omittedMessageCount : 0;
  const dropped = candidates.length - chronological.length;
  const previousCovered = typeof old.coveredMessageCount === "number" ? old.coveredMessageCount : oldEntries.length + legacySourceMessageIds.length + previousOmitted;
  return {
    text: [legacyText, ...chronological.map((entry) => `${entry.role}: ${entry.text}`)].filter(Boolean).join("\n").slice(0, 12_000),
    sourceMessageIds: [...legacySourceMessageIds, ...chronological.map((entry) => entry.messageId)],
    entries: chronological, legacyText, legacySourceMessageIds,
    omittedMessageCount: previousOmitted + dropped,
    coveredMessageCount: previousCovered + added.length,
    truncatedMessageCount: chronological.filter((entry) => entry.contentTruncated).length,
    pendingMessageCount: typeof old.pendingMessageCount === "number" ? old.pendingMessageCount : 0,
    method: "bounded_original_excerpts" as const,
    semanticMemory: mergeSemanticMemory(previous, messages),
    ...summaryCorrectionMetadata(previous),
  };
}
