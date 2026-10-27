// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamingReply, useAssistantStream } from "./StreamingReply";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const draft = { text: "甲👩🏽‍🎨乙", animate: true, pending: true, attemptId: "first" };
describe("流式字素呈现", () => {
  it("keeps historical stream data stable while unrelated composer state rerenders", () => {
    const { result, rerender } = renderHook(({ id }) => useAssistantStream(id), { initialProps: { id: "" } });
    rerender({ id: "history" });
    const historicalDrafts = result.current.drafts;
    for (let index = 0; index < 10; index++) rerender({ id: "history" });
    expect(result.current.drafts).toBe(historicalDrafts);
    expect(Object.keys(result.current.drafts)).toEqual([]);
  });
  it("does not synthesize typing when no real text delta arrived", () => {
    const { result } = renderHook(() => useAssistantStream("conversation"));
    const message = { id: "reply", role: "assistant" as const, status: "completed" as const, content: "完整回复", context: null, clientRequestId: null, replyToId: "user", generationTaskId: null, error: null, createdAt: "", updatedAt: "" };
    const turn = { userMessage: { ...message, id: "user", role: "user" as const }, assistantMessage: message };
    const common = { messageId: "reply", attemptId: "first" };
    act(() => result.current.receive({ ...common, eventId: "1-0", type: "accepted", turn }));
    act(() => result.current.receive({ ...common, eventId: "2-0", type: "message.completed", turn }));
    expect(result.current.drafts.reply?.animate).toBe(false);
  });
  it("cancels the old conversation while preserving a newly created conversation request", () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useAssistantStream(id), { initialProps: { id: "first" } });
    const first = result.current.signalFor("first");
    rerender({ id: "second" }); expect(first.aborted).toBe(true);
    const second = result.current.signalFor("second");
    const prepared = result.current.signalFor("third"); expect(second.aborted).toBe(true);
    rerender({ id: "third" }); expect(prepared.aborted).toBe(false);
    unmount(); expect(prepared.aborted).toBe(true);
  });
  it("reveals one complete grapheme every 30ms without restarting on new chunks", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container, rerender } = render(<StreamingReply content="" draft={draft} />);
    act(() => vi.advanceTimersByTime(29));
    expect(container.firstElementChild?.textContent).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(container.firstElementChild?.textContent).toBe("甲");
    act(() => vi.advanceTimersByTime(10));
    rerender(<StreamingReply content="" draft={{ ...draft, text: draft.text + "丙" }} />);
    act(() => vi.advanceTimersByTime(20));
    expect(container.firstElementChild?.textContent).toBe("甲👩🏽‍🎨");
    act(() => vi.advanceTimersByTime(60));
    expect(container.firstElementChild?.textContent).toBe("甲👩🏽‍🎨乙丙");
    rerender(<StreamingReply content="" draft={{ ...draft, text: draft.text + "丙", pending: false }} />);
    act(() => vi.advanceTimersByTime(120));
    expect(container.querySelectorAll('[class*="character"]').length).toBe(0);
  });
  it("skips the queue and keeps future chunks immediate without another request", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container, getByRole, rerender } = render(<StreamingReply content="" draft={draft} />);
    fireEvent.click(getByRole("button", { name: "立即显示已收到内容" }));
    expect(container.firstElementChild?.textContent).toBe(draft.text);
    rerender(<StreamingReply content="" draft={{ ...draft, text: draft.text + "完成" }} />);
    expect(container.firstElementChild?.textContent).toBe(draft.text + "完成");
  });
  it("renders historical Markdown normally and respects reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container } = render(<StreamingReply content="" draft={{ ...draft, text: "**亚麻**\n\n- 廓形\n- 结构" }} />);
    expect(container.querySelector("strong")?.textContent).toBe("亚麻");
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelectorAll('[class*="character"]').length).toBe(0);
  });
});
