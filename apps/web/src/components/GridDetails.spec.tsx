// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridDetails } from "./GridDetails";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Grid disclosure", () => {
  it("retains drafts, returns focus and interrupts closing", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container } = render(<GridDetails open><summary>高级参数</summary><input aria-label="说明" defaultValue="草稿" /></GridDetails>);
    const input = screen.getByRole("textbox"); input.focus();
    fireEvent.click(screen.getByText("高级参数"));
    expect(document.activeElement?.tagName).toBe("SUMMARY");
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("[inert]")).toBeTruthy();
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByText("高级参数"));
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector("details")?.open).toBe(true);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("草稿");
    fireEvent.click(screen.getByText("高级参数"));
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector("details")?.open).toBe(false);
  });
});
