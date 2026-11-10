import assert from "node:assert/strict";

/** Explicit r17 experiment contract; never changes the old constant-order gate. */
export function validateDynamicFrontOrder(plan, geometry, baselineAudit) {
  assert.equal(plan.frontDrawableId, "Arm_R_Upper_Front");
  assert.equal(plan.productionApproval, false);
  assert.equal(plan.organization.oldPart, "Hair_Front");
  assert.equal(plan.organization.targetPart, "Arm_R");
  assert.deepEqual(plan.organization.targetPartAfterIds, ["Arm_R_Upper_Front", "Arm_R_Lower", "Hand_R", "Arm_R_Upper"]);
  assert.equal(plan.organization.other72RelativeOrderPreserved, true);
  assert.equal(plan.organization.parentDeformerUnchanged, true);
  const keys = [...Array.from({ length: 17 }, (_, i) => i / 16), .45, .55].sort((a, b) => a - b);
  const orders = keys.map(h => h <= .45 ? 500 : h < .55 ? 502 : 503);
  assert.equal(plan.frontOrderGrid.parameterId, "ParamFSHatTouch");
  assert.deepEqual(plan.frontOrderGrid.newUnionKeys, keys);
  assert.deepEqual(plan.frontOrderGrid.nativeIntegralValues, orders);
  assert.equal(plan.frontOrderGrid.maximumScalarDifferenceFromLower, .5);
  assert.equal(plan.frontOrderGrid.exactLowerScalarClaim, false);
  assert.equal(baselineAudit.passed, true);
  assert.ok(baselineAudit.checks.length >= 302 && baselineAudit.checks.every(check => check.passed));
  assert.equal(baselineAudit.inputs.nativeGeometry.nativeCmoSha256, plan.sourceCmo.sha256);
  assert.equal(baselineAudit.inputs.nativeGeometry.sha256, plan.nativeGeometry.sha256);
  const front = geometry.drawables.find(d => d.id === plan.frontDrawableId);
  assert.equal(front.nativeDrawableGuid, plan.frontDrawableGuid);
  assert.equal(front.staticDrawOrder, 500);
  assert.equal(front.absoluteParentLocalForms.length, 19);
  // The native shared Form grid contains all 19 geometry/order keys. The
  // independently exported drawOrder channel can omit redundant constant keys.
  assert.deepEqual(front.nativeFormGrid.bindings, [{ parameterGuid: plan.frontOrderGrid.existingParameterGuid, keys, interpolation: "LINEAR" }]);
  assert.equal(front.nativeFormGrid.cells.length, 19);
  const forms = new Map(front.absoluteParentLocalForms.map(form => [form.guid, form]));
  assert.equal(forms.size, 19);
  for (let i = 0; i < keys.length; i++) {
    const cell = front.nativeFormGrid.cells[i];
    assert.deepEqual(cell.coordinate, [i]);
    assert.equal(forms.get(cell.formGuid)?.drawOrder, orders[i]);
  }
  const channel = front.drawOrderGrid;
  assert.equal(channel.axes.length, 1);
  assert.equal(channel.axes[0].id, "ParamFSHatTouch");
  const channelKeys = channel.axes[0].keys;
  assert.ok(channelKeys.length >= 5 && channelKeys.every((key, i) => keys.includes(key) && (!i || key > channelKeys[i - 1])));
  assert.equal(channelKeys[0], 0); assert.equal(channelKeys.at(-1), 1);
  assert.equal(channel.cells.length, channelKeys.length);
  channel.cells.forEach((cell, i) => { assert.deepEqual(cell.coordinate, [i]); assert.ok(Number.isFinite(cell.value)); });
  for (let i = 0; i < keys.length; i++) {
    const h = keys[i], upper = channelKeys.findIndex(key => key >= h), lower = Math.max(0, upper - 1);
    const t = upper === lower ? 0 : (h - channelKeys[lower]) / (channelKeys[upper] - channelKeys[lower]);
    const value = channel.cells[lower].value * (1 - t) + channel.cells[upper].value * t;
    assert.ok(Math.abs(value - orders[i]) < 1e-10, `Compressed drawOrder differs at native key ${h}`);
  }
  const snapProbeKeys = [.449, .4492, .44921875, .4495, .4505, .45078, .45078125, .451, .4765625, .48046875, .549, .54921875, .54922, .5495, .5505, .55078125, .551];
  const sampleKeys = [...new Set([...Array.from({ length: 257 }, (_, i) => i / 256), ...keys, ...keys.slice(1).map((h, i) => (h + keys[i]) / 2), ...snapProbeKeys])].sort((a, b) => a - b);
  return { keys, orders, sampleKeys, snapProbeKeys, headZ: [-30, 0, 30], baselineMoc: baselineAudit.inputs.moc, baselineModel: baselineAudit.inputs.model };
}
