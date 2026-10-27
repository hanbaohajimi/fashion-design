// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyImageLinkButton } from "./CopyImageLinkButton";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("copy receipt", () => {
  it("starts 2500ms after success, restarts on success and ignores changed targets", async () => {
    vi.useFakeTimers();
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const { rerender } = render(<CopyImageLinkButton value="first" onError={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    act(() => vi.advanceTimersByTime(2499));
    expect(screen.getByRole("button").getAttribute("data-copied")).toBe("true");
    await act(async () => fireEvent.click(screen.getByRole("button")));
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("button").getAttribute("data-copied")).toBe("true");
    act(() => vi.advanceTimersByTime(2499));
    expect(screen.getByRole("button").getAttribute("data-copied")).toBe("false");
    let finish: () => void = () => undefined;
    copy.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button"));
    rerender(<CopyImageLinkButton value="second" onError={vi.fn()} />);
    await act(async () => finish());
    expect(screen.getByRole("button").getAttribute("data-copied")).toBe("false");
  });
});
