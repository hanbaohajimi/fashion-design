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
      return generatePinkedEdge(width, height, intensity, seededRandom);
    case "rough-cut":
      return generateRoughCutEdge(width, height, intensity, seededRandom);
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
  const segments = 12;
  const maxDeviation = intensity * 8;
  const points: string[] = [];

  // Top edge
  points.push(`M ${rand(0) * maxDeviation * 0.5} ${rand(1) * maxDeviation * 0.3}`);
  for (let i = 1; i <= segments; i++) {
    const x = (w / segments) * i;
    const y = rand(i * 2) * maxDeviation - maxDeviation * 0.3;
    const cpx1 = x - w / segments / 3;
    const cpy1 = rand(i * 2 + 100) * maxDeviation * 0.7 - maxDeviation * 0.3;
    const cpx2 = x - w / segments / 6;
    const cpy2 = rand(i * 2 + 200) * maxDeviation * 0.7 - maxDeviation * 0.3;
    points.push(`C ${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x} ${y}`);
  }

  // Right edge
  for (let i = 1; i <= segments; i++) {
    const x = w + rand(i * 2 + 300) * maxDeviation - maxDeviation * 0.3;
    const y = (h / segments) * i;
    const cpx1 = w + rand(i * 2 + 400) * maxDeviation * 0.7 - maxDeviation * 0.3;
    const cpy1 = y - h / segments / 3;
    const cpx2 = w + rand(i * 2 + 500) * maxDeviation * 0.7 - maxDeviation * 0.3;
    const cpy2 = y - h / segments / 6;
    points.push(`C ${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x} ${y}`);
  }

  // Bottom edge
  for (let i = segments; i >= 0; i--) {
    const x = (w / segments) * i;
    const y = h + rand(i * 2 + 600) * maxDeviation - maxDeviation * 0.3;
    const cpx1 = x + w / segments / 3;
    const cpy1 = h + rand(i * 2 + 700) * maxDeviation * 0.7 - maxDeviation * 0.3;
    const cpx2 = x + w / segments / 6;
    const cpy2 = h + rand(i * 2 + 800) * maxDeviation * 0.7 - maxDeviation * 0.3;
    points.push(`C ${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x} ${y}`);
  }

  // Left edge
  for (let i = segments; i >= 0; i--) {
    const x = rand(i * 2 + 900) * maxDeviation * 0.5 - maxDeviation * 0.3;
    const y = (h / segments) * i;
    const cpx1 = rand(i * 2 + 1000) * maxDeviation * 0.7 - maxDeviation * 0.3;
    const cpy1 = y + h / segments / 3;
    const cpx2 = rand(i * 2 + 1100) * maxDeviation * 0.7 - maxDeviation * 0.3;
    const cpy2 = y + h / segments / 6;
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
  const segments = 16;
  const maxDeviation = intensity * 5;
  const points: string[] = [];

  points.push(`M 0 ${rand(0) * maxDeviation * 0.4}`);

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
  rand: (offset: number) => number,
): string {
  const zigzagSize = 6 + intensity * 4;
  const steps = Math.floor((w + h) * 2 / zigzagSize);
  const points: string[] = [];

  points.push(`M 0 0`);

  let x = 0;
  let y = 0;
  let direction = 0; // 0: right, 1: down, 2: left, 3: up

  for (let i = 0; i < steps; i++) {
    const isOut = i % 2 === 0;
    const depth = isOut ? zigzagSize * (0.8 + rand(i) * 0.4) : 0;

    switch (direction) {
      case 0: // Moving right along top
        x += zigzagSize;
        y = isOut ? -depth : 0;
        if (x >= w) {
          x = w;
          y = 0;
          direction = 1;
        }
        break;
      case 1: // Moving down along right
        y += zigzagSize;
        x = w + (isOut ? depth : 0);
        if (y >= h) {
          y = h;
          x = w;
          direction = 2;
        }
        break;
      case 2: // Moving left along bottom
        x -= zigzagSize;
        y = h + (isOut ? depth : 0);
        if (x <= 0) {
          x = 0;
          y = h;
          direction = 3;
        }
        break;
      case 3: // Moving up along left
        y -= zigzagSize;
        x = isOut ? -depth : 0;
        if (y <= 0) {
          y = 0;
          x = 0;
        }
        break;
    }

    points.push(`L ${x} ${y}`);
  }

  points.push("Z");
  return points.join(" ");
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
