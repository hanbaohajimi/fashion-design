import { describe, expect, it } from "vitest";

import {
  activeBoardPath,
  boardTrendsPath,
  clearActiveBoardId,
  PROJECT_LIBRARY_TRENDS_PATH,
  readActiveBoardId,
  resolveTrendReturnTarget,
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

  it("为项目库和当前画布生成带来源的趋势入口", () => {
    expect(PROJECT_LIBRARY_TRENDS_PATH).toBe("/trends?from=projects");
    expect(boardTrendsPath("project/a")).toBe(
      "/trends?from=board&boardId=project%2Fa",
    );
    expect(boardTrendsPath("   ")).toBe(PROJECT_LIBRARY_TRENDS_PATH);
  });

  it("仅在明确从画布进入且项目有效时返回该画布", () => {
    expect(resolveTrendReturnTarget("board", "project/a")).toEqual({
      href: "/project%2Fa",
      label: "← 返回画布",
    });
    expect(resolveTrendReturnTarget("projects", "project/a")).toEqual({
      href: "/",
      label: "← 返回项目库",
    });
    expect(resolveTrendReturnTarget("board", "   ")).toEqual({
      href: "/",
      label: "← 返回项目库",
    });
    expect(resolveTrendReturnTarget(undefined, undefined)).toEqual({
      href: "/",
      label: "← 返回项目库",
    });
  });
});
