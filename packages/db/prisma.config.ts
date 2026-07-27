import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageDirectory = dirname(fileURLToPath(import.meta.url));

config({
  path: resolve(packageDirectory, "../../.env"),
  quiet: true,
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
