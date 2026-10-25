const arrivals = new Map<string, number>();
export function markResultArrival(id: string) {
  arrivals.set(id, Date.now());
  if (arrivals.size > 100) { const oldest = arrivals.keys().next().value; if (oldest) arrivals.delete(oldest); }
}
export function consumeResultArrival(id: string) {
  const at = arrivals.get(id);
  arrivals.delete(id);
  return at !== undefined && Date.now() - at < 10_000;
}
