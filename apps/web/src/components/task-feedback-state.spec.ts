import { describe, expect, it } from "vitest";
import { taskState } from "./task-feedback-state";
import { userFacingError } from "./user-facing-error";

describe("task feedback", () => {
  it("only treats explicit success states as complete", () => {
    for (const status of ["completed", "succeeded", "SUCCEEDED"]) {
      expect(taskState(status).state).toBe("complete");
    }
    for (const status of ["pending", "queued", "running", "unrecognized", ""]) {
      expect(taskState(status).state).not.toBe("complete");
    }
    expect(taskState("unrecognized").label).toBe("正在确认状态");
    expect(taskState("pending").label).toBe("处理中");
  });
  it("preserves actionable business errors but hides runtime internals", () => {
    expect(
      userFacingError(new Error("额度不足，请减少方案数量"), "加载失败"),
    ).toBe("额度不足，请减少方案数量");
    expect(
      userFacingError(
        new TypeError("Cannot read properties of undefined (reading '6')"),
        "趋势暂时无法加载，请重试",
      ),
    ).toBe("趋势暂时无法加载，请重试");
    expect(userFacingError("SQL SELECT * FROM user", "操作失败")).toBe(
      "操作失败",
    );
  });
});
