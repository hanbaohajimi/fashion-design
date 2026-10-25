import { describe, expect, it, vi } from "vitest";
import { claimTaskMotion, markMotion, takeMotion } from "./events";

describe("motion receipts", () => {
  it("does not replay historical data and consumes success once", () => {
    expect(takeMotion("historical")).toBeUndefined();
    markMotion("created", "signature");
    expect(takeMotion("created")?.effect).toBe("signature");
    expect(takeMotion("created")).toBeUndefined();
  });
  it("expires abandoned navigation receipts", () => {
    vi.useFakeTimers();
    markMotion("abandoned", "seal");
    vi.advanceTimersByTime(10_001);
    expect(takeMotion("abandoned")).toBeUndefined();
    vi.useRealTimers();
  });
  it("shares transitions across task views and supports a new attempt", () => {
    expect(claimTaskMotion("task:shared", "ready", false)).toBeUndefined();
    markMotion("task:shared", "needle", "attempt:1");
    expect(claimTaskMotion("task:shared", "pending", true)?.effect).toBe(
      "needle",
    );
    expect(claimTaskMotion("task:shared", "pending", true)).toBeUndefined();
    expect(claimTaskMotion("task:shared", "running", true)?.effect).toBe(
      "thread",
    );
    expect(claimTaskMotion("task:shared", "failed", true)).toBeUndefined();
    markMotion("task:shared", "needle", "attempt:2");
    expect(claimTaskMotion("task:shared", "pending", true)?.eventKey).toBe(
      "attempt:2",
    );
  });
  it("never decorates a task that fails before the first frame", () => {
    markMotion("task:fast-failure", "needle");
    expect(
      claimTaskMotion("task:fast-failure", "failed", true),
    ).toBeUndefined();
  });
});
