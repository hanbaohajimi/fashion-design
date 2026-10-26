// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSearchQuery } from "./use-search-query";
import { useProjectNameValidation, validateProjectName } from "./project-name";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("300ms防抖、输入法提交前不查询，清空也只提交最终查询", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ value }) => useSearchQuery(value), { initialProps: { value: "" } });
  act(() => result.current.onCompositionStart());
  rerender({ value: "mian" });
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.query).toBe("");
  rerender({ value: "棉布" }); act(() => result.current.onCompositionEnd());
  act(() => vi.advanceTimersByTime(299)); expect(result.current.query).toBe("");
  act(() => vi.advanceTimersByTime(1)); expect(result.current.query).toBe("棉布");
  rerender({ value: "棉" }); act(() => vi.advanceTimersByTime(150));
  rerender({ value: "" }); act(() => vi.advanceTimersByTime(300));
  expect(result.current.query).toBe("");
});
it("名称400ms晚报错，合法后立即消错，IME不校验", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ value }) => useProjectNameValidation(value, true), { initialProps: { value: "" } });
  rerender({ value: "衣" });
  act(() => vi.advanceTimersByTime(399)); expect(result.current.error).toBeNull();
  act(() => vi.advanceTimersByTime(1)); expect(result.current.error).toContain("3–80");
  rerender({ value: "秋冬系列" }); expect(result.current.error).toBeNull();
  act(() => { result.current.reset(); result.current.onCompositionStart(); });
  rerender({ value: "冬" }); act(() => vi.advanceTimersByTime(500)); expect(result.current.error).toBeNull();
});
it("创建与重命名保持服务端UTF16字符边界", () => {
  expect(validateProjectName("衣" + "🧵".repeat(40))).toContain("特殊符号");
  expect(validateProjectName("衣衣" + "🧵".repeat(39))).toBeNull();
  expect(validateProjectName("  秋冬系列  ")).toBeNull();
});
