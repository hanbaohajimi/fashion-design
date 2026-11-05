import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@fashion/db";
import type { OutfitSnapshotView } from "@fashion/shared";
import { RealtimeTryOnService } from "./realtime-tryon.service";
import { RealtimeTryOnSessionRepository } from "./realtime-tryon-session.repository";
import { appendOutfitBinding, assertOutfitCaptureBinding, outfitSessionBindings } from "./outfit-session-bindings";
import type { WardrobeService } from "../wardrobe/wardrobe.service";
import type { ProjectAccessPolicy } from "../studio/project-access.policy";
import type { S3FileStorage } from "../files/storage.service";

const env = { REALTIME_TRYON_ENABLED: "true", REALTIME_TRYON_ACCESS_MODE: "internal", REALTIME_TRYON_ALLOWED_USER_IDS: "allowed", DECART_API_KEY: "fake-key", DECART_REALTIME_MODEL: "lucy-vton-3.6", REALTIME_TRYON_MODEL_CONFIRMED: "true", REALTIME_TRYON_ALLOWED_ORIGINS: "http://localhost:3000", REALTIME_TRYON_USD_PER_SECOND: "0.02", REALTIME_TRYON_PRICE_VERIFIED_AT: "2026-10-29", REALTIME_TRYON_DAILY_BUDGET_USD: "5", WARDROBE_REALTIME_OUTFIT_ENABLED: "true", WARDROBE_REALTIME_MULTI_ITEM_VERIFIED: "true", WARDROBE_REALTIME_CATEGORIES: "top,hat" };
beforeEach(() => { for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value); });
afterEach(() => vi.unstubAllEnvs());
const snapshot: OutfitSnapshotView = { id: "snapshot-v17", outfitId: "outfit", projectId: "project", version: 17, layeringConfirmed: false, name: "套装", referenceAssetId: "reference", createdAt: new Date().toISOString(), prompt: "complete outfit", items: ["top", "hat"].map((category, index) => ({ id: `rev-${index}`, itemId: `item-${index}`, version: 2, sourceAssetId: `source-${index}`, assetId: `asset-${index}`, name: category, category: category as "top" | "hat", display: "hanger", layer: index, wearNote: "保持图案", reviewed: true, anchor: { x: 0.5, y: 0 }, sourceKind: "isolated", generatedCompletion: false, url: "/asset", createdAt: new Date().toISOString() })) };

function fixture() {
  const session = { id: "session", userId: "allowed", projectId: "project", outfitSnapshotId: snapshot.id, garmentAssetId: "reference", modelId: "lucy-vton-3.6", issuedAt: new Date(Date.now() - 1000), riskUntil: new Date(Date.now() + 60_000), maxSessionSeconds: 60, generationSeconds: 0, observationSequence: 0, observation: null as unknown, endedAt: null };
  const db = {
    $executeRaw: vi.fn(),
    designAsset: { findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => where.id ? { id: where.id, projectId: "project", width: 100, height: 100, sourceFile: { status: "READY", mimeType: "image/png", sizeBytes: 100 } } : null), create: vi.fn() },
    fileAsset: { findUnique: vi.fn(async () => ({ id: "capture-file", ownerId: "allowed", status: "READY", mimeType: "image/png", width: 100, height: 100, objectKey: "capture.png", thumbnail1024Key: null })) },
    realtimeTryOnCapture: { findUnique: vi.fn(async () => null), create: vi.fn() },
    realtimeTryOnSession: { findUnique: vi.fn(async () => session), findUniqueOrThrow: vi.fn(async () => session), updateMany: vi.fn(async ({ where, data }: { where: { observationSequence?: { lt: number } }; data: Record<string, unknown> }) => {
      if (where.observationSequence && session.observationSequence >= where.observationSequence.lt) return { count: 0 };
      Object.assign(session, data); return { count: 1 };
    }) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  const repository = new RealtimeTryOnSessionRepository(db as unknown as PrismaClient);
  const reserve = vi.spyOn(repository, "reserve").mockResolvedValue(session as never);
  const access = { require: vi.fn(async () => ({})) };
  const wardrobe = { getSnapshot: vi.fn(async () => snapshot) };
  const tokens = { create: vi.fn(async () => ({ apiKey: "fake-short-token", expiresAt: new Date(Date.now() + 20_000).toISOString() })) };
  const service = new RealtimeTryOnService(repository, access as unknown as ProjectAccessPolicy, tokens, {} as S3FileStorage, wardrobe as unknown as WardrobeService);
  return { service, wardrobe, tokens, reserve, session, db };
}
const create = { projectId: "project", garmentAssetId: "reference", outfitSnapshotId: snapshot.id, consentVersion: "2026-10-29" as const };
const capture = () => ({ fileId: "capture-file", garmentAssetId: "reference", outfitSnapshotId: snapshot.id, garmentRevision: 0, width: 100, height: 100, capturedAt: new Date().toISOString() });

it("rejects unverified multi-item and unsupported categories before reserving budget or issuing a credential", async () => {
  const f = fixture();
  vi.stubEnv("WARDROBE_REALTIME_MULTI_ITEM_VERIFIED", "false");
  await expect(f.service.create("allowed", "key", create)).rejects.toMatchObject({ response: { code: "TRYON_OUTFIT_UNVERIFIED" } });
  vi.stubEnv("WARDROBE_REALTIME_MULTI_ITEM_VERIFIED", "true");
  vi.stubEnv("WARDROBE_REALTIME_CATEGORIES", "top");
  await expect(f.service.create("allowed", "key", create)).rejects.toMatchObject({ response: { code: "TRYON_OUTFIT_UNVERIFIED" } });
  expect(f.tokens.create).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled();
});

it("checks the project-scoped snapshot and its reference rather than trusting client asset pairing", async () => {
  const f = fixture();
  await expect(f.service.create("allowed", "key", { ...create, garmentAssetId: "other-reference" })).rejects.toMatchObject({ response: { code: "TRYON_OUTFIT_REFERENCE_MISMATCH" } });
  f.wardrobe.getSnapshot.mockRejectedValueOnce(new Error("source asset access denied"));
  await expect(f.service.create("allowed", "key", create)).rejects.toThrow("source asset access denied");
  expect(f.tokens.create).not.toHaveBeenCalled();
  await f.service.create("allowed", "key", create);
  expect(f.wardrobe.getSnapshot).toHaveBeenCalledWith("allowed", "project", snapshot.id);
  expect(f.reserve).toHaveBeenCalledWith("allowed", "key", expect.any(String), create, expect.any(Object));
});

it("records immutable snapshot history, ignores stale observations and saves every source with the outfit version", async () => {
  const f = fixture();
  const next = { ...snapshot, id: "snapshot-v18", version: 18 };
  f.wardrobe.getSnapshot.mockResolvedValue(next);
  await f.service.observe("allowed", "session", { sequence: 1, garmentAssetId: "reference", outfitSnapshotId: next.id, garmentRevision: 1 });
  expect((await f.service.observe("allowed", "session", { sequence: 1, garmentAssetId: "reference", outfitSnapshotId: next.id, garmentRevision: 1 })).accepted).toBe(false);
  expect(outfitSessionBindings(f.session)).toHaveLength(2);
  vi.stubEnv("WARDROBE_REALTIME_OUTFIT_ENABLED", "false");
  // Already captured output can still be saved after capabilities are disabled.
  await f.service.capture("allowed", "session", "save", { ...capture(), outfitSnapshotId: next.id, garmentRevision: 1 });
  const asset = f.db.designAsset.create.mock.calls[0]?.[0] as { data: { designStep: { create: { inputSnapshot: { sources: { assetId: string }[]; parameters: Record<string, unknown> } } } } };
  expect(asset.data.designStep.create.inputSnapshot.parameters).toMatchObject({ outfitSnapshotId: "snapshot-v18", outfitVersion: 18, garmentRevision: 1 });
  expect(asset.data.designStep.create.inputSnapshot.sources.map((source) => source.assetId)).toEqual(["asset-0", "asset-1", "source-0", "source-1", "reference"]);
  f.wardrobe.getSnapshot.mockResolvedValue(snapshot);
  await f.service.capture("allowed", "session", "save-initial", capture());
  expect(f.db.designAsset.create).toHaveBeenCalledTimes(2);
});

it("rejects forged capture bindings and loss of outfit association", async () => {
  const f = fixture();
  await expect(f.service.capture("allowed", "session", "save", { ...capture(), garmentRevision: 17 })).rejects.toMatchObject({ response: { code: "TRYON_OUTFIT_CAPTURE_UNBOUND" } });
  const { outfitSnapshotId: _snapshot, ...single } = capture();
  expect(_snapshot).toBe(snapshot.id);
  await expect(f.service.capture("allowed", "session", "save", single)).rejects.toMatchObject({ response: { code: "TRYON_REFERENCE_MODE_MISMATCH" } });
  expect(f.db.designAsset.create).not.toHaveBeenCalled();
});

it("keeps bindings bounded, immutable and independent of snapshot version numbering", () => {
  const f = fixture();
  const next = { outfitSnapshotId: "snapshot-v99", garmentAssetId: "reference-99", garmentRevision: 1 };
  f.session.observation = { outfitBindings: appendOutfitBinding(f.session, next) };
  expect(outfitSessionBindings(f.session)).toHaveLength(2);
  expect(appendOutfitBinding(f.session, next)).toHaveLength(2);
  expect(() => appendOutfitBinding(f.session, { ...next, outfitSnapshotId: "forged" })).toThrow();
  expect(() => assertOutfitCaptureBinding(f.session, { ...next, garmentRevision: 99 })).toThrow();
});
