import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const readEnv = async (name) => {
  try { return parse(await readFile(resolve(root, name))); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
};
const example = await readEnv(".env.example");
const env = { ...example, ...await readEnv(".env"), ...process.env };
const [action = "doctor", ...options] = process.argv.slice(2);
const run = (program, args, runtimeEnv = env) => new Promise((done, fail) => {
  const child = spawn(program, args, { cwd: root, env: runtimeEnv, stdio: "inherit" });
  child.once("error", fail);
  child.once("exit", (code, signal) => code === 0 ? done() : fail(new Error(`${program} 执行失败（${signal ?? code}）`)));
});
const pm = async (args, runtimeEnv = env) => {
  if (!process.env.npm_execpath) throw new Error("请通过 pnpm runway:* 运行此工具。");
  await run(process.execPath, [process.env.npm_execpath, ...args], runtimeEnv);
};
const compose = ["compose", "--profile", "runway", "--profile", "runway-test"];
const containerCli = (args, runtimeEnv = env) => run("docker", [...compose, "run", "--build", "--rm", "--no-deps", "runway-worker", "python", "-m", "runway", ...args], runtimeEnv);

async function integration() {
  // Deliberately ignore daily .env and every provider token. This project has its own volumes and ports.
  const isolated = { ...process.env, ...example,
    COMPOSE_PROJECT_NAME: "fashion-runway-test", POSTGRES_DB: "fashion_runway_test",
    POSTGRES_PORT: "35432", REDIS_PORT: "36379", MINIO_API_PORT: "39000", MINIO_CONSOLE_PORT: "39001",
    DATABASE_URL: "postgresql://fashion:fashion_dev@127.0.0.1:35432/fashion_runway_test?schema=public",
    RUNWAY_DATABASE_URL: "", RUNWAY_CONTAINER_DATABASE_URL: "",
    S3_ENDPOINT: "http://127.0.0.1:39000", ASSET_CDN_ORIGIN: "http://127.0.0.1:39000/fashion-assets",
    RUNWAY_ENABLED: "true", RUNWAY_PROVIDER_MODE: "mock", RUNWAY_INTEGRATION: "1", RUNWAY_PIPELINE_INTEGRATION: "1",
    RUNWAY_LLM_API_KEY: "", RUNWAY_IMAGE_API_KEY: "", RUNWAY_VISION_API_KEY: "",
    RUNWAY_VOLC_AK: "", RUNWAY_VOLC_SK: "", RUNWAY_MUSIC_API_KEY: "", LANGSMITH_TRACING: "false",
  };
  const isolatedCompose = ["compose", "--project-name", "fashion-runway-test", "--env-file", ".env.example", "--profile", "runway-test"];
  try {
    await run("docker", [...isolatedCompose, "up", "-d", "--wait", "postgres", "minio"], isolated);
    await run("docker", [...isolatedCompose, "run", "--rm", "minio-init"], isolated);
    await pm(["db:deploy"], isolated);
    await run("docker", [...isolatedCompose, "run", "--build", "--rm", "runway-tests"], isolated);
    await pm(["build:packages"], isolated);
    await run("docker", [...isolatedCompose, "run", "--build", "--rm", "--no-deps", "runway-worker", "python", "-m", "runway", "init-checkpoints"], isolated);
    await run("docker", [...isolatedCompose, "up", "-d", "--wait", "--no-deps", "runway-worker"], isolated);
    await pm(["--filter", "@fashion/api", "exec", "vitest", "run", "src/modules/runway/runway.pipeline.integration.spec.ts"], isolated);
  } finally {
    await run("docker", [...isolatedCompose, "down", "--remove-orphans"], isolated);
  }
}

try {
  if (action === "up") {
    if (!/^(true|1|yes)$/iu.test((env.RUNWAY_ENABLED ?? "").trim())) throw new Error("请在 .env 设置 RUNWAY_ENABLED=true，再启动服装秀执行器。");
    await run("docker", [...compose, "up", "-d", "--wait", "postgres", "minio"]);
    await run("docker", [...compose, "run", "--rm", "minio-init"]);
    await pm(["db:deploy"]);
    await containerCli(["init-checkpoints"]);
    await run("docker", [...compose, "up", "-d", "--wait", "--no-deps", "runway-worker"]);
  } else if (action === "down") {
    await run("docker", [...compose, "stop", "runway-worker"]);
    await run("docker", [...compose, "rm", "--force", "runway-worker"]);
  } else if (action === "doctor") {
    await containerCli(["doctor", ...options]);
  } else if (action === "test") {
    await run("docker", ["build", "--target", "test", "--tag", "fashion-runway-test:local", "apps/runway"]);
    await run("docker", ["run", "--rm", "--network", "none", "fashion-runway-test:local", "python", "-m", "pytest", "-q", "-m", "not integration"]);
  } else if (action === "integration") {
    await integration();
  } else if (action === "smoke") {
    const providerIndex = options.indexOf("--provider");
    const provider = options[providerIndex + 1];
    if (providerIndex < 0 || !["llm", "image", "video", "music"].includes(provider)) throw new Error("请显式指定 --provider llm|image|video|music；此命令调用真实供应商。");
    const evidence = resolve(root, "output/runway-migration/smoke");
    await mkdir(evidence, { recursive: true });
    const writer = typeof process.getuid === "function" ? ["--user", `${process.getuid()}:${process.getgid()}`] : [];
    await run("docker", [...compose, "run", "--build", "--rm", "--no-deps", ...writer, "--volume", `${evidence}:/evidence`,
      "runway-worker", "python", "-m", "runway", "smoke", "--provider", provider, "--output-dir", `/evidence/${provider}`],
    { ...env, RUNWAY_PROVIDER_MODE: "live" });
  } else {
    throw new Error("支持的操作：doctor、up、down、test、integration、smoke。");
  }
} catch (error) {
  // Child errors deliberately contain command names and exit codes, never environment values.
  process.stderr.write(`服装秀工具：${error.message}\n`);
  process.exitCode = 1;
}
