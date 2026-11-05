import { REALTIME_TRYON_MODELS } from "@fashion/shared";

type Environment = Record<string, string | undefined>;
export function readRealtimeTryOnConfig(env: Environment = process.env) {
  const errors: string[] = [];
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) { errors.push(key); return fallback; }
    return value;
  };
  const money = (key: string) => {
    const value = env[key]?.trim() ?? "";
    if (!/^\d{1,8}(\.\d{1,6})?$/u.test(value)) errors.push(key);
    return value || "0";
  };
  const enabled = env.REALTIME_TRYON_ENABLED === "true";
  if (env.REALTIME_TRYON_ENABLED && !["true", "false"].includes(env.REALTIME_TRYON_ENABLED)) errors.push("enabled");
  const accessMode = env.REALTIME_TRYON_ACCESS_MODE ?? "internal";
  if (!["disabled", "internal", "public"].includes(accessMode)) errors.push("access mode");
  const modelId = env.DECART_REALTIME_MODEL ?? "lucy-vton-3.6";
  if (!(REALTIME_TRYON_MODELS as readonly string[]).includes(modelId)) errors.push("model");
  const allowedOrigins = (env.REALTIME_TRYON_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim());
  if (allowedOrigins.length > 20 || allowedOrigins.some((origin) => {
    try { const url = new URL(origin); return !["http:", "https:"].includes(url.protocol) || url.origin !== origin || Boolean(url.username || url.password) || origin.length > 253; }
    catch { return true; }
  })) errors.push("origins");
  const allowedUserIds = (env.REALTIME_TRYON_ALLOWED_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const tokenTtlSeconds = integer("REALTIME_TRYON_TOKEN_TTL_SECONDS", 30, 1, 60);
  const maxSessionSeconds = integer("REALTIME_TRYON_MAX_SESSION_SECONDS", 60, 10, 120);
  const maxActivePerUser = integer("REALTIME_TRYON_MAX_ACTIVE_PER_USER", 1, 1, 2);
  const maxActiveGlobal = integer("REALTIME_TRYON_MAX_ACTIVE_GLOBAL", 1, 1, 20);
  const maxGarmentBytes = integer("REALTIME_TRYON_MAX_GARMENT_BYTES", 5242880, 1, 10485760);
  const usdPerSecond = money("REALTIME_TRYON_USD_PER_SECOND");
  const dailyBudgetUsd = money("REALTIME_TRYON_DAILY_BUDGET_USD");
  const priceVerifiedAt = env.REALTIME_TRYON_PRICE_VERIFIED_AT ?? "";
  const parsedPriceDate = Date.parse(priceVerifiedAt);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(priceVerifiedAt) || !Number.isFinite(parsedPriceDate) || new Date(parsedPriceDate).toISOString().slice(0, 10) !== priceVerifiedAt || parsedPriceDate > Date.now()) errors.push("price date");
  // Public use stays closed until token reuse/concurrency/billing options have been verified.
  const unavailableReason = !enabled || accessMode === "disabled" ? "实时试穿尚未启用" :
    accessMode !== "internal" ? "实时试穿仅开放给内部测试名单" :
    errors.length ? "实时试穿配置尚未完成或包含无效值" :
    !env.DECART_API_KEY?.trim() ? "实时试穿服务尚未配置" :
    env.REALTIME_TRYON_MODEL_CONFIRMED !== "true" ? "尚未确认当前账号的模型权限" :
    !allowedUserIds.length ? "尚未配置内部测试名单" :
    Number(usdPerSecond) <= 0 || Number(dailyBudgetUsd) <= 0 ? "尚未配置费率及测试预算" : undefined;
  return { enabled, configured: !unavailableReason, unavailableReason,
    accessMode: ["internal", "public"].includes(accessMode) ? accessMode as "internal" | "public" : "disabled" as const,
    modelId, allowedOrigins, allowedUserIds, tokenTtlSeconds, maxSessionSeconds,
    maxActivePerUser, maxActiveGlobal, maxGarmentBytes, usdPerSecond, dailyBudgetUsd, priceVerifiedAt };
}
export type RealtimeTryOnConfig = ReturnType<typeof readRealtimeTryOnConfig>;
