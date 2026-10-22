// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PaintingLoader from "./PaintingLoader";

let reduced = false;
let onMotion: (() => void) | undefined;
const visibility = new Map<
  Element,
  (entries: Partial<IntersectionObserverEntry>[]) => void
>();

beforeEach(() => {
  reduced = false;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_event: string, listener: () => void) => {
      onMotion = listener;
    },
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private callback: (
          entries: Partial<IntersectionObserverEntry>[],
        ) => void,
      ) {}
      observe(element: Element) {
        visibility.set(element, this.callback);
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {
        for (const [element, callback] of visibility)
          if (callback === this.callback) visibility.delete(element);
      }
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  visibility.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("allows only one visible painting to own video playback", () => {
  const view = render(
    <>
      <PaintingLoader painting="dusk" />
      <PaintingLoader painting="willow" />
    </>,
  );
  expect(view.container.querySelectorAll("video")).toHaveLength(1);
  expect(
    view.container.querySelector("video source")?.getAttribute("src"),
  ).toContain("willow");
  fireEvent.click(screen.getByRole("button", { name: "暂停动画" }));
  expect(screen.getByRole("button", { name: "播放动画" })).toBeTruthy();
  const host = view.container.children[1];
  if (!host) throw new Error("Missing second painting");
  act(() => visibility.get(host)?.([{ isIntersecting: false }]));
  expect(view.container.querySelectorAll("video")).toHaveLength(1);
  expect(
    view.container.querySelector("video source")?.getAttribute("src"),
  ).toContain("dusk");
});

it("uses a static poster for reduced motion, visibility changes, and media failure", () => {
  reduced = true;
  const view = render(<PaintingLoader painting="irises" />);
  expect(view.container.querySelector("video")).toBeNull();
  act(() => {
    reduced = false;
    onMotion?.();
  });
  const video = view.container.querySelector("video");
  if (!video) throw new Error("Missing playing video");
  fireEvent.error(video);
  expect(view.container.querySelector("video")).toBeNull();
  expect(view.container.querySelector("img")?.getAttribute("src")).toContain(
    "irises.webp",
  );
});

it("keeps paused artwork when an in-flight play promise is intentionally aborted", async () => {
  let rejectPlay: ((error: Error) => void) | undefined;
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectPlay = reject;
      }),
  );
  const view = render(<PaintingLoader painting="dusk" />);
  fireEvent.click(screen.getByRole("button", { name: "暂停动画" }));
  await act(async () => {
    rejectPlay?.(new DOMException("play interrupted by pause", "AbortError"));
  });
  expect(view.container.querySelector("video")).not.toBeNull();
  expect(screen.getByRole("button", { name: "播放动画" })).toBeTruthy();
  view.unmount();
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
});

it("releases the video while the document is hidden", () => {
  const state = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  const view = render(<PaintingLoader painting="dusk" />);
  expect(view.container.querySelector("video")).not.toBeNull();
  act(() => {
    state.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(view.container.querySelector("video")).toBeNull();
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
});
