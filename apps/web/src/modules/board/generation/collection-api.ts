import type {
  CollectionConsistency,
  CollectionDetail,
  CollectionDna,
  CollectionLook,
  CollectionVariationAxis,
  UpdateDnaInput,
} from "./collection-types";

interface ErrorBody {
  readonly code?: string;
  readonly message?: string;
}

export class CollectionApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "CollectionApiError";
  }
}

async function apiError(
  response: Response,
  fallback: string,
): Promise<CollectionApiError> {
  try {
    const body = (await response.json()) as ErrorBody;
    return new CollectionApiError(
      body.message ?? fallback,
      body.code ?? "COLLECTION_REQUEST_FAILED",
    );
  } catch {
    return new CollectionApiError(fallback, "COLLECTION_REQUEST_FAILED");
  }
}

export async function createCollection(
  heroAssetId: string,
): Promise<CollectionDetail> {
  const response = await fetch("/api/collections", {
    method: "POST",
    body: JSON.stringify({ heroAssetId }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw await apiError(response, "系列创建失败，请稍后重试");
  }
  return (await response.json()) as CollectionDetail;
}

export async function fetchCollection(
  collectionId: string,
): Promise<CollectionDetail> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) {
    throw await apiError(response, "系列 DNA 读取失败");
  }
  return (await response.json()) as CollectionDetail;
}

export async function updateCollectionDna(
  collectionId: string,
  input: UpdateDnaInput,
): Promise<CollectionDna> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}/dna`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok) {
    throw await apiError(response, "DNA 自动保存失败");
  }
  return (await response.json()) as CollectionDna;
}

export async function createCollectionLook(
  collectionId: string,
  variationAxis: CollectionVariationAxis,
  prompt?: string,
): Promise<string> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}/looks`,
    {
      method: "POST",
      body: JSON.stringify({
        variationAxis,
        ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
      }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok) {
    throw await apiError(response, "系列 Look 生成任务创建失败");
  }
  const body = (await response.json()) as { readonly task_id: string };
  return body.task_id;
}

export async function fetchCollectionConsistency(
  collectionId: string,
): Promise<CollectionConsistency> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}/consistency`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) {
    throw await apiError(response, "系列参考相似度读取失败");
  }
  return (await response.json()) as CollectionConsistency;
}

export async function forceKeepCollectionLook(
  collectionId: string,
  assetId: string,
): Promise<CollectionLook> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}/looks/${encodeURIComponent(assetId)}/keep`,
    {
      method: "PATCH",
      body: JSON.stringify({ force: true }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok) {
    throw await apiError(response, "强制保留 Look 失败");
  }
  return (await response.json()) as CollectionLook;
}
