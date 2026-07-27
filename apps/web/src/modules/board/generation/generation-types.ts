export type GenerationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export interface GenerationCandidate {
  readonly assetId: string;
  readonly id: string;
  readonly height?: number;
  readonly taskId: string;
  readonly url: string;
  readonly width?: number;
}

export interface GenerationTaskDetail {
  readonly id: string;
  readonly status: GenerationStatus;
  readonly output: unknown;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GenerationTaskItem {
  readonly candidates: readonly GenerationCandidate[];
  readonly connection: "sse" | "polling";
  readonly createdAt: string;
  readonly error: string | null;
  readonly id: string;
  readonly prompt: string;
  readonly status: GenerationStatus;
  readonly taskType: "t2i" | "i2i";
  readonly updatedAt: string;
}

export interface GenerationParameters {
  readonly cfg: number;
  readonly height: number;
  readonly seed?: number;
  readonly steps: number;
  readonly width: number;
}

