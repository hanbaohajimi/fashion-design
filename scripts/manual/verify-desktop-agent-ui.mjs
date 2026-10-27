import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import dotenv from "dotenv";

// All paid provider probes remain opt-in. This runner isolates database/queue tests.
const root = resolve(import.meta.dirname, "../..");
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("请通过 pnpm verify:desktop-ui 启动");
const local = existsSync(resolve(root, ".env")) ? dotenv.parse(readFileSync(resolve(root, ".env"))) : {};
const env = { ...dotenv.parse(readFileSync(resolve(root, ".env.example"))), ...local, ...process.env };
const schema = `desktop_ui_${Date.now()}`;
const database = new URL(env.DATABASE_URL);
database.searchParams.set("schema", schema);
env.DATABASE_URL = database.toString();
const name = `desktop-ui-check-${process.pid}`;
const docker = args => execFileSync("docker", args, { cwd: root, encoding: "utf8", windowsHide: true });
const directory = resolve(root, "output/desktop-agent-ui");
mkdirSync(directory, { recursive: true });
try {
  docker(["run", "--detach", "--rm", "--name", name, "--publish", "127.0.0.1::6379", "redis:7-alpine"]);
  const mapping = docker(["port", name, "6379/tcp"]).trim();
  env.REDIS_URL = `redis://${mapping}`;
  writeFileSync(resolve(directory, "isolated-check-environment.json"), JSON.stringify({ schema, redisContainer: name, node: process.version, platform: process.platform, arch: process.arch }, null, 2));
  for (const command of ["db:deploy", "check"]) {
    const result = spawnSync(process.execPath, [pnpm, command], { cwd: root, env, stdio: "inherit", windowsHide: true });
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
} finally {
  docker(["rm", "--force", name]);
  // Keep the uniquely named schema as audit evidence; never drop a configured database.
}
