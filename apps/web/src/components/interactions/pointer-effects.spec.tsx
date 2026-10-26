// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRef, Profiler } from "react";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "../ui";
import { useMagnetic, usePointerSpotlight } from "./pointer-effects";

const media = new Map<
  string,
  { matches: boolean; listeners: Set<() => void> }
>();
const frames = new Map<number, FrameRequestCallback>();
let sequence = 0;
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("测试对象不存在");
  return value;
}

beforeEach(() => {
  media.clear();
  frames.clear();
  vi.stubGlobal("matchMedia", (query: string) => {
    if (!media.has(query))
      media.set(query, {
        matches: query.includes("pointer: fine"),
        listeners: new Set(),
      });
    const state = required(media.get(query));
    return {
      get matches() {
        return state.matches;
      },
      addEventListener: (_: string, listener: () => void) =>
        state.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        state.listeners.delete(listener),
    };
  });
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      readonly isPrimary: boolean;
      constructor(type: string, options: PointerEventInit = {}) {
        super(type, options);
        this.pointerId = options.pointerId ?? 1;
        this.pointerType = options.pointerType ?? "mouse";
        this.isPrimary = options.isPrimary ?? true;
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function flushFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}
function setMedia(query: string, matches: boolean) {
  act(() => {
    const state = required(media.get(query));
    state.matches = matches;
    state.listeners.forEach((listener) => listener());
  });
}
function bounds(element: HTMLElement) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 50,
    width: 200,
    height: 50,
    toJSON() {},
  });
}

describe("explicit button interactions", () => {
  it.each(["none", "ripple", "magnetic"] as const)(
    "keeps %s button refs, caller events and external form submission",
    (interaction) => {
      const ref = createRef<HTMLButtonElement>();
      const click = vi.fn();
      const submit = vi.fn((event) => event.preventDefault());
      render(
        <>
          <form id="save" onSubmit={submit} />
          <Button
            interaction={interaction}
            ref={ref}
            type="submit"
            form="save"
            onClick={click}
          >
            保存
          </Button>
        </>,
      );
      const button = screen.getByRole("button", { name: "保存" });
      expect(ref.current).toBe(button);
      if (interaction === "none") expect(button.children).toHaveLength(0);
      fireEvent.click(button);
      expect(click).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledTimes(1);
    },
  );

  it("bounds ripples, removes canceled/finished decoration and never dispatches clicks", () => {
    const click = vi.fn();
    const { unmount } = render(
      <Button interaction="ripple" onClick={click}>
        创建
      </Button>,
    );
    const button = screen.getByRole("button");
    const layer = button.querySelector("[aria-hidden]") as HTMLElement;
    bounds(layer);
    for (let pointerId = 1; pointerId <= 3; pointerId++) {
      fireEvent.pointerDown(button, { pointerId, clientX: 20, clientY: 10 });
    }
    expect(layer.children).toHaveLength(2);
    expect(click).not.toHaveBeenCalled();
    fireEvent.pointerCancel(button, { pointerId: 3 });
    expect(layer.children).toHaveLength(1);
    fireEvent.animationEnd(required(layer.firstElementChild));
    expect(layer.children).toHaveLength(0);
    fireEvent.keyDown(button, { key: "Enter" });
    expect(layer.children).toHaveLength(0);
    fireEvent.pointerDown(button, { pointerType: "touch" });
    expect(layer.children).toHaveLength(1);
    unmount();
    expect(layer.children).toHaveLength(0);
  });

  it("honors prevention, loading, reduced motion and preference changes", () => {
    const click = vi.fn();
    const { rerender } = render(
      <Button
        interaction="ripple"
        onPointerDown={(event) => event.preventDefault()}
      >
        保存
      </Button>,
    );
    const button = screen.getByRole("button");
    const layer = required(button.querySelector("[aria-hidden]"));
    fireEvent.pointerDown(button);
    expect(layer.children).toHaveLength(0);
    rerender(
      <Button interaction="ripple" loading onClick={click}>
        保存
      </Button>,
    );
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(layer.children).toHaveLength(0);
    expect(click).not.toHaveBeenCalled();
    rerender(
      <Button interaction="ripple" onClick={click}>
        保存
      </Button>,
    );
    fireEvent.pointerDown(button);
    expect(layer.children).toHaveLength(1);
    setMedia("(prefers-reduced-motion: reduce)", true);
    expect(layer.children).toHaveLength(0);
    fireEvent.pointerDown(button);
    expect(layer.children).toHaveLength(0);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("moves only the visual, clamps offsets, cancels frames, resets on press and disable", () => {
    const { rerender, unmount } = render(
      <Button interaction="magnetic">开始</Button>,
    );
    const button = screen.getByRole("button");
    const visual = button.firstElementChild as HTMLElement;
    bounds(button);
    fireEvent.pointerMove(button, { clientX: 200, clientY: 50 });
    fireEvent.pointerMove(button, { clientX: 199, clientY: 49 });
    expect(frames.size).toBe(1);
    flushFrame();
    expect(visual.style.transform).toBe("translate3d(4px, 2.88px, 0px)");
    expect(button.style.transform).toBe("");
    expect(frames.size).toBe(0);
    fireEvent.pointerDown(button);
    expect(visual.style.transform).toBe("translate3d(0px, 0px, 0px)");
    fireEvent.pointerMove(button, { clientX: 200 });
    expect(frames.size).toBe(0);
    fireEvent.pointerUp(button, { clientX: 200 });
    flushFrame();
    expect(visual.style.transform).toContain("4px");
    fireEvent.pointerMove(button, { clientX: 0 });
    fireEvent.pointerLeave(button);
    expect(frames.size).toBe(0);
    fireEvent.pointerMove(button, { clientX: 200 });
    rerender(
      <Button interaction="magnetic" disabled>
        开始
      </Button>,
    );
    expect(frames.size).toBe(0);
    expect(visual.style.transform).toBe("translate3d(0px, 0px, 0px)");
    unmount();
    expect(
      [...media.values()].every((state) => state.listeners.size === 0),
    ).toBe(true);
  });

  it("gates hover motion on the actual pointer and live device preferences", () => {
    render(<Button interaction="magnetic">开始</Button>);
    const button = screen.getByRole("button");
    bounds(button);
    fireEvent.pointerMove(button, { pointerType: "touch", clientX: 200 });
    expect(frames.size).toBe(0);
    setMedia("(hover: hover) and (pointer: fine)", false);
    fireEvent.pointerMove(button, { clientX: 200 });
    expect(frames.size).toBe(0);
    setMedia("(hover: hover) and (pointer: fine)", true);
    fireEvent.pointerMove(button, { clientX: 200 });
    flushFrame();
    setMedia("(prefers-reduced-motion: reduce)", true);
    expect((button.firstElementChild as HTMLElement).style.transform).toBe(
      "translate3d(0px, 0px, 0px)",
    );
    fireEvent.pointerMove(button, { clientX: 200 });
    expect(frames.size).toBe(0);
  });
});

function Card() {
  const { hostRef, ...spotlight } = usePointerSpotlight();
  const { visualRef, ...magnetic } = useMagnetic();
  return (
    <section ref={hostRef} {...spotlight} aria-label="继续创作">
      <Link href="/project/studio?tab=styles" {...magnetic}>
        <span ref={visualRef}>继续创作</span>
      </Link>
    </section>
  );
}

it("keeps spotlight coordinates on leave and preserves the magnetic link", () => {
  const commit = vi.fn();
  const { unmount } = render(
    <Profiler id="card" onRender={commit}>
      <Card />
    </Profiler>,
  );
  const card = screen.getByRole("region");
  const link = screen.getByRole("link");
  const initialCommits = commit.mock.calls.length;
  bounds(card);
  fireEvent.pointerMove(card, { clientX: 80, clientY: 20 });
  flushFrame();
  expect(card.style.getPropertyValue("--spot-x")).toBe("80px");
  expect(card.dataset.spotlightActive).toBe("true");
  fireEvent.pointerLeave(card);
  expect(card.dataset.spotlightActive).toBeUndefined();
  expect(card.style.getPropertyValue("--spot-x")).toBe("80px");
  expect(link.getAttribute("href")).toBe("/project/studio?tab=styles");
  expect(commit).toHaveBeenCalledTimes(initialCommits);
  fireEvent.pointerMove(card, { clientX: 90 });
  unmount();
  expect(frames.size).toBe(0);
});
