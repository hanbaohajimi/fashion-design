export const PLATFORM_NAME = "AI 服装设计平台";
export const THUMBNAIL_QUEUE_NAME = "thumbnail";

export interface ThumbnailJobData {
  readonly fileId: string;
}

export interface HealthResponse {
  readonly ok: true;
  readonly ts: string;
}
