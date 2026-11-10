import assert from "node:assert/strict";
import test from "node:test";
import { inspectRefinement } from "./refined-mesh-audit.mjs";

const base = { vertexCount: 4, indexCount: 6, positions: [0, 0, 1, 0, 1, 1, 0, 1], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3], opacity: 1, textureIndex: 0 };
const refined = () => ({ vertexCount: 9, indexCount: 24, positions: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0, 1, 0.5, 0.5, 0.5, 0.5, 1, 0, 0.5], uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0, 1, 0.5, 0.5, 0.5, 0.5, 1, 0, 0.5], indices: [0, 4, 6, 4, 1, 5, 6, 5, 2, 4, 5, 6, 0, 6, 8, 6, 2, 7, 8, 7, 3, 6, 7, 8], opacity: 1, textureIndex: 0 });
test("explicit shared-edge midpoint subdivision retains the texture surface", () => {
  const result = inspectRefinement(base, refined());
  assert.equal(result.passed, true); assert.equal(result.subdivisions, 1);
});
test("duplicate triangle plus a hole fails even with identical total area and bounds", () => {
  const damaged = refined(); damaged.indices.splice(21, 3, 0, 4, 6);
  const result = inspectRefinement(base, damaged);
  assert.equal(result.relativeAreaError, 0); assert.equal(result.maximumBoundsError, 0);
  assert.equal(result.exactSubdivisionIndices, false); assert.equal(result.passed, false);
});
test("moved vertex and shifted UV are each rejected", () => {
  const moved = refined(); moved.positions[10] += 0.001;
  const shifted = refined(); shifted.uvs[12] += 0.001;
  assert.equal(inspectRefinement(base, moved).passed, false);
  assert.equal(inspectRefinement(base, shifted).passed, false);
});
test("an unchanged mesh cannot be labelled refinement", () => {
  assert.equal(inspectRefinement(base, structuredClone(base)).passed, false);
});
test("a proven new-vertex renumbering passes, while reversed winding still fails", () => {
  const reordered = refined();
  const order = [0, 1, 2, 3, 8, 7, 6, 5, 4], inverse = order.map((_, index) => order.indexOf(index));
  reordered.positions = order.flatMap(index => reordered.positions.slice(index * 2, index * 2 + 2));
  reordered.uvs = order.flatMap(index => reordered.uvs.slice(index * 2, index * 2 + 2));
  reordered.indices = reordered.indices.map(index => inverse[index]);
  const result = inspectRefinement(base, reordered);
  assert.equal(result.exactSubdivisionIndices, false); assert.equal(result.sameOrientedSubdivision, true); assert.equal(result.passed, true);
  [reordered.indices[0], reordered.indices[1]] = [reordered.indices[1], reordered.indices[0]];
  assert.equal(inspectRefinement(base, reordered).passed, false);
});
