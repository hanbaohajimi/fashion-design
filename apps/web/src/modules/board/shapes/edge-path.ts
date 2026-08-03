import { buildFabricSilhouette } from "./fabric-silhouette";
import type { EdgeStyle } from "./material-appearance";

/**
 * Generate deterministic SVG path for material edges.
 * Uses low spatial frequency for organic, hand-cut appearance.
 */
export function generateEdgePath(
  seed: number,
  width: number,
  height: number,
  style: EdgeStyle,
  intensity: number,
): string {
  if (style === "straight" || intensity <= 0) {
    return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
  }

  const seededRandom = (offset: number): number => {
    const x = Math.sin(seed + offset) * 10000;
    return x - Math.floor(x);
  };

  switch (style) {
    case "torn":
      return generateTornEdge(width, height, intensity, seededRandom);
    case "deckled":
      return generateDeckledEdge(width, height, intensity, seededRandom);
    case "pinked":
      return generatePinkedEdge(width, height, intensity);
    case "rough-cut":
      return generateRoughCutEdge(width, height, intensity, seededRandom);
    case "raw-cut":
      // Cloth offcuts carry extra geometry (frays, folds); MaterialShell builds
      // the full silhouette. Here we only need its outline.
      return buildFabricSilhouette(seed, width, height, intensity).path;
    default:
      return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
  }
}

function generateTornEdge(
  w: number,
  h: number,
  intensity: number,
  rand: (offset: number) => number,
): string {
  const segments = 16;
  const maxDeviation = intensity * 12;
  const points: string[] = [];

  // Top edge
  points.push(`M ${rand(0) * maxDeviation * 0.5} ${rand(1) * maxDeviation * 0.4}`);
  for (let i = 1; i <= segments; i++) {
    const x = (w / segments) * i;
    const y = rand(i * 2) * maxDeviation - maxDeviation * 0.5;
    const cpx1 = x - w / segments / 2.5;
    const cpy1 = rand(i * 2 + 100) * maxDeviation * 1.2 - maxDeviation * 0.5;
    const cpx2 = x - w / segments / 8;
    const cpy2 = rand(i * 2 + 200) * maxDeviation * 1.2 - maxDeviation * 0.5;
    points.push(`C ${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x} ${y}`);
  }

  // Right edge
  for (let i = 1; i <= segments; i++) {
    const x = w + rand(i * 2 + 300) * maxDeviation - maxDeviation * 0.5;
    const y = (h / segments) * i;
    const cpx1 = w + rand(i * 2 + 400) * maxDeviation * 1.2 - maxDeviation * 0.5;
    const cpy1 = y - h / segments / 2.5;
    const cpx2 = w + rand(i * 2 + 500) * maxDeviation * 1.2 - maxDeviation * 0.5;
    const cpy2 = y - h / segments / 8;
    points.push(`C ${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x} ${y}`);
  }

  // Bottom edge
  for (let i = segments; i >= 0; i--) {
    const x = (w / segments) * i;
    const y = h + rand(i * 2 + 600) * maxDeviation - maxDeviation * 0.5;
    const cpx1 = x + w / segments / 2.5;
    const cpy1 = h + rand(i * 2 + 700) * maxDeviation * 1.2 - maxDeviation * 0.5;
    const cpx2 = x + w / segments / 8;
    const cpy2 = h + rand(i * 2 + 800) * maxDeviation * 1.2 - maxDeviation * 0.5;
    points.push(`C ${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x} ${y}`);
  }

  // Left edge
  for (let i = segments; i >= 0; i--) {
    const x = rand(i * 2 + 900) * maxDeviation * 0.5 - maxDeviation * 0.5;
    const y = (h / segments) * i;
    const cpx1 = rand(i * 2 + 1000) * maxDeviation * 1.2 - maxDeviation * 0.5;
    const cpy1 = y + h / segments / 2.5;
    const cpx2 = rand(i * 2 + 1100) * maxDeviation * 1.2 - maxDeviation * 0.5;
    const cpy2 = y + h / segments / 8;
    points.push(`C ${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x} ${y}`);
  }

  points.push("Z");
  return points.join(" ");
}

function generateDeckledEdge(
  w: number,
  h: number,
  intensity: number,
  rand: (offset: number) => number,
): string {
  const segments = 20;
  const maxDeviation = intensity * 8;
  const points: string[] = [];

  points.push(`M 0 ${rand(0) * maxDeviation * 0.6}`);

  // Top edge - gentle irregular waviness
  for (let i = 1; i <= segments; i++) {
    const x = (w / segments) * i;
    const y = rand(i * 3) * maxDeviation - maxDeviation * 0.5;
    points.push(`L ${x} ${y}`);
  }

  // Right edge
  for (let i = 1; i <= segments; i++) {
    const x = w + rand(i * 3 + 200) * maxDeviation - maxDeviation * 0.5;
    const y = (h / segments) * i;
    points.push(`L ${x} ${y}`);
  }

  // Bottom edge
  for (let i = segments; i >= 0; i--) {
    const x = (w / segments) * i;
    const y = h + rand(i * 3 + 400) * maxDeviation - maxDeviation * 0.5;
    points.push(`L ${x} ${y}`);
  }

  // Left edge
  for (let i = segments; i >= 0; i--) {
    const x = rand(i * 3 + 600) * maxDeviation - maxDeviation * 0.5;
    const y = (h / segments) * i;
    points.push(`L ${x} ${y}`);
  }

  points.push("Z");
  return points.join(" ");
}

function generatePinkedEdge(
  w: number,
  h: number,
  intensity: number,
): string {
  /**
   * Replicates the .fabric CSS clip-path from natural_fabric_pinboard_demo.html:
   * uniform small zigzag on all four sides — ~4% step, ~2% tooth depth × intensity.
   *
   * Structure (mirroring the reference polygon):
   *  Top    L→R : y alternates between 0 and depthTB
   *  Right  T→B : x alternates between w and w−depthLR
   *  Bottom R→L : y alternates between h and h−depthTB
   *  Left   B→T : x alternates between 0 and depthLR
   * Corners are single diagonal hops between the sides.
   */
  const px = (v: number): string => v.toFixed(2);
  const depthTB = h * 0.02 * intensity; // tooth depth on top & bottom
  const depthLR = w * 0.02 * intensity; // tooth depth on left & right
  // ~25 teeth per side (4% step across 96% usable length)
  const nH = Math.max(4, Math.round(0.96 / 0.04));
  const nV = Math.max(4, Math.round(0.90 / 0.04));

  const seg = (x: number, y: number): string => `L ${px(x)} ${px(y)}`;
  const out: string[] = [];

  // ── Top (left → right): x from 2% to 98%, y between 0 and depthTB ─────────
  out.push(`M ${px(w * 0.02)} 0`);
  for (let i = 1; i <= nH; i++) {
    const x = w * 0.02 + (w * 0.96) * (i / nH);
    const y = i % 2 === 1 ? depthTB : 0;
    out.push(seg(x, y));
  }

  // ── Corner TR ─────────────────────────────────────────────────────────────
  out.push(seg(w, h * 0.05));

  // ── Right (top → bottom): y from 5% to 95%, x between w and w−depthLR ────
  for (let i = 1; i <= nV; i++) {
    const y = h * 0.05 + (h * 0.90) * (i / nV);
    const x = i % 2 === 1 ? w - depthLR : w;
    out.push(seg(x, y));
  }

  // ── Corner BR ─────────────────────────────────────────────────────────────
  out.push(seg(w * 0.94, h));

  // ── Bottom (right → left): x from 94% to 2%, y between h and h−depthTB ───
  for (let i = 1; i <= nH; i++) {
    const x = w * 0.94 - (w * 0.92) * (i / nH);
    const y = i % 2 === 1 ? h - depthTB : h;
    out.push(seg(x, y));
  }

  // ── Corner BL ─────────────────────────────────────────────────────────────
  out.push(seg(0, h * 0.94));

  // ── Left (bottom → top): y from 94% to 6%, x between 0 and depthLR ───────
  for (let i = 1; i <= nV; i++) {
    const y = h * 0.94 - (h * 0.88) * (i / nV);
    const x = i % 2 === 1 ? depthLR : 0;
    out.push(seg(x, y));
  }

  out.push("Z");
  return out.join(" ");
}

function generateRoughCutEdge(
  w: number,
  h: number,
  intensity: number,
  rand: (offset: number) => number,
): string {
  const segments = 20;
  const maxDeviation = intensity * 3;
  const points: string[] = [];

  points.push(`M ${rand(0) * maxDeviation * 0.3} 0`);

  // Top edge
  for (let i = 1; i <= segments; i++) {
    const x = (w / segments) * i + rand(i) * maxDeviation - maxDeviation * 0.5;
    const y = rand(i + 100) * maxDeviation * 0.6 - maxDeviation * 0.3;
    points.push(`L ${x} ${y}`);
  }

  // Right edge
  for (let i = 1; i <= segments; i++) {
    const x = w + rand(i + 200) * maxDeviation * 0.6 - maxDeviation * 0.3;
    const y = (h / segments) * i + rand(i + 300) * maxDeviation - maxDeviation * 0.5;
    points.push(`L ${x} ${y}`);
  }

  // Bottom edge
  for (let i = segments; i >= 0; i--) {
    const x = (w / segments) * i + rand(i + 400) * maxDeviation - maxDeviation * 0.5;
    const y = h + rand(i + 500) * maxDeviation * 0.6 - maxDeviation * 0.3;
    points.push(`L ${x} ${y}`);
  }

  // Left edge
  for (let i = segments; i >= 0; i--) {
    const x = rand(i + 600) * maxDeviation * 0.6 - maxDeviation * 0.3;
    const y = (h / segments) * i + rand(i + 700) * maxDeviation - maxDeviation * 0.5;
    points.push(`L ${x} ${y}`);
  }

  points.push("Z");
  return points.join(" ");
}
