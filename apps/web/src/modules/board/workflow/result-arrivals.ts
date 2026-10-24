const arrivals = new Set<string>();
export function markResultArrival(id: string) {
  arrivals.add(id);
  if (arrivals.size > 100) { const oldest = arrivals.values().next().value; if (oldest) arrivals.delete(oldest); }
}
export function consumeResultArrival(id: string) { return arrivals.delete(id); }
