import assert from "node:assert/strict";
import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const productionOptions = { spec: { type: "string" }, "output-root": { type: "string" } };

export function isAllowedLayerId(id, stage, temporary) {
  return typeof id === "string" && (/^[A-Za-z][A-Za-z0-9_-]*$/u.test(id) || (stage === "head-stage" && temporary === true && /^__TEMP_[A-Za-z][A-Za-z0-9_-]*$/u.test(id)));
}

/** Resolve a versioned art specification without silently reusing an older output root. */
export async function readProductionContext(options) {
  const legacySpec = path.join(repo, "doc/design/forest-spirit/production/layers-v2.json");
  const specPath = path.resolve(repo, options.spec ?? legacySpec);
  const specification = JSON.parse(await readFile(specPath, "utf8"));
  const characterId = specification.characterId ?? (specPath === legacySpec ? "forest-spirit-approved-v2" : undefined);
  assert.ok(["forest-spirit-approved-v2", "forest-spirit-front-v8"].includes(characterId), "Unsupported or missing specification characterId");
  if (specPath !== legacySpec) assert.ok(options["output-root"], "A versioned --spec requires an explicit --output-root; older artifacts must not be overwritten");
  const outputRoot = path.resolve(repo, options["output-root"] ?? "output/forest-spirit-production-v2");
  assert.ok(outputRoot.startsWith(path.join(repo, "output") + path.sep), "Generated files must stay inside repository output/");
  if (characterId === "forest-spirit-front-v8") assert.notEqual(outputRoot, path.join(repo, "output/forest-spirit-production-v2"), "v8 cannot overwrite the old v2 production root");
  assert.ok(Array.isArray(specification.working_canvas) && specification.working_canvas.length === 2 && specification.working_canvas.every(value => Number.isInteger(value) && value > 0), "Specification requires positive integer working_canvas dimensions");
  assert.ok(Array.isArray(specification.layers) && specification.layers.length, "Specification requires real planned layer IDs");
  const p0Layers = specification.layers.filter(layer => layer.phase === "P0");
  assert.equal(new Set(p0Layers.map(layer => layer.id)).size, p0Layers.length, "Duplicate P0 IDs in specification");
  if (specification.p0_count !== undefined) assert.equal(p0Layers.length, specification.p0_count, "P0 count differs from declared count");
  await mkdir(outputRoot, { recursive: true });
  assert.ok((await realpath(outputRoot)).startsWith((await realpath(path.join(repo, "output"))) + path.sep), "Output symlink escapes repository output/");
  return { repo, specPath, specification, characterId, outputRoot, p0Layers, isFrontV8: characterId === "forest-spirit-front-v8" };
}
