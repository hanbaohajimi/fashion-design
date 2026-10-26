/** Native-dialog portals share its top layer, including its animated containing block. */
export function placeFloatingPanel(panel: HTMLElement, left: number, top: number): void {
  const surface = panel.closest("dialog[open]");
  if (surface instanceof HTMLElement) {
    const transform = getComputedStyle(surface).transform;
    if (transform && transform !== "none" && surface.offsetWidth && surface.offsetHeight) {
      const bounds = surface.getBoundingClientRect();
      const x = bounds.width / surface.offsetWidth;
      const y = bounds.height / surface.offsetHeight;
      if (x && y) { left = (left - bounds.left) / x - surface.clientLeft; top = (top - bounds.top) / y - surface.clientTop; }
    }
  }
  panel.style.setProperty("left", `${left}px`);
  panel.style.setProperty("top", `${top}px`);
}

/** Re-anchor once the containing surface settles, without a perpetual frame watcher. */
export function afterSurfaceMotion(panel: HTMLElement | null, position: () => void): () => void {
  let active = true;
  const animations = panel?.closest("dialog[open]")?.getAnimations?.() ?? [];
  if (animations.length) void Promise.allSettled(animations.map(animation => animation.finished)).then(() => { if (active && panel?.isConnected) position(); });
  return () => { active = false; };
}
