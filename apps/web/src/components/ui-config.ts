/** 与 design-system.css 的工作区尺寸约定保持一致；数值用于画布计算与键盘步进。 */
export const STUDIO_LAYOUT = {
  mobileMax: 767,
  dockedMin: 1100,
  sidebarDefault: 384,
  sidebarMin: 320,
  sidebarMax: 480,
  canvasMin: 640,
  resizeStep: 16,
  followThreshold: 80,
} as const;

export const UI_TIMING = { tooltipOpen: 180, tooltipClose: 120, busyFeedback: 300, paintingDelay: 2000, staleTask: 60_000 } as const;

/** Source reuse must be cleared before enabling these media in a production deployment. */
export const PAINTING_LOADERS_ENABLED = process.env.NEXT_PUBLIC_PAINTING_LOADERS === "true" ||
  (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_PAINTING_LOADERS !== "false");

/** JS interactions read the same motion tokens as CSS and honor reduced motion. */
export function motionDuration(token: "fast" | "normal" | "result" = "normal"): number {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--duration-${token}`).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value * (raw.endsWith("ms") ? 1 : 1000) : 0;
}

export function motionOptions() {
  const duration = motionDuration();
  return duration ? { animation: { duration } } : {};
}
