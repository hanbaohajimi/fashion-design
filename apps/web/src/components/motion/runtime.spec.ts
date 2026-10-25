/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  load: vi.fn(),
  compose: vi.fn(),
  play: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@mojs/core", () => {
  mock.load();
  return { default: {} };
});
vi.mock("./presets", () => ({ composeEffect: mock.compose }));

let runtime: typeof import("./runtime");
let reduced = false;
let bounds = {
  x: 20,
  y: 20,
  left: 20,
  top: 20,
  right: 220,
  bottom: 120,
  width: 200,
  height: 100,
  toJSON() {},
};
function anchor() {
  const element = document.createElement("button");
  element.textContent = "仍可操作";
  document.body.append(element);
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => bounds);
  return element;
}
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  reduced = false;
  bounds = {
    x: 20,
    y: 20,
    left: 20,
    top: 20,
    right: 220,
    bottom: 120,
    width: 200,
    height: 100,
    toJSON() {},
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduced") && reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  document.documentElement.style.setProperty("--motion-seal", "480ms");
  mock.compose.mockImplementation(() => ({ play: mock.play, stop: mock.stop }));
  runtime = await import("./runtime");
});
afterEach(() => {
  runtime.cancelAllMotion();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const flush = () => vi.advanceTimersByTimeAsync(65);

describe("couture presentation lifecycle", () => {
  it("reduced motion never imports or constructs the library", async () => {
    reduced = true;
    runtime.play("seal", { anchor: anchor(), eventKey: "reduced" });
    await flush();
    expect(mock.load).not.toHaveBeenCalled();
    expect(mock.compose).not.toHaveBeenCalled();
  });
  it("plays once, leaves controls usable, and removes decoration and timers", async () => {
    const element = anchor();
    const click = vi.fn();
    element.onclick = click;
    const handle = runtime.play("seal", { anchor: element, eventKey: "saved" });
    await flush();
    const layer = document.querySelector<HTMLElement>("[data-couture-motion]");
    expect(layer?.style.pointerEvents).toBe("none");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    element.click();
    expect(click).toHaveBeenCalledOnce();
    runtime.play("seal", { anchor: element, eventKey: "saved" });
    await vi.advanceTimersByTimeAsync(600);
    await handle.finished;
    expect(mock.play).toHaveBeenCalledOnce();
    expect(mock.stop).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-couture-motion]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("limits concurrency to two and consumes skipped events", async () => {
    const a = anchor(),
      b = anchor(),
      c = anchor();
    runtime.play("seal", { anchor: a, eventKey: "a" });
    runtime.play("seal", { anchor: a, eventKey: "same-anchor" });
    runtime.play("seal", { anchor: b, eventKey: "b" });
    runtime.play("seal", { anchor: c, eventKey: "c" });
    await flush();
    expect(mock.play).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600);
    runtime.play("seal", { anchor: c, eventKey: "c" });
    await flush();
    expect(mock.play).toHaveBeenCalledTimes(2);
  });
  it("cancels before an asynchronous import can decorate an unmounted page", async () => {
    const handle = runtime.play("seal", {
      anchor: anchor(),
      eventKey: "unmounted",
    });
    handle.cancel();
    await flush();
    expect(mock.compose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["move", "resize", "unmount", "background"])(
    "cleans up on %s",
    async (change) => {
      const element = anchor();
      runtime.play("seal", { anchor: element, eventKey: change });
      await flush();
      if (change === "move") bounds = { ...bounds, x: 50, left: 50 };
      if (change === "resize") bounds = { ...bounds, width: 250 };
      if (change === "unmount") element.remove();
      if (change === "background")
        document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(32);
      expect(mock.stop).toHaveBeenCalledOnce();
      expect(document.querySelector("[data-couture-motion]")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("drops invisible arrivals instead of replaying them when scrolled into view", async () => {
    const element = anchor();
    bounds = { ...bounds, top: 5000 };
    runtime.play("seal", { anchor: element, eventKey: "offscreen" });
    bounds = { ...bounds, top: 20 };
    runtime.play("seal", { anchor: element, eventKey: "offscreen" });
    await flush();
    expect(mock.compose).not.toHaveBeenCalled();
  });
  it("fails silently if an effect cannot be constructed", async () => {
    mock.compose.mockImplementation(() => {
      throw new Error("unavailable");
    });
    runtime.play("seal", { anchor: anchor(), eventKey: "failure" });
    await flush();
    expect(document.querySelector("[data-couture-motion]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
