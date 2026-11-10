import assert from "node:assert/strict";
import test from "node:test";
import { validateDynamicFrontOrder } from "./front-dynamic-order-contract.mjs";

// Auditor-only fixtures, never model files, screenshots or production evidence.
function fixture() {
  const keys = [...Array.from({ length: 17 }, (_, i) => i / 16), .45, .55].sort((a, b) => a - b);
  const orders = keys.map(h => h <= .45 ? 500 : h < .55 ? 502 : 503);
  const result = {
    plan: { frontDrawableId: "Arm_R_Upper_Front", frontDrawableGuid: "test-front", productionApproval: false, organization: { oldPart: "Hair_Front", targetPart: "Arm_R", targetPartAfterIds: ["Arm_R_Upper_Front", "Arm_R_Lower", "Hand_R", "Arm_R_Upper"], other72RelativeOrderPreserved: true, parentDeformerUnchanged: true }, frontOrderGrid: { parameterId: "ParamFSHatTouch", newUnionKeys: keys, nativeIntegralValues: orders, maximumScalarDifferenceFromLower: .5, exactLowerScalarClaim: false }, sourceCmo: { sha256: "test-cmo" }, nativeGeometry: { sha256: "test-geometry" } },
    geometry: { drawables: [{ id: "Arm_R_Upper_Front", nativeDrawableGuid: "test-front", staticDrawOrder: 500, drawOrderGrid: { axes: [{ id: "ParamFSHatTouch", keys }], cells: orders.map((value, index) => ({ coordinate: [index], value })) }, absoluteParentLocalForms: Array.from({ length: 19 }, () => ({})) }] },
    audit: { passed: true, checks: Array.from({ length: 302 }, () => ({ passed: true })), inputs: { nativeGeometry: { nativeCmoSha256: "test-cmo", sha256: "test-geometry" }, moc: {}, model: {} } },
  };
  result.plan.frontOrderGrid.existingParameterGuid = "test-hat-guid";
  const front = result.geometry.drawables[0];
  front.absoluteParentLocalForms = orders.map((drawOrder, i) => ({ guid: `form-${i}`, drawOrder }));
  front.nativeFormGrid = { bindings: [{ parameterGuid: "test-hat-guid", keys, interpolation: "LINEAR" }], cells: keys.map((_, i) => ({ coordinate: [i], formGuid: `form-${i}` })) };
  return result;
}
const run = f => validateDynamicFrontOrder(f.plan, f.geometry, f.audit);
test("explicit19 contract samples all keys, midpoints and dense Hat range", () => {
  const result = run(fixture()); assert.equal(result.keys.length, 19); assert.ok(result.sampleKeys.includes(.45)); assert.ok(result.sampleKeys.includes(.475)); assert.ok(result.sampleKeys.includes(.4492)); assert.ok(result.sampleKeys.includes(.5505)); assert.ok(result.sampleKeys.length >= 257); assert.deepEqual(result.headZ, [-30, 0, 30]);
});
test("rejects a constant or missing native order grid", () => { const f = fixture(); f.geometry.drawables[0].drawOrderGrid = null; assert.throws(() => run(f)); });
test("rejects nonintegral501.5 at the shared middle Form", () => { const f = fixture(); f.plan.frontOrderGrid.nativeIntegralValues[9] = 501.5; assert.throws(() => run(f)); });
test("rejects lost original key or incorrectly ordered organization", () => { const f = fixture(); f.plan.organization.targetPartAfterIds.reverse(); assert.throws(() => run(f)); const g = fixture(); g.geometry.drawables[0].absoluteParentLocalForms.pop(); assert.throws(() => run(g)); });
test("rejects an unrelated baseline or failed prior actual audit", () => { const f = fixture(); f.audit.inputs.nativeGeometry.nativeCmoSha256 = "other"; assert.throws(() => run(f)); const g = fixture(); g.audit.checks[0].passed = false; assert.throws(() => run(g)); });
test("rejects a native curve different from the declared integral plan", () => { const f = fixture(); f.geometry.drawables[0].drawOrderGrid.cells[10].value = 502; assert.throws(() => run(f)); });

test("accepts redundant channel-key compression only with the exact19 native Forms", () => {
  const f = fixture(), front = f.geometry.drawables[0];
  front.drawOrderGrid = { axes: [{ id: "ParamFSHatTouch", keys: [0, .1875, .25, .45, .5, .55, 1] }], cells: [500, 500, 500, 500, 502, 503, 503].map((value, i) => ({ coordinate: [i], value })) };
  assert.equal(run(f).keys.length, 19);
  front.absoluteParentLocalForms[9].drawOrder = 501;
  assert.throws(() => run(f));
});
