type NamedNode = { readonly id: string; readonly title: string };

export const MAX_ASSISTANT_REFERENCES = 16;
export type ReferenceInstances = Readonly<Record<string, readonly string[]>>;
export type CanvasReferenceSelection = { nodeIds: string[]; instances: ReferenceInstances };

export function retainReferenceInstances(instances: ReferenceInstances, ids: readonly string[]): ReferenceInstances {
  return Object.fromEntries(Object.entries(instances).filter(([id]) => ids.includes(id)));
}

export function resolveReferenceInstances(ids: readonly string[], instances: ReferenceInstances, bindings: ReadonlyMap<string, string>): CanvasReferenceSelection {
  const nextIds = new Set<string>();
  const nextInstances: Record<string, string[]> = {};
  for (const id of ids) {
    const shapes = instances[id];
    if (!shapes?.length) { nextIds.add(id); continue; }
    for (const shape of shapes) {
      const nextId = bindings.get(shape) ?? id;
      nextIds.add(nextId);
      nextInstances[nextId] = [...new Set([...(nextInstances[nextId] ?? []), shape])];
    }
  }
  return { nodeIds: [...nextIds], instances: nextInstances };
}

/** Explicit additions are atomic, ordered, and keep missing IDs for recovery. */
export function appendDraftReferences(
  nodes: readonly NamedNode[],
  prompt: string,
  selectedIds: readonly string[],
  incoming: readonly string[],
) {
  if (incoming.some((id) => !nodes.some((node) => node.id === id)))
    return { ids: selectedIds, error: "所选素材已变更或不可用，请重新选择后引用。" };
  const current = resolveDraftReferences(nodes, prompt, selectedIds);
  const combined = [...new Set([...selectedIds, ...current.ids, ...incoming])];
  // Choosing a namesake can resolve an earlier ambiguous @ mention; include
  // every now-resolved name when enforcing the limit.
  const ids = [...new Set([...combined, ...resolveDraftReferences(nodes, prompt, combined).ids])];
  if (ids.length > MAX_ASSISTANT_REFERENCES)
    return { ids: selectedIds, error: "合并后超过 16 项，原引用已保留。请减少所选素材或先移除部分引用。" };
  return { ids, error: null };
}

// Chinese prose can touch @ directly. Common email-local characters cannot start a mention.
const mentionStart = /(^|[^A-Za-z0-9_@.+%\-])@/gu;
const mentionEnd = /[\s，。！？、；：,.;:!?）)\]】」》”’}]/u;
const hasTitleBoundary = (suffix: string, title: string) =>
  suffix.startsWith(title) &&
  (!suffix[title.length] || mentionEnd.test(suffix.charAt(title.length)));

export interface DraftMention {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

/** Resolve the mention at a collapsed caret, not necessarily at the end of the draft. */
export function findDraftMention(
  prompt: string,
  selectionStart: number,
  selectionEnd: number,
  nodes: readonly NamedNode[],
): DraftMention | null {
  if (
    selectionStart !== selectionEnd ||
    selectionStart < 1 ||
    selectionStart > prompt.length
  )
    return null;
  const beforeCaret = prompt.slice(0, selectionStart);
  const match = [...beforeCaret.matchAll(mentionStart)].at(-1);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  const query = prompt.slice(start + 1, selectionStart);
  if (/[@\r\n]/u.test(query)) return null;
  const titles = nodes.map((node) => node.title).filter(Boolean);
  const normalized = query.toLocaleLowerCase();
  const matchesTitle = titles.some((title) =>
    title.toLocaleLowerCase().includes(normalized),
  );
  // Once a known title has been followed by prose, stop treating it as an active query.
  if (
    !matchesTitle &&
    titles.some(
      (title) => query.length > title.length && hasTitleBoundary(query, title),
    )
  )
    return null;
  if (/[，。！？、；：,.;:!?\t]/u.test(query) && !matchesTitle) return null;
  if (/\s$/u.test(query)) return null;

  const suffix = prompt.slice(start + 1);
  const existingTitle = titles
    .filter(
      (title) =>
        hasTitleBoundary(suffix, title) &&
        selectionStart <= start + 1 + title.length,
    )
    .sort((a, b) => b.length - a.length)[0];
  const tail =
    prompt
      .slice(selectionStart)
      .match(/^[^@\s，。！？、；：,.;:!?）)\]】」》”’}]*/u)?.[0] ?? "";
  return {
    start,
    end: existingTitle
      ? start + 1 + existingTitle.length
      : selectionStart + tail.length,
    query,
  };
}

export function insertDraftMention(
  prompt: string,
  mention: DraftMention,
  title: string,
) {
  const suffix = prompt.slice(mention.end);
  const separator = !suffix || !mentionEnd.test(suffix.charAt(0)) ? " " : "";
  const inserted = `@${title}${separator}`;
  return {
    value: prompt.slice(0, mention.start) + inserted + suffix,
    caret: mention.start + inserted.length,
  };
}

/** Shared by the composer preview and request builder. Selection alone is never a reference. */
export function resolveDraftReferences(
  nodes: readonly NamedNode[],
  prompt: string,
  selectedIds: readonly string[],
) {
  const named: string[] = [];
  for (const mention of prompt.matchAll(mentionStart)) {
    const suffix = prompt.slice(
      (mention.index ?? 0) + mention[0].lastIndexOf("@") + 1,
    );
    const matches = nodes.filter(
      (node) => node.title && hasTitleBoundary(suffix, node.title),
    );
    const longest = Math.max(0, ...matches.map((node) => node.title.length));
    const exact = matches.filter((node) => node.title.length === longest);
    if (
      exact.length > 1 &&
      !exact.some((node) => selectedIds.includes(node.id))
    )
      return {
        ids: selectedIds.filter((id) => nodes.some((node) => node.id === id)),
        error: `画布中有多个「${exact[0]?.title}」，请从 @列表选择准确节点`,
      };
    if (exact.length === 1 && exact[0]) named.push(exact[0].id);
  }
  return {
    ids: [...new Set([...selectedIds, ...named])].filter((id) =>
      nodes.some((node) => node.id === id),
    ),
    error: null,
  };
}

export function removeReferenceMentions(
  prompt: string,
  nodes: readonly NamedNode[],
  ids: readonly string[],
) {
  const titles = new Set(
    nodes.filter((node) => ids.includes(node.id)).map((node) => node.title),
  );
  const allTitles = [
    ...new Set(nodes.map((node) => node.title).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  if (!allTitles.length) return prompt;
  const alternatives = allTitles
    .map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return prompt.replace(
    new RegExp(
      `(${mentionStart.source})(${alternatives})(?=$|${mentionEnd.source})`,
      "gu",
    ),
    (full: string, _start: string, prefix: string, title: string) =>
      titles.has(title) ? prefix : full,
  );
}
