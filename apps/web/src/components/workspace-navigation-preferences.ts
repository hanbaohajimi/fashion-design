export type WorkspaceNavigationKind = "creation" | "document";

const memory = new Map<string, boolean>();
const volatile = new Set<string>();
export const NAVIGATION_PREFERENCE_EVENT = "fashion:workspace-navigation-change";

export function navigationPreferenceKey(accountId: string, kind: WorkspaceNavigationKind) {
  return `fashion:workspace-navigation:${encodeURIComponent(accountId)}:${kind}`;
}

export function readNavigationPreference(accountId: string, kind: WorkspaceNavigationKind): boolean {
  const key = navigationPreferenceKey(accountId, kind);
  if (volatile.has(key)) return memory.get(key) ?? kind === "document";
  try {
    const saved = localStorage.getItem(key);
    if (saved === "true" || saved === "false") {
      memory.set(key, saved === "true");
      return saved === "true";
    }
    return kind === "document";
  } catch { return memory.get(key) ?? kind === "document"; }
}

export function saveNavigationPreference(accountId: string, kind: WorkspaceNavigationKind, open: boolean) {
  const key = navigationPreferenceKey(accountId, kind);
  memory.set(key, open);
  try { localStorage.setItem(key, String(open)); volatile.delete(key); }
  catch { volatile.add(key); }
  window.dispatchEvent(new Event(NAVIGATION_PREFERENCE_EVENT));
}
