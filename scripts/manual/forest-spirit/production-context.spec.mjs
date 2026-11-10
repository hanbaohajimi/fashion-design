import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { isAllowedLayerId, readProductionContext, repo } from "./production-context.mjs";

const spec = "doc/design/forest-spirit/production/front-v8/layers.json";
test("reserved temporary composites are accepted only in an explicitly diagnostic manifest", () => {
  assert.equal(isAllowedLayerId("__TEMP_Body", "head-stage", true), true);
  assert.equal(isAllowedLayerId("__TEMP_HeadHairHat", "head-stage", true), true);
  assert.equal(isAllowedLayerId("__TEMP_Body", "head-stage", false), false);
  assert.equal(isAllowedLayerId("__TEMP_Body", "production-p0", true), false);
  assert.equal(isAllowedLayerId("Face_Base", "production-p0", false), true);
});
test("v8 reads its actual 72-part native canvas specification and separate output root", async () => {
  const context = await readProductionContext({ spec, "output-root": "output/forest-spirit-production-v2/front-v8/validation/context-test" });
  assert.equal(context.characterId, "forest-spirit-front-v8");
  assert.deepEqual(context.specification.working_canvas, [971, 1620]);
  assert.equal(context.p0Layers.length, 72);
  assert.ok(!context.p0Layers.some(layer => /Bell/u.test(layer.id)));
});
test("a new version cannot silently select or overwrite the historical output root", async () => {
  await assert.rejects(readProductionContext({ spec }), /explicit --output-root/);
  await assert.rejects(readProductionContext({ spec, "output-root": "output/forest-spirit-production-v2" }), /cannot overwrite/);
  await assert.rejects(readProductionContext({ spec, "output-root": "doc/design/forest-spirit" }), /inside repository output/);
});
test("legacy defaults remain available without rewriting historical artifacts", async () => {
  const context = await readProductionContext({});
  assert.equal(context.characterId, "forest-spirit-approved-v2");
  assert.equal(context.outputRoot, path.join(repo, "output/forest-spirit-production-v2"));
  assert.deepEqual(context.specification.working_canvas, [982, 1602]);
  assert.equal(context.p0Layers.length, 73);
});
