export type ExportFormat = "jpg" | "pdf" | "png";
export type ExportQuality = "high" | "standard";
export type ExportStatus =
  "expired" | "failed" | "queued" | "running" | "succeeded";

export interface ExportCapabilities {
  readonly downloadLinkHours: number;
}

export interface ExportJob {
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly downloadUrl?: string | null;
  readonly error: {
    readonly code: string | null;
    readonly message: string;
  } | null;
  readonly expiresAt: string | null;
  readonly fileName: string | null;
  readonly format: ExportFormat;
  readonly id: string;
  readonly maxEdge: number | null;
  readonly mimeType: string;
  readonly quality: ExportQuality;
  readonly retryAllowed?: boolean;
  readonly sizeBytes: number | null;
  readonly status: ExportStatus;
}

export type ExportSource =
  | {
      readonly assetId: string;
      readonly previewUrl: string;
      readonly type: "asset";
    }
  | {
      readonly collectionId: string;
      readonly name: string;
      readonly previewUrl: string;
      readonly type: "collection";
    };

export class ExportApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ExportApiError";
  }
}

export async function fetchExportCapabilities(): Promise<ExportCapabilities> {
  const response = await fetch("/api/exports/capabilities", {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw await apiError(response, "导出权限读取失败");
  }
  return (await response.json()) as ExportCapabilities;
}

export async function createExport(
  source: ExportSource,
  format: ExportFormat,
  quality: ExportQuality,
): Promise<ExportJob> {
  const body =
    source.type === "asset"
      ? {
          assetId: source.assetId,
          format,
          quality,
          sourceType: "asset",
        }
      : {
          collectionId: source.collectionId,
          format: "pdf",
          quality: "standard",
          sourceType: "collection",
        };
  const response = await fetch("/api/exports", {
    method: "POST",
    body: JSON.stringify(body),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw await apiError(response, "导出任务创建失败");
  }
  return (await response.json()) as ExportJob;
}

export async function fetchExportJob(exportId: string): Promise<ExportJob> {
  const response = await fetch(`/api/exports/${encodeURIComponent(exportId)}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw await apiError(response, "导出状态读取失败");
  }
  return (await response.json()) as ExportJob;
}

async function apiError(
  response: Response,
  fallback: string,
): Promise<ExportApiError> {
  try {
    const body = (await response.json()) as {
      readonly code?: string;
      readonly message?: string;
    };
    return new ExportApiError(
      body.message ?? fallback,
      body.code ?? "EXPORT_REQUEST_FAILED",
    );
  } catch {
    return new ExportApiError(fallback, "EXPORT_REQUEST_FAILED");
  }
}
