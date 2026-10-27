import { expect, it } from "vitest";
import { createImeGuard } from "./assistant-ime";

it("组合输入和结束伴生Enter被拦截，后续正常发送不被连续吞键", () => {
  let now = 0;
  const guard = createImeGuard(() => now);
  guard.start(); expect(guard.blocks({ key: "Enter" })).toBe(true);
  guard.end(); now = 20; expect(guard.blocks({ key: "Enter" })).toBe(true);
  expect(guard.blocks({ key: "Enter" })).toBe(false);
  guard.end(); now = 600; expect(guard.blocks({ key: "Enter" })).toBe(false);
  guard.end(); expect(guard.blocks({ key: "a" })).toBe(false);
  expect(guard.blocks({ key: "Enter" })).toBe(false);
});
