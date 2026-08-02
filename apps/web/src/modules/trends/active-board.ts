export const ACTIVE_BOARD_STORAGE_KEY = "fashion.active-board-id";

export interface BrowserStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function defaultStorage(): BrowserStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function readActiveBoardId(
  storage: BrowserStorage | undefined = defaultStorage(),
): string | null {
  const value = storage?.getItem(ACTIVE_BOARD_STORAGE_KEY)?.trim();
  return value || null;
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
