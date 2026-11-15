// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskFeedback } from "./TaskFeedback";

vi.mock("./RefineFrame", async (original) => ({
  ...await original<typeof import("./RefineFrame")>(),
  RefineFrame: ({ animate }: { animate?: boolean }) => <div data-testid="refine-frame" data-animate={Boolean(animate)} />,
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
  expect(screen.queryByTestId("refine-frame")).toBeNull();
  view.rerender(<TaskFeedback taskId="first" status="succeeded" />);
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByTestId("refine-frame")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("已完成");
});

it("resets media when changing task identity and excludes text analysis", () => {
  vi.useFakeTimers();
  const view = render(<TaskFeedback taskId="first" status="queued" visual />);
  expect(screen.getByTestId("refine-frame").getAttribute("data-animate")).toBe("false");
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByTestId("refine-frame").getAttribute("data-animate")).toBe("true");
  view.rerender(<TaskFeedback taskId="second" status="running" visual />);
  expect(screen.getByTestId("refine-frame").getAttribute("data-animate")).toBe("false");
  view.rerender(
    <TaskFeedback taskId="analysis" status="running" operation="analysis" visual />,
  );
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.queryByTestId("refine-frame")).toBeNull();
});

it("does not turn a stale task into a failure or invent progress", () => {
  vi.useFakeTimers();
  render(<TaskFeedback taskId="stale" status="running" visual={false} />);
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByText(/暂未收到新状态/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("处理中");
  expect(screen.queryByRole("progressbar")).toBeNull();
});
