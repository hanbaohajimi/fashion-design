import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const orders = {
  Hand_R: 502, Arm_R_Lower: 503, Arm_R_Upper_Front: 503, Cape_R: 504,
  Pouch_Strap: 505, Tool_Roll_A: 505, Tool_Roll_B: 505, Tool_Roll_C: 505,
  Tool_Scissors: 505, Pouch_Back: 505, Pouch_Front: 505, Chest_Button: 505,
};
const scarfMasks = ["Scarf_Back", "Scarf_Lower", "Scarf_Middle", "Scarf_Upper"];
const masks = {
  Arm_R_Upper_Front: scarfMasks,
  Cape_R: ["Braid_Root", "Braid_Mid", "Braid_Tip", "Hair_BraidTie", ...scarfMasks],
};
const formCounts = { Arm_R_Upper: 17, Arm_R_Upper_Front: 57, Arm_R_Lower: 12 };
const floatSha = positions => {
  const bytes = Buffer.alloc(positions.length * 4);
  positions.forEach((value, i) => { assert.ok(Number.isFinite(value)); bytes.writeFloatLE(value, i * 4); });
  return createHash("sha256").update(bytes).digest("hex");
};
const cellKey = cell => JSON.stringify(cell.coordinate);
const normalizedCells = cells => [...cells].sort((a, b) => cellKey(a).localeCompare(cellKey(b)));

export function assertFirstAxisFastGrid(drawable) {
  const grid = drawable.nativeFormGrid;
  const sizes = grid.bindings.map(binding => binding.keys.length);
  assert.equal(grid.cells.length, sizes.reduce((count, size) => count * size, 1), `${drawable.id} native grid cardinality`);
  for (let index = 0; index < grid.cells.length; index++) {
    let stride = 1;
    const coordinate = sizes.map(size => {
      const value = Math.floor(index / stride) % size;
      stride *= size;
      return value;
    });
    assert.deepEqual(grid.cells[index].coordinate, coordinate, `${drawable.id} native serialized cell ${index} must use first-axis-fast order`);
  }
}

export function validateStorageOrderRepair(repair, geometry, failedGeometry) {
  assert.equal(failedGeometry.sourceSha256, repair.sourceCmoSha256);
  assert.deepEqual(repair.drawables.map(d => d.id).sort(), ["Arm_R_Lower", "Arm_R_Upper_Front"]);
  assert.deepEqual(geometry.parameters, failedGeometry.parameters);
  assert.deepEqual(geometry.deformerParents, failedGeometry.deformerParents);
  assert.deepEqual(geometry.drawables.map(d => d.id), failedGeometry.drawables.map(d => d.id));
  for (const current of geometry.drawables) {
    const old = failedGeometry.drawables.find(d => d.id === current.id);
    const change = repair.drawables.find(d => d.id === current.id);
    const expected = structuredClone(old);
    if (change) {
      assert.equal(change.nativeDrawableGuid, old.nativeDrawableGuid);
      assert.deepEqual(change.originalNativeFormGrid, old.nativeFormGrid);
      assert.deepEqual(old.absoluteParentLocalForms.map(f => f.guid), change.preserveFormPoolGuidOrder);
      assert.deepEqual(current.absoluteParentLocalForms.map(f => f.guid), change.preserveFormPoolGuidOrder);
      expected.nativeFormGrid.cells = change.expectedNativeCells;
    }
    assert.deepEqual(current, expected, `${current.id} changed beyond the two approved grid-list permutations`);
    assertFirstAxisFastGrid(current);
  }
  return { repairedGridIds: repair.drawables.map(d => d.id), originalFormPoolsPreserved: true, allOtherGeometryFieldsPreserved: true };
}

// This contract is opt-in and cannot relax the historical constant/dynamic
// Front contracts. Actual pixels, motion, and final visual approval are separate.
export function validateOcclusionComposition(plan, geometry, baselineGeometry, baselineAudit) {
  assert.equal(plan.productionAccepted, false);
  assert.equal(plan.organizationChange, false);
  assert.equal(plan.preserveCape51GeometryAndAllSourceSampling, true);
  assert.equal(plan.preserveAllParameterParentPhysicsAndDisplayFields, true);
  assert.equal(baselineAudit.passed, true);
  assert.ok(baselineAudit.checks.length >= 302 && baselineAudit.checks.every(check => check.passed));
  assert.equal(baselineAudit.inputs.nativeGeometry.nativeCmoSha256, plan.sourceCmoSha256);
  assert.equal(baselineAudit.inputs.nativeGeometry.sha256, plan.sourceGeometrySha256);
  assert.equal(baselineGeometry.sourceSha256, plan.sourceCmoSha256);
  assert.equal(geometry.sourceMetadataSha256, plan.sourceMetadataSha256);
  assert.equal(geometry.drawableDeclarationSha256, plan.drawableMapSha256);
  assert.equal(geometry.drawables.length, 73);
  assert.equal(baselineGeometry.drawables.length, 73);
  assert.equal(geometry.sourceLayerCount, 72);
  assert.deepEqual(geometry.parameters, baselineGeometry.parameters);
  assert.deepEqual(geometry.deformerParents, baselineGeometry.deformerParents);
  assert.deepEqual(geometry.drawables.map(d => d.id), baselineGeometry.drawables.map(d => d.id));
  assert.equal(new Set(plan.expectedPaintOrder).size, 73);
  assert.deepEqual([...plan.expectedPaintOrder].sort(), geometry.drawables.map(d => d.id).sort());
  assert.deepEqual(Object.fromEntries(plan.drawOrderAssignments.map(d => [d.id, d.allFormDrawOrder])), orders);
  assert.equal(plan.drawOrderAssignments.length, 12);
  assert.equal(plan.maskChanges.length, 2);
  assert.deepEqual(plan.drawables.map(d => d.id).sort(), Object.keys(formCounts).sort());

  const oldById = new Map(baselineGeometry.drawables.map(d => [d.id, d]));
  const patches = new Map(plan.drawables.map(d => [d.id, d]));
  const assignments = new Map(plan.drawOrderAssignments.map(d => [d.id, d]));
  for (const change of plan.maskChanges) {
    const old = oldById.get(change.id);
    assert.deepEqual(change.maskIds, masks[change.id]);
    assert.equal(change.invertMaskAfter, true);
    assert.deepEqual(change.originalMaskIds, old.maskIds);
    assert.equal(change.invertMaskBefore, old.invertMask);
  }

  for (const current of geometry.drawables) {
    // r18 proved coordinate-map equality is insufficient: official Core uses
    // the serialized flat list. Hat must be the fast axis in Hat×Z grids.
    assertFirstAxisFastGrid(current);
    const old = oldById.get(current.id), patch = patches.get(current.id);
    const assignment = assignments.get(current.id);
    for (const field of ["nativeDrawableGuid", "sourceLayerId", "sourceTileId", "parentDeformerId", "uvs", "placement", "sourceToCanvas", "opacity", "visible"])
      assert.deepEqual(current[field], old[field], `${current.id} changed ${field}`);
    assert.deepEqual(current.maskIds, masks[current.id] ?? old.maskIds, `${current.id} mask members`);
    assert.equal(current.invertMask, masks[current.id] ? true : old.invertMask, `${current.id} invert mask`);
    const currentForms = new Map(current.absoluteParentLocalForms.map(form => [form.guid, form]));
    assert.equal(currentForms.size, current.absoluteParentLocalForms.length, `${current.id} duplicate Form GUID`);
    if (patch) {
      assert.equal(patch.nativeDrawableGuid, current.nativeDrawableGuid);
      assert.equal(patch.parentDeformerId, current.parentDeformerId);
      assert.deepEqual(patch.originalIndices, old.indices);
      assert.deepEqual(patch.originalNativeFormGrid, old.nativeFormGrid);
      assert.deepEqual(current.indices, patch.newIndices);
      assert.deepEqual(current.geometryAxes, patch.newGeometryAxes);
      const bindings = patch.newGeometryAxes.map(axis => {
        const existing = baselineGeometry.drawables.flatMap(d => d.nativeFormGrid.bindings.map((binding, i) => ({ binding, axis: d.geometryAxes[i] }))).find(item => item.axis?.parameter === axis.parameter);
        assert.ok(existing, `No frozen native GUID for ${axis.parameter}`);
        return { parameterGuid: existing.binding.parameterGuid, keys: axis.keys, interpolation: "LINEAR" };
      });
      assert.deepEqual(current.nativeFormGrid.bindings, bindings);
      assert.deepEqual(normalizedCells(current.nativeFormGrid.cells), normalizedCells(patch.newNativeCells));
      assert.equal(currentForms.size, formCounts[current.id]);
      assert.equal(patch.forms.length, formCounts[current.id]);
      for (const target of patch.forms) {
        const actual = currentForms.get(target.formGuid);
        assert.ok(actual, `${current.id} missing Form ${target.formGuid}`);
        assert.equal(floatSha(target.absoluteParentLocalPositions), target.targetFloat32Sha256);
        assert.equal(floatSha(actual.positions), target.targetFloat32Sha256, `${current.id} target local positions`);
        // Native Form storage is Float32. Java emits its shortest round-tripping
        // decimal, whereas the plan may spell the exact Float32 value as a
        // longer double. The byte hash above is exact, without a tolerance.
        const inherited = old.absoluteParentLocalForms.find(f => f.guid === target.copyNonGeometryFromFormGuid || f.guid === target.formGuid);
        assert.ok(inherited, `${current.id} missing source Form`);
        assert.equal(actual.opacity, inherited.opacity);
        assert.equal(actual.drawOrder, assignment?.allFormDrawOrder ?? inherited.drawOrder);
      }
    } else {
      assert.deepEqual(current.indices, old.indices);
      assert.deepEqual(current.geometryAxes, old.geometryAxes);
      assert.deepEqual(current.nativeFormGrid, old.nativeFormGrid);
      assert.equal(currentForms.size, old.absoluteParentLocalForms.length);
      for (const original of old.absoluteParentLocalForms) {
        const actual = currentForms.get(original.guid);
        assert.ok(actual);
        assert.deepEqual(actual.positions, original.positions, `${current.id} unapproved geometry change`);
        assert.equal(actual.opacity, original.opacity);
        assert.equal(actual.drawOrder, assignment?.allFormDrawOrder ?? original.drawOrder);
      }
    }
    if (assignment) {
      assert.equal(assignment.nativeDrawableGuid, current.nativeDrawableGuid);
      assert.deepEqual(assignment.originalNativeFormGrid, old.nativeFormGrid);
      assert.equal(current.staticDrawOrder, assignment.allFormDrawOrder);
      assert.ok(current.absoluteParentLocalForms.every(f => f.drawOrder === assignment.allFormDrawOrder));
      if (current.drawOrderGrid) assert.ok(current.drawOrderGrid.cells.length > 0 && current.drawOrderGrid.cells.every(cell => cell.value === assignment.allFormDrawOrder), `${current.id} retained nonconstant order channel`);
    } else {
      assert.equal(current.staticDrawOrder, old.staticDrawOrder);
      assert.deepEqual(current.drawOrderGrid, old.drawOrderGrid);
    }
  }
  const transitionKeys = [.449, .44921875, .45, .45078125, .451, .4749, .475, .4765625, .48046875, .4832, .4834, .484375, .549, .54921875, .55, .55078125, .551];
  const sampleKeys = [...new Set([...Array.from({ length: 257 }, (_, i) => i / 256), ...transitionKeys])].sort((a, b) => a - b);
  return { orders, unchangedOrderCount: 61, expectedPaintOrder: plan.expectedPaintOrder, sampleKeys, headZ: [-30, 0, 30], baselineMoc: baselineAudit.inputs.moc, baselineModel: baselineAudit.inputs.model };
}
