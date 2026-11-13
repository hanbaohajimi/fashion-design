import { describe, expect, it } from "vitest";

import { clearProjectIntake, peekProjectIntake, readProjectIntake, writeProjectIntake, type ProjectIntakeStorage } from "./project-intake";

function storage(): ProjectIntakeStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("project intake handoff", () => {
  it("hands a brief to the first canvas load and consumes it once", () => {
    const store = storage();
    writeProjectIntake(store, "project-1", "  先确认廓形，再看面料。  ");

    expect(readProjectIntake(store, "project-1")).toBe("先确认廓形，再看面料。");
    expect(readProjectIntake(store, "project-1")).toBeNull();
  });

  it("can keep a brief during a failed first load", () => {
    const store = storage();
    writeProjectIntake(store, "project-3", "先保留品牌色");

    expect(peekProjectIntake(store, "project-3")).toBe("先保留品牌色");
    expect(peekProjectIntake(store, "project-3")).toBe("先保留品牌色");
    clearProjectIntake(store, "project-3");
    expect(peekProjectIntake(store, "project-3")).toBeNull();
  });

  it("ignores malformed intake records without leaving stale drafts", () => {
    const store = storage();
    store.setItem("fashion:project-intake:project-2", "not-json");

    expect(readProjectIntake(store, "project-2")).toBeNull();
    expect(readProjectIntake(store, "project-2")).toBeNull();
  });
});
