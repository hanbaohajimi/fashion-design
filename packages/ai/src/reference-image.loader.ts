const DEFAULT_MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_REFERENCE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface LoadedReferenceImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly filename: string;
}

export type ReferenceImageLoader = (
  url: string,
  signal: AbortSignal,
) => Promise<LoadedReferenceImage>;

export class ReferenceImageLoadError extends Error {
  constructor(
    readonly kind: "INVALID_REQUEST" | "INVALID_RESPONSE",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReferenceImageLoadError";
  }
}

export interface ReferenceImageLoaderConfig {
  readonly allowedOrigins: readonly string[];
  readonly maxBytes?: number;
}

export function createReferenceImageLoader(
  config: ReferenceImageLoaderConfig,
): ReferenceImageLoader {
  const allowedOrigins = new Set(
    config.allowedOrigins.map((value) => originFrom(value)),
  );
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_REFERENCE_IMAGE_BYTES;

  return async (value, signal) => {
    const url = parseAllowedUrl(value, allowedOrigins);
    const response = await fetch(url, {
      redirect: "manual",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ReferenceImageLoadError(
        "INVALID_RESPONSE",
        `参考图片下载失败（HTTP ${response.status}）`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new ReferenceImageLoadError(
        "INVALID_RESPONSE",
        "参考图片下载不允许重定向",
      );
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!contentType || !ALLOWED_REFERENCE_IMAGE_TYPES.has(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ReferenceImageLoadError(
        "INVALID_RESPONSE",
        "参考图片格式仅支持 PNG、JPEG 或 WEBP",
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new ReferenceImageLoadError(
        "INVALID_RESPONSE",
        "参考图片超过大小限制",
      );
    }
    const bytes = await readBodyWithLimit(response, maxBytes);
    if (bytes.byteLength === 0) {
      throw new ReferenceImageLoadError("INVALID_RESPONSE", "参考图片为空");
    }
    return {
      bytes,
      contentType,
      filename: filenameFrom(url, contentType),
    };
  };
}

function parseAllowedUrl(value: string, allowedOrigins: Set<string>): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ReferenceImageLoadError("INVALID_REQUEST", "参考图片 URL 无效", {
      cause,
    });
  }
  if (!allowedOrigins.has(url.origin)) {
    throw new ReferenceImageLoadError(
      "INVALID_REQUEST",
      `参考图片来源未加入允许列表：${url.origin}`,
    );
  }
  return url;
}

function originFrom(value: string): string {
  try {
    return new URL(value).origin;
  } catch (cause) {
    throw new Error(`参考图片允许来源配置无效：${value}`, { cause });
  }
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    throw new ReferenceImageLoadError(
      "INVALID_RESPONSE",
      "参考图片响应没有内容",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ReferenceImageLoadError(
          "INVALID_RESPONSE",
          "参考图片超过大小限制",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function filenameFrom(url: URL, contentType: string): string {
  const pathName = decodeURIComponent(url.pathname.split("/").at(-1) || "");
  if (/\.(?:jpe?g|png|webp)$/iu.test(pathName)) {
    return pathName;
  }
  const extension =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : "jpg";
  return `reference.${extension}`;
}
