type NamedNode = { readonly id: string; readonly title: string };

/** Shared by the composer preview and request builder. Selection alone is never a reference. */
export function resolveDraftReferences(nodes: readonly NamedNode[], prompt: string, selectedIds: readonly string[]) {
  const named: string[] = [];
  for (const mention of prompt.matchAll(/(?:^|\s)@/gu)) {
    const suffix = prompt.slice((mention.index ?? 0) + mention[0].lastIndexOf("@") + 1);
    const matches = nodes.filter((node) => node.title && suffix.startsWith(node.title) && (!suffix[node.title.length] || /[\s，。！？,.;:!?）)]/u.test(suffix[node.title.length] ?? "")));
    const longest = Math.max(0, ...matches.map((node) => node.title.length));
    const exact = matches.filter((node) => node.title.length === longest);
    if (exact.length > 1 && !exact.some((node) => selectedIds.includes(node.id))) return { ids: selectedIds.filter((id) => nodes.some((node) => node.id === id)), error: `画布中有多个「${exact[0]?.title}」，请从 @列表选择准确节点` };
    if (exact.length === 1 && exact[0]) named.push(exact[0].id);
  }
  return { ids: [...new Set([...selectedIds, ...named])].filter((id) => nodes.some((node) => node.id === id)), error: null };
}

export function removeReferenceMentions(prompt: string, nodes: readonly NamedNode[], ids: readonly string[]) {
  const titles = new Set(nodes.filter((node) => ids.includes(node.id)).map((node) => node.title));
  const allTitles = [...new Set(nodes.map((node) => node.title).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!allTitles.length) return prompt;
  const alternatives = allTitles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return prompt.replace(new RegExp(`(^|\\s)@(${alternatives})(?=$|[\\s，。！？,.;:!?）)])`, "gu"), (full: string, prefix: string, title: string) => titles.has(title) ? prefix : full);
}
