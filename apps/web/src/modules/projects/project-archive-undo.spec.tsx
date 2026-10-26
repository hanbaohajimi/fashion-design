// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { ArchiveUndoNotice, useProjectArchiveUndo } from "./project-archive-undo";
import type { Project } from "./project-types";
const mocks = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
it("4秒窗口在悬停或焦点期间暂停，连续归档重新计时", () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  const view = render(<ArchiveUndoNotice count={1} phase="ready" revision={1} onUndo={vi.fn()} onDismiss={dismiss} />);
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.pointerEnter(screen.getByRole("status"));
  act(() => vi.advanceTimersByTime(5000)); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.pointerLeave(screen.getByRole("status"));
  act(() => vi.advanceTimersByTime(2000)); expect(dismiss).not.toHaveBeenCalled();
  view.rerender(<ArchiveUndoNotice count={2} phase="ready" revision={2} onUndo={vi.fn()} onDismiss={dismiss} />);
  act(() => vi.advanceTimersByTime(3999)); expect(dismiss).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(dismiss).toHaveBeenCalledTimes(1);
});
it("批次部分失败仅重试失败项目，撤销中新归档进入下一批", async () => {
  const project = (id: string) => ({ id, name: id, archived: true }) as Project;
  let finishA: () => void = () => {};
  let finishB: () => void = () => {};
  const restore = vi.fn((value: Project) => value.id === "a"
    ? new Promise<void>((done) => { finishA = done; })
    : new Promise<void>((_done, reject) => { finishB = () => reject(new Error("恢复失败")); }));
  const { result } = renderHook(() => useProjectArchiveUndo(restore));
  const latest = () => {
    const call = mocks.custom.mock.calls.at(-1)?.[0] as () => ReactElement<{ phase: string; count: number; onUndo: () => void }>;
    return call().props;
  };
  act(() => { result.current(project("a")); result.current(project("b")); });
  expect(latest().count).toBe(2);
  act(() => latest().onUndo());
  act(() => result.current(project("c")));
  await act(async () => { finishA(); finishB(); });
  expect(latest().phase).toBe("error"); expect(latest().count).toBe(1);
  restore.mockResolvedValue(undefined);
  await act(async () => latest().onUndo());
  expect(restore.mock.calls.map(([value]) => value.id)).toEqual(["a", "b", "b"]);
  expect(latest().phase).toBe("ready"); expect(latest().count).toBe(1);
});
