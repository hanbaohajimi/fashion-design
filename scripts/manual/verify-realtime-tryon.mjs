import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import dotenv from "dotenv";

// This command never mints a client token or runs a connectivity/inference probe.
const root = resolve(import.meta.dirname, "../..");
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const envFile = (name) => existsSync(resolve(root, name))
  ? dotenv.parse(readFileSync(resolve(root, name))) : {};
const env = { ...envFile(".env.example"), ...envFile(".env"), ...process.env };
const output = resolve(root, "output/realtime-tryon");
mkdirSync(output, { recursive: true });
const args = new Set(process.argv.slice(3));
const command = process.argv[2] ?? "doctor";
const { require: tsRequire } = apiRequire("tsx/cjs/api");
const module = tsRequire(resolve(root, "apps/api/src/modules/realtime-tryon/realtime-tryon.config.ts"), import.meta.url);
const { readRealtimeTryOnConfig } = module.default ?? module;

async function localDependency(value, defaultPort) {
  if (!value) return "未配置";
  try {
    const url = new URL(value);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "非本机地址，未探测";
    const port = Number(url.port || defaultPort);
    return await new Promise((resolve) => {
      const socket = createConnection({ host: url.hostname.replace(/^\[|\]$/gu, ""), port });
      const done = (result) => { socket.destroy(); resolve(result); };
      socket.setTimeout(1000);
      socket.once("connect", () => done("TCP可达，未验证认证/业务"));
      socket.once("error", () => done("TCP不可达"));
      socket.once("timeout", () => done("TCP超时"));
    });
  } catch { return "地址无效"; }
}

async function doctor() {
  const config = readRealtimeTryOnConfig(env);
  let sdk = { installed: false };
  try {
    const sdkModule = await import(pathToFileURL(webRequire.resolve("@decartai/sdk")).href);
    const model = sdkModule.models.realtime(config.modelId);
    const version = JSON.parse(readFileSync(resolve(root, "apps/web/package.json"), "utf8")).dependencies["@decartai/sdk"];
    const installedVersion = webRequire("@decartai/sdk/package.json").version;
    sdk = { installed: true, pinnedVersion: version, installedVersion, exactVersionMatches: installedVersion === version, modelSupported: Boolean(model), width: model.width, height: model.height, fps: model.fps };
  } catch {
    sdk = { installed: false, reason: "SDK 未安装或当前模型不在安装版本中" };
  }
  const report = {
    checkedAt: new Date().toISOString(), mode: "configuration-and-local-tcp-only", node: process.version,
    configured: config.configured, enabled: config.enabled,
    unavailableReason: config.unavailableReason ?? null,
    accessMode: config.accessMode, modelId: config.modelId,
    keyPresent: Boolean(env.DECART_API_KEY?.trim()),
    allowedOriginCount: config.allowedOrigins.filter(Boolean).length,
    allowedUserCount: config.allowedUserIds.length,
    tokenTtlSeconds: config.tokenTtlSeconds, maxSessionSeconds: config.maxSessionSeconds,
    priceVerifiedAt: config.priceVerifiedAt || null, sdk,
    localDependencies: {
      postgres: await localDependency(env.DATABASE_URL, 5432),
      redis: await localDependency(env.REDIS_URL, 6379),
      minio: await localDependency(env.S3_ENDPOINT, 9000),
    },
    providerRequests: 0, liveValidation: "未执行；需独立的真实调用与预算授权",
  };
  writeFileSync(resolve(output, "doctor.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (args.has("--require-ready") && (!config.configured || !sdk.installed || !sdk.exactVersionMatches)) process.exitCode = 1;
}

function runPnpm(commandArgs, runEnv) {
  if (!process.env.npm_execpath) throw new Error("请通过 pnpm tryon:verify 运行");
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...commandArgs], {
    cwd: root, env: runEnv, stdio: "inherit", windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`验证命令失败：pnpm ${commandArgs.join(" ")}`);
}

async function verify() {
  const testEnv = { ...env, REALTIME_TRYON_ENABLED: "false", DECART_API_KEY: "", RUN_LIVE_TRYON_TESTS: "0" };
  const commands = [
    ["--filter", "@fashion/shared", "build"],
    ["--filter", "@fashion/db", "build"],
  ];
  if (args.has("--local")) {
    const database = new URL(env.DATABASE_URL);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) {
      throw new Error("真实依赖验证仅接受本机 PostgreSQL；未对配置数据库执行迁移");
    }
    const schema = `tryon_verify_${Date.now()}`;
    database.searchParams.set("schema", schema);
    testEnv.DATABASE_URL = database.toString();
    testEnv.TRYON_TEST_DATABASE_URL = database.toString();
    testEnv.RUN_TRYON_LOCAL_INTEGRATION = "1";
    writeFileSync(resolve(output, "local-environment.json"), JSON.stringify({ schema, createdAt: new Date().toISOString(), providerRequests: 0 }, null, 2) + "\n", "utf8");
    // Keep this unique schema as audit evidence; never drop the user's database.
    commands.push(["db:deploy"]);
  } else {
    testEnv.RUN_TRYON_LOCAL_INTEGRATION = "0";
  }
  commands.push(
    ["--filter", "@fashion/api", "test", "src/modules/realtime-tryon"],
    ["--filter", "@fashion/web", "test", "src/modules/studio/realtime-tryon", "src/modules/board/workflow/TryOnReferenceEntry.spec.tsx"],
  );
  if (args.has("--browser")) commands.push(["exec", "playwright", "test", "tests/e2e/realtime-tryon.spec.ts", "tests/e2e/realtime-tryon-live-fixture.spec.ts"]);
  for (const entry of commands) runPnpm(entry, testEnv);
  console.log("实时试穿无收费验证完成。真实供应商验证未执行。");
}

try {
  if (command === "doctor") await doctor();
  else if (command === "verify") await verify();
  else throw new Error("支持 doctor 或 verify；此工具没有真实收费 smoke 入口");
} catch (error) {
  // No raw provider/DB exceptions or credentials are printed by this wrapper.
  console.error(error instanceof Error && /^(请通过|真实依赖|验证命令|支持)/u.test(error.message)
    ? error.message : "实时试穿检查失败，请确认本机依赖与配置。详情不包含凭证。");
  process.exitCode = 1;
}
