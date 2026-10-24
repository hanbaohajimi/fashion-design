export interface CreativeVisit { projectId: string; path: string; visitedAt: string }
const key = (userId: string) => `fashion:creative-visit:${userId}`;
export function readCreativeVisit(userId: string): CreativeVisit | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(userId)) ?? "null") as CreativeVisit | null;
    if (!value || typeof value.projectId !== "string" || !/^[a-zA-Z0-9-]+$/u.test(value.projectId) ||
      !["/" + value.projectId, "/" + value.projectId + "/studio"].some(path => value.path === path || value.path.startsWith(path + "?")) ||
      !Number.isFinite(Date.parse(value.visitedAt))) return null;
    return value;
  } catch { return null; }
}
export function rememberCreativeVisit(userId: string, projectId: string, path: string) {
  try { localStorage.setItem(key(userId), JSON.stringify({ projectId, path, visitedAt: new Date().toISOString() })); }
  catch { /* Browsing remains available when storage is disabled. */ }
}
