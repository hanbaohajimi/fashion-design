/** Browser-only helpers. Call from effects/events, never during rendering. */
export function reducedMotion(): boolean {
  return typeof window === "undefined" || typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function motionTime(token: string, fallback: number): number {
  if (reducedMotion()) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value * (raw.endsWith("ms") ? 1 : 1000) : fallback;
}

export function motionEase(exit = false): string {
  return getComputedStyle(document.documentElement).getPropertyValue(exit ? "--ease-exit" : "--ease-enter").trim() ||
    (exit ? "cubic-bezier(.4,0,1,1)" : "cubic-bezier(.23,1,.32,1)");
}

export function observeMotionCancellation(cancel: () => void): () => void {
  const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const visibility = () => { if (document.hidden) cancel(); };
  preference?.addEventListener("change", cancel);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", cancel);
  return () => {
    preference?.removeEventListener("change", cancel);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", cancel);
  };
}
