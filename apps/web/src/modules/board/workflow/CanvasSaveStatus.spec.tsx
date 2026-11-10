// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CanvasSaveStatus } from "./CanvasSaveStatus";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it("成功与快速保存安静完成，慢保存延迟一秒出现，异常立即出现", () => {
  vi.useFakeTimers();
  const view = render(<CanvasSaveStatus label="已保存" />);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<CanvasSaveStatus label="保存中…" />);
  act(() => { vi.advanceTimersByTime(999); });
  expect(screen.queryByRole("status")).toBeNull();
  act(() => { vi.advanceTimersByTime(1); });
  expect(screen.getByRole("status").textContent).toBe("保存中…");
  view.rerender(<CanvasSaveStatus label="已保存" />);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<CanvasSaveStatus label="保存未完成"><button>重试保存</button></CanvasSaveStatus>);
  expect(screen.getByRole("button", { name: "重试保存" })).toBeTruthy();
});
