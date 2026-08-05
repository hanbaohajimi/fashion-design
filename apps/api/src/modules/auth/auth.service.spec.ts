import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuthFlowError } from "./auth.errors";
import { AuthService } from "./auth.service";
import type { SupabaseAuthGateway } from "./supabase-auth.gateway";

describe("AuthService origin validation", () => {
  const service = new AuthService({} as SupabaseAuthGateway);
  let previousAppOrigin: string | undefined;
  let previousNodeEnv: string | undefined;

  beforeEach(() => {
    previousAppOrigin = process.env.APP_ORIGIN;
    previousNodeEnv = process.env.NODE_ENV;
    process.env.APP_ORIGIN = "http://localhost:3000";
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    if (previousAppOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousAppOrigin;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  it("接受配置的标准来源", () => {
    expect(() =>
      service.assertAllowedOrigin("http://localhost:3000"),
    ).not.toThrow();
  });

  it("开发环境接受同协议同端口的回环地址别名", () => {
    expect(() =>
      service.assertAllowedOrigin("http://127.0.0.1:3000"),
    ).not.toThrow();
  });

  it("拒绝外部来源，并在生产环境拒绝回环地址别名", () => {
    expect(() =>
      service.assertAllowedOrigin("http://example.com:3000"),
    ).toThrow(AuthFlowError);

    process.env.NODE_ENV = "production";
    expect(() =>
      service.assertAllowedOrigin("http://127.0.0.1:3000"),
    ).toThrow(AuthFlowError);
  });
});
