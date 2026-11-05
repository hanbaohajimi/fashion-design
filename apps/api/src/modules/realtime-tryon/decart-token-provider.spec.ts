import { afterEach, expect, it, vi } from "vitest";
import { OfficialDecartTokenProvider } from "./decart-token-provider";
import { readRealtimeTryOnConfig } from "./realtime-tryon.config";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("官方 REST 仅签发限定模型、来源、TTL与媒体时长的令牌", async () => {
  vi.stubEnv("DECART_API_KEY", "fake-permanent-key");
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiKey: "fake-client-token", expiresAt: new Date(Date.now() + 20_000).toISOString() })));
  vi.stubGlobal("fetch", request);
  const config = { ...readRealtimeTryOnConfig({}), modelId: "lucy-vton-3.6", allowedOrigins: ["https://app.example.com"], tokenTtlSeconds: 30, maxSessionSeconds: 60 };
  await expect(new OfficialDecartTokenProvider().create(config)).resolves.toMatchObject({ apiKey: "fake-client-token" });
  expect(request).toHaveBeenCalledOnce();
  const call = request.mock.calls[0];
  if (!call) throw new Error("missing request");
  const [url, options] = call;
  expect(url).toBe("https://api.decart.ai/v1/client/tokens");
  expect(JSON.parse(options.body)).toEqual({ expiresIn: 30, allowedModels: ["lucy-vton-3.6"], allowedOrigins: ["https://app.example.com"], constraints: { realtime: { maxSessionDuration: 60 } } });
  expect(options.redirect).toBe("error");
});
it.each(["failure", "expired", "permanent", "invalid"])("%s 响应不泄漏上游数据且不重试", async (kind) => {
  vi.stubEnv("DECART_API_KEY", "fake-permanent-key");
  const request = vi.fn().mockResolvedValue(kind === "failure" ? new Response("SECRET URL CONTENT", { status: 500 }) : new Response(JSON.stringify({ apiKey: kind === "permanent" ? "fake-permanent-key" : "fake-client-token", expiresAt: kind === "invalid" ? "invalid" : new Date(Date.now() - 10).toISOString() })));
  vi.stubGlobal("fetch", request);
  const error = await new OfficialDecartTokenProvider().create(readRealtimeTryOnConfig({})).catch((error: unknown) => error);
  expect(JSON.stringify(error)).not.toMatch(/SECRET|fake-permanent-key/u);
  expect(request).toHaveBeenCalledOnce();
});
it.each([[401, "TRYON_PROVIDER_AUTH_FAILED"], [403, "TRYON_PROVIDER_AUTH_FAILED"], [402, "TRYON_PROVIDER_CREDIT_REQUIRED"], [429, "TRYON_PROVIDER_RATE_LIMITED"]])("HTTP %s 使用固定安全领域错误", async (status, code) => {
  const request = vi.fn().mockResolvedValue(new Response("untrusted secret provider body", { status: Number(status) }));
  vi.stubGlobal("fetch", request);
  await expect(new OfficialDecartTokenProvider().create(readRealtimeTryOnConfig({}))).rejects.toMatchObject({ response: { code } });
  expect(request).toHaveBeenCalledOnce();
});
