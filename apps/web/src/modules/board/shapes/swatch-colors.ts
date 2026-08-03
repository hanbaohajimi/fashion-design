/**
 * Multi-colour swatch model.
 *
 * A swatch card holds 1..SWATCH_MAX_COLORS colour entries laid out in a single
 * horizontal row (see the physical reference: three tone blocks with small-caps
 * labels underneath). The card's natural width grows with the colour count so
 * every block keeps a comfortable size.
 *
 * Legacy shapes only carry the scalar `color` / `label` props. `getSwatchColors`
 * transparently upgrades those to a single-entry list, and every write mirrors
 * entry 0 back onto the scalar props so existing consumers (role inspector,
 * palette API) keep working.
 */

export interface SwatchColor {
  readonly id: string;
  readonly color: string;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Layout geometry — shared by the shape util, the tool rail and the toolbar
// ---------------------------------------------------------------------------
export const SWATCH_MAX_COLORS = 4;

/** Mirrors `.swatchBody` horizontal padding in shapes.module.css. */
export const SWATCH_PADDING_X = 20;
/** Natural width of one colour cell before flex distribution. */
export const SWATCH_BLOCK_WIDTH = 104;
/** Mirrors `.swatchColorRow` gap. */
export const SWATCH_BLOCK_GAP = 10;
/** Mirrors `.swatchAddCell` width. */
export const SWATCH_ADD_WIDTH = 40;
/** Balanced card height: longer chips with enough room for readable labels. */
export const SWATCH_HEIGHT = 200;

/** Natural card width for a given colour count, including the add button. */
export function computeSwatchWidth(colorCount: number): number {
  const count = Math.max(1, Math.min(SWATCH_MAX_COLORS, colorCount));
  const blocks =
    count * SWATCH_BLOCK_WIDTH + (count - 1) * SWATCH_BLOCK_GAP;
  const addButton =
    count < SWATCH_MAX_COLORS ? SWATCH_BLOCK_GAP + SWATCH_ADD_WIDTH : 0;
  return SWATCH_PADDING_X * 2 + blocks + addButton;
}

// ---------------------------------------------------------------------------
// Hex / HSL conversion
// ---------------------------------------------------------------------------
const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Returns a lowercase `#rrggbb` string, or null when the input is not a hex colour. */
export function normalizeSwatchHex(value: string): string | null {
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const body = match[1] ?? "";
  const full =
    body.length === 3
      ? body
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : body;
  return `#${full.toLowerCase()}`;
}

function hexToRgb(hex: string): readonly [number, number, number] | null {
  const normalized = normalizeSwatchHex(hex);
  if (!normalized) {
    return null;
  }
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ] as const;
}

function rgbToHsl(
  red: number,
  green: number,
  blue: number,
): readonly [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return [0, 0, lightness] as const;
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    hue = ((b - r) / delta + 2) * 60;
  } else {
    hue = ((r - g) / delta + 4) * 60;
  }

  return [hue, saturation, lightness] as const;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, saturation));
  const l = Math.max(0, Math.min(1, lightness));

  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const offset = l - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;
  if (h < 60) {
    red = chroma;
    green = secondary;
  } else if (h < 120) {
    red = secondary;
    green = chroma;
  } else if (h < 180) {
    green = chroma;
    blue = secondary;
  } else if (h < 240) {
    green = secondary;
    blue = chroma;
  } else if (h < 300) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const toHex = (channel: number): string =>
    Math.round((channel + offset) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

/**
 * Derives the next tone in a harmonious ramp from the last entry: a small hue
 * rotation plus a lightness step away from the current value. Keeps generated
 * palettes usable instead of scattering random colours across the card.
 */
export function deriveNextSwatchColor(baseHex: string): string {
  const rgb = hexToRgb(baseHex);
  if (!rgb) {
    return "#c3b49c";
  }
  const [hue, saturation, lightness] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const nextHue = hue + 7;
  const nextSaturation = Math.max(0.06, Math.min(0.7, saturation * 0.93));
  const nextLightness =
    lightness > 0.52
      ? Math.max(0.3, lightness - 0.14)
      : Math.min(0.8, lightness + 0.14);
  return hslToHex(nextHue, nextSaturation, nextLightness);
}

// ---------------------------------------------------------------------------
// Entry helpers
// ---------------------------------------------------------------------------
export function createSwatchColorId(): string {
  return `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createSwatchColor(color: string, label: string): SwatchColor {
  return {
    id: createSwatchColorId(),
    color: normalizeSwatchHex(color) ?? "#c3b49c",
    label,
  };
}

interface SwatchColorSource {
  readonly color: string;
  readonly colors?: readonly SwatchColor[] | undefined;
  readonly label: string;
}

/** Reads the colour list, upgrading legacy single-colour props on the fly. */
export function getSwatchColors(
  props: SwatchColorSource,
): readonly SwatchColor[] {
  const stored = props.colors;
  if (stored && stored.length > 0) {
    return stored;
  }
  return [
    {
      id: "sc-legacy-0",
      color: normalizeSwatchHex(props.color) ?? "#d94f2b",
      label: props.label,
    },
  ];
}

/** Default label for a newly appended entry. */
export function nextSwatchColorLabel(existingCount: number): string {
  return `色彩 ${existingCount + 1}`;
}
