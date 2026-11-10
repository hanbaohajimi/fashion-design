import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { productionOptions, readProductionContext } from "./production-context.mjs";

// An actual program-authored Cubism physics3 draft for Editor import. It is not
// an Editor export and does not prove that the referenced deformations exist.
const { values } = parseArgs({ options: { ...productionOptions, "parameter-csv": { type: "string" }, "motion-manifest": { type: "string" }, motions: { type: "string" }, profile: { type: "string", default: "conservative-v4" } } });
assert.ok(["conservative-v4", "gesture-inertia-v5"].includes(values.profile));
const { repo, characterId, specPath, specification, outputRoot: production, isFrontV8 } = await readProductionContext(values);
const output = path.join(production, "physics-drafts");
await mkdir(output, { recursive: true });
assert.ok((await realpath(output)).startsWith((await realpath(production)) + path.sep));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const manifestPath = path.resolve(repo, values["motion-manifest"] ?? path.join(production, "motion-drafts/motion-drafts.manifest.json"));
const manifestBytes = await readFile(manifestPath);
const motionManifest = JSON.parse(manifestBytes);
assert.equal(motionManifest.characterId, characterId, "Motion drafts belong to a different character version");
const plannedIds = new Set([...motionManifest.motionOwnedParameters, ...motionManifest.excludedPhysicsOutputParameters]);
// layers.json declares v8 identity/counts, not ranges. Read the already approved
// Editor-column CSV rather than misattributing hardcoded ranges to that spec.
const csvPath = path.resolve(repo, values["parameter-csv"] ?? path.join(production, "validation/production-parameters.csv"));
const csvBytes = await readFile(csvPath);
function readCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === "," || c === "\n")) { row.push(field); field = ""; if (c === "\n") { rows.push(row); row = []; } }
    else if (c !== "\r" || quoted) field += c;
  }
  assert.ok(!quoted, "Unclosed CSV quote");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const rows = readCsv(csvBytes.toString("utf8").replace(/^\uFEFF/u, ""));
assert.deepEqual(rows[0], ["GUID", "类型", "ID", "名称", "群组", "最低值", "基准值", "最大值", "循环", "说明", "标签颜色"]);
const parameterBounds = Object.fromEntries(rows.slice(1).filter(row => row.some(Boolean)).map(row => {
  assert.equal(row[1], "PARAMETER");
  const minimum = Number(row[5]), neutral = Number(row[6]), maximum = Number(row[7]);
  assert.ok([minimum, neutral, maximum].every(Number.isFinite) && minimum < maximum && minimum <= neutral && neutral <= maximum);
  return [row[2], { minimum, default: neutral, maximum }];
}));
assert.deepEqual(new Set(Object.keys(parameterBounds)), plannedIds);
assert.equal(Object.keys(parameterBounds).length, specification.parameter_count ?? motionManifest.plannedParameterCount);
assert.equal(motionManifest.excludedPhysicsOutputParameters.length, specification.physics_output_count ?? (isFrontV8 ? 6 : 7));
for (const id of motionManifest.excludedPhysicsOutputParameters) assert.deepEqual(parameterBounds[id], { minimum: -1, default: 0, maximum: 1 });
const motionDirectory = path.resolve(repo, values.motions ?? path.dirname(manifestPath));
const motionFiles = (await readdir(motionDirectory)).filter(file => file.endsWith(".motion3.json")).sort();
assert.equal(motionFiles.length, 4, "Review exactly four real motion inputs");
const motionEvidence = [];
for (const file of motionFiles) {
  const bytes = await readFile(path.join(motionDirectory, file)), motion = JSON.parse(bytes);
  assert.equal(motion.Meta.Fps, 60);
  assert.equal(motion.Curves.length, 11);
  assert.deepEqual(new Set(motion.Curves.map(curve => curve.Id)), new Set(motionManifest.motionOwnedParameters));
  assert.ok(motion.Curves.every(curve => curve.Target === "Parameter" && !motionManifest.excludedPhysicsOutputParameters.includes(curve.Id)));
  motionEvidence.push({ path: path.join(motionDirectory, file), sha256: sha(bytes), physicsOutputsAbsent: true });
}
const groups = [
  { id: "HairBack", name: "后发低幅跟随", destination: "ParamFSHairBackSway", length: 7, mobility: 0.65, delay: 0.25, acceleration: 1.0, scale: 1.5, weight: 60, sources: [["ParamAngleZ", "Angle", 45], ["ParamBodyAngleZ", "Angle", 15], ["ParamAngleY", "Y", 15]] },
  { id: "Braid", name: "发辫低幅跟随", destination: "ParamFSBraidSway", length: 9, mobility: 0.6, delay: 0.28, acceleration: 0.9, scale: 1.2, weight: 60, sources: [["ParamAngleZ", "Angle", 35], ["ParamBodyAngleZ", "Angle", 25], ["ParamFSPickup", "Y", 15]] },
  { id: "HatBrim", name: "圆帽檐轻跟随", destination: "ParamFSHatBrimSway", length: 5, mobility: 0.48, delay: 0.18, acceleration: 1.0, scale: 0.55, weight: 45, sources: [["ParamAngleZ", "Angle", 45], ["ParamAngleY", "Y", 20], ["ParamFSSettle", "Y", 10]] },
  { id: "Bell", name: "无声铃铛轻摆", destination: "ParamFSBellSway", length: 6, mobility: 0.72, delay: 0.22, acceleration: 1.1, scale: 1.5, weight: 55, sources: [["ParamAngleZ", "Angle", 45], ["ParamBodyAngleZ", "Angle", 20], ["ParamFSSettle", "Y", 15]] },
  { id: "Scarf", name: isFrontV8 ? "围巾下圈小幅跟随" : "围巾尾低幅回落", destination: "ParamFSScarfSway", length: isFrontV8 ? 4 : 8, mobility: isFrontV8 ? 0.45 : 0.6, delay: 0.26, acceleration: 0.9, scale: isFrontV8 ? 0.45 : 1.3, weight: isFrontV8 ? 35 : 55, sources: [["ParamBodyAngleZ", "Angle", 45], ["ParamAngleZ", "Angle", 15], ["ParamFSPickup", "Y", 15]] },
  { id: "Skirt", name: "裙瓣低幅回落", destination: "ParamFSSkirtSway", length: 6, mobility: 0.52, delay: 0.22, acceleration: 1.0, scale: 0.7, weight: 45, sources: [["ParamBodyAngleZ", "Angle", 40], ["ParamFSPickup", "Y", 15], ["ParamFSSettle", "Y", 20]] },
  { id: "Pouch", name: "重工具袋小幅回落", destination: "ParamFSPouchSway", length: 7, mobility: 0.42, delay: 0.22, acceleration: 1.6, scale: 0.4, weight: 35, sources: [["ParamBodyAngleZ", "Angle", 35], ["ParamFSPickup", "Y", 10], ["ParamFSSettle", "Y", 15]] },
].filter(group => !isFrontV8 || group.id !== "Bell");
if (values.profile === "gesture-inertia-v5") {
  assert.ok(isFrontV8, "The gesture inertia candidate belongs only to approved frontal v8");
  // The official solver's Angle output is in radians, not degrees. X inputs
  // move the pendulum root sideways: the earlier Y-only gesture input barely
  // excited a vertical one-link pendulum. These are existing authored pose
  // parameters; the six outputs remain exclusively owned by the solver.
  const candidate = {
    HairBack: { scale: 1.6, weight: 25, acceleration: 2, delay: .18, sources: [["ParamBodyAngleZ", "Angle", 10], ["ParamFSPickup", "X", 55], ["ParamFSHatTouch", "X", 35]] },
    Braid: { scale: 2, weight: 25, acceleration: 1.5, delay: .24, sources: [["ParamFSPickup", "X", 70], ["ParamBodyAngleZ", "Angle", 10], ["ParamFSSettle", "X", 20]] },
    HatBrim: { scale: 1.2, weight: 25, acceleration: 2, sources: [["ParamFSHatTouch", "X", 85], ["ParamAngleZ", "Angle", 10], ["ParamFSSettle", "X", 5]] },
    Scarf: { scale: 1, weight: 25, acceleration: 1.8, sources: [["ParamBreath", "X", 30], ["ParamAngleZ", "Angle", 10], ["ParamFSPickup", "X", 60]] },
    Skirt: { scale: 1.4, weight: 25, acceleration: 2.2, delay: .16, sources: [["ParamFSPickup", "X", 60], ["ParamFSSettle", "X", 30], ["ParamBodyAngleZ", "Angle", 10]] },
    Pouch: { scale: 1.6, weight: 25, sources: [["ParamFSPickup", "X", 65], ["ParamFSSettle", "X", 25], ["ParamBodyAngleZ", "Angle", 10]] },
  };
  for (const group of groups) Object.assign(group, candidate[group.id]);
}
const settings = groups.map(group => ({
  Id: `Physics_${group.id}`,
  Input: group.sources.map(([id, type, weight]) => ({ Source: { Target: "Parameter", Id: id }, Weight: weight, Type: type, Reflect: false })),
  Output: [{ Destination: { Target: "Parameter", Id: group.destination }, VertexIndex: 1, Scale: group.scale, Weight: group.weight, Type: "Angle", Reflect: false }],
  Vertices: [
    { Position: { X: 0, Y: 0 }, Mobility: 1, Delay: 1, Acceleration: 1, Radius: 0 },
    { Position: { X: 0, Y: group.length }, Mobility: group.mobility, Delay: group.delay, Acceleration: group.acceleration, Radius: group.length },
  ],
  // SDK normalization centers parameter ranges at their midpoint. All v5 X
  // inputs are 0..1 with default 0, so [0,2,4] maps default to zero instead
  // of a static root translation. Relative movement remains four units.
  Normalization: { Position: values.profile === "gesture-inertia-v5" ? { Minimum: 0, Default: 2, Maximum: 4 } : { Minimum: -2, Default: 0, Maximum: 2 }, Angle: { Minimum: -10, Default: 0, Maximum: 10 } },
}));
const physics = {
  Version: 3,
  Meta: {
    PhysicsSettingCount: settings.length, TotalInputCount: settings.reduce((n, group) => n + group.Input.length, 0),
    TotalOutputCount: settings.reduce((n, group) => n + group.Output.length, 0), VertexCount: settings.reduce((n, group) => n + group.Vertices.length, 0),
    Fps: 60, EffectiveForces: { Gravity: { X: 0, Y: -1 }, Wind: { X: 0, Y: 0 } },
    PhysicsDictionary: groups.map(group => ({ Id: `Physics_${group.id}`, Name: group.name })),
  },
  PhysicsSettings: settings,
};
const groupCount = isFrontV8 ? 6 : 7;
assert.equal(settings.length, groupCount); assert.equal(physics.Meta.TotalInputCount, groupCount * 3); assert.equal(physics.Meta.TotalOutputCount, groupCount); assert.equal(physics.Meta.VertexCount, groupCount * 2);
assert.deepEqual(new Set(groups.map(group => group.destination)), new Set(motionManifest.excludedPhysicsOutputParameters));
for (const group of settings) {
  assert.ok(group.Input.every(input => input.Weight >= 0 && input.Weight <= 100));
  assert.ok(group.Input.reduce((sum, input) => sum + input.Weight, 0) <= 100);
  for (const input of group.Input) assert.ok(plannedIds.has(input.Source.Id) && !motionManifest.excludedPhysicsOutputParameters.includes(input.Source.Id), "Physics input must be an actual motion-owned planned parameter");
  for (const output of group.Output) assert.ok(plannedIds.has(output.Destination.Id) && !motionManifest.motionOwnedParameters.includes(output.Destination.Id), "Do not write a motion-owned parameter from physics");
}
const filename = path.join(output, "forest_spirit.physics3.json");
const bytes = Buffer.from(JSON.stringify(physics, null, 2) + "\n", "utf8");
await writeFile(filename, bytes, { flag: "wx" });
assert.deepEqual(JSON.parse(await readFile(filename, "utf8")), physics);
const report = {
  schemaVersion: 1, characterId, specification: specPath, status: "program_authored_physics_draft_pending_model_binding_editor_import_and_reexport",
  designation: "PROGRAM_DRAFT", specificationSha256: sha(await readFile(specPath)),
  authoringProfile: values.profile,
  parameterBounds, parameterBoundsSource: { path: csvPath, sha256: sha(csvBytes), note: "Approved production CSV supplies actual ranges/defaults; layers.json supplies version and counts only. Solver audit separately cross-checks these against actual r12 Core." },
  motionManifestSource: { path: manifestPath, sha256: sha(manifestBytes) }, reviewedMotionFiles: motionEvidence,
  sourceMethod: "Conservative one-pendulum-per-output draft following official physics3 schema, not an Editor export",
  officialImportDocumentation: "https://docs.live2d.com/en/cubism-editor-manual/switch-viewer-setting/",
  editorMenu: "Physics Settings > Physics > Import Physics settings; after actual binding and preview, export physics3 with FPS",
  path: filename, sha256: sha(bytes), bytes: bytes.length,
  fps: 60, groupCount, inputCount: groupCount * 3, outputCount: groupCount, vertexCount: groupCount * 2, plannedParameterCount: motionManifest.plannedParameterCount, parameterSetMatchesPlan: true,
  motionOutputOwnershipConflict: false, syntaxAndCountsVerified: true,
  editorImported: false, editorExported: false, actualDeformationBindingsVerified: false, visualAmplitudeAndSettlingAccepted: false,
  solverValidation: "not_run_by_authoring_tool", displayFrameCap: 30,
  limitations: ["Small scale/weight and conservative pendulum values are only starting settings; actual amplitude depends on the authored deformations.", "No claim of real bound physics acceptance until the approved model is inspected in Editor and official Web runtime.", ...(isFrontV8 ? ["No bell group exists. Scarf output is only the lower loop, with the upper neck loop stationary; there is no scarf tail."] : []), "No wind, audio, walking or springy squash is authored.", "Keep this draft separate from eventual Editor-exported model resources."],
};
await writeFile(path.join(output, "physics-draft.manifest.json"), JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify(report, null, 2));
