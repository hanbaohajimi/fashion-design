export function inspectRefinement(base, candidate) {
  if (!candidate || candidate.vertexCount <= base.vertexCount) return { passed: false, reason: "missing_or_not_refined" };
  let expected = { positions: [...base.positions], uvs: [...base.uvs], indices: [...base.indices] }, subdivisions = 0;
  while (expected.positions.length < candidate.positions.length && subdivisions < 6) {
    const positions = [...expected.positions], uvs = [...expected.uvs], indices = [], edges = new Map();
    const midpoint = (a, b) => {
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      if (!edges.has(key)) {
        const index = positions.length / 2;
        for (let axis = 0; axis < 2; axis++) {
          positions.push(Math.fround(Math.fround(expected.positions[a * 2 + axis] + expected.positions[b * 2 + axis]) * 0.5));
          uvs.push(Math.fround(Math.fround(expected.uvs[a * 2 + axis] + expected.uvs[b * 2 + axis]) * 0.5));
        }
        edges.set(key, index);
      }
      return edges.get(key);
    };
    for (let at = 0; at < expected.indices.length; at += 3) {
      const [a, b, c] = expected.indices.slice(at, at + 3), ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    expected = { positions, uvs, indices }; subdivisions++;
  }
  const exactSubdivisionIndices = JSON.stringify(expected.indices) === JSON.stringify(candidate.indices);
  const rawMidpointPositionError = expected.positions.length === candidate.positions.length ? Math.max(...expected.positions.map((v, i) => Math.abs(v - candidate.positions[i]))) : Infinity;
  const rawMidpointUvError = expected.uvs.length === candidate.uvs.length ? Math.max(...expected.uvs.map((v, i) => Math.abs(v - candidate.uvs[i]))) : Infinity;
  // Core may reorder newly inserted vertices. Prove a unique position+UV
  // bijection, then compare every oriented triangle; never align/warp an image.
  const buckets = new Map(), quantum = 1e-6, tolerance = 5e-7;
  for (let i = 0; i < expected.positions.length / 2; i++) {
    const key = `${Math.floor(expected.positions[i * 2] / quantum)},${Math.floor(expected.positions[i * 2 + 1] / quantum)}`;
    const bucket = buckets.get(key) ?? []; bucket.push(i); buckets.set(key, bucket);
  }
  const correspondence = [], used = new Set();
  let midpointPositionError = 0, midpointUvError = 0, ambiguousVertices = 0, unmatchedVertices = 0;
  for (let i = 0; i < candidate.vertexCount; i++) {
    const qx = Math.floor(candidate.positions[i * 2] / quantum), qy = Math.floor(candidate.positions[i * 2 + 1] / quantum), matches = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const index of buckets.get(`${qx + dx},${qy + dy}`) ?? []) {
        if ([0, 1].every(axis => Math.abs(expected.positions[index * 2 + axis] - candidate.positions[i * 2 + axis]) < tolerance && Math.abs(expected.uvs[index * 2 + axis] - candidate.uvs[i * 2 + axis]) < tolerance)) matches.push(index);
      }
    }
    if (matches.length !== 1 || used.has(matches[0])) {
      if (matches.length === 0) unmatchedVertices++; else ambiguousVertices++;
      correspondence.push(-1); continue;
    }
    const mapped = matches[0]; correspondence.push(mapped); used.add(mapped);
    for (let axis = 0; axis < 2; axis++) {
      midpointPositionError = Math.max(midpointPositionError, Math.abs(expected.positions[mapped * 2 + axis] - candidate.positions[i * 2 + axis]));
      midpointUvError = Math.max(midpointUvError, Math.abs(expected.uvs[mapped * 2 + axis] - candidate.uvs[i * 2 + axis]));
    }
  }
  const uniqueVertexBijection = !ambiguousVertices && !unmatchedVertices && used.size === expected.positions.length / 2 && used.size === candidate.vertexCount;
  const orientedTriangles = indices => {
    const keys = [];
    for (let at = 0; at < indices.length; at += 3) {
      const [a, b, c] = indices.slice(at, at + 3);
      keys.push(a <= b && a <= c ? `${a},${b},${c}` : b <= a && b <= c ? `${b},${c},${a}` : `${c},${a},${b}`);
    }
    return keys.sort();
  };
  const sameOrientedSubdivision = uniqueVertexBijection && JSON.stringify(orientedTriangles(expected.indices)) === JSON.stringify(orientedTriangles(candidate.indices.map(index => correspondence[index])));
  const area2 = (points, a, b, c) => (points[b * 2] - points[a * 2]) * (points[c * 2 + 1] - points[a * 2 + 1]) - (points[b * 2 + 1] - points[a * 2 + 1]) * (points[c * 2] - points[a * 2]);
  let triangle;
  for (let at = 0; at < base.indices.length && !triangle; at += 3) {
    const ids = base.indices.slice(at, at + 3);
    if (Math.abs(area2(base.positions, ...ids)) > 1e-8) triangle = ids;
  }
  if (!triangle) return { passed: false, reason: "no_nondegenerate_baseline_triangle" };
  const [a, b, c] = triangle, denominator = area2(base.positions, a, b, c);
  const mappingError = mesh => {
    let maximum = 0;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = mesh.positions[i * 2], y = mesh.positions[i * 2 + 1];
      const bx = base.positions[b * 2] - base.positions[a * 2], by = base.positions[b * 2 + 1] - base.positions[a * 2 + 1];
      const cx = base.positions[c * 2] - base.positions[a * 2], cy = base.positions[c * 2 + 1] - base.positions[a * 2 + 1];
      const dx = x - base.positions[a * 2], dy = y - base.positions[a * 2 + 1];
      const wb = (dx * cy - dy * cx) / denominator, wc = (bx * dy - by * dx) / denominator, wa = 1 - wb - wc;
      for (let axis = 0; axis < 2; axis++) maximum = Math.max(maximum, Math.abs(mesh.uvs[i * 2 + axis] - (base.uvs[a * 2 + axis] * wa + base.uvs[b * 2 + axis] * wb + base.uvs[c * 2 + axis] * wc)));
    }
    return maximum;
  };
  const surface = mesh => {
    let area = 0;
    for (let at = 0; at < mesh.indices.length; at += 3) area += Math.abs(area2(mesh.positions, ...mesh.indices.slice(at, at + 3))) / 2;
    const xs = mesh.positions.filter((_, i) => i % 2 === 0), ys = mesh.positions.filter((_, i) => i % 2 === 1);
    return { area, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  };
  const oldVerticesRetained = base.positions.every((value, index) => Math.abs(value - candidate.positions[index]) < 1e-7) && base.uvs.every((value, index) => Math.abs(value - candidate.uvs[index]) < 1e-7);
  const oldSurface = surface(base), newSurface = surface(candidate);
  const relativeAreaError = Math.abs(newSurface.area - oldSurface.area) / oldSurface.area;
  const maximumBoundsError = Math.max(...oldSurface.bounds.map((value, index) => Math.abs(value - newSurface.bounds[index])));
  const oldUvError = mappingError(base), newUvError = mappingError(candidate);
  const passed = sameOrientedSubdivision && midpointPositionError < tolerance && midpointUvError < tolerance && oldVerticesRetained && relativeAreaError < 1e-5 && maximumBoundsError < 1e-7 && oldUvError < 1e-5 && newUvError < 1e-5 && base.opacity === candidate.opacity && base.textureIndex === candidate.textureIndex;
  return { passed, oldVertices: base.vertexCount, newVertices: candidate.vertexCount, oldTriangles: base.indexCount / 3, newTriangles: candidate.indexCount / 3, subdivisions, exactSubdivisionIndices, sameOrientedSubdivision, uniqueVertexBijection, ambiguousVertices, unmatchedVertices, reorderedVertices: correspondence.filter((mapped, index) => mapped !== index).length, rawMidpointPositionError, rawMidpointUvError, midpointPositionError, midpointUvError, oldVerticesRetained, relativeAreaError, maximumBoundsError, oldUvError, newUvError, limitation: "This accepts only the explicitly authored shared-midpoint subdivision, up to a proven one-to-one vertex renumbering and oriented-triangle reorder. It does not accept arbitrary remeshing or align rendered pixels. Inspect fixed actual PNG captures and frozen quality-spec separately" };
}
