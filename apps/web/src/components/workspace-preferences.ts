export function workspacePreferenceKey(accountId: string, projectId: string) {
  return `fashion:workspace-split:${accountId}:${projectId}`;
}

export function readWorkspacePreference(key: string): { width: number; open?: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as { width?: unknown; open?: unknown } | null;
    return {
      width: typeof value?.width === "number" && Number.isFinite(value.width) ? Math.max(320, Math.min(480, value.width)) : 384,
      ...(typeof value?.open === "boolean" ? { open: value.open } : {}),
    };
  } catch { return { width: 384 }; }
}

export function saveWorkspacePreference(key: string, value: { width?: number; open?: boolean }) {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({ ...readWorkspacePreference(key), ...value })); } catch { /* Layout remains usable without storage. */ }
}
