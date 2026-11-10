import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import vm from "node:vm";

// Offline real official SDK/Core parameter evaluation. No browser, raster
// renderer, synthetic model, native Editor export, or production approval.
const { values } = parseArgs({ options: { draft: { type: "string" }, model: { type: "string" }, physics: { type: "string" }, out: { type: "string" } } });
for (const name of ["draft", "model", "physics", "out"]) assert.ok(values[name], `Missing --${name}`);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = path.resolve(repo, values.out);
assert.ok(out.startsWith(path.join(repo, "output") + path.sep));
await mkdir(out, { recursive: false });
assert.ok((await realpath(out)).startsWith((await realpath(path.join(repo, "output"))) + path.sep));
const hash = bytes => createHash("sha256").update(bytes).digest("hex"), inputs = new Map();
async function read(file) { const actual = await realpath(file), bytes = await readFile(actual); inputs.set(actual, { path: actual, sha256: hash(bytes), bytes: bytes.length }); return bytes; }
const draft = await realpath(path.resolve(repo, values.draft));
const buildReport = JSON.parse(await read(path.join(draft, "can-amplitude-build-report.json")));
for (const source of buildReport.inputs) assert.equal(hash(await read(source.path)), source.sha256, `Native build source changed: ${source.path}`);
await read(fileURLToPath(import.meta.url));
await read(path.join(repo, "scripts/manual/forest-spirit/author-motion-amplitude-can.py"));
assert.equal(hash(await read(buildReport.candidate.path)), buildReport.candidate.sha256);
assert.equal(buildReport.unchangedCurveCount, 42);
assert.equal(buildReport.allOtherXmlFieldsExact, true);
const manifest = JSON.parse(await read(path.join(draft, "motion-inputs-PROGRAM_DRAFT/manifest.json")));
assert.equal(manifest.designation, "PROGRAM_DRAFT");
assert.equal(manifest.files.length, 4);
const pairs = [];
for (const file of manifest.files) {
  const baseline = await read(file.source), candidate = await read(file.path);
  assert.equal(hash(baseline), file.sourceSha256); assert.equal(hash(candidate), file.sha256);
  const before = JSON.parse(baseline), after = JSON.parse(candidate);
  assert.deepEqual(before.Meta, after.Meta);
  assert.equal(after.Curves.length, 11);
  const name = path.basename(file.path);
  const expected = name.startsWith("Idle_") ? { id: "ParamBreath", factor: 1 / .22 } : name.startsWith("Hover_") ? { id: "ParamAngleY", factor: 9 } : null;
  for (let i = 0; i < after.Curves.length; i++) {
    const prior = before.Curves[i], curve = after.Curves[i];
    assert.equal(curve.Target, "Parameter"); assert.equal(curve.Id, prior.Id);
    assert.ok(!manifest.excludedPhysicsOutputParameters.includes(curve.Id));
    if (curve.Id !== expected?.id) assert.deepEqual(curve, prior);
    else {
      assert.equal(curve.Segments.length, prior.Segments.length);
      for (let at = 2; at < curve.Segments.length; at += 7) {
        for (const offset of [0, 1, 3, 5]) assert.equal(curve.Segments[at + offset], prior.Segments[at + offset]);
        for (const offset of [2, 4, 6]) assert.ok(Math.abs(curve.Segments[at + offset] - prior.Segments[at + offset] * expected.factor) < 1e-12);
      }
    }
    // Zero tangent at every key: endpoint/interior continuity is not inferred
    // from sparse frame samples alone. Times themselves remain source times.
    let previousValue = curve.Segments[1], previousTime = curve.Segments[0];
    for (let at = 2; at < curve.Segments.length; at += 7) {
      const [kind, t1, v1, t2, v2, end, value] = curve.Segments.slice(at, at + 7);
      assert.equal(kind, 1); assert.ok(previousTime < t1 && t1 < t2 && t2 < end);
      assert.equal(previousValue, v1); assert.equal(v2, value);
      previousValue = value; previousTime = end;
    }
  }
  pairs.push({ name, baseline: baseline.toString("utf8"), candidate: candidate.toString("utf8"), expected });
}
const stage = path.join(repo, "output/forest-spirit-production-v2/front-v8");
const approvedPhysicsManifest = JSON.parse(await read(path.join(stage, "revisions/physics-program-v5-r2/physics-drafts/physics-draft.manifest.json")));
assert.equal(hash(await read(approvedPhysicsManifest.parameterBoundsSource.path)), approvedPhysicsManifest.parameterBoundsSource.sha256);
const modelPath = await realpath(path.resolve(repo, values.model)), model = JSON.parse(await read(modelPath));
const mocPath = path.resolve(path.dirname(modelPath), model.FileReferences.Moc);
assert.ok(mocPath.startsWith(path.dirname(modelPath) + path.sep));
const moc = await read(mocPath), physicsBytes = await read(path.resolve(repo, values.physics)), physics = JSON.parse(physicsBytes);
assert.equal(hash(physicsBytes), "b00744d57d25895c5ad5d94dda398365417be3734e624a816d7eedb7140bcbe7");
const sdk = path.join(repo, "output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5");
assert.match((await read(path.join(sdk, "cubism-info.yml"))).toString("utf8"), /^version: 5-r\.5\s*$/mu);
const corePath = path.join(sdk, "Core/live2dcubismcore.min.js"), core = await read(corePath);
const sourceEntry = path.join(out, "official-motion-evaluation.ts");
await writeFile(sourceEntry, `
import { CubismFramework } from "@cubism/live2dcubismframework";
import { CubismMoc } from "@cubism/model/cubismmoc";
import { CubismMotion } from "@cubism/motion/cubismmotion";
import { CubismMotionQueueEntry } from "@cubism/motion/cubismmotionqueueentry";
import "@cubism/rendering/cubismrenderer_webgl";
export function run(input) {
  CubismFramework.startUp(); CubismFramework.initialize();
  const bytes=Uint8Array.from(atob(input.moc), c=>c.charCodeAt(0)).buffer;
  const moc=CubismMoc.create(bytes,true); if(!moc)throw Error("Official Core consistency failed");
  const model=moc.createModel(); if(!model)throw Error("Actual Core model unavailable");
  const bounds=Object.fromEntries(Array.from({length:model.getParameterCount()},(_,i)=>[String(model.getParameterId(i).getString()),{minimum:model.getParameterMinimumValue(i),default:model.getParameterDefaultValue(i),maximum:model.getParameterMaximumValue(i)}]));
  const ids=Object.keys(bounds), index=new Map(ids.map((id,i)=>[id,i]));
  if(JSON.stringify(bounds)!==JSON.stringify(input.bounds))for(const id of ids)for(const key of ["minimum","default","maximum"])if(bounds[id][key]!==input.bounds[id]?.[key])throw Error("Actual parameter bounds mismatch");
  if(ids.length!==17||Object.keys(input.bounds).length!==17)throw Error("Exact 17 real parameters required");
  const reset=()=>ids.forEach((id,i)=>model.setParameterValueByIndex(i,bounds[id].default));
  const sample=(text)=>{
    const json=JSON.parse(text),data=new TextEncoder().encode(text).buffer;
    const motion=CubismMotion.create(data,data.byteLength,undefined,undefined,true);if(!motion)throw Error("Official motion parser rejected input");
    const originalFades={in:motion.getFadeInTime(),out:motion.getFadeOutTime()};
    motion.setLoop(false);motion.setFadeInTime(0);motion.setFadeOutTime(0);motion.setEffectIds([],[]);
    const queue=new CubismMotionQueueEntry();queue._motion=motion;motion.setupMotionQueueEntry(queue,0);
    try{
      const count=Math.round(json.Meta.Duration*240),frames=[],minimum=Object.fromEntries(ids.map(id=>[id,Infinity])),maximum=Object.fromEntries(ids.map(id=>[id,-Infinity]));
      for(let frame=0;frame<=count;frame++){
        const time=frame===count?json.Meta.Duration:frame/240;reset();motion.updateParameters(model,queue,time);
        const values=Object.fromEntries(ids.map(id=>[id,model.getParameterValueByIndex(index.get(id))]));
        for(const id of ids){const value=values[id];if(!Number.isFinite(value)||value<bounds[id].minimum-1e-6||value>bounds[id].maximum+1e-6)throw Error("Invalid evaluated parameter "+id);minimum[id]=Math.min(minimum[id],value);maximum[id]=Math.max(maximum[id],value);}
        frames.push({time,values});
      }
      return {fps:json.Meta.Fps,duration:json.Meta.Duration,originalFades,frames,minimum,maximum,first:frames[0].values,last:frames.at(-1).values};
    }finally{queue.release();motion.release();}
  };
  try{return{actualDrawableCount:model.getDrawableCount(),actualParameterBounds:bounds,cases:input.pairs.map(pair=>({name:pair.name,baseline:sample(pair.baseline),candidate:sample(pair.candidate)}))};}
  finally{moc.deleteModel(model);moc.release();CubismFramework.dispose();CubismFramework.cleanUp();}
}
`, { encoding: "utf8", flag: "wx" });
let vitePath;
for (const dir of ["apps/web", "output/live2d-proof-20261105"]) { try { vitePath = createRequire(path.join(repo, dir, "package.json")).resolve("vite"); break; } catch { /* Existing local only. */ } }
assert.ok(vitePath);
const { build } = await import(pathToFileURL(vitePath).href);
await build({ configFile: false, root: repo, logLevel: "error", resolve: { alias: { "@cubism": path.join(sdk, "Framework/src") } }, build: { minify: false, emptyOutDir: false, outDir: out, lib: { entry: sourceEntry, name: "OfficialMotionEvaluation", formats: ["iife"], fileName: () => "official-motion-evaluation.js" } } });
const context = vm.createContext({ console, TextEncoder, TextDecoder, WebAssembly, setTimeout, clearTimeout, performance, atob, btoa });
vm.runInContext(core.toString("utf8"), context, { filename: corePath });
let coreVersion;
for (let attempt = 0; attempt < 200; attempt++) { try { coreVersion = vm.runInContext("Live2DCubismCore.Version.csmGetVersion()", context); } catch { /* Embedded WASM startup. */ } if (coreVersion > 0) break; await new Promise(resolve => setTimeout(resolve, 10)); }
assert.ok(coreVersion > 0);
const report = { designation: "PROGRAM_DRAFT_OFFLINE_SDK_DIAGNOSTIC", scope: "Actual official SDK curves and physics evaluated on actual r9 Core parameter arrays in Node VM. No browser/rendered frame, new model binding, Editor reopen/export or visual acceptance.", browserStarted: false, editorOpened: false, editorExported: false, productionApproval: false, visualAcceptance: false, coreVersion, modelPath, checks: [], physicsInputMapping: physics.PhysicsSettings.map(group => ({ output: group.Output[0].Destination.Id, inputs: group.Input.map(input => input.Source.Id) })), curveEvaluation: "Raw authored curves at 240 Hz, fades disabled solely to compare curve values. Existing application transition/fade replay is a separate test.", authority: "Two authorized native curves only, preserving 42 other curves and all six unkeyed physics tracks" };
function check(name, passed, detail) { report.checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) }); }
try {
  vm.runInContext((await readFile(path.join(out, "official-motion-evaluation.js"))).toString("utf8"), context);
  context.probeInput = { moc: moc.toString("base64"), bounds: approvedPhysicsManifest.parameterBounds, pairs };
  const actual = vm.runInContext("OfficialMotionEvaluation.run(probeInput)", context);
  report.curves = actual;
  check("actual Core exposes 72 drawables and 17 approved parameter bounds", actual.actualDrawableCount === 72 && Object.keys(actual.actualParameterBounds).length === 17);
  for (const actualCase of actual.cases) {
    const pair = pairs.find(pair => pair.name === actualCase.name), errors = {};
    for (const id of Object.keys(actual.actualParameterBounds)) errors[id] = 0;
    assert.equal(actualCase.baseline.frames.length, actualCase.candidate.frames.length);
    for (let i = 0; i < actualCase.candidate.frames.length; i++) for (const id of Object.keys(errors)) {
      const baseline = actualCase.baseline.frames[i].values[id], candidate = actualCase.candidate.frames[i].values[id];
      errors[id] = Math.max(errors[id], Math.abs(candidate - baseline * (id === pair.expected?.id ? pair.expected.factor : 1)));
    }
    check(`${pair.name}: actual SDK values match only the declared scaling`, Object.entries(errors).every(([id, error]) => error <= (id === pair.expected?.id ? 3e-6 : 0)), errors);
    check(`${pair.name}: actual endpoint values preserved`, Object.keys(errors).every(id => actualCase.candidate.first[id] === actualCase.baseline.first[id] && actualCase.candidate.last[id] === actualCase.baseline.last[id]));
  }
  const byPrefix = prefix => actual.cases.find(item => item.name.startsWith(prefix)).candidate;
  check("Idle loop exact endpoint values", JSON.stringify(byPrefix("Idle").first) === JSON.stringify(byPrefix("Idle").last));
  check("DragHold final and PutDown first match all actual parameters", JSON.stringify(byPrefix("DragHold").last) === JSON.stringify(byPrefix("PutDown").first));
  check("Hover and PutDown return all actual parameters to defaults", [byPrefix("Hover"), byPrefix("PutDown")].every(item => Object.entries(actual.actualParameterBounds).every(([id, bound]) => item.last[id] === bound.default)));
  check("Idle breath reaches one and Hover Y reaches 27", byPrefix("Idle").maximum.ParamBreath === 1 && byPrefix("Hover").maximum.ParamAngleY === 27);
  check("all six physics groups omit AngleY so Hover change cannot alter physics input", physics.PhysicsSettings.every(group => group.Input.every(input => input.Source.Id !== "ParamAngleY")));

  // Reuse the previously audited real SDK solver bundle as-is, with its 14s
  // schedules and unclamped-output checks; no browser is necessary for Core.
  const solverFile = path.join(stage, "validation/physics-program-v5-r2-solver/official-physics-probe.js");
  const solverCode = await read(solverFile);
  report.reusedSolverSource = { path: solverFile, sha256: hash(solverCode), note: "Historical helper's internal scope string mentions r12; this invocation actually uses the hashed 72-drawable r9 MOC above, not r12." };
  vm.runInContext(solverCode.toString("utf8"), context);
  report.physics = {};
  for (const variant of ["baseline", "candidate"]) {
    context.physicsInput = { moc: moc.toString("base64"), bounds: approvedPhysicsManifest.parameterBounds, physics: physicsBytes.toString("utf8"), motions: pairs.map(pair => ({ name: pair.name, text: pair[variant] })) };
    const result = vm.runInContext("OfficialPhysicsProbe.run(physicsInput)", context);
    report.physics[variant] = result;
    for (const entry of result.cases) for (const [name, passed] of Object.entries(entry.checks)) check(`${variant}/${entry.schedule}/${entry.scenario}/${name}`, passed);
  }
  report.physicsMotionComparison = [];
  for (const candidate of report.physics.candidate.cases.filter(item => item.scenario.endsWith(".motion3.json"))) {
    const baseline = report.physics.baseline.cases.find(item => item.scenario === candidate.scenario && item.schedule === candidate.schedule);
    const fields = ["peak", "minimum", "maximum", "peakToPeak", "tail", "rawPreWeightPeak"];
    const difference = Object.fromEntries(Object.keys(candidate.peak).map(id => [id, Math.max(...fields.map(field => Math.abs(candidate[field][id] - baseline[field][id])))]));
    const allowed = candidate.scenario.startsWith("Idle_") ? "ParamFSScarfSway" : null;
    check(`${candidate.schedule}/${candidate.scenario}: physics change confined to Idle scarf input`, Object.entries(difference).every(([id, value]) => id === allowed || value === 0), difference);
    report.physicsMotionComparison.push({ schedule: candidate.schedule, motion: candidate.scenario, baselinePeakToPeak: baseline.peakToPeak, candidatePeakToPeak: candidate.peakToPeak, candidateRawPreWeightPeak: candidate.rawPreWeightPeak, candidateTail: candidate.tail, maximumDifference: difference });
  }
} catch (error) { report.error = String(error); process.exitCode = 1; }
report.inputs = [...inputs.values()];
report.probeArtifacts = await Promise.all([sourceEntry, path.join(out, "official-motion-evaluation.js")].map(async filename => { const bytes = await readFile(filename); return { path: filename, sha256: hash(bytes), bytes: bytes.length }; }));
report.inputsUnchanged = (await Promise.all(report.inputs.map(async item => hash(await readFile(item.path)) === item.sha256))).every(Boolean);
check("all original CAN/export/physics/model and candidate inputs remain unchanged", report.inputsUnchanged);
report.passed = !report.error && report.checks.every(item => item.passed);
report.status = report.passed ? "offline_numeric_checks_passed_native_and_visual_pending" : "offline_numeric_checks_failed";
if (!report.passed) process.exitCode = 2;
await writeFile(path.join(out, "offline-sdk-amplitude-report.json"), JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failed: report.checks.filter(item => !item.passed).map(item => item.name), error: report.error ?? null, output: out, browserStarted: false, productionApproval: false }));
