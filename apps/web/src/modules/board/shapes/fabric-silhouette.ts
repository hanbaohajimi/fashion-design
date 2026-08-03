/**
 * Deterministic geometry for a hand-cut fabric swatch.
 *
 * A real offcut is not a rectangle: the sides slant, the cut edges undulate
 * unevenly, corners are blunted or bitten away, and the raw edge sheds threads.
 * Everything here is derived from the shape seed, so a swatch keeps the exact
 * same silhouette across re-renders, reloads and collaborators.
 *
 * All geometry is generated *inside* a margin so the cloth never leaves the
 * shape's own w×h box — that keeps the clipped photo covering the whole body.
 */

const TAU = Math.PI * 2;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

type Side = "top" | "right" | "bottom" | "left";
type Corner = "tl" | "tr" | "br" | "bl";
type CornerMode = "round" | "blunt" | "nick" | "curl";

export interface OutlinePoint extends Vec2 {
  /** Outward unit normal — fray strands grow along it. */
  readonly nx: number;
  readonly ny: number;
  readonly side: Side;
}

/** A corner lifting off the board, showing the cloth's thickness. */
export interface FabricCurl {
  /** Light crescent along the raised lip. */
  readonly lift: string;
  /** Contact shade tucked just under the lip. */
  readonly shade: string;
}

export interface FabricBulge {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly rotate: number;
}

export interface FabricSilhouette {
  /** Closed outline of the cloth body. */
  readonly path: string;
  /** Short fibres along the raw edge. */
  readonly frayPaths: readonly string[];
  /** A handful of longer pulled threads. */
  readonly threadPaths: readonly string[];
  /** Soft folds running across the body. */
  readonly creasePaths: readonly string[];
  /** Slack areas where the cloth rises off the board. */
  readonly bulges: readonly FabricBulge[];
  readonly curls: readonly FabricCurl[];
}

const CORNER_ORDER: readonly Corner[] = ["tl", "tr", "br", "bl"];
const PREV_CORNER: Record<Corner, Corner> = { tl: "bl", tr: "tl", br: "tr", bl: "br" };
const NEXT_CORNER: Record<Corner, Corner> = { tl: "tr", tr: "br", br: "bl", bl: "tl" };
/** The side that leaves each corner, walking clockwise. */
const SIDE_FROM_CORNER: Record<Corner, Side> = {
  tl: "top",
  tr: "right",
  br: "bottom",
  bl: "left",
};

/**
 * Stable seed from a tldraw shape id (FNV-1a). Shape ids are mostly letters,
 * so digit-stripping collides far too often.
 */
export function deriveShapeSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash % 100000) + 1;
}

function makeRandom(seed: number): (offset: number) => number {
  return (offset: number) => {
    const x = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
}

/**
 * Smooth, non-periodic-looking 1D noise over t ∈ [0,1], output ≈ -1..1.
 * Layered sines give gentle irregular waviness rather than a machined ripple.
 */
function makeWave(
  rand: (offset: number) => number,
  salt: number,
  octaves: number,
): (t: number) => number {
  const harmonics = Array.from({ length: octaves }, (_, i) => ({
    freq: (i + 1) * (0.85 + rand(salt + i * 3) * 0.95),
    phase: rand(salt + i * 3 + 1) * TAU,
    amp: 1 / (i + 1.35),
  }));
  const norm = harmonics.reduce((sum, h) => sum + h.amp, 0) || 1;
  return (t: number) => {
    let value = 0;
    for (const h of harmonics) {
      value += Math.sin(t * TAU * h.freq + h.phase) * h.amp;
    }
    return value / norm;
  };
}

function wrapAt(points: readonly Vec2[], index: number): Vec2 {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  return points[((index % n) + n) % n] ?? { x: 0, y: 0 };
}

function f(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * Closed Catmull-Rom spline as cubic béziers, with tangents scaled by local
 * segment length so tight point clusters (the nicks) stay crisp instead of
 * ballooning into loops.
 */
function closedSplinePath(points: readonly Vec2[]): string {
  const n = points.length;
  if (n < 3) return "";

  const tension = 0.28;
  const start = wrapAt(points, 0);
  const segments: string[] = [`M ${f(start.x)} ${f(start.y)}`];

  for (let i = 0; i < n; i++) {
    const p0 = wrapAt(points, i - 1);
    const p1 = wrapAt(points, i);
    const p2 = wrapAt(points, i + 1);
    const p3 = wrapAt(points, i + 2);

    const span = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const inLen = Math.hypot(p2.x - p0.x, p2.y - p0.y) || 1;
    const outLen = Math.hypot(p3.x - p1.x, p3.y - p1.y) || 1;

    const c1x = p1.x + ((p2.x - p0.x) / inLen) * span * tension;
    const c1y = p1.y + ((p2.y - p0.y) / inLen) * span * tension;
    const c2x = p2.x - ((p3.x - p1.x) / outLen) * span * tension;
    const c2y = p2.y - ((p3.y - p1.y) / outLen) * span * tension;

    segments.push(
      `C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`,
    );
  }

  segments.push("Z");
  return segments.join(" ");
}

interface Notch {
  readonly t: number;
  readonly width: number;
  readonly depth: number;
}

function buildNotches(
  rand: (offset: number) => number,
  salt: number,
  length: number,
  count: number,
  maxDepth: number,
): Notch[] {
  const notches: Notch[] = [];
  for (let i = 0; i < count; i++) {
    const widthPx = 2.4 + rand(salt + i * 4) * 5;
    notches.push({
      t: 0.14 + rand(salt + i * 4 + 1) * 0.72,
      width: widthPx / Math.max(length, 1),
      depth: maxDepth * (0.4 + rand(salt + i * 4 + 2) * 0.6),
    });
  }
  return notches;
}

interface SideOptions {
  readonly segments: number;
  readonly waveAmp: number;
  readonly fiber: number;
  readonly notches: readonly Notch[];
  /** Keep stops clear of the corner clusters. */
  readonly trimPx: number;
}

function buildSide(
  from: Vec2,
  to: Vec2,
  side: Side,
  wave: (t: number) => number,
  rand: (offset: number) => number,
  salt: number,
  options: SideOptions,
): OutlinePoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // Clockwise winding in screen space (y down) → right-hand perpendicular
  // points away from the cloth.
  const nx = uy;
  const ny = -ux;

  const stops: { t: number; offset: number }[] = [];

  for (let i = 1; i < options.segments; i++) {
    const t = i / options.segments;
    const fiber = (rand(salt + i * 7) - 0.5) * options.fiber;
    stops.push({ t, offset: wave(t) * options.waveAmp + fiber });
  }

  for (const notch of options.notches) {
    const half = notch.width / 2;
    stops.push({ t: notch.t - half, offset: wave(notch.t - half) * options.waveAmp });
    stops.push({ t: notch.t, offset: wave(notch.t) * options.waveAmp - notch.depth });
    stops.push({ t: notch.t + half, offset: wave(notch.t + half) * options.waveAmp });
  }

  const trim = Math.min(0.32, options.trimPx / length);
  return stops
    .filter((stop) => stop.t > trim && stop.t < 1 - trim)
    .sort((a, b) => a.t - b.t)
    .map((stop) => ({
      x: from.x + ux * length * stop.t + nx * stop.offset,
      y: from.y + uy * length * stop.t + ny * stop.offset,
      nx,
      ny,
      side,
    }));
}

interface CornerResult {
  readonly points: readonly OutlinePoint[];
  readonly curl?: FabricCurl;
}

function buildCorner(
  point: Vec2,
  previous: Vec2,
  next: Vec2,
  mode: CornerMode,
  side: Side,
  size: number,
  rand: (offset: number) => number,
  salt: number,
): CornerResult {
  const inLen = Math.hypot(point.x - previous.x, point.y - previous.y) || 1;
  const outLen = Math.hypot(next.x - point.x, next.y - point.y) || 1;
  const ix = (point.x - previous.x) / inLen;
  const iy = (point.y - previous.y) / inLen;
  const ox = (next.x - point.x) / outLen;
  const oy = (next.y - point.y) / outLen;

  // Bisector of the two side directions points into the cloth.
  const bx = ox - ix;
  const by = oy - iy;
  const bLen = Math.hypot(bx, by) || 1;
  const inwardX = bx / bLen;
  const inwardY = by / bLen;
  const nx = -inwardX;
  const ny = -inwardY;

  const pull = size * (0.45 + rand(salt) * 0.35);
  const before: Vec2 = { x: point.x - ix * pull, y: point.y - iy * pull };
  const after: Vec2 = { x: point.x + ox * pull, y: point.y + oy * pull };
  const at = (p: Vec2): OutlinePoint => ({ x: p.x, y: p.y, nx, ny, side });

  switch (mode) {
    case "round":
      return { points: [at(before), at(after)] };

    case "blunt": {
      const midX = (before.x + after.x) / 2 + inwardX * size * 0.16;
      const midY = (before.y + after.y) / 2 + inwardY * size * 0.16;
      return { points: [at(before), at({ x: midX, y: midY }), at(after)] };
    }

    case "nick": {
      // A bite taken out of the corner.
      const bite = size * (0.55 + rand(salt + 1) * 0.5);
      const deepX = (before.x + after.x) / 2 + inwardX * bite;
      const deepY = (before.y + after.y) / 2 + inwardY * bite;
      const lip: Vec2 = {
        x: point.x - ix * pull * 1.5,
        y: point.y - iy * pull * 1.5,
      };
      return {
        points: [at(lip), at({ x: deepX, y: deepY }), at(after)],
      };
    }

    case "curl":
    default: {
      // The tip lifts off the board: 1.5–3px of cloth thickness.
      const lift = 1.5 + rand(salt + 2) * 1.5;
      const tip: Vec2 = { x: point.x + nx * lift, y: point.y + ny * lift };
      const outer: Vec2 = {
        x: (before.x + after.x) / 2 + nx * lift * 2.4,
        y: (before.y + after.y) / 2 + ny * lift * 2.4,
      };
      const inner: Vec2 = {
        x: (before.x + after.x) / 2 + inwardX * lift * 1.6,
        y: (before.y + after.y) / 2 + inwardY * lift * 1.6,
      };
      return {
        points: [at(before), at(tip), at(after)],
        curl: {
          lift:
            `M ${f(before.x)} ${f(before.y)} ` +
            `Q ${f(outer.x)} ${f(outer.y)} ${f(after.x)} ${f(after.y)} Z`,
          shade:
            `M ${f(before.x)} ${f(before.y)} ` +
            `Q ${f(inner.x)} ${f(inner.y)} ${f(after.x)} ${f(after.y)} Z`,
        },
      };
    }
  }
}

function buildFrays(
  outline: readonly OutlinePoint[],
  rand: (offset: number) => number,
): { frayPaths: string[]; threadPaths: string[] } {
  const frayPaths: string[] = [];

  outline.forEach((p, i) => {
    // Cut edges shed more along the weft (top/bottom) than the selvedge sides.
    const density = p.side === "top" || p.side === "bottom" ? 0.62 : 0.44;
    if (rand(900 + i * 6) > density) return;

    const length = 1.6 + rand(901 + i * 6) * 4.4;
    const tx = -p.ny;
    const ty = p.nx;
    const drift = (rand(902 + i * 6) - 0.5) * length * 0.9;
    const bend = (rand(903 + i * 6) - 0.5) * length * 0.7;

    const sx = p.x - p.nx * 0.8;
    const sy = p.y - p.ny * 0.8;
    const cx = p.x + p.nx * length * 0.5 + tx * bend;
    const cy = p.y + p.ny * length * 0.5 + ty * bend;
    const ex = p.x + p.nx * length + tx * drift;
    const ey = p.y + p.ny * length + ty * drift + 0.4;

    frayPaths.push(
      `M ${f(sx)} ${f(sy)} Q ${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`,
    );
  });

  // A few long threads pulled clear of the weave.
  const threadPaths: string[] = [];
  const threadCount = 4 + Math.floor(rand(1200) * 4);
  for (let i = 0; i < threadCount; i++) {
    const anchor = outline[Math.floor(rand(1210 + i * 5) * outline.length)];
    if (!anchor) continue;

    const length = 8 + rand(1211 + i * 5) * 8;
    const tx = -anchor.ny;
    const ty = anchor.nx;
    const swing = (rand(1212 + i * 5) - 0.5) * length * 1.3;
    const counter = (rand(1213 + i * 5) - 0.5) * length * 0.9;

    const sx = anchor.x - anchor.nx * 1.2;
    const sy = anchor.y - anchor.ny * 1.2;
    const c1x = anchor.x + anchor.nx * length * 0.35 + tx * counter;
    const c1y = anchor.y + anchor.ny * length * 0.35 + ty * counter;
    const c2x = anchor.x + anchor.nx * length * 0.72 + tx * swing;
    const c2y = anchor.y + anchor.ny * length * 0.72 + ty * swing + length * 0.2;
    const ex = anchor.x + anchor.nx * length + tx * swing * 0.6;
    const ey = anchor.y + anchor.ny * length + ty * swing * 0.6 + length * 0.35;

    threadPaths.push(
      `M ${f(sx)} ${f(sy)} C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(ex)} ${f(ey)}`,
    );
  }

  return { frayPaths, threadPaths };
}

function buildCreases(
  outline: readonly OutlinePoint[],
  rand: (offset: number) => number,
  count: number,
): string[] {
  const n = outline.length;
  if (n < 8) return [];

  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const startIndex = Math.floor(rand(1400 + i * 7) * n);
    const arc = Math.floor((0.3 + rand(1401 + i * 7) * 0.4) * n);
    const a = outline[startIndex % n];
    const b = outline[(startIndex + arc) % n];
    if (!a || !b) continue;

    // Start and end a little inside the cut edge so the fold reads as cloth.
    const ax = a.x - a.nx * 1.5;
    const ay = a.y - a.ny * 1.5;
    const bx = b.x - b.nx * 1.5;
    const by = b.y - b.ny * 1.5;

    const dx = bx - ax;
    const dy = by - ay;
    const span = Math.hypot(dx, dy) || 1;
    const px = -dy / span;
    const py = dx / span;

    const bow1 = (rand(1402 + i * 7) - 0.5) * span * 0.3;
    const bow2 = (rand(1403 + i * 7) - 0.5) * span * 0.24;

    const c1x = ax + dx * 0.3 + px * bow1;
    const c1y = ay + dy * 0.3 + py * bow1;
    const c2x = ax + dx * 0.7 + px * bow2;
    const c2y = ay + dy * 0.7 + py * bow2;

    paths.push(
      `M ${f(ax)} ${f(ay)} C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(bx)} ${f(by)}`,
    );
  }
  return paths;
}

export function buildFabricSilhouette(
  seed: number,
  width: number,
  height: number,
  intensity = 1,
): FabricSilhouette {
  const rand = makeRandom(seed);
  const srand = (offset: number): number => rand(offset) * 2 - 1;
  const k = Math.max(0.5, Math.min(1.7, intensity));

  const minSide = Math.max(24, Math.min(width, height));
  // Breathing room reserved inside the shape box for waves, frays and curls.
  const margin = Math.max(4, minSide * 0.055);
  const x0 = margin;
  const y0 = margin;
  const x1 = Math.max(margin + 8, width - margin);
  const y1 = Math.max(margin + 8, height - margin);
  const innerW = x1 - x0;
  const innerH = y1 - y0;

  // Slide the top and bottom edges sideways so no two sides stay parallel,
  // then drift each corner for an unmistakably hand-cut trapezoid.
  const topShift = srand(41) * innerW * 0.03 * k;
  const bottomShift = srand(43) * innerW * 0.03 * k;
  const leftShift = srand(45) * innerH * 0.022 * k;
  const rightShift = srand(47) * innerH * 0.022 * k;
  const jitterX = margin * 0.5 * k;
  const jitterY = margin * 0.55 * k;

  const corners: Record<Corner, Vec2> = {
    tl: {
      x: x0 + topShift + srand(51) * jitterX,
      y: y0 + leftShift + srand(52) * jitterY,
    },
    tr: {
      x: x1 + topShift + srand(53) * jitterX,
      y: y0 + rightShift + srand(54) * jitterY,
    },
    br: {
      x: x1 + bottomShift + srand(55) * jitterX,
      y: y1 + rightShift + srand(56) * jitterY,
    },
    bl: {
      x: x0 + bottomShift + srand(57) * jitterX,
      y: y1 + leftShift + srand(58) * jitterY,
    },
  };

  // Every swatch gets one of each corner treatment, in a seed-dependent order —
  // guaranteed variety without any corner looking machined.
  const shuffledModes = (["round", "blunt", "nick", "curl"] as const)
    .map((mode, i) => ({ mode, key: rand(210 + i * 9) }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.mode);
  const cornerModes: Record<Corner, CornerMode> = {
    tl: shuffledModes[0] ?? "round",
    tr: shuffledModes[1] ?? "blunt",
    br: shuffledModes[2] ?? "nick",
    bl: shuffledModes[3] ?? "curl",
  };

  const horizontalWaveAmp = margin * 0.52 * k;
  const verticalWaveAmp = margin * 0.38 * k;
  const notchDepth = margin * 0.62 * k;
  // One side also carries a deeper, narrower split.
  const tearSide = CORNER_ORDER[Math.floor(rand(300) * 4)] ?? "tl";

  const outline: OutlinePoint[] = [];
  const curls: FabricCurl[] = [];

  CORNER_ORDER.forEach((corner, index) => {
    const point = corners[corner];
    const previous = corners[PREV_CORNER[corner]];
    const next = corners[NEXT_CORNER[corner]];
    const side = SIDE_FROM_CORNER[corner];
    const isHorizontal = side === "top" || side === "bottom";

    const cornerResult = buildCorner(
      point,
      previous,
      next,
      cornerModes[corner],
      side,
      margin * (0.85 + rand(400 + index) * 0.6),
      rand,
      500 + index * 11,
    );
    outline.push(...cornerResult.points);
    if (cornerResult.curl) curls.push(cornerResult.curl);

    const sideLength = Math.hypot(next.x - point.x, next.y - point.y);
    const notchCount = Math.floor(rand(600 + index * 5) * 2.6);
    const notches = buildNotches(
      rand,
      700 + index * 17,
      sideLength,
      notchCount,
      notchDepth,
    );
    if (corner === tearSide) {
      notches.push({
        t: 0.24 + rand(320) * 0.5,
        width: 2.6 / Math.max(sideLength, 1),
        depth: notchDepth * (1.5 + rand(321) * 0.9),
      });
    }

    outline.push(
      ...buildSide(
        point,
        next,
        side,
        makeWave(rand, 800 + index * 13, isHorizontal ? 4 : 3),
        rand,
        850 + index * 23,
        {
          segments: isHorizontal ? 15 : 10,
          waveAmp: isHorizontal ? horizontalWaveAmp : verticalWaveAmp,
          fiber: 1.3,
          notches,
          trimPx: margin * 1.9,
        },
      ),
    );
  });

  const { frayPaths, threadPaths } = buildFrays(outline, rand);

  const bulgeCount = 2 + Math.floor(rand(1500) * 2);
  const bulges: FabricBulge[] = Array.from({ length: bulgeCount }, (_, i) => ({
    cx: x0 + innerW * (0.26 + rand(1510 + i * 6) * 0.48),
    cy: y0 + innerH * (0.24 + rand(1511 + i * 6) * 0.5),
    rx: innerW * (0.16 + rand(1512 + i * 6) * 0.14),
    ry: innerH * (0.14 + rand(1513 + i * 6) * 0.14),
    rotate: srand(1514 + i * 6) * 42,
  }));

  return {
    path: closedSplinePath(outline),
    frayPaths,
    threadPaths,
    creasePaths: buildCreases(outline, rand, 3 + Math.floor(rand(1600) * 3)),
    bulges,
    curls,
  };
}
