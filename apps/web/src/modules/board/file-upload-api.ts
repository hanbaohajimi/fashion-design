import { privateFetch as fetch, privateRequestSignal } from "../auth/private-fetch";
import { readErrorMessage } from "../auth/auth-api";

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type FileProcessingStatus =
  "PENDING" | "PROCESSING" | "READY" | "FAILED";

export interface UploadedFile {
  readonly error: string | null;
  readonly height: number | null;
  readonly id: string;
  readonly mimeType: string;
  readonly name: string;
  readonly size: number;
  readonly status: FileProcessingStatus;
  readonly thumbnail1024Url: string | null;
  readonly thumbnail256Url: string | null;
  readonly width: number | null;
}

interface SignUploadResponse {
  readonly deduplicated: boolean;
  readonly file: UploadedFile;
  readonly upload: {
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "PUT";
    readonly url: string;
  } | null;
}

export function imageMimeType(file: File): string {
  const declared = file.type.toLowerCase();
  if (declared) {
    return declared;
  }
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return (
    {
      heic: "image/heic",
      heif: "image/heif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    }[extension ?? ""] ?? ""
  );
}

export function validateImage(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has(imageMimeType(file))) {
    return "仅支持 JPG、PNG、WebP 或 HEIC 图片";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "图片不能超过 50MB";
  }
  return null;
}

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function signImageUpload(
  projectId: string,
  file: File,
  signal?: AbortSignal,
): Promise<SignUploadResponse> {
  const response = await fetch("/api/files/sign-upload", {
    ...(signal ? { signal } : {}),
    method: "POST",
    body: JSON.stringify({
      mimeType: imageMimeType(file),
      name: file.name,
      projectId,
      sha256: await sha256Hex(file),
      size: file.size,
    }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "获取上传签名失败"));
  }
  return (await response.json()) as SignUploadResponse;
}

export async function putOriginal(
  upload: NonNullable<SignUploadResponse["upload"]>,
  file: File,
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: { loaded: number; total: number; lengthComputable: boolean }) => void;
  },
): Promise<void> {
  if (options?.onProgress) {
    const signal = privateRequestSignal(options.signal);
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        xhr.upload.onprogress = null;
        xhr.onload = xhr.onerror = xhr.onabort = null;
      };
      const fail = (error: unknown) => { cleanup(); reject(error); };
      const abort = () => { xhr.abort(); fail(signal.reason ?? new DOMException("已取消上传", "AbortError")); };
      xhr.open(upload.method, upload.url);
      // 只发送签名返回的头；浏览器自行设置 Content-Length，不附加账号凭据。
      for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (event) => options.onProgress?.({ loaded: event.loaded, total: event.total, lengthComputable: event.lengthComputable });
      xhr.onload = () => {
        if (signal.aborted) { fail(signal.reason); return; }
        if (xhr.status >= 200 && xhr.status < 300) { cleanup(); resolve(); }
        else fail(new Error("原图直传失败，请检查网络后重试"));
      };
      xhr.onerror = () => fail(new Error("原图直传失败，请检查网络后重试"));
      xhr.onabort = () => fail(signal.reason ?? new DOMException("已取消上传", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      try { xhr.send(file); } catch (error) { fail(error); }
    });
    return;
  }
  const response = await fetch(upload.url, {
    method: upload.method,
    body: file,
    headers: upload.headers,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error("原图直传失败，请检查网络后重试");
  }
}

export async function completeUpload(fileId: string, signal?: AbortSignal): Promise<UploadedFile> {
  const response = await fetch(
    `/api/files/${encodeURIComponent(fileId)}/complete`,
    {
      method: "POST",
      ...(signal ? { signal } : {}),
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "确认上传失败"));
  }
  return (await response.json()) as UploadedFile;
}

export async function fetchUploadedFile(fileId: string, signal?: AbortSignal): Promise<UploadedFile> {
  const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "读取图片状态失败"));
  }
  return (await response.json()) as UploadedFile;
}

export async function waitForThumbnail(
  fileId: string,
  initial?: UploadedFile,
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  const startedAt = Date.now();
  let current = initial;

  while (Date.now() - startedAt < timeoutMs) {
    signal?.throwIfAborted();
    current ??= await fetchUploadedFile(fileId, signal);
    if (current.status === "READY") {
      return current;
    }
    if (current.status === "FAILED") {
      throw new Error(current.error || "缩略图生成失败，请重试");
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => { window.clearTimeout(timer); reject(signal?.reason); };
      const timer = window.setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 350);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    current = await fetchUploadedFile(fileId, signal);
  }
  throw new Error("缩略图生成超时，请稍后重试");
}
