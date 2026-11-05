import { z } from "zod";

export const REALTIME_TRYON_CONSENT_VERSION = "2026-10-29";
export const REALTIME_TRYON_SDK_VERSION = "0.2.14";
export const REALTIME_TRYON_MODELS = ["lucy-vton-3.6", "lucy-vton-3.5"] as const;
const id = z.string().min(1).max(100);
export const realtimeTryOnCreateSchema = z.object({
  projectId: id,
  garmentAssetId: id,
  outfitSnapshotId: id.optional(),
  consentVersion: z.literal(REALTIME_TRYON_CONSENT_VERSION),
}).strict();
export const realtimeTryOnObservationSchema = z.object({
  sequence: z.number().int().min(1).max(2_147_483_647),
  generationSeconds: z.number().finite().min(0).max(3600).optional(),
  garmentRevision: z.number().int().min(0).max(100_000).optional(),
  garmentAssetId: id.optional(),
  outfitSnapshotId: id.optional(),
  connectionState: z.string().max(100).optional(),
  providerSessionId: z.string().max(100).optional(),
}).strict();
export const realtimeTryOnCaptureSchema = z.object({
  fileId: id,
  garmentAssetId: id,
  outfitSnapshotId: id.optional(),
  garmentRevision: z.number().int().min(0).max(100_000),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
  capturedAt: z.iso.datetime(),
}).strict();
export const realtimeTryOnEndSchema = z.object({ reason: z.string().min(1).max(100) }).strict();
export type CreateRealtimeTryOnSession = z.infer<typeof realtimeTryOnCreateSchema>;
export type RealtimeTryOnObservation = z.infer<typeof realtimeTryOnObservationSchema>;
export type RealtimeTryOnCapture = z.infer<typeof realtimeTryOnCaptureSchema>;
export interface RealtimeTryOnCapabilities {
  enabled: boolean;
  configured: boolean;
  accessMode: "disabled" | "internal" | "public";
  provider: "decart";
  modelId: string | null;
  maxSessionSeconds: number;
  maxGarmentBytes: number;
  estimatedUsdPerSecond: string | null;
  priceVerifiedAt: string | null;
  unavailableReason?: string;
}
export interface CreatedRealtimeTryOnSession {
  sessionId: string;
  clientToken: string;
  tokenExpiresAt: string;
  modelId: string;
  maxSessionSeconds: number;
  serverNow: string;
  estimatedUsdPerSecond: string;
}
export interface RealtimeTryOnCaptureResult {
  assetId: string;
  url: string;
  source: "realtime-tryon-capture";
}
