/* global window */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import { productionOptions, readProductionContext } from "./production-context.mjs";

// Real Core parameters -> WebGL draw -> visible canvas recording. No PNG playback,
// authored motion/CAN claim, model mutation, product feature flag, or paid request.
const { values } = parseArgs({ options: { ...productionOptions, model: { type: "string" }, runtime: { type: "string", default: "output/forest-spirit-runtime/front-v8-eye-sequence" }, "capture-id": { type: "string", default: "r10-eye-sequence" } } });
assert.ok(values.model?.endsWith(".model3.json"), "Pass an actual Editor-exported model3.json");
assert.match(values["capture-id"], /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u);
const { repo, characterId, specification, outputRoot } = await readProductionContext(values);
assert.equal(characterId, "forest-spirit-front-v8");
assert.deepEqual(specification.working_canvas, [971, 1620]);
const modelPath = await realpath(path.resolve(repo, values.model));
const roots = { model: path.dirname(modelPath), runtime: await realpath(path.resolve(repo, values.runtime)) };
const output = path.join(outputRoot, "validation", values["capture-id"]);
await mkdir(output, { recursive: false });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const resources = new Map();
const modelUrl = `/model/${encodeURIComponent(path.basename(modelPath))}`;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>真实 r10 连续眼参数诊断</title>
<style>html,body{margin:0;background:#f4f1e8}#evidence{display:block;width:1100px;height:820px}#model{position:absolute;left:-2000px;width:971px;height:1620px}</style>
<canvas id="model" width="971" height="1620"></canvas><canvas id="evidence" width="1100" height="820"></canvas>
<script src="/runtime/live2dcubismcore.min.js"></script><script type="module">
import {createNeutralDiagnosticRenderer,sdkVersion} from '/runtime/forest-spirit-runtime.js';
const source=document.querySelector('#model'), display=document.querySelector('#evidence'), ctx=display.getContext('2d');
const proof=window.eyeSequence={ready:false,done:false,errors:[],frames:[],sdkVersion};
const eyeIds=new Set(['Eye_L_Open','Eye_L_Closed','Eye_L_Cross','Eye_R_Open','Eye_R_Closed','Eye_R_Cross']);
source.addEventListener('forest-spirit-error',event=>proof.errors.push(String(event.detail)));
const renderer=createNeutralDiagnosticRenderer(source);proof.renderer=renderer;
const smooth=value=>value*value*(3-2*value);
function openness(local){if(local<160)return 1;if(local<340)return 1-smooth((local-160)/180);if(local<480)return 0;if(local<740)return smooth((local-480)/260);return 1;}
function intended(ms){const cycle=Math.min(5,Math.floor(ms/1000)), value=ms>=6000?1:openness(ms%1000);return {left:cycle===3?1:value,right:cycle===2?1:value,cycle,mode:cycle===2?'left only':cycle===3?'right only':'both'};}
function paint(snapshot,elapsed,mode){
 ctx.fillStyle='#f4f1e8';ctx.fillRect(0,0,1100,820);ctx.fillStyle='#213f30';ctx.font='bold 22px sans-serif';ctx.fillText('Actual Editor-exported r10 / official Core / continuous eye diagnostic',18,30);
 ctx.font='15px sans-serif';ctx.fillText('22-layer internal sample with TEMP composites. No authored motion or production approval.',18,55);
 ctx.fillText('Full character: 220 CSS px',18,88);ctx.fillText('Same live WebGL frame: fixed face ROI, enlarged 2x',275,88);
 ctx.drawImage(source,0,0,971,1620,18,104,220,1620*220/971);
 ctx.drawImage(source,326,343,397,288,275,104,794,576);
 ctx.fillStyle='#213f30';ctx.font='18px monospace';ctx.fillText('t='+ (elapsed/1000).toFixed(3)+'s / '+mode,18,510);
 ctx.fillText('L='+snapshot.parameters.ParamEyeLOpen.toFixed(3)+'  R='+snapshot.parameters.ParamEyeROpen.toFixed(3),18,540);
 ctx.font='14px sans-serif';ctx.fillText('Anatomical L = viewer right',18,570);ctx.fillText('Software WebGL; not a GPU benchmark',18,594);
 ctx.strokeStyle='#b0b7a5';ctx.strokeRect(18,700,1050,80);
 for(const [key,color] of [['ParamEyeLOpen','#245f3b'],['ParamEyeROpen','#ac6a2c']]){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();proof.frames.forEach((f,i)=>{const x=18+1050*f.elapsedMs/6000,y=778-76*f.parameters[key];if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();}
 ctx.fillStyle='#213f30';ctx.fillText('Actual parameter trace: green L / amber R; close > hold > reopen; bilateral repeats and independent winks',18,808);
}
try {
 await renderer.load({model3Url:${JSON.stringify(modelUrl)}},new AbortController().signal);
 const neutral=renderer.renderEyeState(1,1);paint(neutral,0,'ready');proof.ready=true;
 proof.start=async()=>{
  if(proof.started)throw new Error('Sequence already started');proof.started=true;
  const stream=display.captureStream(0), track=stream.getVideoTracks()[0];
  if(typeof track.requestFrame!=='function')throw new Error('Manual frame recording is unavailable');
  // Prefer the cheaper local encoder: VP9 startup stalled encoded frames during
  // the first observed software capture even while real Core rendering continued.
  const mime=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(value=>MediaRecorder.isTypeSupported(value));
  if(!mime)throw new Error('No local WebM encoder');
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2500000}), chunks=[];
  recorder.addEventListener('dataavailable',event=>{if(event.data.size)chunks.push(event.data);});
  const stopped=new Promise(resolve=>recorder.addEventListener('stop',resolve,{once:true}));
  recorder.start();
  const started=performance.now();let last=-Infinity;
  await new Promise((resolve,reject)=>{
   const tick=now=>{try{
    if(now-last<1000/30){requestAnimationFrame(tick);return;}
    last=now;const elapsed=Math.min(6000,now-started), target=intended(elapsed), renderStart=performance.now();
    const snapshot=renderer.renderEyeState(target.left,target.right);
    if(snapshot.pngDataUrl!==undefined)throw new Error('Unexpected per-frame PNG encoding');
    const frame={index:proof.frames.length,elapsedMs:elapsed,wallElapsedMs:now-started,renderDurationMs:performance.now()-renderStart,mode:target.mode,cycle:target.cycle,requested:{left:target.left,right:target.right},parameters:snapshot.parameters,eyes:snapshot.drawables.filter(d=>eyeIds.has(d.id)),unexpectedChangedDrawables:snapshot.drawables.filter(d=>!eyeIds.has(d.id)&&(d.changedVertexCount>0||Math.abs(d.opacityDeltaFromNeutral)>1e-7)).map(d=>d.id)};
    proof.frames.push(frame);paint(snapshot,elapsed,target.mode);track.requestFrame();
    if(elapsed>=6000){resolve();return;}requestAnimationFrame(tick);
   }catch(error){reject(error);}};requestAnimationFrame(tick);
  });
  // Allow the final requested rendered frame to reach the local encoder.
  await new Promise(resolve=>setTimeout(resolve,80));recorder.stop();await stopped;track.stop();
  const blob=new Blob(chunks,{type:mime});proof.videoDataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  proof.mime=mime;proof.finalNeutral=renderer.captureNeutral();proof.durationWallMs=performance.now()-started;proof.done=true;
 };
}catch(error){proof.errors.push(String(error));}
</script></html>`;
const mime = { ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".vert": "text/plain", ".frag": "text/plain" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" }); response.end(html); return; }
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    const root = roots[parts.shift()];
    if (!root) throw new Error("Unknown resource root");
    const filename = await realpath(path.resolve(root, ...parts));
    if (!filename.startsWith(root + path.sep)) throw new Error("Resource escaped diagnostic root");
    const bytes = await readFile(filename);
    resources.set(filename, { path: filename, bytes: bytes.length, sha256: sha(bytes) });
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] ?? "application/octet-stream", "Cache-Control": "no-store" }); response.end(bytes);
  } catch { response.writeHead(404); response.end("Missing local diagnostic resource"); }
});
const report = { characterId, scope: "Actual Editor-exported 22-layer r10 internal model directly driven through official Core; no authored four motions, CAN or production approval", status: "not_run", model: { path: modelPath, sha256: sha(await readFile(modelPath)) }, plannedDurationMs: 6000, maximumRequestedFps: 30, renderer: "Official SDK 5-r.5; headless Chromium SwiftShader software WebGL, not hardware performance evidence", rawCanvas: { width: 971, height: 1620, dpr: 1, fit: 1 }, fullViewCssWidth: 220, enlargedFaceSourceRect: [326,343,723,631], recording: "Primary actual-browser-recording.webm records the real browser viewport. Its evidence canvas copies freshly drawn WebGL frames directly, never PNG/reference stand-ins. The separate real-eye-sequence.webm canvas MediaRecorder experiment is not the accepted recording: observed startup encoder frame stalls require decoder review.", authoredMotionAdvanced: false, physicsAdvanced: false, productionApproval: false, errors: [], checks: [], createdAt: new Date().toISOString() };
let browser;
let browserVideo;
let context;
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const require = createRequire(import.meta.url);
  const { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  context = await browser.newContext({ viewport: { width: 1100, height: 820 }, deviceScaleFactor: 1, recordVideo: { dir: path.join(output, "browser-recording"), size: { width: 1100, height: 820 } } });
  const page = await context.newPage();
  browserVideo = page.video();
  page.on("pageerror", error => report.errors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => window.eyeSequence.ready || window.eyeSequence.errors.length, undefined, { timeout: 45000 });
  const loaded = await page.evaluate(() => ({ ready: window.eyeSequence.ready, errors: window.eyeSequence.errors }));
  assert.ok(loaded.ready && !loaded.errors.length, JSON.stringify(loaded));
  await page.evaluate(() => window.eyeSequence.start());
  const result = await page.evaluate(() => ({ done: window.eyeSequence.done, errors: window.eyeSequence.errors, frames: window.eyeSequence.frames, mime: window.eyeSequence.mime, videoDataUrl: window.eyeSequence.videoDataUrl, durationWallMs: window.eyeSequence.durationWallMs, finalNeutral: window.eyeSequence.finalNeutral }));
  assert.ok(result.done && !result.errors.length, JSON.stringify(result.errors));
  const video = Buffer.from(result.videoDataUrl.split(",")[1], "base64");
  await writeFile(path.join(output, "real-eye-sequence.webm"), video);
  const neutral = Buffer.from(result.finalNeutral.pngDataUrl.split(",")[1], "base64");
  await writeFile(path.join(output, "final-neutral-971x1620.png"), neutral);
  await page.screenshot({ path: path.join(output, "sequence-final-page.png") });
  for (const frame of result.frames) for (const eye of frame.eyes) eye.vertexPositionsSha256 = sha(Buffer.from(Float32Array.from(eye.vertexPositions).buffer));
  await writeFile(path.join(output, "actual-render-frame-trace.json"), JSON.stringify({ scope: report.scope, model: report.model, frames: result.frames }, null, 2) + "\n");
  const intervals = result.frames.slice(1).map((frame, index) => frame.wallElapsedMs - result.frames[index].wallElapsedMs);
  report.actual = { frameCount: result.frames.length, sampledDurationMs: result.frames.at(-1).elapsedMs, wallDurationMs: result.durationWallMs, renderedFps: (result.frames.length - 1) * 1000 / (result.frames.at(-1).wallElapsedMs - result.frames[0].wallElapsedMs), minimumFrameIntervalMs: Math.min(...intervals), maximumFrameIntervalMs: Math.max(...intervals), meanRenderDurationMs: result.frames.reduce((sum, frame) => sum + frame.renderDurationMs, 0) / result.frames.length, recorderMime: result.mime };
  const check = (name, passed) => { report.checks.push({ name, passed: Boolean(passed) }); };
  check("actual sequence reaches 6000 ms", result.frames.at(-1).elapsedMs === 6000);
  check("render cadence never exceeds 30 frames per second", Math.min(...intervals) >= 1000 / 30 - 1e-5);
  check("actual requested eye parameters match Core every frame", result.frames.every(frame => Math.abs(frame.parameters.ParamEyeLOpen - frame.requested.left) < 1e-6 && Math.abs(frame.parameters.ParamEyeROpen - frame.requested.right) < 1e-6));
  check("all six real eye drawables are traced on every frame", result.frames.every(frame => frame.eyes.length === 6 && frame.eyes.every(eye => eye.vertexCount > 0 && eye.textureIndexValid)));
  check("each of six cycles includes a real closed state", [0,1,2,3,4,5].every(cycle => result.frames.some(frame => frame.cycle === cycle && (cycle === 3 ? frame.parameters.ParamEyeROpen : frame.parameters.ParamEyeLOpen) === 0)));
  check("single-eye cycles leave the other parameter open", result.frames.filter(frame => frame.cycle === 2 || frame.cycle === 3).every(frame => frame.cycle === 2 ? frame.parameters.ParamEyeROpen === 1 : frame.parameters.ParamEyeLOpen === 1));
  check("unrelated drawables never change from their neutral geometry/opacity", result.frames.every(frame => frame.unexpectedChangedDrawables.length === 0));
  check("Core ends with both eye parameters open", result.finalNeutral.parameters.ParamEyeLOpen === 1 && result.finalNeutral.parameters.ParamEyeROpen === 1);
  check("no browser or runtime errors", report.errors.length === 0 && result.errors.length === 0);
  report.status = report.checks.every(check => check.passed) ? "actual_continuous_eye_diagnostic_recorded_visual_review_pending" : "failed_checks";
  if (report.status === "failed_checks") process.exitCode = 2;
  await page.evaluate(() => window.eyeSequence.renderer.dispose());
} catch (error) {
  report.status = "failed"; report.failure = String(error); process.exitCode = 1;
} finally {
  await context?.close();
  if (browserVideo) await browserVideo.saveAs(path.join(output, "actual-browser-recording.webm"));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  report.resources = [...resources.values()];
  for (const item of report.resources) item.unchangedAfterRecording = sha(await readFile(item.path)) === item.sha256;
  report.artifacts = [];
  for (const filename of ["actual-browser-recording.webm", "real-eye-sequence.webm", "final-neutral-971x1620.png", "sequence-final-page.png", "actual-render-frame-trace.json"]) {
    try { const bytes = await readFile(path.join(output, filename)); report.artifacts.push({ filename, bytes: bytes.length, sha256: sha(bytes) }); } catch { /* Failed runs do not invent artifacts. */ }
  }
  await writeFile(path.join(output, "sequence-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, output, actual: report.actual, failedChecks: report.checks.filter(check => !check.passed), failure: report.failure ?? null, productionApproval: false }));
}
