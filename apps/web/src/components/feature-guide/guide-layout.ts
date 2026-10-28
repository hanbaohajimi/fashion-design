export interface GuideRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface GuideViewport extends GuideRect { readonly mobile: boolean; }

const GAP = 16;
const EDGE = 16;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)));

function overlap(a: GuideRect, b: GuideRect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

export function placeGuideCard(target: GuideRect, card: { width: number; height: number }, viewport: GuideViewport): GuideRect {
  const left = viewport.x + EDGE;
  const top = viewport.y + EDGE;
  const width = Math.min(card.width, viewport.width - EDGE * 2);
  const height = Math.min(card.height, viewport.height - EDGE * 2);
  const right = viewport.x + viewport.width - EDGE - width;
  const bottom = viewport.y + viewport.height - EDGE - height;
  const fit = (x: number, y: number): GuideRect => ({ x: clamp(x, left, right), y: clamp(y, top, bottom), width, height });
  const center = target.x + (target.width - width) / 2;
  const candidates = viewport.mobile ? [
    fit(left, bottom), fit(left, top),
  ] : [
    fit(target.x + target.width + GAP, target.y),
    fit(target.x - width - GAP, target.y),
    fit(center, target.y + target.height + GAP),
    fit(center, target.y - height - GAP),
  ];
  const best = candidates.reduce((current, next) => overlap(next, target) < overlap(current, target) ? next : current, candidates[0] ?? fit(left, top));
  if (!overlap(best, target)) return best;
  // On short screens, keep the controls visible and let the explanation scroll.
  const below = viewport.y + viewport.height - EDGE - (target.y + target.height + GAP);
  const above = target.y - GAP - top;
  const available = Math.max(below, above);
  if (available >= 180) {
    const reducedHeight = Math.min(height, available);
    return { x: clamp(center, left, right), y: below >= above ? target.y + target.height + GAP : target.y - GAP - reducedHeight, width, height: reducedHeight };
  }
  return best;
}

export function guideVisibleRect(target: GuideRect, viewport: GuideViewport): GuideRect {
  const x = Math.max(viewport.x + 4, target.x - 6);
  const y = Math.max(viewport.y + 4, target.y - 6);
  return {
    x, y,
    width: Math.max(0, Math.min(viewport.x + viewport.width - 4, target.x + target.width + 6) - x),
    height: Math.max(0, Math.min(viewport.y + viewport.height - 4, target.y + target.height + 6) - y),
  };
}
