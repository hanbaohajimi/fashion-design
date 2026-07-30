import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 15_000,
    include: ["src/**/*.spec.ts"],
    testTimeout: 15_000,
  },
});
