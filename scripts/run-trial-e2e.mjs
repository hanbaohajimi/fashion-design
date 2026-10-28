import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const runtime = resolve(root, "output/trial-runtime");
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("请通过 pnpm test:e2e:real 启动隔离验收");
const env = { ...process.env, ...parse(await readFile(resolve(root, ".env.example"))),
  POSTGRES_PORT: "25432", REDIS_PORT: "26379", MINIO_API_PORT: "29000", MINIO_CONSOLE_PORT: "29001",
  DATABASE_URL: "postgresql://fashion:fashion_dev@127.0.0.1:25432/fashion_trial?schema=public", POSTGRES_DB: "fashion_trial",
  REDIS_URL: "redis://127.0.0.1:26379", S3_ENDPOINT: "http://127.0.0.1:29000", ASSET_CDN_ORIGIN: "http://127.0.0.1:29000/fashion-assets",
  APP_ORIGIN: "http://localhost:4300", API_INTERNAL_URL: "http://127.0.0.1:4301", API_PORT: "4301",
  AI_PRIMARY_PROVIDER: "amux", AI_FALLBACK_PROVIDER: "", AMUX_BASE_URL: "http://127.0.0.1:4302/v1", AMUX_API_KEY: "trial-local-only",
  TREND_DIGEST_ENABLED: "false", SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "", NEXT_PUBLIC_POSTHOG_KEY: "",
  EXPORT_PDF_FONT_PATH: process.env.EXPORT_PDF_FONT_PATH ?? "", EXPORT_PDF_FONT_FAMILY: process.env.EXPORT_PDF_FONT_FAMILY ?? "",
  PNPM_VERIFY_DEPS_BEFORE_RUN: "false", TRIAL_E2E: "1", NODE_ENV: "development" };
const compose = ["compose", "--project-name", "fashion-trial", "--env-file", ".env.example", "-f", "docker-compose.yml", "-f", "docker-compose.trial.yml"];
const children = [];
await mkdir(resolve(runtime, "supabase/templates"), { recursive: true });
const run = (command, args, options = {}) => new Promise((done, fail) => {
  const child = spawn(command, args, { cwd: root, env, stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit", ...options });
  let output = "", diagnostics = "";
  if (options.capture) {
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk.toString("utf8")).slice(-8000); });
  }
  child.on("error", fail); child.on("exit", (code) => code === 0 ? done(output) : fail(new Error(`${command} ${args.slice(0, 4).join(" ")} exited ${code}${options.capture ? ": " + output.slice(-2000) + "\n" + diagnostics : ""}`)));
});
const pm = (args, options) => run(process.execPath, [pnpm, ...args], options);
const background = (name, command, args, cwd = root) => {
  const stream = createWriteStream(resolve(runtime, `${name}.log`));
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  child.stdout.pipe(stream); child.stderr.pipe(stream); children.push(child);
  child.on("error", (error) => stream.write(error.message));
  return child;
};
const stopChildren = async () => {
  for (const child of children.splice(0).reverse()) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") await run("taskkill", ["/PID", String(child.pid), "/T", "/F"], { capture: true }).catch(() => undefined);
    else { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ } }
  }
};
const ready = async (url) => {
  for (let tries = 0; tries < 120; tries++) {
    if (children.some((child) => child.exitCode !== null)) throw new Error("验收服务启动失败，请查看 output/trial-runtime/*.log");
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* startup */ }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`服务未就绪: ${url}`);
};
let infraStarted = false;
let authStarted = false;
try {
  await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (process.argv.includes("--reuse-verified-minio")) {
    if (process.arch !== "x64") throw new Error("现有镜像复用校验仅支持 amd64，请运行默认构建");
    const hashes = await run("docker", ["run", "--rm", "--entrypoint", "sha256sum", "fashion-trial-minio:local", "/usr/local/bin/minio", "/usr/local/bin/mc"], { capture: true });
    const expected = [
      "53e2a2cb16c5366ea6fbbc479c19ddb4c6a0948273e752f740fb1fbf27bb817c  /usr/local/bin/minio",
      "ac90da87a35641be5a0ac75d49de5161ddb47d629b5ba01261b0ae9e00aea15f  /usr/local/bin/mc",
    ];
    if (hashes.trim().split(/\r?\n/u).some((line, index) => line !== expected[index]) || hashes.trim().split(/\r?\n/u).length !== 2)
      throw new Error("现有 MinIO 镜像未通过锁定的二进制校验，请运行默认构建");
    process.stdout.write("Reusing MinIO image after verifying both pinned binary hashes.\n");
  } else {
    await run("docker", [...compose, "build", "minio"]);
  }
  infraStarted = true;
  await run("docker", [...compose, "up", "-d", "--wait", "--no-build", "postgres", "redis", "minio"]);
  await run("docker", [...compose, "run", "--rm", "minio-init"]);
  let config = await readFile(resolve(root, "supabase/config.toml"), "utf8");
  config = config.replace('project_id = "new-fashion-design"', 'project_id = "fashion-trial"').replaceAll("543", "553")
    .replaceAll("http://localhost:3000", "http://localhost:4300").replace('sql_paths = ["./seed.sql"]', "sql_paths = []");
  await writeFile(resolve(runtime, "supabase/config.toml"), config, "utf8");
  await copyFile(resolve(root, "supabase/templates/magic_link.html"), resolve(runtime, "supabase/templates/magic_link.html"));
  authStarted = true;
  await pm(["exec", "supabase", "start", "--workdir", runtime], { capture: true });
  const status = JSON.parse(await pm(["exec", "supabase", "status", "--workdir", runtime, "--output", "json"], { capture: true }));
  env.SUPABASE_URL = status.API_URL; env.SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  env.TRIAL_MAIL_URL = "http://127.0.0.1:55324";
  await pm(["db:deploy"]);
  await pm(["build:packages"]);
  if (process.argv.includes("--checks")) {
    // Let Vitest select "test" and Next build select "production". Carrying the
    // trial app's "development" mode into checks starts background consumers
    // inside integration fixtures and lets them steal each other's outbox work.
    const checkEnv = { ...env };
    delete checkEnv.NODE_ENV;
    await pm(["check"], { env: checkEnv });
    await pm(["verify:file-pipeline"]);
  }
  if (process.argv.includes("--contracts")) await pm(["test:e2e"]);
  background("provider", process.execPath, [resolve(root, "scripts/trial-ai-server.mjs")]);
  await ready("http://127.0.0.1:4302/health");
  background("api", process.execPath, [resolve(root, "apps/api/node_modules/tsx/dist/cli.mjs"), "--tsconfig", resolve(root, "apps/api/tsconfig.json"), resolve(root, "apps/api/src/main.ts")]);
  background("worker", process.execPath, [resolve(root, "apps/worker/node_modules/tsx/dist/cli.mjs"), resolve(root, "apps/worker/src/index.ts")]);
  background("web", process.execPath, [resolve(root, "apps/web/node_modules/next/dist/bin/next"), "dev", "--port", "4300"], resolve(root, "apps/web"));
  await ready("http://127.0.0.1:4301/health/ready");
  await ready("http://localhost:4300/login");
  await pm(["exec", "playwright", "test", "--config", "playwright.real.config.ts"]);
  if (process.argv.includes("--real-model-smoke") || process.argv.includes("--assistant-smoke")) {
    await stopChildren();
    const configured = parse(await readFile(resolve(root, ".env")));
    const realEnv = { ...env, ...Object.fromEntries(Object.entries(configured).filter(([key]) => key.startsWith("AMUX_"))) };
    if (!realEnv.AMUX_API_KEY || realEnv.AMUX_API_KEY === "trial-local-only") throw new Error("真实模型令牌未配置");
    if (process.argv.includes("--real-model-smoke")) await run(process.execPath, ["scripts/verify-trial-image-model.mjs"], { env: realEnv });
    await run(process.execPath, ["apps/api/node_modules/tsx/dist/cli.mjs", "--tsconfig", "apps/api/tsconfig.json", "scripts/verify-workflow-assistant.ts"], { env: realEnv });
  }
} finally {
  await stopChildren();
  if (authStarted) await pm(["exec", "supabase", "stop", "--workdir", runtime]).catch(() => undefined);
  if (infraStarted) await run("docker", [...compose, "down", "--remove-orphans"]).catch(() => undefined);
}
