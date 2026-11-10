import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveDrawableContract } from "./drawable-source-contract.mjs";

const spec = JSON.parse(await readFile(new URL("../../../doc/design/forest-spirit/production/front-v8/layers.json", import.meta.url)));
function declarationFixture() {
  const contract = resolveDrawableContract(spec);
  contract.sourceToDrawables.Arm_R_Upper.push("Arm_R_Upper_Front");
  return { schemaVersion: 1, characterId: spec.characterId, sourceLayerCount: 72, drawableCount: 73, sourceMetadataSha256: "a".repeat(64), sourceToDrawables: contract.sourceToDrawables };
}
test("legacy model expects exactly the frozen 72 source IDs", () => {
  const contract = resolveDrawableContract(spec);
  assert.deepEqual(contract.drawableIds, contract.sourceIds);
  assert.equal(contract.drawableCount, 72);
});
test("explicit Upper split retains all 72 sources and expects exactly 73 drawables", () => {
  const contract = resolveDrawableContract(spec, declarationFixture());
  assert.equal(contract.sourceLayerCount, 72);
  assert.equal(contract.drawableCount, 73);
  assert.ok(contract.drawableIds.includes("Arm_R_Upper_Front"));
  assert.equal(contract.nativeOwnershipVerificationRequired, true);
});
test("missing source, duplicate drawable, unexpected split or changed counts cannot hide behind count 73", () => {
  for (const mutate of [
    d => { delete d.sourceToDrawables.Hand_R; },
    d => { d.sourceToDrawables.Arm_R_Upper[1] = "Hand_R"; },
    d => { d.sourceToDrawables.Hand_R.push("Hand_R_Front"); },
    d => { d.sourceLayerCount = 73; },
    d => { d.sourceMetadataSha256 = "unverified"; },
  ]) { const declaration = declarationFixture(); mutate(declaration); assert.throws(() => resolveDrawableContract(spec, declaration)); }
});
