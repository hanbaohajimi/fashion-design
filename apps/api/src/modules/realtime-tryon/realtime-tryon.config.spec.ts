import { describe, expect, it } from "vitest";
import { readRealtimeTryOnConfig } from "./realtime-tryon.config";
export const validTryOnEnvironment = {
  REALTIME_TRYON_ENABLED: "true", REALTIME_TRYON_ACCESS_MODE: "internal",
  REALTIME_TRYON_ALLOWED_USER_IDS: "allowed", DECART_API_KEY: "fake-test-permanent-key",
  DECART_REALTIME_MODEL: "lucy-vton-3.6", REALTIME_TRYON_MODEL_CONFIRMED: "true",
  REALTIME_TRYON_ALLOWED_ORIGINS: "http://localhost:3000", REALTIME_TRYON_USD_PER_SECOND: "0.02",
  REALTIME_TRYON_PRICE_VERIFIED_AT: "2026-10-29", REALTIME_TRYON_DAILY_BUDGET_USD: "5",
};
describe("实时试穿配置", () => {
  it("默认不可用，完整内部配置可用", () => {
    expect(readRealtimeTryOnConfig({}).configured).toBe(false);
    expect(readRealtimeTryOnConfig(validTryOnEnvironment).configured).toBe(true);
  });
  it.each([
    ["REALTIME_TRYON_ENABLED", "false"], ["DECART_API_KEY", ""], ["DECART_REALTIME_MODEL", "lucy-vton-latest"],
    ["REALTIME_TRYON_ACCESS_MODE", "public"], ["REALTIME_TRYON_ACCESS_MODE", "unknown"],
    ["REALTIME_TRYON_ALLOWED_ORIGINS", "https://example.com/"], ["REALTIME_TRYON_ALLOWED_ORIGINS", "http://localhost:3000,"],
    ["REALTIME_TRYON_ALLOWED_ORIGINS", "https://USER@example.com"], ["REALTIME_TRYON_ALLOWED_ORIGINS", "https://EXAMPLE.com"],
    ["REALTIME_TRYON_USD_PER_SECOND", ""], ["REALTIME_TRYON_USD_PER_SECOND", "0"], ["REALTIME_TRYON_USD_PER_SECOND", "NaN"],
    ["REALTIME_TRYON_DAILY_BUDGET_USD", "0"], ["REALTIME_TRYON_MAX_SESSION_SECONDS", "10000"],
    ["REALTIME_TRYON_TOKEN_TTL_SECONDS", "0"], ["REALTIME_TRYON_MODEL_CONFIRMED", "false"],
    ["REALTIME_TRYON_PRICE_VERIFIED_AT", "invalid"], ["REALTIME_TRYON_MAX_ACTIVE_GLOBAL", ""],
    ["REALTIME_TRYON_PRICE_VERIFIED_AT", "2026-02-31"], ["REALTIME_TRYON_PRICE_VERIFIED_AT", "2999-01-01"],
  ])("配置 %s=%s 时不启用", (key, value) => expect(readRealtimeTryOnConfig({ ...validTryOnEnvironment, [key]: value }).configured).toBe(false));
});
