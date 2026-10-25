import { privateFetch } from "../../auth/private-fetch";
export class ImageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function imageRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await privateFetch(path, {
    method,
    credentials: "include",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new ImageRequestError(
      error?.message ?? "图片操作失败，请重试",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export async function imageBlob(assetId: string) {
  const response = await privateFetch(
    `/api/design-assets/${encodeURIComponent(assetId)}/file`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("原图下载失败，请重试");
  return response.blob();
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
