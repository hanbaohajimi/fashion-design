import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";
import type { RealtimeTryOnConfig } from "./realtime-tryon.config";

export const DECART_TOKEN_PROVIDER = Symbol("DECART_TOKEN_PROVIDER");
export interface DecartTokenProvider {
  create(config: RealtimeTryOnConfig): Promise<{ apiKey: string; expiresAt: string }>;
}
const tokenSchema = z.object({ apiKey: z.string().min(1), expiresAt: z.string() });
export class DecartTokenError extends ServiceUnavailableException {
  constructor(status: number) {
    const [code, message] = status === 401 || status === 403
      ? ["TRYON_PROVIDER_AUTH_FAILED", "AI 服务鉴权失败，请联系管理员核对模型权限与服务配置"]
      : status === 402 ? ["TRYON_PROVIDER_CREDIT_REQUIRED", "AI 服务要求补充额度，请联系管理员"]
        : status === 429 ? ["TRYON_PROVIDER_RATE_LIMITED", "AI 服务达到请求或容量限制，请稍后手动重试"]
          : ["TRYON_TOKEN_UNCERTAIN", "服务令牌申请结果未知，请等待旧会话风险时限结束后重试"];
    super({ code, message });
  }
}

/** REST boundary matches @decartai/sdk 0.2.14 tokens/client + shared/request.
 * Keep ESM/browser media dependencies outside Nest's CommonJS build. */
@Injectable()
export class OfficialDecartTokenProvider implements DecartTokenProvider {
  async create(config: RealtimeTryOnConfig) {
    try {
      const response = await fetch("https://api.decart.ai/v1/client/tokens", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "X-API-KEY": process.env.DECART_API_KEY ?? "" },
        body: JSON.stringify({
          expiresIn: config.tokenTtlSeconds,
          allowedModels: [config.modelId],
          allowedOrigins: config.allowedOrigins,
          constraints: { realtime: { maxSessionDuration: config.maxSessionSeconds } },
        }),
      });
      // Never forward provider bodies, URLs, headers or exception causes to logging/Sentry.
      if (!response.ok) throw new DecartTokenError(response.status);
      const token = tokenSchema.parse(await response.json());
      const expiry = Date.parse(token.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + (config.tokenTtlSeconds + 5) * 1000 || token.apiKey === process.env.DECART_API_KEY) throw new Error("invalid token");
      return { apiKey: token.apiKey, expiresAt: new Date(expiry).toISOString() };
    } catch (error) {
      if (error instanceof DecartTokenError) throw error;
      throw new ServiceUnavailableException({ code: "TRYON_TOKEN_UNCERTAIN", message: "服务令牌申请结果未知，请等待旧会话风险时限结束后重试" });
    }
  }
}
