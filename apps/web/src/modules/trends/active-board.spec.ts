import { describe, expect, it } from "vitest";

import {
  activeBoardPath,
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

  it("为活动画布生成返回路径，无记录时回退项目库", () => {
    const storage = createStorage();

    expect(activeBoardPath(storage)).toBe("/");
    writeActiveBoardId("project/a", storage);
    expect(activeBoardPath(storage)).toBe("/project%2Fa");
  });
});
