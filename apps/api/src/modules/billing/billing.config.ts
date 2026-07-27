const FALLBACK_GENERATION_LIMIT = 100;

export function resolveDefaultGenerationLimit(
  value = process.env.DEFAULT_GEN_LIMIT,
): number {
  if (!value?.trim()) {
    return FALLBACK_GENERATION_LIMIT;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : FALLBACK_GENERATION_LIMIT;
}
