export const AI_ERROR_CODES = [
  "INVALID_REQUEST",
  "AUTH_FAILED",
  "RATE_LIMITED",
  "CONTENT_FLAGGED",
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
  "NOT_FOUND",
  "INVALID_RESPONSE",
  "UNKNOWN",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

interface AiProviderErrorOptions {
  code: AiErrorCode;
  provider: string;
  message: string;
  retryable?: boolean;
  status?: number;
  cause?: unknown;
}

export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(options: AiProviderErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AiProviderError";
    this.code = options.code;
    this.provider = options.provider;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export function normalizeProviderError(
  provider: string,
  error: unknown,
): AiProviderError {
  if (error instanceof AiProviderError) {
    return error;
  }

  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return new AiProviderError({
      code: "TIMEOUT",
      provider,
      message: "AI Provider 请求超时",
      cause: error,
    });
  }

  return new AiProviderError({
    code: "UNKNOWN",
    provider,
    message: "AI Provider 请求失败",
    cause: error,
  });
}
