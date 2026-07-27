const NAMED_COLORS = [
  ["black", 0, 0, 0],
  ["white", 255, 255, 255],
  ["charcoal", 54, 69, 79],
  ["gray", 128, 128, 128],
  ["navy", 0, 32, 96],
  ["blue", 30, 90, 180],
  ["teal", 0, 128, 128],
  ["green", 45, 125, 70],
  ["olive", 128, 128, 0],
  ["yellow", 240, 200, 40],
  ["orange", 230, 120, 30],
  ["red", 190, 35, 45],
  ["burgundy", 128, 0, 32],
  ["pink", 225, 120, 155],
  ["purple", 110, 60, 150],
  ["brown", 120, 75, 45],
  ["beige", 220, 205, 170],
] as const;

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized ? normalized.slice(0, 48) : null;
}

export function compilePaletteColor(
  color: unknown,
  label: unknown,
): string | null {
  const explicitLabel = cleanLabel(label);
  if (explicitLabel) return explicitLabel;
  if (typeof color !== "string") return null;
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color.trim());
  if (!match) return null;
  const red = Number.parseInt(match[1] ?? "00", 16);
  const green = Number.parseInt(match[2] ?? "00", 16);
  const blue = Number.parseInt(match[3] ?? "00", 16);
  let nearest: (typeof NAMED_COLORS)[number] = NAMED_COLORS[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of NAMED_COLORS) {
    const score =
      (red - candidate[1]) ** 2 +
      (green - candidate[2]) ** 2 +
      (blue - candidate[3]) ** 2;
    if (score < distance) {
      distance = score;
      nearest = candidate;
    }
  }
  return `${nearest[0]} (${color.toUpperCase()})`;
}
