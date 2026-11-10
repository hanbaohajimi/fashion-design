import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// Real official solver on a genuine model's parameter arrays. No fabricated moc,
// WebGL image substitution, Editor export, binding or visual-physics claim.
const { values } = parseArgs({ options: { manifest: { type: "string" }, model: { type: "string" }, out: { type: "string" }, sdk: { type: "string", default: "output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5" } } });
assert.ok(values.manifest && values.model && values.out);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = path.resolve(repo, values.out);
assert.ok(out.startsWith(path.join(repo, "output") + path.sep));
await mkdir(out, { recursive: true });
assert.ok((await realpath(out)).startsWith((await realpath(path.join(repo, "output"))) + path.sep));
const hash = data => createHash("sha256").update(data).digest("hex");
const inputs = new Map();
async function read(file) { const name = await realpath(file), bytes = await readFile(name); inputs.set(name, hash(bytes)); return bytes; }
const manifest = JSON.parse(await read(path.resolve(repo, values.manifest)));
assert.equal(manifest.characterId, "forest-spirit-front-v8");
assert.equal(manifest.designation, "PROGRAM_DRAFT");
const physicsBytes = await read(manifest.path);
assert.equal(hash(physicsBytes), manifest.sha256);
const physics = JSON.parse(physicsBytes);
assert.equal(physics.Meta.Fps, 60); assert.equal(physics.PhysicsSettings.length, 6);
const modelPath = await realpath(path.resolve(repo, values.model)), model3 = JSON.parse(await read(modelPath));
const mocPath = path.resolve(path.dirname(modelPath), model3.FileReferences.Moc);
assert.ok(mocPath.startsWith(path.dirname(modelPath) + path.sep));
const moc = await read(mocPath);
const motions = [];
for (const source of manifest.reviewedMotionFiles) {
  const bytes = await read(source.path); assert.equal(hash(bytes), source.sha256);
  motions.push({ name: path.basename(source.path), text: bytes.toString("utf8") });
}
for (const source of [manifest.parameterBoundsSource, manifest.motionManifestSource]) assert.equal(hash(await read(source.path)), source.sha256);
assert.equal(hash(await read(manifest.specification)), manifest.specificationSha256);
const sdk = await realpath(path.resolve(repo, values.sdk));
assert.match(await readFile(path.join(sdk, "cubism-info.yml"), "utf8"), /^version: 5-r\.5\s*$/mu);
const require = createRequire(import.meta.url);
let vitePath;
for (const folder of ["apps/web", "output/live2d-proof-20261105"]) {
  try { vitePath = createRequire(path.join(repo, folder, "package.json")).resolve("vite"); break; } catch { /* Existing local dependency only. */ }
}
assert.ok(vitePath);
const { build } = await import(pathToFileURL(vitePath).href);
const entry = path.join(out, "official-physics-probe.ts");
await writeFile(entry, `
import { CubismFramework } from "@cubism/live2dcubismframework";
import { CubismMoc } from "@cubism/model/cubismmoc";
import { CubismPhysics } from "@cubism/physics/cubismphysics";
import { CubismMotion } from "@cubism/motion/cubismmotion";
import { CubismMotionQueueEntry } from "@cubism/motion/cubismmotionqueueentry";
import "@cubism/rendering/cubismrenderer_webgl";
export function run(input) {
  CubismFramework.startUp(); CubismFramework.initialize();
  const bytes = Uint8Array.from(atob(input.moc), c => c.charCodeAt(0)).buffer;
  const moc = CubismMoc.create(bytes, true); if (!moc) throw new Error("Actual moc failed official consistency");
  const model = moc.createModel(); if (!model) throw new Error("Actual model creation failed");
  const bounds = Object.fromEntries(Array.from({length:model.getParameterCount()},(_,i)=>[String(model.getParameterId(i).getString()), {minimum:model.getParameterMinimumValue(i), maximum:model.getParameterMaximumValue(i), default:model.getParameterDefaultValue(i)}]));
  if (JSON.stringify(Object.keys(bounds).sort()) !== JSON.stringify(Object.keys(input.bounds).sort())) throw new Error("Actual model does not contain the exact 17 CSV parameters");
  for (const id of Object.keys(bounds)) for (const key of ["minimum","maximum","default"]) if (bounds[id][key] !== input.bounds[id][key]) throw new Error("CSV range mismatch: "+id+"/"+key);
  const ids=Object.keys(bounds), indices=new Map(ids.map((id,i)=>[id,i]));
  const settings=JSON.parse(input.physics).PhysicsSettings, outputs=settings.map(s=>s.Output[0].Destination.Id);
  for(const group of settings) for(const id of [...group.Input.map(i=>i.Source.Id),...group.Output.map(o=>o.Destination.Id)]) if(!indices.has(id))throw new Error("Missing real parameter: "+id);
  const data=new TextEncoder().encode(input.physics).buffer;
  const reset=()=>ids.forEach((id,index)=>model.setParameterValueByIndex(index,bounds[id].default));
  const cases=[{name:"neutral",kind:"neutral"},{name:"head-positive-step",kind:"step",values:{ParamAngleZ:30,ParamAngleY:30}},{name:"head-negative-step",kind:"step",values:{ParamAngleZ:-30,ParamAngleY:-30}},{name:"body-positive-step",kind:"step",values:{ParamBodyAngleZ:10,ParamFSPickup:1,ParamFSSettle:1}},{name:"body-negative-step",kind:"step",values:{ParamBodyAngleZ:-10}},{name:"hat-touch-step",kind:"step",values:{ParamFSHatTouch:1}},{name:"breath-step",kind:"step",values:{ParamBreath:1}},{name:"pickup-step",kind:"step",values:{ParamFSPickup:1}},{name:"settle-step",kind:"step",values:{ParamFSSettle:1}},{name:"all-inputs-positive-step",kind:"step",values:{ParamAngleZ:30,ParamBodyAngleZ:10,ParamFSPickup:1,ParamFSSettle:1,ParamFSHatTouch:1,ParamBreath:1}},{name:"all-gestures-head-negative-step",kind:"step",values:{ParamAngleZ:-30,ParamBodyAngleZ:-10,ParamFSPickup:1,ParamFSSettle:1,ParamFSHatTouch:1,ParamBreath:1}},{name:"bounded-combined-sine",kind:"sine"},...input.motions.map(m=>({name:m.name,kind:"motion",text:m.text}))];
  cases.push({name:"DragHold-hold-then-PutDown",kind:"motion-chain",text:input.motions.find(m=>m.name.startsWith("DragHold_")).text,release:input.motions.find(m=>m.name.startsWith("PutDown_")).text},{name:"neutral-cold-start",kind:"neutral",coldStart:true});
  const results=[];
  try {
    for(const schedule of [{name:"60fps",dts:[1/60]},{name:"30fps",dts:[1/30]},{name:"jitter-up-to-100ms",dts:[1/120,1/24,1/30,.1]}]) for(const scenario of cases){
      reset();
      const solver=CubismPhysics.create(data,data.byteLength);
      let motion,queue,releaseMotion,releaseQueue,heldValues;
      try{
        if(!scenario.coldStart)solver.stabilization(model);
        if(scenario.kind==="motion"||scenario.kind==="motion-chain"){
          const buffer=new TextEncoder().encode(scenario.text).buffer;
          motion=CubismMotion.create(buffer,buffer.byteLength,undefined,undefined,true); if(!motion)throw new Error("Motion parser rejected input");
          motion.setLoop(false);motion.setFadeInTime(0);motion.setFadeOutTime(0);motion.setEffectIds([],[]);
          queue=new CubismMotionQueueEntry();queue._motion=motion;motion.setupMotionQueueEntry(queue,0);
          if(scenario.kind==="motion-chain"){
            const endQueue=new CubismMotionQueueEntry();endQueue._motion=motion;motion.setupMotionQueueEntry(endQueue,0);
            motion.updateParameters(model,endQueue,JSON.parse(scenario.text).Meta.Duration);
            heldValues=ids.map((_,i)=>model.getParameterValueByIndex(i));endQueue.release();reset();
            const releaseBuffer=new TextEncoder().encode(scenario.release).buffer;
            releaseMotion=CubismMotion.create(releaseBuffer,releaseBuffer.byteLength,undefined,undefined,true);if(!releaseMotion)throw new Error("Release motion parser rejected input");
            releaseMotion.setLoop(false);releaseMotion.setFadeInTime(0);releaseMotion.setFadeOutTime(0);releaseMotion.setEffectIds([],[]);
            releaseQueue=new CubismMotionQueueEntry();releaseQueue._motion=releaseMotion;releaseMotion.setupMotionQueueEntry(releaseQueue,3);
          }
        }
        const peak=Object.fromEntries(outputs.map(id=>[id,0])), tail={...peak}, rawPeak={...peak}, minimum={...peak}, maximum={...peak}, trace=[];
        let time=0,frames=0,finite=true,inRange=true,unchangedInputs=true,peakParticleSpeed=0;
        const neutralOutput=Object.fromEntries(outputs.map(id=>[id,model.getParameterValueByIndex(indices.get(id))]));
        while(time<14-1e-9){
          const dt=Math.min(schedule.dts[frames%schedule.dts.length],14-time);time+=dt;
          reset();
          if(scenario.kind==="step"&&time>=.5&&time<1.5)for(const [id,value]of Object.entries(scenario.values))model.setParameterValueByIndex(indices.get(id),value);
          if(scenario.kind==="sine"&&time<3){const s=Math.sin(time*2*Math.PI);for(const[id,value]of Object.entries({ParamAngleZ:30*s,ParamBodyAngleZ:10*Math.sin(time*2*Math.PI+.4),ParamAngleY:30*s,ParamFSPickup:(s+1)/2,ParamFSSettle:(Math.sin(time*2*Math.PI+.7)+1)/2,ParamFSHatTouch:(Math.sin(time*2*Math.PI+1.4)+1)/2,ParamBreath:(Math.sin(time*2*Math.PI+2.1)+1)/2}))model.setParameterValueByIndex(indices.get(id),value);}
          const motionDuration=motion?JSON.parse(scenario.text).Meta.Duration:0;
          if(motion&&time<=motionDuration)motion.updateParameters(model,queue,time);
          if(scenario.kind==="motion-chain"){
            if(time>motionDuration&&time<3)ids.forEach((id,i)=>{if(!outputs.includes(id))model.setParameterValueByIndex(i,heldValues[i]);});
            if(time>=3&&time<=3+JSON.parse(scenario.release).Meta.Duration)releaseMotion.updateParameters(model,releaseQueue,time);
          }
          const before=ids.map((_,i)=>model.getParameterValueByIndex(i));
          solver.evaluate(model,dt);model.update();
          const actual=Object.fromEntries(outputs.map(id=>[id,model.getParameterValueByIndex(indices.get(id))]));
          for(const id of ids){const value=model.getParameterValueByIndex(indices.get(id));finite&&=Number.isFinite(value);inRange&&=value>=bounds[id].minimum-1e-6&&value<=bounds[id].maximum+1e-6;if(!outputs.includes(id))unchangedInputs&&=value===before[indices.get(id)];}
          for(let i=0;i<outputs.length;i++){
            const id=outputs[i],raw=solver._currentRigOutputs[i].outputs[0]*settings[i].Output[0].Scale;
            finite&&=Number.isFinite(raw);rawPeak[id]=Math.max(rawPeak[id],Math.abs(raw));peak[id]=Math.max(peak[id],Math.abs(actual[id]));minimum[id]=Math.min(minimum[id],actual[id]);maximum[id]=Math.max(maximum[id],actual[id]);if(time>=12)tail[id]=Math.max(tail[id],Math.abs(actual[id]));
          }
          for(const p of solver._physicsRig.particles){for(const v of [p.position,p.velocity,p.force])finite&&=Number.isFinite(v.x)&&Number.isFinite(v.y);peakParticleSpeed=Math.max(peakParticleSpeed,Math.hypot(p.velocity.x,p.velocity.y));}
          if(frames%Math.max(1,Math.round(.1/dt))===0||time>=14)trace.push({time,outputs:actual});frames++;
        }
        const neutralStable=Object.values(neutralOutput).every(v=>Math.abs(v)<1e-6);
        const decayed=outputs.every(id=>tail[id]<=Math.max(.0001,peak[id]*.05));
        const lowAmplitude=outputs.every(id=>peak[id]<=.25);
        const noHiddenClamping=outputs.every(id=>rawPeak[id]<=Math.max(Math.abs(bounds[id].minimum),Math.abs(bounds[id].maximum)));
        const neutralRemainsZero=scenario.kind!=="neutral"||outputs.every(id=>peak[id]<=1e-6);
        results.push({scenario:scenario.name,schedule:schedule.name,frames,duration:time,coldStart:!!scenario.coldStart,neutralOutput,peak,minimum,maximum,peakToPeak:Object.fromEntries(outputs.map(id=>[id,maximum[id]-minimum[id]])),tail,rawPreWeightPeak:rawPeak,peakParticleSpeed,checks:{finite,inRange,unchangedInputs,neutralStable,neutralRemainsZero,decayed,lowAmplitude,noHiddenClamping},trace});
      } finally {queue?.release();motion?.release();releaseQueue?.release();releaseMotion?.release();solver.release();}
    }
    return {actualParameterBounds:bounds,actualDrawableCount:model.getDrawableCount(),cases:results,outputs,scope:"Actual official solver + real r12 Core parameter arrays, no Editor physics import or deformation/visual acceptance"};
  } finally {moc.deleteModel(model);moc.release();CubismFramework.dispose();CubismFramework.cleanUp();}
}
`, { encoding: "utf8", flag: "wx" });
await build({ configFile: false, root: repo, logLevel: "error", resolve: { alias: { "@cubism": path.join(sdk, "Framework/src") } }, build: { minify: false, emptyOutDir: false, outDir: out, lib: { entry, name: "OfficialPhysicsProbe", formats: ["iife"], fileName: () => "official-physics-probe.js" } } });
const core = await read(path.join(sdk, "Core/live2dcubismcore.min.js"));
const report = { designation: "PROGRAM_DRAFT_SOLVER_DIAGNOSTIC", editorImported: false, editorExported: false, productionApproval: false, rendererFpsCap: 30, solverFps: 60, modelPath, checks: [], pageErrors: [], criteriaFrozenBeforeRun: { durationSeconds: 14, restTailSeconds: [12, 14], minimumTailTolerance: .0001, tailPeakRatio: .05, maximumOutputAmplitude: .25, noPreWeightRangeClipping: true }, sources: ["https://github.com/Live2D/CubismSpecs/blob/master/FileFormats/physics3.json.md", "https://docs.live2d.com/en/cubism-editor-manual/switch-viewer-setting/"] };
let browser;
try {
  const { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
  browser = await chromium.launch({ headless: true });const page=await browser.newPage();
  page.on("pageerror", error=>report.pageErrors.push(error.message));await page.route("**/*", route=>route.abort());
  await page.addScriptTag({content:core.toString("utf8")});await page.waitForFunction(()=>globalThis.Live2DCubismCore?.Version?.csmGetVersion()>0);
  await page.addScriptTag({path:path.join(out,"official-physics-probe.js")});
  report.actual = await page.evaluate(input=>globalThis.OfficialPhysicsProbe.run(input), {moc:moc.toString("base64"),physics:physicsBytes.toString("utf8"),bounds:manifest.parameterBounds,motions});
  for(const entry of report.actual.cases) for(const[name,passed]of Object.entries(entry.checks))report.checks.push({name:entry.schedule+"/"+entry.scenario+"/"+name,passed});
  report.checks.push({name:"all six outputs respond in at least one bounded stimulus",passed:report.actual.outputs.every(id=>report.actual.cases.some(c=>c.peak[id]>1e-5))});
  report.checks.push({name:"no uncaught browser errors",passed:report.pageErrors.length===0});
  report.passed=report.checks.every(c=>c.passed);report.status=report.passed?"official_solver_numeric_checks_passed_editor_import_pending":"solver_numeric_checks_failed";
  if(!report.passed)process.exitCode=2;
}catch(error){report.passed=false;report.status="failed";report.error=String(error);process.exitCode=1;}
finally{
  try{await browser?.close();}catch(error){report.cleanupError=String(error);report.passed=false;report.status="cleanup_failed";process.exitCode=1;}
  report.inputs=[...inputs].map(([file,sha256])=>({file,sha256}));
  report.inputsUnchanged=(await Promise.all([...inputs].map(async([file,digest])=>hash(await readFile(file))===digest))).every(Boolean);
  if(!report.inputsUnchanged){report.passed=false;report.status="input_integrity_failed";process.exitCode=2;}
  await writeFile(path.join(out,"official-physics-solver-report.json"),JSON.stringify(report,null,2)+"\n",{encoding:"utf8",flag:"wx"});
}
console.log(JSON.stringify({passed:report.passed,status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>!c.passed),error:report.error??null,out,editorExported:false}));
