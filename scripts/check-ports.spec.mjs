import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { test } from "node:test";
import { checkPorts, probePort, publishedPorts, updateDotEnvContent } from "./check-ports.mjs";

const localEnv = () => ({
  POSTGRES_PORT: "5432", DATABASE_URL: "postgresql://user:secret@localhost:5432/design?schema=public",
  REDIS_PORT: "6379", REDIS_URL: "redis://127.0.0.1:6379/2",
  MINIO_API_PORT: "9000", MINIO_CONSOLE_PORT: "9001",
  S3_ENDPOINT: "http://localhost:9000", ASSET_CDN_ORIGIN: "http://localhost:9000/private-assets",
});
const blocked = (ports) => async (port) => ports.has(port) ? { available: false, code: ports.get(port) } : { available: true };

for (const code of ["EACCES", "EADDRINUSE"]) {
  test(`binding ${code} is an unavailable port, not an unhandled rejection`, async () => {
    const createServer = () => {
      const server = new EventEmitter();
      server.listen = () => queueMicrotask(() => server.emit("error", Object.assign(new Error(code), { code })));
      return server;
    };
    assert.deepEqual(await probePort(5432, createServer), { available: false, code });
  });
}

test("real occupied socket is reported and a free socket is released", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve));
  const port = server.address().port;
  try { assert.equal((await probePort(port)).available, false); }
  finally { await new Promise((resolve) => server.close(resolve)); }
  assert.deepEqual(await probePort(port), { available: true });
});

test("strict check explains denied ports without changing configuration", async () => {
  const env = localEnv();
  const result = await checkPorts(env, { probe: blocked(new Map([[5432, "EACCES"]])) });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /5432.*EACCES/u);
  assert.match(result.errors[0], /POSTGRES_PORT.*DATABASE_URL/u);
  assert.deepEqual(result.updates, {});
  assert.equal(env.POSTGRES_PORT, "5432");
});

test("local repair skips unavailable fallback ports and preserves database credentials and query", async () => {
  const result = await checkPorts(localEnv(), { repair: true,
    probe: blocked(new Map([[5432, "EACCES"], [15432, "EADDRINUSE"]])) });
  assert.deepEqual(result.errors, []);
  assert.equal(result.updates.POSTGRES_PORT, "15433");
  assert.equal(result.updates.DATABASE_URL, "postgresql://user:secret@localhost:15433/design?schema=public");
});

test("Redis and MinIO repairs synchronize only matching local endpoints", async () => {
  const result = await checkPorts(localEnv(), { repair: true,
    probe: blocked(new Map([[6379, "EADDRINUSE"], [9000, "EACCES"], [9001, "EACCES"]])) });
  assert.deepEqual(result.errors, []);
  assert.equal(result.updates.REDIS_PORT, "16379");
  assert.equal(result.updates.REDIS_URL, "redis://127.0.0.1:16379/2");
  assert.equal(result.updates.MINIO_API_PORT, "19000");
  assert.equal(result.updates.MINIO_CONSOLE_PORT, "19001");
  assert.equal(result.updates.S3_ENDPOINT, "http://localhost:19000/");
  assert.equal(result.updates.ASSET_CDN_ORIGIN, "http://localhost:19000/private-assets");
});

test("remote database URLs are never rewritten by local repair", async () => {
  const env = { ...localEnv(), DATABASE_URL: "postgresql://user:secret@db.example.com:5432/design" };
  const result = await checkPorts(env, { repair: true, probe: blocked(new Map([[5432, "EACCES"]])) });
  assert.match(result.errors.join("\n"), /DATABASE_URL/u);
  assert.equal(result.updates.DATABASE_URL, undefined);
});

test("inconsistent local URL ports fail without guessing their replacement", async () => {
  const env = { ...localEnv(), DATABASE_URL: "postgresql://user:secret@localhost:6543/design" };
  const result = await checkPorts(env, { repair: true, probe: blocked(new Map([[5432, "EACCES"]])) });
  assert.equal(result.errors.length, 1);
  assert.equal(result.updates.POSTGRES_PORT, undefined);
});

test("external CDN origins remain untouched", async () => {
  const result = await checkPorts({ ...localEnv(), ASSET_CDN_ORIGIN: "https://assets.example.com" },
    { repair: true, probe: blocked(new Map([[9000, "EACCES"]])) });
  assert.deepEqual(result.errors, []);
  assert.equal(result.updates.MINIO_API_PORT, "19000");
  assert.equal(result.updates.ASSET_CDN_ORIGIN, undefined);
});

test("only the actual published port of a running project service is exempted", async () => {
  const ownedPorts = new Map([["postgres", new Set([15432])]]);
  const probe = blocked(new Map([[5432, "EACCES"], [15432, "EADDRINUSE"]]));
  assert.equal((await checkPorts(localEnv(), { ownedPorts, probe })).errors.length, 1);
  assert.deepEqual((await checkPorts({ ...localEnv(), POSTGRES_PORT: "15432" }, { ownedPorts, probe })).errors, []);
});

test("Docker compact port ranges include both MinIO host ports", () => {
  assert.deepEqual([...publishedPorts("127.0.0.1:9000-9001->9000-9001/tcp, [::]:9000-9001->9000-9001/tcp, 6379/tcp")], [9000, 9001]);
  assert.deepEqual([...publishedPorts("127.0.0.1:15432->5432/tcp")], [15432]);
});

for (const port of ["0", "65536", "not-a-number"]) {
  test(`invalid port ${port} produces a configuration error`, async () => {
    const result = await checkPorts({ ...localEnv(), POSTGRES_PORT: port });
    assert.match(result.errors.join("\n"), /POSTGRES_PORT/u);
  });
}

test("configuration updates preserve UTF-8, unrelated secrets and CRLF", () => {
  const source = '\uFEFF# 本地配置\r\nPOSTGRES_PORT=5432\r\nDATABASE_URL="postgresql://u:p%24%26@localhost:5432/db?schema=public"\r\nAMUX_API_KEY="keep-this-value"\r\n';
  const updated = updateDotEnvContent(source, { POSTGRES_PORT: "15432", DATABASE_URL: "postgresql://u:p%24%26@localhost:15432/db?schema=public" });
  assert.match(updated, /POSTGRES_PORT=15432\r\n/u);
  assert.match(updated, /localhost:15432\/db\?schema=public/u);
  assert.match(updated, /AMUX_API_KEY="keep-this-value"\r\n/u);
  assert.ok(updated.startsWith("\uFEFF# 本地配置\r\n"));
  assert.equal(updated.replaceAll("\r\n", "").includes("\n"), false);
});
