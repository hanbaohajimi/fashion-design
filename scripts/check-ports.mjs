import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";

const targets = [
  { envName: "POSTGRES_PORT", defaultPort: 5432, fallbackPort: 15432, service: "postgres", urls: ["DATABASE_URL"] },
  { envName: "REDIS_PORT", defaultPort: 6379, fallbackPort: 16379, service: "redis", urls: ["REDIS_URL"] },
  { envName: "MINIO_API_PORT", defaultPort: 9000, fallbackPort: 19000, service: "minio", urls: ["S3_ENDPOINT", "ASSET_CDN_ORIGIN"] },
  { envName: "MINIO_CONSOLE_PORT", defaultPort: 9001, fallbackPort: 19001, service: "minio", urls: [] },
];
const fallbackAttempts = 100;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function probePort(port, createServer = net.createServer) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve({ available: false, code: error.code });
      else reject(error);
    });
    server.once("listening", () => {
      server.close(() => resolve({ available: true }));
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true });
  });
}

function endpointUpdates(env, target, oldPort, newPort) {
  const updates = { [target.envName]: String(newPort) };
  for (const key of target.urls) {
    const optional = key === "ASSET_CDN_ORIGIN";
    let url;
    try { url = new URL(env[key]); }
    catch {
      if (optional && !env[key]) continue;
      throw new Error(`${key} 不是有效连接地址，请手动核对本地配置。`);
    }
    const expectedProtocols = key === "DATABASE_URL" ? ["postgresql:", "postgres:"]
      : key === "REDIS_URL" ? ["redis:", "rediss:"] : ["http:", "https:"];
    const port = Number(url.port || (url.protocol === "https:" ? 443 : url.protocol === "http:" ? 80 : target.defaultPort));
    if (!loopbackHosts.has(url.hostname) || port !== oldPort || !expectedProtocols.includes(url.protocol)) {
      if (optional) continue;
      throw new Error(`${key} 未指向同一台本机的 ${oldPort} 端口；自动避让不会改写远程或不一致的连接地址。`);
    }
    url.port = String(newPort);
    updates[key] = url.toString();
  }
  return updates;
}

export async function checkPorts(env, { repair = false, ownedPorts = new Map(), probe = probePort } = {}) {
  const updates = {};
  const errors = [];
  const messages = [];
  const selected = new Set();
  const configured = new Set(targets.map((target) => Number(env[target.envName] ?? target.defaultPort)));
  for (const target of targets) {
    const port = Number(env[target.envName] ?? target.defaultPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`[配置错误] ${target.envName} 必须为 1–65535 的整数。`);
      continue;
    }
    if (!selected.has(port) && ownedPorts.get(target.service)?.has(port)) {
      selected.add(port);
      continue;
    }
    const status = selected.has(port) ? { available: false, code: "EADDRINUSE" } : await probe(port);
    if (status.available) {
      selected.add(port);
      continue;
    }
    const reason = status.code === "EACCES" ? "被系统拒绝绑定，可能处于 Windows 保留范围" : "已被占用";
    if (!repair) {
      errors.push(`[端口不可用] ${port} ${reason}（${status.code}）。请修改 .env 中的 ${target.envName}` +
        (target.urls.length ? ` 并同步 ${target.urls.join("、")}` : "") + "，或使用本地一键启动自动避让。");
      continue;
    }
    try {
      let replacement;
      for (let offset = 0; offset < fallbackAttempts; offset++) {
        const candidate = target.fallbackPort + offset;
        if (!selected.has(candidate) && !configured.has(candidate) && (await probe(candidate)).available) {
          replacement = candidate;
          break;
        }
      }
      if (!replacement) throw new Error(`${target.envName} 没有找到可用替代端口，请手动设置。`);
      const endpointChanges = endpointUpdates(env, target, port, replacement);
      Object.assign(updates, endpointChanges);
      selected.add(replacement);
      messages.push(`${target.envName}: ${port} → ${replacement}（${status.code}），同步 ${Object.keys(endpointChanges).join("、")}。`);
    } catch (error) {
      errors.push(`[无法自动避让] ${error.message}`);
    }
  }
  return { updates, errors, messages };
}

export function updateDotEnvContent(source, updates) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  let content = source;
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^([\\t \\uFEFF]*(?:export[\\t ]+)?${key}[\\t ]*=)[^\\r\\n]*`, "gm");
    const encoded = /^\d+$/u.test(value) ? value : JSON.stringify(value);
    if (pattern.test(content)) content = content.replace(pattern, (_line, prefix) => prefix + encoded);
    else content += (content.endsWith("\n") || !content ? "" : newline) + `${key}=${encoded}${newline}`;
  }
  return content;
}

export function publishedPorts(value) {
  const ports = new Set();
  for (const match of value.matchAll(/:(\d+)(?:-(\d+))?->/gu)) {
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end > 65535) continue;
    for (let port = start; port <= end; port++) ports.add(port);
  }
  return ports;
}

function runningProjectPorts(env) {
  const owned = new Map();
  try {
    const output = execFileSync("docker", ["ps", "--filter",
      `label=com.docker.compose.project=${env.COMPOSE_PROJECT_NAME ?? "new-fashion-design"}`,
      "--format", '{{.Label "com.docker.compose.service"}}|{{.Ports}}'], { encoding: "utf8", windowsHide: true });
    for (const line of output.split(/\r?\n/u)) {
      const [service, published = ""] = line.split("|");
      if (service) owned.set(service, publishedPorts(published));
    }
  } catch {
    // Compose will report an unavailable daemon; this check only concerns host ports.
  }
  return owned;
}

async function main() {
  const inherited = { ...process.env };
  const envFile = resolve(process.env.DOTENV_CONFIG_PATH ?? ".env");
  config({ path: envFile, quiet: true });
  const repair = process.argv.includes("--repair-local");
  if (repair && process.env.NODE_ENV === "production") throw new Error("自动端口避让仅用于本地开发，不修改生产配置。");
  const result = await checkPorts(process.env, { repair, ownedPorts: runningProjectPorts(process.env) });
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  if (Object.keys(result.updates).length) {
    if (!existsSync(envFile)) throw new Error("缺少 .env，请先从 .env.example 创建本地配置。");
    for (const key of Object.keys(result.updates)) {
      if (Object.hasOwn(inherited, key) && inherited[key] !== result.updates[key]) {
        throw new Error(`${key} 被当前终端环境覆盖，请先移除该覆盖值，再运行本地启动。未改动 .env。`);
      }
    }
    const source = readFileSync(envFile, "utf8");
    const temporary = `${envFile}.port-repair-${randomUUID()}`;
    try {
      writeFileSync(temporary, updateDotEnvContent(source, result.updates), { encoding: "utf8", mode: statSync(envFile).mode });
      renameSync(temporary, envFile);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    for (const message of result.messages) console.log(message);
    console.log("已保存本地端口配置，原有数据库卷与其他配置保持完整。");
  } else {
    console.log("PostgreSQL、Redis 与 MinIO 目标端口可用。");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[启动检查失败] ${error.message}`);
    process.exitCode = 1;
  });
}
