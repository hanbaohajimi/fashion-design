// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSerialPolling } from "./use-serial-polling";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("does not overlap slow requests and aborts on unmount", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const task = vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => { signal.throwIfAborted(); finish = resolve; }));
  const hook = renderHook(() => useSerialPolling("project", true, 3000, task));
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(task).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); await Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(task).toHaveBeenCalledTimes(2);
  hook.unmount();
  expect(task.mock.calls[1]?.[0].aborted).toBe(true);
});

it("pauses hidden pages and synchronizes immediately when visible again", async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const task = vi.fn(async () => undefined);
  const hook = renderHook(() => useSerialPolling("project", true, 3000, task));
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(task).toHaveBeenCalledTimes(1);
  act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event("visibilitychange")); });
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(task).toHaveBeenCalledTimes(1);
  await act(async () => { hidden.mockReturnValue(false); document.dispatchEvent(new Event("visibilitychange")); });
  expect(task).toHaveBeenCalledTimes(2);
  hook.unmount();
});

it("backs off a broken connection but keeps retrying within thirty seconds", async () => {
  vi.useFakeTimers();
  const task = vi.fn(async () => { throw new Error("offline"); });
  const hook = renderHook(() => useSerialPolling("project", true, 3000, task));
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(hook.result.current.error).toBe("offline");
  await act(() => vi.advanceTimersByTimeAsync(2999));
  expect(task).toHaveBeenCalledTimes(1);
  for (const delay of [3000, 12000, 24000, 30000]) await act(() => vi.advanceTimersByTimeAsync(delay));
  expect(task).toHaveBeenCalledTimes(5);
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(task).toHaveBeenCalledTimes(6);
  hook.unmount();
});
