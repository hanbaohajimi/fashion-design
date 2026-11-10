import assert from "node:assert/strict";
import test from "node:test";
import { auditEyeDiagnostic, defaultEyeDrawableMap, eyeDiagnosticStates, inspectEyeDrawableInventory } from "./eye-diagnostic-audit.mjs";

// Synthetic measurements only; no model files or fake production screenshots are produced.
const parameterIds = ["ParamAngleX", "ParamAngleY", "ParamAngleZ", "ParamBodyAngleX", "ParamBodyAngleZ", "ParamBreath", "ParamEyeLOpen", "ParamEyeROpen", "ParamFSHatTouch", "ParamFSPickup", "ParamFSSettle", "ParamFSHairBackSway", "ParamFSBraidSway", "ParamFSHatBrimSway", "ParamFSScarfSway", "ParamFSSkirtSway", "ParamFSPouchSway"];
function measurements() {
  return Object.fromEntries(eyeDiagnosticStates.map(state => {
    const parameters = Object.fromEntries(parameterIds.map(id => [id, 0]));
    Object.assign(parameters, { ParamEyeLOpen: state.left, ParamEyeROpen: state.right });
    const drawables = [];
    const mesh = (id, opacity, base) => ({ id, opacity, opacityDeltaFromNeutral: opacity - base, vertexCount: 4, vertexIndexCount: 6, textureIndex: 0, textureIndexValid: true, maximumVertexDisplacementPixels: 0, vertexPositions: [0, 0, 1, 0, 1, 1, 0, 1] });
    for (const side of ["left", "right"]) {
      const ids = defaultEyeDrawableMap[side], value = state[side];
      drawables.push(mesh(ids.open, value, 1), mesh(ids.cross, value, 1), mesh(ids.closed, 1 - value, 0));
    }
    drawables.push(...defaultEyeDrawableMap.preserve.map(id => mesh(id, 1, 1)));
    return [state.name, { parameters, drawables, textureCount: 1, pixelFingerprint: `synthetic-${state.name}`, width: 971, height: 1620, devicePixelRatio: 1, fit: 1, motionsAdvanced: false, physicsAdvanced: false }];
  }));
}
test("complete measurements pass structural checks without claiming visual acceptance", () => {
  const report = auditEyeDiagnostic(measurements(), parameterIds);
  assert.equal(report.passed, true);
  assert.equal(report.transparentClosedDrawablesExported, true);
  assert.equal(report.visualAcceptance, false);
  assert.equal(report.productionApproval, false);
});
test("JSON-style virtual or missing parameters cannot stand in for actual Core enumeration", () => {
  const snapshots = measurements(); delete snapshots.neutral.parameters.ParamEyeLOpen;
  assert.equal(auditEyeDiagnostic(snapshots, parameterIds).passed, false);
});
test("an omitted transparent closed mesh or unassigned atlas is detected", () => {
  const missing = measurements(); missing.neutral.drawables = missing.neutral.drawables.filter(item => item.id !== "Eye_L_Closed");
  assert.equal(auditEyeDiagnostic(missing, parameterIds).transparentClosedDrawablesExported, false);
  const untextured = measurements(); untextured.neutral.drawables.find(item => item.id === "Eye_R_Closed").textureIndex = -1;
  assert.equal(auditEyeDiagnostic(untextured, parameterIds).passed, false);
});
test("neutral inventory separates an exported transparent arc from an unresolved Editor ID mapping", () => {
  const snapshot = measurements().neutral;
  assert.equal(inspectEyeDrawableInventory(snapshot).left.closed.status, "transparent_closed_drawable_exported");
  snapshot.drawables.find(item => item.id === "Eye_L_Closed").id = "ArtMesh18";
  assert.equal(inspectEyeDrawableInventory(snapshot).left.closed.status, "expected_id_not_found_or_actual_editor_mapping_required");
  const mapped = structuredClone(defaultEyeDrawableMap); mapped.left.closed = "ArtMesh18";
  assert.equal(inspectEyeDrawableInventory(snapshot, mapped).left.closed.status, "transparent_closed_drawable_exported");
});
test("cross highlights remaining visible on fully closed eyes fail", () => {
  const snapshots = measurements(); snapshots.closed.drawables.find(item => item.id === "Eye_L_Cross").opacity = 1;
  assert.equal(auditEyeDiagnostic(snapshots, parameterIds).passed, false);
});
test("wrong-side and unintended eyebrow bindings fail", () => {
  const wrongSide = measurements(); wrongSide.leftClosed.drawables.find(item => item.id === "Eye_R_Open").opacityDeltaFromNeutral = -1;
  assert.equal(auditEyeDiagnostic(wrongSide, parameterIds).passed, false);
  const brow = measurements(); brow.half.drawables.find(item => item.id === "Brow_R").maximumVertexDisplacementPixels = 2;
  assert.equal(auditEyeDiagnostic(brow, parameterIds).passed, false);
});
test("an unbound or stepped half-close cannot masquerade as a meaningful middle frame", () => {
  const snapshots = measurements(); snapshots.half.pixelFingerprint = snapshots.closed.pixelFingerprint;
  assert.equal(auditEyeDiagnostic(snapshots, parameterIds).passed, false);
});
