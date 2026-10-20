import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(appDirectory, "../../.env");
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const apiOrigin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
// Allow the 15-minute assistant deadline plus a short response/commit margin.
const proxyTimeoutMs = 15 * 60_000 + 5_000;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "host.docker.internal"],
  devIndicators: false,
  experimental: {
    proxyTimeout: proxyTimeoutMs,
  },
  reactStrictMode: true,
  transpilePackages: ["@fashion/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
