import assert from "node:assert/strict";
import test from "node:test";
import { inspectEyeOpacityInvariant, inspectEyeStateOpacity, inspectTriangleDeformation, makeHeadScarfStates } from "./head-scarf-diagnostic-audit.mjs";

const snapshot = points => ({ drawables: [{ id: "test", vertexPositions: points, vertexIndices: [0, 1, 2] }] });
const base = snapshot([0, 0, 1, 0, 0, 1]);
test("rigid translation preserves orientation and area", () => {
  const result = inspectTriangleDeformation(base, snapshot([2, 3, 3, 3, 2, 4]));
  assert.equal(result.passed, true); assert.equal(result.minimumAreaRatio, 1);
});
test("flipped, collapsed and non-finite geometry cannot pass", () => {
  assert.equal(inspectTriangleDeformation(base, snapshot([0, 0, 0, 1, 1, 0])).flips, 1);
  assert.equal(inspectTriangleDeformation(base, snapshot([0, 0, 1, 0, 2, 0])).collapsed, 1);
  assert.equal(inspectTriangleDeformation(base, snapshot([NaN, 0, 1, 0, 0, 1])).passed, false);
});
test("changed topology cannot pass", () => {
  const changed = snapshot([0, 0, 1, 0, 0, 1]); changed.drawables[0].vertexIndices = [0, 2, 1];
  assert.equal(inspectTriangleDeformation(base, changed).passed, false);
});
test("grid includes independent eye combinations and parameter interiors", () => {
  const states = makeHeadScarfStates();
  assert.equal(states.length, 252);
  assert.equal(new Set(states.map(state => state.name)).size, states.length);
  assert.ok(states.some(state => state.parameters.ParamEyeLOpen === 0 && state.parameters.ParamEyeROpen === 1));
  assert.ok(states.some(state => state.parameters.ParamAngleY === 2.5));
});
test("head cannot hide both open eye and cross or reveal a closed arc at a fixed blink value", () => {
  const baseline = { drawables: ["L", "R"].flatMap(side => ["Open", "Cross", "Closed"].map(kind => ({ id: `Eye_${side}_${kind}`, opacity: kind === "Closed" ? 0 : 1 }))) };
  assert.ok(inspectEyeOpacityInvariant(baseline, structuredClone(baseline)).every(check => check.passed));
  const faded = structuredClone(baseline); faded.drawables[0].opacity = 0; faded.drawables[1].opacity = 0;
  assert.ok(inspectEyeOpacityInvariant(baseline, faded).some(check => !check.passed));
  const residual = structuredClone(baseline); residual.drawables[2].opacity = 0.1;
  assert.ok(inspectEyeOpacityInvariant(baseline, residual).some(check => !check.passed));
});

test("full eye opacity accepts only existing1e-6 numerical rounding tolerance", () => {
  const rounded = 0.9999999404;
  assert.equal(inspectEyeStateOpacity({ side: "L", value: 1, open: rounded, cross: rounded, closed: 0 }).passed, true);
  assert.equal(inspectEyeStateOpacity({ side: "R", value: 0, open: 0, cross: 0, closed: rounded }).passed, true);
  for (const faded of [0.99999, 0.99, 0.5, 0]) assert.equal(inspectEyeStateOpacity({ side: "L", value: 1, open: faded, cross: faded, closed: 0 }).passed, false);
});

test("fully closed eyes still require exactly zero open eye and cross", () => {
  for (const residue of [Number.EPSILON, 1e-9, 0.01]) {
    assert.equal(inspectEyeStateOpacity({ side: "L", value: 0, open: 0, cross: residue, closed: 1 }).passed, false);
    assert.equal(inspectEyeStateOpacity({ side: "R", value: 0, open: residue, cross: 0, closed: 1 }).passed, false);
  }
  assert.equal(inspectEyeStateOpacity({ side: "L", value: 1, open: 1, cross: 1, closed: Number.EPSILON }).passed, false);
});

test("cross divergence and nonfinite measured opacity remain rejected", () => {
  assert.equal(inspectEyeStateOpacity({ side: "L", value: 0.5, open: 0.5, cross: 0.49, closed: 0.5 }).passed, false);
  for (const bad of [NaN, Infinity, undefined]) assert.equal(inspectEyeStateOpacity({ side: "L", value: 1, open: bad, cross: 1, closed: 0 }).passed, false);
});
