import { describe, expect, it } from "vitest";
import { isAllowedOrigin, OriginGuard } from "./origin.guard";
import type { ExecutionContext } from "@nestjs/common";

describe("OriginGuard", () => {
  it("rejects absent, opaque, deceptive and sibling origins", () => {
    for (const value of [undefined, "null", "https://evil.example.com", "https://studio.example.com.evil.test", "https://studio.example.com/path", "https://studio.example.com@evil.test"]) {
      expect(isAllowedOrigin(value, "https://studio.example.com", true)).toBe(false);
    }
    expect(isAllowedOrigin("https://studio.example.com", "https://studio.example.com/", true)).toBe(true);
  });
  it("allows same-port development loopback aliases only outside production", () => {
    expect(isAllowedOrigin("http://127.0.0.1:3000", "http://localhost:3000", false)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3001", "http://localhost:3000", false)).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:3000", "http://localhost:3000", true)).toBe(false);
  });
  it("protects multipart writes without depending on body or authentication parsing", () => {
    const original = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "https://studio.example.com";
    const request = { method: "POST", get: () => "https://untrusted.example.com" };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    try { expect(() => new OriginGuard().canActivate(context)).toThrow("请求来源无效"); }
    finally { if (original === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = original; }
  });
});
