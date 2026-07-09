/** Format an ISO date string to a short localised date like "7月 9日". */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
