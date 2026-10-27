import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Explicit manual smoke: one short text request against the configured gateway.
const root = resolve(import.meta.dirname, "../..");
try { process.loadEnvFile(resolve(root, ".env.example")); } catch { /* Optional defaults. */ }
try { process.loadEnvFile(resolve(root, ".env")); } catch { /* Environment may be injected. */ }
const require = createRequire(resolve(root, "apps/api/package.json"));
const { createAmuxClaudeClientFromEnv } = require("@fashion/ai");
const started = performance.now();
let firstDeltaMs = null;
let deltaCount = 0;
let last = "";
let networkChunks = 0;
let firstDeltaChunk = null;
let lastDeltaMs = null;
const actualFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await actualFetch(...args);
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
  return new Response(response.body.pipeThrough(new TransformStream({ transform(chunk, controller) { networkChunks++; controller.enqueue(chunk); } })), { status: response.status, headers: response.headers });
};
const report = { gatewayVerified: false, deltaCount: 0, networkChunks: 0, firstDeltaChunk: null, firstDeltaMs: null, lastDeltaMs: null, completedMs: null, incrementalBeforeCompletion: false, error: null };
try {
  const client = createAmuxClaudeClientFromEnv();
  const result = await client.streamJson({
    instructions: "Return the requested structured reply. Put kind before message. No other commentary.",
    prompt: "用一句简短中文说明亚麻适合夏季服装的一个原因。",
    schemaName: "assistant_stream_smoke", maxTokens: 128, timeoutMs: 30_000,
    jsonSchema: { type: "object", properties: { kind: { type: "string", enum: ["reply"] }, message: { type: "string" } }, required: ["kind", "message"], additionalProperties: false },
    parse(value) { if (!value || value.kind !== "reply" || typeof value.message !== "string" || !value.message) throw new Error("Invalid final schema"); return value; },
  }, async ({ text }) => { if (text && text !== last) { firstDeltaMs ??= performance.now() - started; firstDeltaChunk ??= networkChunks; lastDeltaMs = performance.now() - started; deltaCount++; last = text; } });
  report.completedMs = performance.now() - started;
  report.firstDeltaMs = firstDeltaMs; report.deltaCount = deltaCount; report.lastDeltaMs = lastDeltaMs; report.networkChunks = networkChunks; report.firstDeltaChunk = firstDeltaChunk;
  report.incrementalBeforeCompletion = firstDeltaMs !== null && firstDeltaMs < report.completedMs && firstDeltaChunk < networkChunks;
  report.gatewayVerified = report.incrementalBeforeCompletion && last === result.message;
} catch (error) {
  // Never serialize transport headers, environment configuration or API credentials.
  report.error = error instanceof Error ? error.message.replace(/https?:\/\/\S+/gu, "[gateway]") : "Gateway verification failed";
}
globalThis.fetch = actualFetch;
const directory = resolve(root, "output/ui-refinement/assistant-stream"); mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "gateway-smoke.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report));
if (!report.gatewayVerified) process.exitCode = 1;
