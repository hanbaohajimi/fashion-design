import { privateFetch as fetch } from "../../auth/private-fetch";
import type {
  DesignDecisionKind,
  DesignDecisionView,
  DesignPathView,
} from "@fashion/shared";
import type {
  DesignAssetVersion,
  GenerationPaletteColor,
  GenerationParameters,
  GenerationTaskDetail,
  GenerationTaskList,
} from "./generation-types";

interface CreateGenerationInput extends GenerationParameters {
  readonly projectId: string;
  readonly prompt: string;
  readonly maskImageUrl?: string;
  readonly palette?: readonly GenerationPaletteColor[];
  readonly parentAssetId?: string;
  readonly referenceImageUrl?: string;
  readonly shapeIds: readonly string[];
  readonly taskType: "t2i" | "i2i" | "inpaint";
}

export async function fetchDesignPath(
  assetId: string,
): Promise<DesignPathView> {
  const response = await fetch(
    `/api/design-assets/${encodeURIComponent(assetId)}/path`,
    {
      cache: "no-store",
      credentials: "include",
    },
  );
  if (!response.ok) throw await apiError(response, "设计路径读取失败");
  return (await response.json()) as DesignPathView;
}

export async function recordDesignDecision(
  assetId: string,
  kind: DesignDecisionKind,
  reason: string,
  clientRequestId: string,
): Promise<DesignDecisionView> {
  const response = await fetch(
    `/api/design-assets/${encodeURIComponent(assetId)}/decisions`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, reason, clientRequestId }),
    },
  );
  if (!response.ok) throw await apiError(response, "设计选择保存失败");
  return (await response.json()) as DesignDecisionView;
}

export async function fetchAssetVersions(
  assetId: string,
  cursor?: string,
): Promise<{
  readonly items: readonly DesignAssetVersion[];
  readonly nextCursor: string | null;
}> {
  const query = new URLSearchParams({ limit: "10" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(
    `/api/design-assets/${encodeURIComponent(assetId)}/versions?${query}`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) {
    throw await apiError(response, "版本历史读取失败");
  }
  return (await response.json()) as {
    readonly items: readonly DesignAssetVersion[];
    readonly nextCursor: string | null;
  };
}

export async function restoreAssetVersion(
  targetAssetId: string,
  currentAssetId: string,
  clientRequestId?: string,
): Promise<DesignAssetVersion> {
  const response = await fetch(
    `/api/design-assets/${encodeURIComponent(targetAssetId)}/restore`,
    {
      method: "POST",
      body: JSON.stringify({ currentAssetId, clientRequestId }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok) {
    throw await apiError(response, "版本恢复失败");
  }
  return (await response.json()) as DesignAssetVersion;
}

interface ErrorBody {
  readonly code?: string;
  readonly message?: string;
  readonly remaining?: number;
}

export class GenerationApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly remaining?: number,
  ) {
    super(message);
    this.name = "GenerationApiError";
  }
}

async function apiError(
  response: Response,
  fallback: string,
): Promise<GenerationApiError> {
  try {
    const body = (await response.json()) as ErrorBody;
    return new GenerationApiError(
      body.message ?? fallback,
      body.code ?? "GENERATION_REQUEST_FAILED",
      body.remaining,
    );
  } catch {
    return new GenerationApiError(fallback, "GENERATION_REQUEST_FAILED");
  }
}

export async function createGeneration(
  input: CreateGenerationInput,
  idempotencyKey = crypto.randomUUID(),
): Promise<string> {
  const response = await fetch("/api/generations", {
    method: "POST",
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  if (!response.ok) {
    throw await apiError(response, "生成任务创建失败，请稍后重试");
  }
  const body = (await response.json()) as { readonly task_id: string };
  return body.task_id;
}

export async function cancelGeneration(
  taskId: string,
): Promise<GenerationTaskDetail> {
  const response = await fetch(
    `/api/generations/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw await apiError(response, "生成任务取消失败");
  }
  return (await response.json()) as GenerationTaskDetail;
}

export async function fetchGenerationTask(
  taskId: string,
): Promise<GenerationTaskDetail> {
  const response = await fetch(
    `/api/generations/${encodeURIComponent(taskId)}`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) {
    throw await apiError(response, "生成任务状态读取失败");
  }
  return (await response.json()) as GenerationTaskDetail;
}

export async function fetchGenerationTasks(
  projectId: string,
  cursor?: string,
): Promise<GenerationTaskList> {
  const query = new URLSearchParams({ limit: "100", projectId });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/generations?${query}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw await apiError(response, "生成任务历史读取失败");
  }
  return (await response.json()) as GenerationTaskList;
}

export async function setGenerationCandidateDisposition(
  taskId: string,
  index: number,
  disposition: "adopted" | "dismissed",
): Promise<GenerationTaskDetail> {
  const response = await fetch(
    `/api/generations/${encodeURIComponent(taskId)}/candidates/${index}`,
    {
      method: "PATCH",
      body: JSON.stringify({ disposition }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok) {
    throw await apiError(response, "候选状态保存失败");
  }
  return (await response.json()) as GenerationTaskDetail;
}

interface SignedMaskUpload {
  readonly expiresAt: string;
  readonly maskId: string;
  readonly maskUrl: string;
  readonly upload: {
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "PUT";
    readonly url: string;
  };
}

const MASK_UPLOAD_TIMEOUT_MS = 20_000;

async function checksumSha256Base64(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new GenerationApiError(
      "当前浏览器不支持安全掩码上传，请升级浏览器后重试",
      "MASK_CHECKSUM_UNSUPPORTED",
    );
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

export async function uploadTemporaryMask(
  projectId: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<string> {
  const checksumSha256 = await checksumSha256Base64(blob);
  const response = await fetch("/api/generations/masks/sign", {
    method: "POST",
    body: JSON.stringify({
      height,
      projectId,
      checksumSha256,
      size: blob.size,
      width,
    }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw await apiError(response, "临时掩码签名失败");
  }
  const signed = (await response.json()) as SignedMaskUpload;
  if (signed.upload.headers["x-amz-checksum-sha256"] !== checksumSha256) {
    throw new GenerationApiError(
      "掩码签名摘要不匹配，请重试",
      "MASK_CHECKSUM_MISMATCH",
    );
  }
  let uploaded: Response;
  try {
    uploaded = await fetch(signed.upload.url, {
      method: signed.upload.method,
      body: blob,
      headers: signed.upload.headers,
      signal: AbortSignal.timeout(MASK_UPLOAD_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut =
      cause instanceof DOMException &&
      (cause.name === "AbortError" || cause.name === "TimeoutError");
    throw new GenerationApiError(
      timedOut
        ? "掩码上传超时，请检查网络后重试"
        : "掩码上传被浏览器阻止，请检查网络或对象存储跨域配置后重试",
      timedOut ? "MASK_UPLOAD_TIMEOUT" : "MASK_UPLOAD_NETWORK_FAILED",
    );
  }
  if (!uploaded.ok) {
    throw new GenerationApiError("掩码上传失败，请重试", "MASK_UPLOAD_FAILED");
  }
  return signed.maskUrl;
}
