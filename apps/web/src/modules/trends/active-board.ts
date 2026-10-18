export const ACTIVE_BOARD_STORAGE_KEY = "fashion.active-board-id";
export const PROJECT_LIBRARY_TRENDS_PATH = "/trends?from=projects";

export interface TrendReturnTarget {
  readonly href: string;
  readonly label: "← 返回画布" | "← 返回项目库";
}

export interface BrowserStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function defaultStorage(): BrowserStorage | undefined {
  if (typeof window === "undefined" || !activeUserId) return undefined;
  const storage = window.localStorage;
  const key = `${ACTIVE_BOARD_STORAGE_KEY}:${activeUserId}`;
  return {
    getItem: () => storage.getItem(key),
    setItem: (_key, value) => storage.setItem(key, value),
    removeItem: () => storage.removeItem(key),
  };
}

let activeUserId: string | null = null;
export function setActiveBoardUser(userId: string | null): void {
  activeUserId = userId;
}

export function readActiveBoardId(
  storage: BrowserStorage | undefined = defaultStorage(),
): string | null {
  const value = storage?.getItem(ACTIVE_BOARD_STORAGE_KEY)?.trim();
  return value || null;
}

export function activeBoardPath(
  storage: BrowserStorage | undefined = defaultStorage(),
): string {
  const boardId = readActiveBoardId(storage);
  return boardId ? `/${encodeURIComponent(boardId)}` : "/";
}

export function boardTrendsPath(boardId: string): string {
  const value = boardId.trim();
  return value
    ? `/trends?from=board&boardId=${encodeURIComponent(value)}`
    : PROJECT_LIBRARY_TRENDS_PATH;
}

export function resolveTrendReturnTarget(
  source: string | undefined,
  boardId: string | undefined,
): TrendReturnTarget {
  const value = boardId?.trim();
  if (source === "board" && value) {
    return {
      href: `/${encodeURIComponent(value)}`,
      label: "← 返回画布",
    };
  }

  return {
    href: "/",
    label: "← 返回项目库",
  };
}

export function writeActiveBoardId(
  boardId: string,
  storage: BrowserStorage | undefined = defaultStorage(),
): void {
  const value = boardId.trim();
  if (value) storage?.setItem(ACTIVE_BOARD_STORAGE_KEY, value);
}

export function clearActiveBoardId(
  storage: BrowserStorage | undefined = defaultStorage(),
): void {
  storage?.removeItem(ACTIVE_BOARD_STORAGE_KEY);
}
