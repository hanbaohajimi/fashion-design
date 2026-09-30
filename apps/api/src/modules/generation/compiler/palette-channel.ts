function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized ? normalized.slice(0, 48) : null;
}

export function compilePaletteColor(
  color: unknown,
  label: unknown,
): string | null {
  if (typeof color === "string") {
    const match = /^#?([\da-f]{6})$/iu.exec(color.trim());
    if (match?.[1]) {
      return `#${match[1].toUpperCase()}`;
    }
  }
  return cleanLabel(label);
}
