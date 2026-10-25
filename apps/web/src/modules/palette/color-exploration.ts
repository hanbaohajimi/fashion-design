import chroma from "chroma-js";

import type { PaletteColor } from "../board/generation/collection-types";

export type PaletteStrategy = "tonal" | "analogous" | "complementary";
export const PALETTE_LIMIT = 12;
export const NEAR_COLOR_DELTA_E = 5;
const HEX = /^#[\da-f]{6}$/iu;

export interface PaletteWarning {
  readonly left: number;
  readonly right: number;
  readonly deltaE: number;
}

export function paletteWarnings(
  colors: readonly PaletteColor[],
): PaletteWarning[] {
  const warnings: PaletteWarning[] = [];
  colors.forEach((left, i) => {
    colors.slice(i + 1).forEach((right, offset) => {
      if (!HEX.test(left.hex) || !HEX.test(right.hex)) return;
      const deltaE = chroma.deltaE(left.hex, right.hex);
      if (deltaE < NEAR_COLOR_DELTA_E)
        warnings.push({ left: i, right: i + offset + 1, deltaE });
    });
  });
  return warnings;
}

export function colorForeground(hex: string): "#000000" | "#ffffff" {
  if (!HEX.test(hex)) return "#000000";
  return chroma.contrast(hex, "#000000") >= chroma.contrast(hex, "#ffffff")
    ? "#000000"
    : "#ffffff";
}

/** Reduce OKLCH chroma into sRGB, keeping lightness and hue fixed. */
export function fitPaletteColor(
  lightness: number,
  colorfulness: number,
  hue: number,
): string {
  const l = Math.max(0, Math.min(1, lightness));
  const h = Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : 0;
  let low = 0;
  let high = Math.max(0, colorfulness);
  const candidate = chroma.oklch(l, high, h);
  if (!candidate.clipped()) return candidate.hex("rgb");
  for (let step = 0; step < 24; step++) {
    const mid = (low + high) / 2;
    if (chroma.oklch(l, mid, h).clipped()) high = mid;
    else low = mid;
  }
  return chroma.oklch(l, low, h).hex("rgb");
}

export function explorePalette({
  baseHex,
  existing,
  strategy,
  count,
}: {
  readonly baseHex: string;
  readonly existing: readonly PaletteColor[];
  readonly strategy: PaletteStrategy;
  readonly count: number;
}): {
  suggestions: PaletteColor[];
  warnings: PaletteWarning[];
  message: string | null;
} {
  const requested = Number.isFinite(count)
    ? Math.max(1, Math.min(5, Math.trunc(count)))
    : 3;
  const capacity = Math.max(0, PALETTE_LIMIT - existing.length);
  const target = Math.min(requested, capacity);
  if (!HEX.test(baseHex) || existing.some((color) => !HEX.test(color.hex))) {
    return {
      suggestions: [],
      warnings: [],
      message: "请先修正无效色号，再探索配色。",
    };
  }
  if (!target)
    return {
      suggestions: [],
      warnings: paletteWarnings(existing),
      message: "已达 12 色上限，请删除颜色后再探索。",
    };
  const [l, c, rawHue] = chroma(baseHex).oklch();
  const neutral = !Number.isFinite(rawHue) || c < 0.02;
  const hue = neutral ? 0 : rawHue;
  const offsets =
    strategy === "analogous"
      ? [30, -30, 60, -60, 30]
      : strategy === "complementary"
        ? [180, 150, 210, 180, 150]
        : [0, 0, 0, 0, 0];
  const lightnessSteps = [0.12, -0.12, 0.24, -0.24, 0.36];
  const seen = new Set(existing.map((color) => color.hex.toLowerCase()));
  seen.add(baseHex.toLowerCase());
  const suggestions: PaletteColor[] = [];
  // A bounded second pass gives black/white and repeated colors useful tones.
  const candidates = [
    ...lightnessSteps.map((step, i) => ({
      l: Math.max(0.08, Math.min(0.95, l + step)),
      offset: offsets[i] ?? 0,
    })),
    ...[0.35, 0.65, 0.2, 0.8, 0.5].map((value, i) => ({
      l: value,
      offset: offsets[i] ?? 0,
    })),
  ];
  for (const candidate of candidates) {
    const hex = fitPaletteColor(
      candidate.l,
      neutral ? 0 : c,
      hue + (neutral ? 0 : candidate.offset),
    );
    if (seen.has(hex)) continue;
    seen.add(hex);
    suggestions.push({
      hex,
      name: `建议色 ${existing.length + suggestions.length + 1}`,
    });
    if (suggestions.length === target) break;
  }
  return {
    suggestions,
    warnings: paletteWarnings([...existing, ...suggestions]),
    message:
      suggestions.length < target
        ? `去除重复颜色后，可追加 ${suggestions.length} 色。`
        : capacity < requested
          ? `受 12 色上限限制，本次可追加 ${suggestions.length} 色。`
          : null,
  };
}
