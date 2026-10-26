// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RunwayMediaView } from "@fashion/shared";
import { MediaPreview } from "./RunwayRunPanel";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const media = { id: "video-1", kind: "video", mimeType: "video/mp4", contentUrl: "/test.mp4" } as RunwayMediaView;
it("shows a delayed buffering overlay only after a frame, then clears on pause without starting playback", async () => {
  vi.useFakeTimers(); render(<MediaPreview media={media} label="镜头" />);
  const video = screen.getByLabelText("镜头") as HTMLVideoElement;
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
  const play = vi.spyOn(video, "play");
  fireEvent.waiting(video); await act(() => vi.advanceTimersByTimeAsync(500)); expect(screen.queryByRole("status")).toBeNull();
  fireEvent.loadedData(video); fireEvent.waiting(video); await act(() => vi.advanceTimersByTimeAsync(249)); expect(screen.queryByRole("status")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1)); expect(screen.getByRole("status").textContent).toContain("保留当前画面");
  fireEvent.pause(video); expect(screen.queryByRole("status")).toBeNull(); expect(play).not.toHaveBeenCalled();
});
