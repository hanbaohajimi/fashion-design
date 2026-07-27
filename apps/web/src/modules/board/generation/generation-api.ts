import type {
  GenerationParameters,
  GenerationTaskDetail,
} from "./generation-types";

interface CreateGenerationInput extends GenerationParameters {
  readonly projectId: string;
  readonly prompt: string;
  readonly maskImageUrl?: string;
  readonly referenceImageUrl?: string;
  readonly shapeIds: readonly string[];
  readonly strength?: number;
  readonly taskType: "t2i" | "i2i" | "inpaint";
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
): Promise<string> {
  const response = await fetch("/api/generations", {
    method: "POST",
    body: JSON.stringify(input),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw await apiError(response, "生成任务创建失败，请稍后重试");
  }
  const body = (await response.json()) as { readonly task_id: string };
  return body.task_id;
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

export async function uploadTemporaryMask(
  projectId: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<string> {
  const response = await fetch("/api/generations/masks/sign", {
    method: "POST",
    body: JSON.stringify({ height, projectId, size: blob.size, width }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw await apiError(response, "临时掩码签名失败");
  }
  const signed = (await response.json()) as SignedMaskUpload;
  const uploaded = await fetch(signed.upload.url, {
    method: signed.upload.method,
    body: blob,
    headers: signed.upload.headers,
  });
  if (!uploaded.ok) {
    throw new GenerationApiError("掩码上传失败，请重试", "MASK_UPLOAD_FAILED");
  }
  return signed.maskUrl;
}
