import assert from "node:assert/strict";

// This validates an explicit inventory declaration, not source ownership,
// geometry, an Editor session, or visual acceptance. Those need native audits.
export function resolveDrawableContract(specification, declaration = null) {
  assert.equal(specification.characterId, "forest-spirit-front-v8");
  const sourceIds = specification.layers.filter(layer => layer.phase === "P0").map(layer => layer.id).sort();
  assert.equal(sourceIds.length, 72, "The frozen production source inventory must remain 72");
  assert.equal(new Set(sourceIds).size, 72, "Duplicate production source ID");
  const sourceToDrawables = Object.fromEntries(sourceIds.map(id => [id, [id]]));
  if (declaration !== null) {
    assert.equal(declaration.schemaVersion, 1);
    assert.equal(declaration.characterId, specification.characterId);
    assert.equal(declaration.sourceLayerCount, 72);
    assert.equal(declaration.drawableCount, 73);
    assert.match(declaration.sourceMetadataSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.ok(sourceIds.includes("Arm_R_Upper"));
    sourceToDrawables.Arm_R_Upper = ["Arm_R_Upper", "Arm_R_Upper_Front"];
    assert.deepEqual(Object.keys(declaration.sourceToDrawables ?? {}).sort(), sourceIds, "Every frozen source must be declared exactly once");
    for (const id of sourceIds) assert.deepEqual(declaration.sourceToDrawables[id], sourceToDrawables[id], `Unexpected drawable mapping for ${id}`);
  }
  const drawableIds = Object.values(sourceToDrawables).flat().sort();
  assert.equal(new Set(drawableIds).size, drawableIds.length);
  return {
    sourceIds, sourceToDrawables, drawableIds,
    sourceLayerCount: sourceIds.length, drawableCount: drawableIds.length,
    declarationOnly: true,
    nativeOwnershipVerificationRequired: declaration !== null,
  };
}
