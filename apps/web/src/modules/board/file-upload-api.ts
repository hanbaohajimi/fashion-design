import { privateFetch as fetch } from "../auth/private-fetch";
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
): Promise<SignUploadResponse> {
  const response = await fetch("/api/files/sign-upload", {
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
): Promise<void> {
  const response = await fetch(upload.url, {
    method: upload.method,
    body: file,
    headers: upload.headers,
  });
  if (!response.ok) {
    throw new Error("原图直传失败，请检查网络后重试");
  }
}

export async function completeUpload(fileId: string): Promise<UploadedFile> {
  const response = await fetch(
    `/api/files/${encodeURIComponent(fileId)}/complete`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "确认上传失败"));
  }
  return (await response.json()) as UploadedFile;
}

export async function fetchUploadedFile(fileId: string): Promise<UploadedFile> {
  const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
    cache: "no-store",
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
): Promise<UploadedFile> {
  const startedAt = Date.now();
  let current = initial;

  while (Date.now() - startedAt < timeoutMs) {
    current ??= await fetchUploadedFile(fileId);
    if (current.status === "READY") {
      return current;
    }
    if (current.status === "FAILED") {
      throw new Error(current.error || "缩略图生成失败，请重试");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    current = await fetchUploadedFile(fileId);
  }
  throw new Error("缩略图生成超时，请稍后重试");
}
