import type {
  CreatedRealtimeTryOnSession,
  CreateRealtimeTryOnSession,
} from "@fashion/shared";

export type RealtimeTryOnStatus =
  | "idle"
  | "requesting-camera"
  | "local-preview"
  | "creating-session"
  | "connecting"
  | "live"
  | "updating-garment"
  | "stopping"
  | "ended"
  | "error";

export interface TryOnGarment {
  assetId: string;
  file: File;
  description?: string;
  outfitSnapshotId?: string;
  outfitPrompt?: string;
}

export interface TryOnGenerationState {
  image: File;
  prompt: string;
  enhance: false;
}

export interface TryOnConnection {
  set(state: TryOnGenerationState): Promise<void>;
  disconnect(): void | Promise<void>;
}

export interface TryOnAdapter {
  connect(options: {
    token: string;
    modelId: string;
    signal: AbortSignal;
    stream: MediaStream;
    initialState: TryOnGenerationState;
    onRemoteStream(stream: MediaStream): void;
    onError(code: string): void;
    onEnded(): void;
    onGeneration(seconds: number): void;
  }): Promise<TryOnConnection>;
}

export interface TryOnObservation {
  sequence: number;
  generationSeconds?: number;
  garmentRevision?: number;
  garmentAssetId?: string;
  outfitSnapshotId?: string;
  connectionState?: string;
  providerSessionId?: string;
}

export interface RealtimeTryOnApi {
  create(input: CreateRealtimeTryOnSession, key: string): Promise<CreatedRealtimeTryOnSession>;
  observe(id: string, observation: TryOnObservation): Promise<unknown>;
  end(id: string, reason: string): Promise<unknown>;
}

export interface TryOnSnapshot {
  status: RealtimeTryOnStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  error: string | null;
  sessionId: string | null;
  garmentAssetId: string | null;
  outfitSnapshotId?: string | null;
  garmentRevision: number;
  canCapture: boolean;
  generationSeconds: number | null;
}

export interface TryOnCapture {
  blob: Blob;
  width: number;
  height: number;
  sessionId: string;
  garmentAssetId: string;
  outfitSnapshotId?: string;
  garmentRevision: number;
  capturedAt: string;
}

export class TryOnError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "TryOnError";
  }
}
