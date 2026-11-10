// Pure numerical checks of measured Core vertices. This never accepts visual quality.
export function inspectTriangleDeformation(baseline, candidate, pixelsPerUnit = 971) {
  const failures = [];
  let triangles = 0, flips = 0, collapsed = 0, baselineDegenerate = 0;
  let minimumAreaRatio = Infinity, maximumAreaRatio = -Infinity;
  const baseById = new Map(baseline.drawables.map(drawable => [drawable.id, drawable]));
  for (const current of candidate.drawables) {
    const base = baseById.get(current.id);
    const indices = current.vertexIndices;
    if (!base || !Array.isArray(indices) || indices.length % 3 || JSON.stringify(indices) !== JSON.stringify(base.vertexIndices) || current.vertexPositions.length !== base.vertexPositions.length || !current.vertexPositions.every(Number.isFinite)) {
      failures.push({ id: current.id, reason: "invalid_or_changed_topology_or_nonfinite_vertices" });
      continue;
    }
    const area = (points, offset) => {
      const a = indices[offset] * 2, b = indices[offset + 1] * 2, c = indices[offset + 2] * 2;
      if ([a, b, c].some(index => index < 0 || index + 1 >= points.length)) return NaN;
      return ((points[b] - points[a]) * (points[c + 1] - points[a + 1]) - (points[b + 1] - points[a + 1]) * (points[c] - points[a])) * pixelsPerUnit * pixelsPerUnit / 2;
    };
    for (let offset = 0; offset < indices.length; offset += 3) {
      const a = area(base.vertexPositions, offset), b = area(current.vertexPositions, offset);
      triangles++;
      if (!Number.isFinite(a) || !Number.isFinite(b)) { failures.push({ id: current.id, triangle: offset / 3, reason: "invalid_indices" }); continue; }
      if (Math.abs(a) < 1e-4) { baselineDegenerate++; continue; }
      const ratio = b / a;
      minimumAreaRatio = Math.min(minimumAreaRatio, ratio);
      maximumAreaRatio = Math.max(maximumAreaRatio, ratio);
      if (ratio < 0) { flips++; failures.push({ id: current.id, triangle: offset / 3, reason: "flipped", ratio }); }
      else if (Math.abs(b) < 1e-4) { collapsed++; failures.push({ id: current.id, triangle: offset / 3, reason: "newly_collapsed", ratio }); }
    }
  }
  if (candidate.drawables.length !== baseline.drawables.length) failures.push({ reason: "drawable_count_changed" });
  return { triangles, flips, collapsed, baselineDegenerate, minimumAreaRatio: Number.isFinite(minimumAreaRatio) ? minimumAreaRatio : null, maximumAreaRatio: Number.isFinite(maximumAreaRatio) ? maximumAreaRatio : null, failures, passed: failures.length === 0 };
}

export function makeHeadScarfStates() {
  const states = [];
  const add = (name, y, z, scarf, left = 1, right = left, capture = false) => states.push({ name, capture, parameters: { ParamAngleY: y, ParamAngleZ: z, ParamFSScarfSway: scarf, ParamEyeLOpen: left, ParamEyeROpen: right } });
  add("neutral", 0, 0, 0, 1, 1, true);
  for (const [name, y, z, scarf] of [["head-up", 30, 0, 0], ["head-down", -30, 0, 0], ["head-z-positive", 0, 30, 0], ["head-z-negative", 0, -30, 0], ["scarf-positive", 0, 0, 1], ["scarf-negative", 0, 0, -1]]) add(name, y, z, scarf, 1, 1, true);
  for (const y of [-30, -5, 0, 5, 30]) for (const z of [-30, -5, 0, 5, 30]) for (const scarf of [-1, 0, 1]) for (const eye of [0, 0.5, 1]) {
    const corner = Math.abs(y) === 30 && Math.abs(z) === 30 && scarf === (z > 0 ? 1 : -1);
    add(`grid-y${y}-z${z}-s${scarf}-eye${eye}`, y, z, scarf, eye, eye, corner);
  }
  for (const y of [-2.5, 2.5]) for (const z of [-2.5, 2.5]) for (const scarf of [-0.5, 0.5]) for (const eye of [0.25, 0.75]) add(`inter-y${y}-z${z}-s${scarf}-eye${eye}`, y, z, scarf, eye);
  for (const [left, right] of [[0, 1], [1, 0]]) for (const sign of [-1, 1]) add(`single-left${left}-right${right}-sign${sign}`, sign * 30, -sign * 30, sign, left, right, true);
  return states;
}

export function inspectEyeOpacityInvariant(baseline, candidate) {
  return ["L", "R"].flatMap(side => ["Open", "Cross", "Closed"].map(kind => {
    const id = `Eye_${side}_${kind}`, before = baseline.drawables.find(drawable => drawable.id === id)?.opacity, after = candidate.drawables.find(drawable => drawable.id === id)?.opacity;
    return { id, baseline: before ?? null, actual: after ?? null, passed: Number.isFinite(before) && Number.isFinite(after) && Math.abs(before - after) < 1e-6 };
  }));
}

// Effective Core opacity can differ from full opacity by Float32 rounding under
// combined parent parameters. Only full values use the existing 1e-6 tolerance;
// inactive shapes, especially a cross at full closure, must remain exactly zero.
export function inspectEyeStateOpacity({ side, value, open, cross, closed }) {
  const full = opacity => Math.abs(opacity - 1) < 1e-6;
  return {
    side, value, open, cross, closed,
    passed: [open, cross, closed].every(Number.isFinite)
      && Math.abs(open - cross) < 1e-6
      && (value !== 0 || open === 0 && cross === 0 && full(closed))
      && (value !== 1 || full(open) && full(cross) && closed === 0),
  };
}
