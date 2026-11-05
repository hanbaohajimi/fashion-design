import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

// A fresh local schema and project-prefixed objects; no provider calls or user's data reset.
const root = resolve(import.meta.dirname, "../..");
const apiRoot = resolve(root, "apps/api");
const dbRoot = resolve(root, "packages/db");
const apiRequire = createRequire(resolve(apiRoot, "package.json"));
const dbRequire = createRequire(resolve(dbRoot, "package.json"));
const envFile = (name) => existsSync(resolve(root, name)) ? dotenv.parse(readFileSync(resolve(root, name))) : {};
const env = { ...envFile(".env.example"), ...envFile(".env"), ...process.env };
const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
for (const value of [env.DATABASE_URL, env.S3_ENDPOINT, env.REDIS_URL]) {
  if (!value || !local.has(new URL(value).hostname)) throw new Error("衣架验证只接受本机 PostgreSQL、Redis 和 MinIO");
}
const url = new URL(env.DATABASE_URL);
const schema = `wardrobe_verify_${Date.now()}`;
url.searchParams.set("schema", schema);
// Prisma's schema option qualifies ORM SQL; billing/outbox raw SQL also needs an isolated search_path.
url.searchParams.set("options", `-c search_path=${schema}`);
const runEnv = { ...env, DATABASE_URL: url.toString(), WARDROBE_TEST_DATABASE_URL: url.toString(), RUN_WARDROBE_LOCAL_INTEGRATION: "1", WARDROBE_ENABLED: "true", WARDROBE_PREPARATION_ENABLED: "true", WARDROBE_STATIC_TRYON_ENABLED: "true", WARDROBE_REALTIME_OUTFIT_ENABLED: "false", AMUX_API_KEY: "local-test-never-used", AMUX_BASE_URL: "http://127.0.0.1:9", DECART_API_KEY: "" };
mkdirSync(resolve(root, "output/wardrobe"), { recursive: true });
writeFileSync(resolve(root, "output/wardrobe/local-environment.json"), JSON.stringify({ schema, providerRequests: 0, createdAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
for (const [file, args, cwd] of [
  [resolve(root, "node_modules/typescript/bin/tsc"), ["-p", "packages/shared/tsconfig.json"], root],
  [dbRequire.resolve("prisma/build/index.js"), ["generate"], dbRoot],
  [resolve(root, "node_modules/typescript/bin/tsc"), ["-p", "tsconfig.build.json"], dbRoot],
  [dbRequire.resolve("prisma/build/index.js"), ["migrate", "deploy"], dbRoot],
  [resolve(apiRequire.resolve("vitest/package.json"), "../vitest.mjs"), ["run", "src/modules/wardrobe"], apiRoot],
]) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, env: runEnv, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`衣架隔离数据库/私有存储验证完成；schema ${schema} 留作审计，供应商调用 0 次。`);
