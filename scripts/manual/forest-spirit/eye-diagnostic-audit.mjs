export const eyeDiagnosticStates = [
  { name: "neutral", left: 1, right: 1 },
  { name: "half", left: 0.5, right: 0.5 },
  { name: "closed", left: 0, right: 0 },
  { name: "leftClosed", left: 0, right: 1 },
  { name: "rightClosed", left: 1, right: 0 },
];
export const defaultEyeDrawableMap = {
  left: { open: "Eye_L_Open", closed: "Eye_L_Closed", cross: "Eye_L_Cross" },
  right: { open: "Eye_R_Open", closed: "Eye_R_Closed", cross: "Eye_R_Cross" },
  preserve: ["Brow_L", "Brow_R", "Nose", "Mouth"],
};
const near = (left, right) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.001;
const unchanged = item => item && near(item.opacityDeltaFromNeutral, 0) && near(item.maximumVertexDisplacementPixels, 0);
const sameMeshAppearance = (left, right) => left && right && near(left.opacity, right.opacity) && Array.isArray(left.vertexPositions) && Array.isArray(right.vertexPositions) && left.vertexPositions.length === right.vertexPositions.length && left.vertexPositions.every((value, index) => Math.abs(value - right.vertexPositions[index]) < 1e-7);

export function inspectEyeDrawableInventory(snapshot, mapping = defaultEyeDrawableMap) {
  return Object.fromEntries(["left", "right"].map(side => [side, Object.fromEntries(["open", "closed", "cross"].map(kind => {
    const id = mapping[side]?.[kind], item = snapshot.drawables?.find(drawable => drawable.id === id);
    const texturedMesh = Boolean(item && item.vertexCount >= 3 && item.vertexIndexCount >= 3 && item.textureIndex >= 0 && item.textureIndex < snapshot.textureCount);
    return [kind, {
      expectedId: id ?? null, actualIdFound: Boolean(item), opacity: item?.opacity ?? null,
      vertexCount: item?.vertexCount ?? null, textureIndex: item?.textureIndex ?? null, texturedMesh,
      status: !item ? "expected_id_not_found_or_actual_editor_mapping_required" : !texturedMesh ? "drawable_present_mesh_or_texture_incomplete" : kind === "closed" && near(item.opacity, 0) ? "transparent_closed_drawable_exported" : "textured_drawable_exported",
    }];
  }))]));
}

/** Audits measurements from a real Core sweep. Fixtures in unit tests are not model evidence. */
export function auditEyeDiagnostic(snapshots, expectedParameterIds, mapping = defaultEyeDrawableMap) {
  const checks = [];
  const record = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), ...(detail ? { detail } : {}) });
  const neutral = snapshots.neutral;
  const actualIds = Object.keys(neutral?.parameters ?? {});
  const missingParameters = expectedParameterIds.filter(id => !actualIds.includes(id));
  const unexpectedParameters = actualIds.filter(id => !expectedParameterIds.includes(id));
  record("actual seventeen-parameter v8 set", expectedParameterIds.length === 17 && actualIds.length === 17 && !missingParameters.length && !unexpectedParameters.length, { missingParameters, unexpectedParameters });
  const drawable = (state, id) => snapshots[state]?.drawables?.find(item => item.id === id);
  const mappedEyeIds = [mapping.left?.open, mapping.left?.closed, mapping.left?.cross, mapping.right?.open, mapping.right?.closed, mapping.right?.cross];
  const preservationIds = mapping.preserve;
  record("explicit distinct eye Drawable mapping", mappedEyeIds.every(id => typeof id === "string" && id.length) && new Set(mappedEyeIds).size === 6);
  record("explicit other-facial-feature mapping", Array.isArray(preservationIds) && preservationIds.length >= 4 && preservationIds.every(id => typeof id === "string" && id.length) && new Set(preservationIds).size === preservationIds?.length);
  for (const id of mappedEyeIds) {
    const item = drawable("neutral", id);
    record(`real textured mesh exported: ${id}`, item && item.vertexCount >= 3 && item.vertexIndexCount >= 3 && item.textureIndexValid && Number.isInteger(item.textureIndex) && item.textureIndex >= 0 && item.textureIndex < neutral?.textureCount && Array.isArray(item.vertexPositions) && item.vertexPositions.length === item.vertexCount * 2 && item.vertexPositions.every(Number.isFinite), item ? { opacity: item.opacity, vertexCount: item.vertexCount, vertexIndexCount: item.vertexIndexCount, textureIndex: item.textureIndex } : { missing: true });
  }
  for (const state of eyeDiagnosticStates) {
    const sample = snapshots[state.name];
    record(`actual eye parameter values: ${state.name}`, near(sample?.parameters?.ParamEyeLOpen, state.left) && near(sample?.parameters?.ParamEyeROpen, state.right));
    record(`fixed static capture: ${state.name}`, sample?.width === 971 && sample?.height === 1620 && sample?.devicePixelRatio === 1 && sample?.fit === 1 && sample?.motionsAdvanced === false && sample?.physicsAdvanced === false);
    record(`same exported Drawable inventory: ${state.name}`, sample?.drawables?.length === neutral?.drawables?.length && neutral?.drawables?.every(base => {
      const item = drawable(state.name, base.id);
      return item && item.vertexCount === base.vertexCount && item.textureIndex === base.textureIndex;
    }));
  }
  for (const [side, ids] of [["left", mapping.left], ["right", mapping.right]]) {
    record(`${side} neutral open/cross visible and closed arc transparent`, near(drawable("neutral", ids?.open)?.opacity, 1) && near(drawable("neutral", ids?.cross)?.opacity, 1) && near(drawable("neutral", ids?.closed)?.opacity, 0));
    record(`${side} closed arc visible and open/cross hidden`, near(drawable("closed", ids?.open)?.opacity, 0) && near(drawable("closed", ids?.cross)?.opacity, 0) && near(drawable("closed", ids?.closed)?.opacity, 1));
    const oppositeOnly = side === "left" ? "rightClosed" : "leftClosed";
    record(`${side} eye independent of opposite eye parameter`, [ids?.open, ids?.closed, ids?.cross].every(id => unchanged(drawable(oppositeOnly, id))));
    const changed = [ids?.open, ids?.closed, ids?.cross].some(id => {
      const item = drawable("closed", id);
      return item && (Math.abs(item.opacityDeltaFromNeutral) > 0.01 || item.maximumVertexDisplacementPixels > 0.01);
    });
    record(`${side} actual opacity or mesh changes`, changed);
    record(`${side} half-close has an intermediate eye mesh or opacity`, [ids?.open, ids?.closed, ids?.cross].some(id => {
      const half = drawable("half", id);
      return half && !sameMeshAppearance(half, drawable("neutral", id)) && !sameMeshAppearance(half, drawable("closed", id));
    }));
  }
  for (const id of Array.isArray(preservationIds) ? preservationIds : []) {
    record(`original facial feature unchanged: ${id}`, eyeDiagnosticStates.every(state => unchanged(drawable(state.name, id))));
  }
  const fingerprints = ["neutral", "half", "closed"].map(name => snapshots[name]?.pixelFingerprint);
  record("neutral, half and closed rendered pixels differ", fingerprints.every(value => typeof value === "string" && value.length > 0) && new Set(fingerprints).size === 3);
  const passed = checks.every(check => check.passed);
  return {
    status: passed ? "structural_eye_binding_checks_passed_visual_review_pending" : "eye_binding_checks_failed",
    passed, checks, mapping, actualParameterIds: actualIds, inventory: inspectEyeDrawableInventory(neutral ?? {}, mapping),
    transparentClosedDrawablesExported: [mapping.left?.closed, mapping.right?.closed].every(id => {
      const item = drawable("neutral", id);
      return item && near(item.opacity, 0) && item.vertexCount >= 3 && item.vertexIndexCount >= 3 && item.textureIndexValid && item.textureIndex >= 0 && item.textureIndex < neutral?.textureCount;
    }),
    visualAcceptance: false, productionApproval: false,
    limitation: "Drawable/parameter/pixel changes cannot prove the closed arcs are clean or eyelash-free. Review all five actual captures and source artwork.",
  };
}
