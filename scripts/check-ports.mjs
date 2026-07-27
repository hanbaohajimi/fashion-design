import "dotenv/config";

import { execFileSync } from "node:child_process";
import net from "node:net";

const composeServices = new Set();

try {
  const output = execFileSync(
    "docker",
    [
      "ps",
      "--filter",
      "label=com.docker.compose.project=new-fashion-design",
      "--format",
      '{{.Label "com.docker.compose.service"}}',
    ],
    { encoding: "utf8", windowsHide: true },
  );

  for (const service of output.split(/\r?\n/u)) {
    if (service) {
      composeServices.add(service);
    }
  }
} catch {
  // `docker compose up` will provide the actionable Docker error afterwards.
}

const targets = [
  {
    envName: "POSTGRES_PORT",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    service: "postgres",
  },
  {
    envName: "REDIS_PORT",
    port: Number(process.env.REDIS_PORT ?? 6379),
    service: "redis",
  },
  {
    envName: "MINIO_API_PORT",
    port: Number(process.env.MINIO_API_PORT ?? 9000),
    service: "minio",
  },
  {
    envName: "MINIO_CONSOLE_PORT",
    port: Number(process.env.MINIO_CONSOLE_PORT ?? 9001),
    service: "minio",
  },
];

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      reject(error);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true });
  });
}

let hasConflict = false;

for (const target of targets) {
  if (composeServices.has(target.service)) {
    continue;
  }

  if (!(await isPortAvailable(target.port))) {
    hasConflict = true;
    console.error(
      `[端口冲突] ${target.port} 已被占用。请在 .env 中修改 ${target.envName}，` +
        "并同步更新 DATABASE_URL 或 REDIS_URL 后重试。",
    );
  }
}

if (hasConflict) {
  process.exitCode = 1;
} else {
  console.log("PostgreSQL、Redis 与 MinIO 目标端口可用。");
}
