import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@fashion/db";
import { REALTIME_TRYON_CONSENT_VERSION, type CreateRealtimeTryOnSession } from "@fashion/shared";
import { RealtimeTryOnService } from "./realtime-tryon.service";
import { RealtimeTryOnSessionRepository } from "./realtime-tryon-session.repository";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";
const env = { REALTIME_TRYON_ENABLED: "true", REALTIME_TRYON_ACCESS_MODE: "internal", REALTIME_TRYON_ALLOWED_USER_IDS: "allowed", DECART_API_KEY: "fake-test-key", DECART_REALTIME_MODEL: "lucy-vton-3.6", REALTIME_TRYON_MODEL_CONFIRMED: "true", REALTIME_TRYON_ALLOWED_ORIGINS: "http://localhost:3000", REALTIME_TRYON_USD_PER_SECOND: "0.02", REALTIME_TRYON_PRICE_VERIFIED_AT: "2026-10-29", REALTIME_TRYON_DAILY_BUDGET_USD: "5" };
beforeEach(() => { for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value); });
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const db = { designAsset: { findUnique: vi.fn().mockResolvedValue({ id: "garment", projectId: "project", width: 100, height: 100, sourceFile: { status: "READY", mimeType: "image/png", sizeBytes: 100 } }) }, realtimeTryOnSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() } };
  const repository = new RealtimeTryOnSessionRepository(db as unknown as PrismaClient);
  const reserve = vi.spyOn(repository, "reserve").mockResolvedValue({ id: "session" } as never);
  const access = { require: vi.fn().mockResolvedValue({}) };
  const tokens = { create: vi.fn().mockResolvedValue({ apiKey: "fake-short-token", expiresAt: new Date(Date.now() + 20_000).toISOString() }) };
  return { db, reserve, access, tokens, service: new RealtimeTryOnService(repository, access as unknown as ProjectAccessPolicy, tokens, new S3FileStorage()) };
}
const input: CreateRealtimeTryOnSession = { projectId: "project", garmentAssetId: "garment", consentVersion: REALTIME_TRYON_CONSENT_VERSION };
it("没有配置只读能力，不签发且不访问供应商", async () => {
  vi.stubEnv("REALTIME_TRYON_ENABLED", "false");
  const { service, tokens, reserve } = fixture();
  expect(service.capabilities("allowed").enabled).toBe(false);
  await expect(service.create("allowed", "request-key", input)).rejects.toMatchObject({ status: 503 });
  expect(tokens.create).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
});
it("允许名单、项目编辑权限和跨项目服装均在签发前验证", async () => {
  const { service, tokens, access, db } = fixture();
  await expect(service.create("other", "request-key", input)).rejects.toMatchObject({ status: 403 });
  db.designAsset.findUnique.mockResolvedValue({ id: "garment", projectId: "other-project" } as never);
  await expect(service.create("allowed", "request-key", input)).rejects.toMatchObject({ status: 404 });
  access.require.mockRejectedValue(new Error("permission denied"));
  await expect(service.create("allowed", "request-key", input)).rejects.toThrow("permission denied");
  expect(tokens.create).not.toHaveBeenCalled();
});
it("永久密钥不进入会话响应和持久化字段", async () => {
  const { service, db, tokens } = fixture();
  const result = await service.create("allowed", "request-key", input);
  expect(result.clientToken).toBe("fake-short-token");
  expect(tokens.create).toHaveBeenCalledOnce();
  expect(JSON.stringify(db.realtimeTryOnSession.updateMany.mock.calls)).not.toMatch(/fake-short-token|fake-test-key/u);
});
it("不确定签发只标记unknown，不自动签发第二次", async () => {
  const { service, db, tokens } = fixture();
  tokens.create.mockRejectedValue(new Error("fake-test-key upstream-url"));
  await expect(service.create("allowed", "request-key", input)).rejects.toMatchObject({ status: 503 });
  expect(tokens.create).toHaveBeenCalledOnce();
  expect(db.realtimeTryOnSession.updateMany).toHaveBeenCalledWith({ where: { id: "session", status: "reserved" }, data: { status: "unknown" } });
});
