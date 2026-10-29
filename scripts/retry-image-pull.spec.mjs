import assert from "node:assert/strict";
import { test } from "node:test";
import { retryImagePull } from "./retry-image-pull.mjs";

const throttled = new Error("failed to pull docker image: toomanyrequests: retry-after: 207.304µs, allowed: 44000/minute");
const harness = () => {
  const waits = [], reports = [];
  return { waits, reports, options: {
    sleep: async (ms) => { waits.push(ms); },
    report: (message) => { reports.push(message); },
  } };
};

test("successful startup returns immediately without a retry", async () => {
  const { waits, reports, options } = harness();
  assert.equal(await retryImagePull(async () => "ready", options), "ready");
  assert.deepEqual(waits, []);
  assert.deepEqual(reports, []);
});

test("recorded GHCR throttling recovers with bounded backoff", async () => {
  const { waits, reports, options } = harness();
  let calls = 0;
  const result = await retryImagePull(async () => {
    if (++calls < 3) throw throttled;
    return "ready";
  }, options);
  assert.equal(result, "ready");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [15_000, 30_000]);
  assert.match(reports[0], /2\/3/u);
  assert.match(reports[1], /3\/3/u);
});

test("persistent throttling rethrows the last failure after three attempts", async () => {
  const { waits, options } = harness();
  let calls = 0;
  const errors = [throttled, throttled, new Error("error pulling image configuration: 429 Too Many Requests")];
  await assert.rejects(retryImagePull(async () => { throw errors[calls++]; }, options), (error) => error === errors[2]);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [15_000, 30_000]);
});

for (const message of [
  "failed to pull docker image: manifest unknown",
  "failed to pull docker image: unauthorized",
  "database is unhealthy",
  "invalid configuration",
  "application request failed: 429 Too Many Requests",
]) {
  test(`does not retry unrelated failure: ${message}`, async () => {
    const { waits, options } = harness();
    const failure = new Error(message);
    let calls = 0;
    await assert.rejects(retryImagePull(async () => { calls++; throw failure; }, options), (error) => error === failure);
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  });
}

test("an application failure after throttling stops immediately", async () => {
  const { waits, options } = harness();
  const failure = new Error("database is unhealthy");
  let calls = 0;
  await assert.rejects(retryImagePull(async () => {
    if (++calls === 1) throw throttled;
    throw failure;
  }, options), (error) => error === failure);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [15_000]);
});
