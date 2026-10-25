import { composeEffect, type CoutureEffect, type Mojs } from "./presets";

export interface MotionOptions {
  readonly anchor: HTMLElement | null;
  readonly eventKey: string;
  readonly colors?: readonly string[];
}
export interface MotionHandle {
  cancel(): void;
  readonly finished: Promise<void>;
}
let library: Promise<Mojs> | undefined;
const active = new Map<HTMLElement, MotionHandle>();
const seen = new Map<string, number>();
const noop = (): MotionHandle => ({ cancel() {}, finished: Promise.resolve() });

export function motionAllowed(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    document.visibilityState === "visible" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function visible(anchor: HTMLElement): boolean {
  const rect = anchor.getBoundingClientRect();
  return (
    anchor.isConnected &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < innerHeight &&
    rect.left < innerWidth &&
    !anchor.closest("[hidden], [inert]")
  );
}

export function cancelAllMotion(): void {
  [...active.values()].forEach((handle) => handle.cancel());
}

/** Lazy, best-effort presentation: never await this in a business operation. */
export function play(
  effect: CoutureEffect,
  { anchor, eventKey, colors = [] }: MotionOptions,
): MotionHandle {
  if (!anchor || !motionAllowed()) return noop();
  const now = performance.now();
  for (const [key, timestamp] of seen)
    if (now - timestamp > 300_000) seen.delete(key);
  if (seen.has(eventKey)) return noop();
  // Consume even skipped events: scrolling or remounting must not replay a celebration.
  seen.set(eventKey, now);
  const oldest = seen.keys().next().value;
  if (seen.size > 512 && oldest) seen.delete(oldest);
  if (!visible(anchor) || active.has(anchor) || active.size >= 2) return noop();

  let stopped = false;
  let layer: HTMLElement | undefined;
  let animation: ReturnType<typeof composeEffect> | undefined;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: () => void;
  const finished = new Promise<void>((done) => {
    resolve = done;
  });
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pathname = location.pathname;
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    animation?.stop();
    layer?.remove();
    active.delete(anchor);
    document.removeEventListener("visibilitychange", cancel);
    preference.removeEventListener("change", cancel);
    window.removeEventListener("pagehide", cancel);
    resolve();
  };
  const handle = { cancel, finished };
  active.set(anchor, handle);
  document.addEventListener("visibilitychange", cancel);
  preference.addEventListener("change", cancel);
  window.addEventListener("pagehide", cancel);
  // Includes import latency; a missed moment is preferable to a late celebration.
  timer = setTimeout(cancel, 1200);
  library ??= import("@mojs/core")
    .then((module) => module.default)
    .catch((error: unknown) => {
      library = undefined;
      throw error;
    });
  void library
    .then((mo) => {
      let previous = anchor.getBoundingClientRect();
      let stableFrames = 0;
      const settle = () => {
        if (stopped) return;
        if (
          !motionAllowed() ||
          !visible(anchor) ||
          pathname !== location.pathname ||
          performance.now() - now > 1000
        ) {
          cancel();
          return;
        }
        const next = anchor.getBoundingClientRect();
        const stable =
          Math.abs(next.x - previous.x) < 0.5 &&
          Math.abs(next.y - previous.y) < 0.5 &&
          Math.abs(next.width - previous.width) < 0.5 &&
          Math.abs(next.height - previous.height) < 0.5;
        previous = next;
        stableFrames = stable ? stableFrames + 1 : 0;
        if (stableFrames < 3) {
          frame = requestAnimationFrame(settle);
          return;
        }
        try {
          begin(mo);
        } catch {
          cancel();
        }
      };
      frame = requestAnimationFrame(settle);
    })
    .catch(cancel);
  const begin = (mo: Mojs) => {
    if (
      stopped ||
      !motionAllowed() ||
      !visible(anchor) ||
      pathname !== location.pathname ||
      performance.now() - now > 1000
    ) {
      cancel();
      return;
    }
    const tokens = getComputedStyle(document.documentElement);
    const raw = tokens.getPropertyValue(`--motion-${effect}`).trim();
    const duration = Number.parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000);
    if (!duration || duration < 0) {
      cancel();
      return;
    }
    const bounds = anchor.getBoundingClientRect();
    layer = document.createElement("div");
    layer.dataset.coutureMotion = effect;
    layer.setAttribute("aria-hidden", "true");
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "10000",
    });
    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "absolute",
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      pointerEvents: "none",
    });
    layer.append(host);
    document.body.append(layer);
    const palette = colors
      .filter((color) => /^#[\da-f]{3}(?:[\da-f]{3})?$/iu.test(color))
      .slice(0, 6);
    if (!palette.length)
      palette.push(
        tokens.getPropertyValue("--color-ink").trim() || "#323232",
        tokens.getPropertyValue("--color-signal").trim() || "#777",
      );
    animation = composeEffect(
      mo,
      effect,
      host,
      duration,
      palette,
      window.matchMedia("(pointer: coarse)").matches,
    );
    animation.play();
    clearTimeout(timer);
    timer = setTimeout(cancel, duration + 50);
    const watch = () => {
      const next = anchor.getBoundingClientRect();
      if (
        !motionAllowed() ||
        !visible(anchor) ||
        pathname !== location.pathname ||
        Math.abs(next.x - bounds.x) > 1 ||
        Math.abs(next.y - bounds.y) > 1 ||
        Math.abs(next.width - bounds.width) > 1 ||
        Math.abs(next.height - bounds.height) > 1
      ) {
        cancel();
        return;
      }
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
  };
  return handle;
}
