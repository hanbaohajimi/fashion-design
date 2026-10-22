const INTERNAL_ERROR =
  /TypeError|ReferenceError|SyntaxError|Cannot read|is not (?:a function|defined)|\bat\s+\S+\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE)\b|Prisma|ECONN|fetch failed|Failed to fetch|AbortError|\bstack\b/iu;

/** Preserve business guidance; runtime details belong in the existing diagnostics channel. */
export function userFacingError(
  error: unknown,
  fallback = "操作失败，请重试",
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return message &&
    message.length <= 500 &&
    /\p{Script=Han}/u.test(message) &&
    !INTERNAL_ERROR.test(message)
    ? message
    : fallback;
}
