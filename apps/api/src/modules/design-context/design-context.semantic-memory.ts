import { createHash } from "node:crypto";
import { contextObject, contextText, safeContextText, stringIds } from "./design-context.projector";

export interface MemoryEvidenceRef { id: string; messageId: string; quote: string; role: string }
export interface SemanticMemoryEntry { id: string; text: string; evidenceRefIds: string[] }
export interface SemanticDialogMemory {
  version: "dialog-semantic-memory/1";
  goalEvolution: SemanticMemoryEntry[];
  rejectedUnderstandings: SemanticMemoryEntry[];
  decisions: SemanticMemoryEntry[];
  openQuestions: SemanticMemoryEntry[];
  evidenceRefs: MemoryEvidenceRef[];
  omittedEntryCount: number;
  method: "source_labeled_sentences";
}
const fields = ["goalEvolution", "rejectedUnderstandings", "decisions", "openQuestions"] as const;
const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);

/** A rebuildable index of explicit sentences, rather than a second authority over source messages. */
export function mergeSemanticMemory(previous: unknown, messages: readonly { id: string; role: string; content: string }[]): SemanticDialogMemory {
  const old = contextObject(contextObject(previous).semanticMemory);
  const evidence = new Map<string, MemoryEvidenceRef>();
  for (const value of Array.isArray(old.evidenceRefs) ? old.evidenceRefs : []) {
    const ref = contextObject(value);
    if (typeof ref.id === "string" && typeof ref.messageId === "string" && typeof ref.quote === "string") {
      evidence.set(ref.id, { id: ref.id, messageId: contextText(ref.messageId, 128), quote: safeContextText(ref.quote, 1_000), role: contextText(ref.role, 20) });
    }
  }
  const memory: SemanticDialogMemory = {
    version: "dialog-semantic-memory/1", goalEvolution: [], rejectedUnderstandings: [], decisions: [], openQuestions: [], evidenceRefs: [],
    omittedEntryCount: typeof old.omittedEntryCount === "number" ? old.omittedEntryCount : 0, method: "source_labeled_sentences",
  };
  for (const key of fields) {
    memory[key] = (Array.isArray(old[key]) ? old[key] : []).flatMap((value) => {
      const item = contextObject(value);
      const refs = stringIds(item.evidenceRefIds).filter((id) => evidence.has(id));
      return typeof item.id === "string" && typeof item.text === "string" && refs.length ? [{ id: item.id, text: safeContextText(item.text, 1_000), evidenceRefIds: refs }] : [];
    });
  }
  for (const message of messages) {
    if (message.role.toLowerCase() !== "user") continue;
    // Scan the whole source so corrections at the end are not lost by excerpt truncation.
    const sentences = (message.content.match(/[^。！？.!?\n]+[。！？.!?]?/gu) ?? []).flatMap((sentence) => {
      if (sentence.length <= 1_000) return [sentence];
      const windows: string[] = [];
      for (let offset = 0; offset < sentence.length; offset += 720) windows.push(sentence.slice(offset, offset + 800));
      return windows;
    });
    for (const raw of sentences) {
      const quote = raw.trim();
      if (!quote) continue;
      const keys: (typeof fields)[number][] = [];
      if (/(?:目标|需求|设计方向|最初想|改为|改成|objective|goal|brief)/iu.test(quote)) keys.push("goalEvolution");
      if (/(?:不对|理解错|误解|不要再|不是这个意思|纠正|否定|incorrect|misunderstand|do not assume)/iu.test(quote)) keys.push("rejectedUnderstandings");
      if (/(?:采用|否决|拒绝|选(?:择|用)|保留|放弃|跳过|接受|确认|accept|reject|keep|choose|skip)/iu.test(quote)) keys.push("decisions");
      if (/[？?]$/u.test(quote) || /(?:为什么|如何|能否|是否|待确认|不确定|尚不清楚|unknown|unresolved|why|how)/iu.test(quote)) keys.push("openQuestions");
      if (!keys.length) continue;
      const text = safeContextText(quote, 1_000);
      if (text !== contextText(quote, 1_000)) { memory.omittedEntryCount += 1; continue; }
      const refId = `msg_${digest(`${message.id}\0${text}`)}`;
      evidence.set(refId, { id: refId, messageId: message.id, quote: text, role: "user" });
      for (const key of keys) {
        const id = `${key}_${digest(`${message.id}\0${text}`)}`;
        if (!memory[key].some((item) => item.id === id)) memory[key].push({ id, text, evidenceRefIds: [refId] });
      }
    }
  }
  let used = 0;
  // Corrections have priority; each category retains recent evidence, with the first goal kept.
  for (const key of ["rejectedUnderstandings", "goalEvolution", "decisions", "openQuestions"] as const) {
    const items = memory[key];
    const first = items[0];
    const ordered = key === "goalEvolution" && first ? [first, ...items.slice(1).reverse()] : [...items].reverse();
    const kept = new Set<string>();
    for (const entry of ordered) {
      const cost = entry.text.length * 2 + 200;
      if (used + cost > 18_000 || kept.size >= 32) { memory.omittedEntryCount += 1; continue; }
      used += cost; kept.add(entry.id);
    }
    memory[key] = items.filter((entry) => kept.has(entry.id));
  }
  const needed = new Set(fields.flatMap((key) => memory[key].flatMap((item) => item.evidenceRefIds)));
  memory.evidenceRefs = [...evidence.values()].filter((ref) => needed.has(ref.id));
  return memory;
}
