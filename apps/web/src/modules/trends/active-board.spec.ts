import { describe, expect, it } from "vitest";

import {
  clearActiveBoardId,
  readActiveBoardId,
  writeActiveBoardId,
  type BrowserStorage,
} from "./active-board";

function createStorage(): BrowserStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("active board persistence", () => {
  it("持久化最近访问的白板，并忽略空值", () => {
    const storage = createStorage();

    writeActiveBoardId("project-a", storage);
    expect(readActiveBoardId(storage)).toBe("project-a");
    writeActiveBoardId("   ", storage);
    expect(readActiveBoardId(storage)).toBe("project-a");
    clearActiveBoardId(storage);
    expect(readActiveBoardId(storage)).toBeNull();
  });
});
