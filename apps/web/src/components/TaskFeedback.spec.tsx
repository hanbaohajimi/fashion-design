// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskFeedback } from "./TaskFeedback";

vi.mock("next/dynamic", () => ({
  default: () =>
    function Painting() {
      return <div data-testid="painting" />;
    },
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("delays artwork and never flashes it after a fast completion", () => {
  vi.useFakeTimers();
  const view = render(<TaskFeedback taskId="first" status="running" />);
  expect(screen.getByRole("status").textContent).toContain("处理中");
  act(() => vi.advanceTimersByTime(300));
  expect(screen.getByRole("status").textContent).toContain("处理中");
  act(() => vi.advanceTimersByTime(1600));
  expect(screen.queryByTestId("painting")).toBeNull();
  view.rerender(<TaskFeedback taskId="first" status="succeeded" />);
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByTestId("painting")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("已完成");
});

it("resets media when changing task identity and excludes text analysis", () => {
  vi.useFakeTimers();
  const view = render(<TaskFeedback taskId="first" status="queued" painting />);
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByTestId("painting")).not.toBeNull();
  view.rerender(<TaskFeedback taskId="second" status="running" painting />);
  expect(screen.queryByTestId("painting")).toBeNull();
  view.rerender(
    <TaskFeedback taskId="analysis" status="running" operation="analysis" />,
  );
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.queryByTestId("painting")).toBeNull();
});

it("does not turn a stale task into a failure or invent progress", () => {
  vi.useFakeTimers();
  render(<TaskFeedback taskId="stale" status="running" painting={false} />);
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByText(/暂未收到新状态/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("处理中");
  expect(screen.queryByRole("progressbar")).toBeNull();
});
