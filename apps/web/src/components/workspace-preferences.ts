import type { AssistantBounds, AssistantPresentation } from "./assistant-window-geometry";

export interface WorkspacePreference { width: number; open?: boolean; presentation?: AssistantPresentation; floatingBounds?: AssistantBounds }

export function workspacePreferenceKey(accountId: string, projectId: string) {
  return `fashion:workspace-split:${accountId}:${projectId}`;
}

export function readWorkspacePreference(key: string, options: { defaultWidth?: number; minWidth?: number; maxWidth?: number } = {}): WorkspacePreference {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as { width?: unknown; open?: unknown; presentation?: unknown; floatingBounds?: AssistantBounds } | null;
    const rect = value?.floatingBounds;
    return {
      width: typeof value?.width === "number" && Number.isFinite(value.width) ? Math.max(options.minWidth ?? 320, Math.min(options.maxWidth ?? 480, value.width)) : options.defaultWidth ?? 384,
      ...(typeof value?.open === "boolean" ? { open: value.open } : {}),
      ...(value?.presentation === "floating" || value?.presentation === "docked" ? { presentation: value.presentation } : {}),
      ...(rect && [rect.x, rect.y, rect.width, rect.height].every(item => typeof item === "number" && Number.isFinite(item)) && rect.width > 0 && rect.height > 0 ? { floatingBounds: rect } : {}),
    };
  } catch { return { width: options.defaultWidth ?? 384 }; }
}

export function saveWorkspacePreference(key: string, value: Partial<WorkspacePreference>, defaultWidth = 384) {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({ ...readWorkspacePreference(key, { maxWidth: 600, defaultWidth }), ...value })); } catch { /* Layout remains usable without storage. */ }
}
