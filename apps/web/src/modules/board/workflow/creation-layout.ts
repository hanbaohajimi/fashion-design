export interface ScreenRect { x: number; y: number; w: number; h: number }

export function emptyCreationPosition(occupied: readonly ScreenRect[], preferred: { x: number; y: number }, size = { w: 340, h: 440 }) {
  for (let index = 0; index < 400; index++) {
    const point = { x: preferred.x + (index % 8) * (size.w + 80), y: preferred.y + Math.floor(index / 8) * (size.h + 80) };
    if (!occupied.some((box) => point.x < box.x + box.w + 32 && point.x + size.w + 32 > box.x && point.y < box.y + box.h + 32 && point.y + size.h + 32 > box.y)) return point;
  }
  return { x: Math.max(preferred.x, ...occupied.map((box) => box.x + box.w)) + 100, y: preferred.y };
}

/** UI stays in screen pixels; a short viewport uses a bottom composer. */
export function creationOverlayLayout(rect: ScreenRect, viewport: { w: number; h: number }) {
  const margin = 20;
  const width = Math.max(280, Math.min(660, viewport.w - margin * 2));
  const x = Math.max(margin, Math.min(rect.x + rect.w / 2 - width / 2, viewport.w - width - margin));
  const toolbarWidth = Math.max(280, Math.min(720, viewport.w - margin * 2));
  const toolbarX = Math.max(margin, Math.min(rect.x + rect.w / 2 - toolbarWidth / 2, viewport.w - toolbarWidth - margin));
  const compact = viewport.w < 700 || viewport.h < 650;
  const composerHeight = compact ? 226 : 230;
  const topClearance = viewport.w < 700 ? 132 : 76;
  return {
    x, width, compact, toolbarX, toolbarWidth,
    toolbarY: Math.max(topClearance, Math.min(rect.y - 78, viewport.h - composerHeight - 140)),
    composerY: compact ? Math.max(80, viewport.h - composerHeight - 90) : Math.max(100, Math.min(rect.y + rect.h + 16, viewport.h - composerHeight - 90)),
  };
}

export function connectionCurve(from: { x: number; y: number }, to: { x: number; y: number }) {
  const bend = Math.max(60, Math.abs(to.x - from.x) * 0.45);
  return `M${from.x},${from.y} C${from.x + bend},${from.y} ${to.x - bend},${to.y} ${to.x},${to.y}`;
}
