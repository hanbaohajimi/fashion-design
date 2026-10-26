// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { PresentationOrder } from "./PresentationOrder";
import { restorePresentationItems, usePresentationUndo } from "./use-presentation-undo";
import { useStudioForm } from "./use-studio-form";
import { useSubmitFeedback, type SubmitFeedbackController } from "../../components/interactions/use-submit-feedback";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const items = [
  { assetId: "a", kind: "front", label: "正面说明", reviewed: true },
  { assetId: "b", kind: "back", label: "背面说明", reviewed: true },
  { assetId: "c", kind: "detail", label: "细节说明", reviewed: false },
] satisfies { assetId: string; kind: string; label: string; reviewed: boolean }[];
it("keyboard reorder commits once, while Escape restores the original order", () => {
  const changed = vi.fn();
  render(<PresentationOrder ids={items.map((item) => item.assetId)} assets={[]} assetName={(id) => id} disabled={false} currentId="a" onSelect={vi.fn()} onReorder={changed} />);
  const handle = screen.getByRole("button", { name: "调整a顺序" });
  fireEvent.keyDown(handle, { key: " " }); fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(changed).not.toHaveBeenCalled();
  fireEvent.keyDown(handle, { key: "Escape" }); expect(changed).not.toHaveBeenCalled();
  fireEvent.keyDown(handle, { key: " " }); fireEvent.keyDown(handle, { key: "ArrowRight" }); fireEvent.keyDown(handle, { key: " " });
  expect(changed).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"]);
});
it("undo restores a removal batch in source order and never overwrites a re-added edit", () => {
  const [first, second, third] = items;
  if (!first || !second || !third) throw new Error("fixture incomplete");
  expect(restorePresentationItems([third], items, items.slice(0, 2))).toEqual(items);
  const edited = { ...first, label: "新的说明" };
  expect(restorePresentationItems([edited, third], items, items.slice(0, 2))).toEqual([edited, second, third]);
});
it("undo pauses its four-second lifetime while focused and expires after remaining time", async () => {
  vi.useFakeTimers();
  function Example() {
    const [selected, setSelected] = useState(items);
    const undo = usePresentationUndo(selected, setSelected);
    return <><button onClick={() => undo.remove("a")}>remove</button><button onFocus={undo.pause} onBlur={undo.resume} onClick={undo.restore}>restore</button><output>{undo.count}</output><p>{selected.map((item) => item.assetId).join(",")}</p></>;
  }
  render(<Example />); fireEvent.click(screen.getByText("remove"));
  await act(() => vi.advanceTimersByTimeAsync(1000)); fireEvent.focus(screen.getByText("restore"));
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(screen.getByRole("status").textContent).toBe("1");
  fireEvent.blur(screen.getByText("restore")); await act(() => vi.advanceTimersByTimeAsync(3001));
  expect(screen.getByRole("status").textContent).toBe("0"); expect(screen.getByText("b,c")).toBeTruthy();
});

function UndoVisibilityExample() {
  const [selected, setSelected] = useState(items);
  const undo = usePresentationUndo(selected, setSelected);
  return <><button onClick={() => undo.remove("a")}>remove a</button><button onClick={() => undo.remove("b")}>remove b</button><button onMouseEnter={undo.pause} onMouseLeave={undo.resume}>hover</button><output>{undo.count}</output><span data-testid="remaining">{undo.remaining}</span><span data-testid="paused">{String(undo.paused)}</span></>;
}

it("hidden time never consumes or resets the remaining undo lifetime", async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  render(<UndoVisibilityExample />); fireEvent.click(screen.getByText("remove a"));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  visibility.mockReturnValue("hidden"); fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByTestId("remaining").textContent).toBe("3000");
  await act(() => vi.advanceTimersByTimeAsync(7000));
  expect(screen.getByRole("status").textContent).toBe("1");
  visibility.mockReturnValue("visible"); fireEvent(document, new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(2999)); expect(screen.getByRole("status").textContent).toBe("1");
  await act(() => vi.advanceTimersByTimeAsync(2)); expect(screen.getByRole("status").textContent).toBe("0");
});

it("visibility and interaction pauses are independent in either release order", async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  render(<UndoVisibilityExample />); fireEvent.click(screen.getByText("remove a"));
  await act(() => vi.advanceTimersByTimeAsync(1000)); fireEvent.mouseEnter(screen.getByText("hover"));
  visibility.mockReturnValue("hidden"); fireEvent(document, new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(5000));
  visibility.mockReturnValue("visible"); fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByTestId("paused").textContent).toBe("true");
  await act(() => vi.advanceTimersByTimeAsync(5000)); expect(screen.getByRole("status").textContent).toBe("1");
  visibility.mockReturnValue("hidden"); fireEvent(document, new Event("visibilitychange"));
  fireEvent.mouseLeave(screen.getByText("hover"));
  expect(screen.getByTestId("paused").textContent).toBe("true");
  await act(() => vi.advanceTimersByTimeAsync(5000));
  visibility.mockReturnValue("visible"); fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByTestId("remaining").textContent).toBe("3000");
  await act(() => vi.advanceTimersByTimeAsync(3001)); expect(screen.getByRole("status").textContent).toBe("0");
});

it.each([false, true])("a new removal gets four full seconds even when hidden=%s", async (isHidden) => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  render(<UndoVisibilityExample />); fireEvent.click(screen.getByText("remove a"));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  if (isHidden) { visibility.mockReturnValue("hidden"); fireEvent(document, new Event("visibilitychange")); }
  fireEvent.click(screen.getByText("remove b"));
  expect(screen.getByTestId("remaining").textContent).toBe("4000");
  if (isHidden) { await act(() => vi.advanceTimersByTimeAsync(6000)); visibility.mockReturnValue("visible"); fireEvent(document, new Event("visibilitychange")); }
  await act(() => vi.advanceTimersByTimeAsync(3999)); expect(screen.getByRole("status").textContent).toBe("2");
  await act(() => vi.advanceTimersByTimeAsync(2)); expect(screen.getByRole("status").textContent).toBe("0");
});
it("a save receipt survives revision remount, but a new edit clears it", async () => {
  const dirty = vi.fn(); const write = vi.fn(async () => ({}));
  function Editor({ feedback, saved }: { feedback: SubmitFeedbackController; saved: () => void }) {
    const form = useStudioForm({ name: "原值" }, dirty, { feedback, notifySaved: false });
    return <><input aria-label="name" value={form.draft.name} onChange={(event) => form.setDraft({ name: event.target.value })} /><button onClick={async () => { if (await form.submit(write)) saved(); }}>save</button><output>{feedback.snapshot.phase}</output></>;
  }
  function Parent() { const feedback = useSubmitFeedback(); const [revision, setRevision] = useState(1); return <Editor key={revision} feedback={feedback} saved={() => setRevision((value) => value + 1)} />; }
  render(<Parent />); await act(async () => fireEvent.click(screen.getByText("save")));
  expect(write).toHaveBeenCalledTimes(1); expect(screen.getByRole("status").textContent).toBe("success");
  fireEvent.change(screen.getByLabelText("name"), { target: { value: "新输入" } }); expect(screen.getByRole("status").textContent).toBe("idle");
});
