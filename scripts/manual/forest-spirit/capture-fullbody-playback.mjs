/* global window */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inspectMotion, inspectPhysics, inspectNeutralModelPackage, inspectModelPackage } from "./asset-preflight.mjs";
import { resolveDrawableContract } from "./drawable-source-contract.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const stage = "output/forest-spirit-production-v2/front-v8";
const names = [["Idle", "idle"], ["Hover", "hover_greet"], ["DragHold", "drag_hold"], ["PutDown", "put_down"]];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const originForValidation = "http://127.0.0.1";

/** Explicit local routing composition, never described as an Editor export. */
export function routePlaybackPackage(model, modelUrl, physicsUrl, motionUrls) {
  const base = inspectNeutralModelPackage(model, new URL(modelUrl, originForValidation).href);
  const local = url => new URL(url, originForValidation).pathname;
  const routing = { ...model, FileReferences: { ...model.FileReferences, Moc: local(base.moc), Textures: base.textures.map(local), Physics: physicsUrl, Motions: Object.fromEntries(names.map(([, id]) => [id, [{ File: motionUrls[id] }]])) } };
  inspectModelPackage(routing, new URL("/routing.model3.json", originForValidation).href, motionUrls);
  return routing;
}

/** Numerical observation checks only. Never converts these into visual approval. */
export function auditPlaybackTrace(proof, bounds, expectedDrawableIds) {
  assert.ok(Array.isArray(expectedDrawableIds) && expectedDrawableIds.length > 0);
  assert.equal(new Set(expectedDrawableIds).size, expectedDrawableIds.length);
  const expectedIds = JSON.stringify([...expectedDrawableIds].sort());
  const checks = [], add = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  add("sequence completed without page/runtime errors", proof.done && proof.errors.length === 0);
  add("four actual instances were observed", JSON.stringify(proof.instances.map(i => i.id)) === JSON.stringify(["160", "220", "280", "zoom"]));
  for (const instance of proof.instances) {
    const frames = proof.frames.filter(frame => frame.instance === instance.id);
    add(`${instance.id}: actual production frames exist`, frames.length > 0);
    add(`${instance.id}: production Idle-only loop and approved global fades`, names.every(([, id]) => { const p = instance.playbackPolicy?.[id]; return p && p.loop === (id === "idle") && p.fadeIn === (id === "drag_hold" ? 0 : .12) && p.fadeOut === (id === "drag_hold" ? 0 : .12); }));
    add(`${instance.id}: load -> motion -> save -> physics on every completed frame`, frames.length > 0 && frames.every(frame => JSON.stringify(frame.order) === JSON.stringify(["load", "motion", "save", "physics"])));
    add(`${instance.id}: finite actual parameters remain within approved bounds`, frames.length > 0 && frames.every(frame => Object.entries(bounds).every(([id, bound]) => Number.isFinite(frame.parameters[id]) && frame.parameters[id] >= bound.minimum - 1e-6 && frame.parameters[id] <= bound.maximum + 1e-6)));
    add(`${instance.id}: finite actual geometry/opacity/render order`, frames.length > 0 && frames.every(frame => JSON.stringify(frame.drawables.map(d => d.id).sort()) === expectedIds && frame.drawables.every(d => d.finiteVertices && d.vertexCount > 0 && Number.isFinite(d.opacity) && Number.isFinite(d.renderOrder) && d.canvasBounds.every(Number.isFinite))));
    add(`${instance.id}: real frame time positive and production dt capped`, frames.length > 0 && frames.every(frame => frame.dt > 0 && frame.dt <= .10000001) && frames.slice(1).every((frame, i) => frame.drawCompletedMs > frames[i].drawCompletedMs));
    for (const phase of ["idle-loop", "hover-complete", "drag-hold-complete", "put-down-complete", "interrupt-hover-with-drag", "interrupt-put-down-with-hover", "final-idle"]) add(`${instance.id}: ${phase} has actual rendered evidence`, frames.some(frame => frame.phase === phase));
    for (const id of proof.physicsIds) {
      const values = frames.map(frame => frame.parameters[id]), minimum = Math.min(...values), maximum = Math.max(...values);
      checks.push({ name: `${instance.id}/${id}: actual output varied`, passed: values.length > 1 && values.every(Number.isFinite) && maximum - minimum > 1e-6, minimum: Number.isFinite(minimum) ? minimum : null, maximum: Number.isFinite(maximum) ? maximum : null, peakToPeak: values.length ? maximum - minimum : null });
    }
  }
  add("both actual DragHold pauses preserved end pose without rendering/reset", proof.holds.length === 2 && proof.holds.every(hold => hold.instances.length === 4 && hold.instances.every(i => i.parametersUnchanged && i.geometryUnchanged && i.noNewRenderedFrame && i.stopped && Math.abs(i.pickup - 1) < 1e-6)));
  for (const reason of ["hover-complete", "put-down-complete"]) add(`${reason}: naturally returns all instances to Idle`, proof.instances.length === 4 && proof.instances.every(instance => proof.events.some(e => e.type === "promise-resolved" && e.reason === reason && e.instance === instance.id && e.state.current === "idle")));
  for (const reason of ["interrupt-hover-with-drag", "interrupt-put-down-with-hover"]) {
    const event = proof.events.find(e => e.type === "command" && e.reason === reason), expected = reason === "interrupt-hover-with-drag" ? "hover_greet" : "put_down";
    add(`${reason}: previous action was still active in all instances`, event && event.before.length === 4 && event.before.every(before => before.current === expected && !before.finished));
  }
  return checks;
}

/** Bounded high-port allocation avoids Chromium-blocked ephemeral ports on Windows. */
export async function listenOnDiagnosticPort(server, first = 48270, last = 48279) {
  for (let port = first; port <= last; port++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off("listening", onListening); reject(error); };
        const onListening = () => { server.off("error", onError); resolve(); };
        server.once("error", onError); server.once("listening", onListening); server.listen(port, "127.0.0.1");
      });
      return port;
    } catch (error) { if (error.code !== "EADDRINUSE") throw error; }
  }
  throw new Error(`No free diagnostic port in ${first}..${last}`);
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { model: { type: "string" }, "model-origin": { type: "string" }, motions: { type: "string" }, "motion-origin": { type: "string" }, physics: { type: "string" }, "physics-origin": { type: "string" }, runtime: { type: "string", default: "output/forest-spirit-runtime/front-v8-fullbody-diagnostic-r3" }, out: { type: "string" }, "drawable-map": { type: "string" }, "raw-frame-evidence": { type: "boolean" }, help: { type: "boolean" }, "check-inputs-only": { type: "boolean" } } });
  if (values.help) { console.log("node scripts/manual/forest-spirit/capture-fullbody-playback.mjs --model <actual model3> --model-origin editor-export --motions <four actual *_STAGE.motion3.json directory> --motion-origin editor-export --physics <physics3> --physics-origin editor-export|program-draft --out <NEW output directory> [--runtime <existing official bundle>] [--drawable-map <explicit 72-source/73-drawable JSON>] [--raw-frame-evidence] [--check-inputs-only]\nRuns the unmodified production renderer at 160/220/280 CSS heights plus a large real-render zoom. Optional raw evidence saves every completed 280px draw and large shoulder/arm crop with exact frame timing. Does not create a model, change approval gates, or certify visual quality."); return; }
  assert.ok(values.model && values.motions && values.physics && values.out, "Explicit actual model/motions/physics and a new output directory are required");
  assert.equal(values["model-origin"], "editor-export"); assert.equal(values["motion-origin"], "editor-export"); assert.ok(["editor-export", "program-draft"].includes(values["physics-origin"]));
  const out = path.resolve(repo, values.out), outputRoot = await realpath(path.join(repo, "output"));
  assert.ok(out.startsWith(path.join(repo, "output") + path.sep));
  await mkdir(path.dirname(out), { recursive: true }); assert.ok((await realpath(path.dirname(out))).startsWith(outputRoot + path.sep));
  await mkdir(out, { recursive: false }); // Never overwrite a prior run's success or failure.
  const inputs = new Map(), resources = new Map(), routes = new Map();
  async function read(file) { const actual = await realpath(path.resolve(repo, file)), bytes = await readFile(actual), digest = hash(bytes), previous = inputs.get(actual); if (previous) assert.equal(previous.sha256, digest, "A frozen input changed during this run"); else inputs.set(actual, { path: actual, bytes: bytes.length, sha256: digest }); return { actual, bytes }; }
  const report = { designation: "REAL_PRODUCTION_RENDERER_DIAGNOSTIC", productionApproval: false, visualAcceptance: false, sourceDeclaration: { model: values["model-origin"], motions: values["motion-origin"], physics: values["physics-origin"] }, sourceDeclarationVerifiedBy: "Explicit caller provenance plus recorded raw input hashes; this tool cannot certify an Editor session", routingDescriptor: "Local diagnostic resource composition, NOT an Editor-exported model3; all original input files remain unchanged", renderer: "Existing official SDK 5-r.5 production factory, real RAF/motion manager/physics, SwiftShader software WebGL; no performance claim", cssHeights: [160, 220, 280], dpr: 1, productionFit: .96, comparisonScope: "Production-size and enlarged visual review only; not the fixed fit=1 neutral quality scoring tool", status: "preparing", checks: [], cleanupErrors: [], errors: [], artifacts: [] };
  let server, browser, context, page, video;
  const recordArtifact = async (name, bytes) => { const file = path.join(out, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes, { flag: "wx" }); report.artifacts.push({ path: file, bytes: bytes.length, sha256: hash(bytes) }); };
  try {
    const modelSource = await read(values.model), model = JSON.parse(modelSource.bytes), motionDirectory = await realpath(path.resolve(repo, values.motions)), runtime = await realpath(path.resolve(repo, values.runtime));
    const motionManifest = JSON.parse((await read(`${stage}/revisions/motion-meta-v2/motion-drafts/motion-drafts.manifest.json`)).bytes);
    const physicsSource = await read(values.physics), physics = JSON.parse(physicsSource.bytes), physicsIds = inspectPhysics(physics);
    assert.equal(physics.Meta.Fps, 60); assert.deepEqual([...physicsIds].sort(), [...motionManifest.excludedPhysicsOutputParameters].sort()); assert.equal(new Set(physicsIds).size, 6);
    const specification = JSON.parse((await read("doc/design/forest-spirit/production/front-v8/layers.json")).bytes), quality = JSON.parse((await read("doc/design/forest-spirit/production/front-v8/quality-spec.json")).bytes);
    const mappingSource = values["drawable-map"] ? await read(values["drawable-map"]) : null;
    const drawableContract = resolveDrawableContract(specification, mappingSource ? JSON.parse(mappingSource.bytes) : null);
    const drawableIds = drawableContract.drawableIds;
    report.drawableContract = { ...drawableContract, mappingFile: mappingSource ? { path: mappingSource.actual, sha256: hash(mappingSource.bytes) } : null };
    await read(fileURLToPath(new URL("./drawable-source-contract.mjs", import.meta.url)));
    const csv = await read(`${stage}/validation/production-parameters.csv`); assert.equal(hash(csv.bytes), "37bfcd1277085dabb51b7f27fe88024d96971e5f015d012506e4f1c6fe79a8f3");
    const parameterBounds = Object.fromEntries(csv.bytes.toString("utf8").replace(/^\uFEFF/u, "").trim().split(/\r?\n/u).slice(1).map(line => { const columns = line.split(","); assert.equal(columns[1], "PARAMETER"); return [columns[2], { minimum: Number(columns[5]), default: Number(columns[6]), maximum: Number(columns[7]) }]; }));
    assert.equal(Object.keys(parameterBounds).length, 17);
    const register = (url, source) => { routes.set(url, source.actual); return url; };
    const originalUrl = register("/source/original.model3.json", modelSource), motionUrls = {};
    // Resolve the original relative references using the actual model directory,
    // then expose only these exact files, not a broad repository file server.
    const sourceReferences = inspectNeutralModelPackage(model, new URL(originalUrl, originForValidation).href);
    const modelCopy = structuredClone(model); modelCopy.FileReferences.Moc = register("/source/model.moc3", await read(path.resolve(path.dirname(modelSource.actual), model.FileReferences.Moc)));
    modelCopy.FileReferences.Textures = await Promise.all(model.FileReferences.Textures.map(async (file, index) => register(`/source/texture-${index}.png`, await read(path.resolve(path.dirname(modelSource.actual), file)))));
    assert.equal(sourceReferences.textures.length, modelCopy.FileReferences.Textures.length);
    for (const [label, id] of names) {
      const source = await read(path.join(motionDirectory, `${label}_STAGE.motion3.json`)), motion = JSON.parse(source.bytes), parameters = inspectMotion(motion, id);
      assert.equal(motion.Meta.Fps, 60); assert.equal(parameters.length, 11); assert.deepEqual([...parameters].sort(), [...motionManifest.motionOwnedParameters].sort()); assert.ok(parameters.every(key => !physicsIds.includes(key)));
      motionUrls[id] = register(`/motion/${label}_STAGE.motion3.json`, source);
    }
    const routing = routePlaybackPackage(modelCopy, originalUrl, register("/physics/selected.physics3.json", physicsSource), motionUrls);
    await recordArtifact("diagnostic-routing.model3.json", Buffer.from(JSON.stringify(routing, null, 2) + "\n"));
    const config = { asset: { model3Url: "/routing.model3.json", motions: motionUrls }, parameterBounds, drawableIds, physicsIds, backgrounds: quality.backgrounds, zoomRegions: quality.regions.filter(region => ["face", "scarf", "pouch_tools"].includes(region.id)), rawFrameEvidence: values["raw-frame-evidence"] === true };
    await recordArtifact("capture-config.json", Buffer.from(JSON.stringify(config, null, 2) + "\n"));
    for (const name of ["forest-spirit-runtime.js", "live2dcubismcore.min.js", "build-manifest.json"]) register(`/runtime/${name}`, await read(path.join(runtime, name)));
    const bundleManifest = JSON.parse((await read(path.join(runtime, "build-manifest.json"))).bytes);
    assert.equal(bundleManifest.sdkVersion, "5-r.5"); assert.match(bundleManifest.sdkInfo, /a49bc546222194ac28326d20a46aa35ee4d1ce8e/u);
    for (const name of ["forest-spirit-runtime.js", "live2dcubismcore.min.js"]) assert.equal(hash((await read(path.join(runtime, name))).bytes), bundleManifest.files.find(file => file.path === name)?.sha256, `Runtime bundle hash differs from its build manifest: ${name}`);
    const sourceScript = await read(fileURLToPath(import.meta.url)), pageScript = await read(path.join(path.dirname(sourceScript.actual), "fullbody-playback-page.mjs")); register("/tool/page.mjs", pageScript);
    if (values["check-inputs-only"]) { report.status = "inputs_verified_recording_not_run"; report.recordingPerformed = false; return; }
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Actual fullbody motion + physics diagnostic</title><style>body{margin:12px;background:#f5f2e9;color:#1a3525;font:14px sans-serif}h1{font-size:20px}h2{font-size:15px}#sizes{display:flex;gap:20px}#sizes canvas{display:block;margin-bottom:7px}#layout{display:flex;gap:30px}.source{position:absolute;left:-3000px}#zoom{display:flex;gap:10px}#zoom canvas{display:block;max-width:596px;height:auto}</style><h1>Actual production renderer · fullbody candidate · visual acceptance pending</h1><p>Physics source: ${values["physics-origin"]}. Real Core frames only. Software WebGL, no performance claim. 0.96 production fit.</p><p id="status">Loading actual local resources</p><div id="layout"><div id="sizes"></div><div id="zoom"></div></div><script src="/runtime/live2dcubismcore.min.js"></script><script type="module">import {createCubismRenderer} from '/runtime/forest-spirit-runtime.js';import {preparePlaybackPage} from '/tool/page.mjs';await preparePlaybackPage(await (await fetch('/config.json')).json(),createCubismRenderer);</script></html>`;
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, originForValidation); let bytes, type;
        if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
        if (url.pathname === "/") { bytes = Buffer.from(html); type = "text/html;charset=utf-8"; }
        else if (url.pathname === "/routing.model3.json") { bytes = Buffer.from(JSON.stringify(routing)); type = "application/json"; }
        else if (url.pathname === "/config.json") { bytes = Buffer.from(JSON.stringify(config)); type = "application/json"; }
        else {
          let file = routes.get(decodeURIComponent(url.pathname));
          if (!file && url.pathname.startsWith("/runtime/shaders/")) { file = await realpath(path.resolve(runtime, decodeURIComponent(url.pathname.slice("/runtime/".length)))); assert.ok(file.startsWith(path.join(runtime, "shaders") + path.sep)); }
          assert.ok(file, "Not an explicitly permitted diagnostic resource"); const source = await read(file); bytes = source.bytes;
          const previous = resources.get(file); if (previous) assert.equal(previous.sha256, hash(bytes), "Resource changed while recording"); resources.set(file, { path: file, bytes: bytes.length, sha256: hash(bytes) });
          type = ({ ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png" })[path.extname(file)] ?? "text/plain";
        }
        response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(bytes);
      } catch (error) { report.errors.push(`Resource request ${request.url}: ${String(error)}`); response.writeHead(404); response.end("Missing local diagnostic resource"); }
    });
    await listenOnDiagnosticPort(server); const origin = `http://127.0.0.1:${server.address().port}`;
    const require = createRequire(import.meta.url), { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
    browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    context = await browser.newContext({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 1, reducedMotion: "no-preference", recordVideo: { dir: path.join(out, "browser-recording"), size: { width: 1500, height: 1200 } } });
    page = await context.newPage(); video = page.video(); page.on("pageerror", error => report.errors.push(error.message));
    await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
    await page.goto(origin); await page.waitForFunction(() => window.fullbodyPlayback?.ready || window.fullbodyPlayback?.errors.length, undefined, { timeout: 90000 });
    const loaded = await page.evaluate(() => ({ ready: window.fullbodyPlayback.ready, errors: window.fullbodyPlayback.errors })); assert.ok(loaded.ready && !loaded.errors.length, JSON.stringify(loaded));
    await page.evaluate(() => window.fullbodyPlayback.start());
    const result = await page.evaluate(() => { const p = window.fullbodyPlayback; return { ready: p.ready, done: p.done, errors: p.errors, frames: p.frames, events: p.events, snapshots: p.snapshots, holds: p.holds, instances: p.instances, physicsIds: p.physicsIds, wallDurationMs: p.wallDurationMs }; });
    if (config.rawFrameEvidence) {
      const count = await page.evaluate(() => window.fullbodyPlayback.rawFrames.length), frames = [];
      for (let first = 0; first < count; first += 20) {
        const chunk = await page.evaluate(start => window.fullbodyPlayback.rawFrames.slice(start, start + 20), first);
        for (const raw of chunk) {
          const { pngDataUrl, ...metadata } = raw, bytes = Buffer.from(pngDataUrl.split(",")[1], "base64");
          const name = `raw-frames/${raw.instance}/frame-${String(raw.frameCounter).padStart(5, "0")}.png`;
          await recordArtifact(name, bytes); frames.push({ ...metadata, path: name, sha256: hash(bytes), bytes: bytes.length });
        }
      }
      const expected = result.frames.filter(frame => frame.instance === "280" || frame.instance === "zoom");
      assert.equal(frames.length, expected.length, "Every selected completed draw needs a PNG");
      for (let i = 0; i < frames.length; i++) {
        const raw = frames[i], frame = expected[i];
        assert.ok(raw.instance === frame.instance && raw.frameCounter === frame.frameCounter && raw.wallElapsedMs === frame.wallElapsedMs && raw.drawCompletedMs === frame.drawCompletedMs, "Raw PNG must match the exact completed draw");
      }
      await recordArtifact("raw-frame-manifest.json", Buffer.from(JSON.stringify({ scope: "Every completed 280px production draw and fixed [120,560,425,975] crop of every completed large draw; synchronous original canvas PNGs. No parameter driving, interpolation or dropped frames. Observer overhead means no performance claim.", timing: "Actual completed-draw wall clock; preserve gaps (including DragHold) when encoding. First PNG is first completed motion draw, not wall zero.", wallDurationMs: result.wallDurationMs, allSelectedCompletedFramesCaptured: true, frames }, null, 2) + "\n"));
      report.rawFrameEvidence = { frames: frames.length, allSelectedCompletedFramesCaptured: true, manifest: "raw-frame-manifest.json" };
    }
    for (const snapshot of result.snapshots) await recordArtifact(`frames/${snapshot.name}-${snapshot.instance}-${snapshot.kind}.png`, Buffer.from(snapshot.pngDataUrl.split(",")[1], "base64"));
    await recordArtifact("checkpoint-frame-associations.json", Buffer.from(JSON.stringify(result.snapshots.map(({ pngDataUrl, ...snapshot }) => ({ ...snapshot, pngSha256: hash(Buffer.from(pngDataUrl.split(",")[1], "base64")) })), null, 2) + "\n"));
    delete result.snapshots;
    await recordArtifact("actual-completed-frame-trace.json", Buffer.from(JSON.stringify(result, null, 2) + "\n"));
    await recordArtifact("final-page.png", await page.screenshot({ fullPage: true }));
    report.checks = auditPlaybackTrace(result, parameterBounds, drawableIds); report.checks.push({ name: "no browser or local resource errors", passed: report.errors.length === 0 });
    report.actual = { wallDurationMs: result.wallDurationMs, frameStatistics: result.instances.map(instance => { const frames = result.frames.filter(f => f.instance === instance.id), intervals = frames.slice(1).map((f, i) => f.drawCompletedMs - frames[i].drawCompletedMs); return { id: instance.id, frameCount: frames.length, activeDtSumSeconds: frames.reduce((sum, f) => sum + f.dt, 0), totalWindowFpsIncludingIntentionalHold: frames.length * 1000 / result.wallDurationMs, minimumDrawIntervalMs: Math.min(...intervals), maximumDrawIntervalMs: Math.max(...intervals), warning: "Includes deliberate no-RAF DragHold pauses and software rendering; not a frame-rate acceptance score" }; }) };
    report.passed = report.checks.every(check => check.passed); report.status = report.passed ? "actual_playback_recorded_visual_review_pending" : "actual_playback_checks_failed"; if (!report.passed) process.exitCode = 2;
  } catch (error) {
    report.passed = false; report.status = "failed"; report.error = String(error); process.exitCode = 1;
    if (page) try {
      const partial = await page.evaluate(() => { const p = window.fullbodyPlayback; return p ? { ready: p.ready, done: p.done, errors: p.errors, frames: p.frames, events: p.events, holds: p.holds, instances: p.instances } : null; });
      await recordArtifact("failed-partial-frame-trace.json", Buffer.from(JSON.stringify(partial, null, 2) + "\n"));
      await recordArtifact("failed-page.png", await page.screenshot({ fullPage: true }));
    } catch (partialError) { report.partialEvidenceError = String(partialError); }
  }
  finally {
    try { const errors = await page?.evaluate(() => { const p = window.fullbodyPlayback; p?.dispose(); return p?.errors.filter(e => e.cleanup) ?? []; }); if (errors?.length) report.cleanupErrors.push(...errors.map(error => JSON.stringify(error))); } catch (error) { report.cleanupErrors.push(`dispose: ${String(error)}`); }
    try { await context?.close(); } catch (error) { report.cleanupErrors.push(`context: ${String(error)}`); }
    if (video) try { const target = path.join(out, "actual-browser-recording.webm"); await video.saveAs(target); const bytes = await readFile(target); report.artifacts.push({ path: target, bytes: bytes.length, sha256: hash(bytes) }); } catch (error) { report.cleanupErrors.push(`recording: ${String(error)}`); }
    try { await browser?.close(); } catch (error) { report.cleanupErrors.push(`browser: ${String(error)}`); }
    if (server) try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } catch (error) { report.cleanupErrors.push(`server: ${String(error)}`); }
    report.inputs = [...inputs.values()]; report.resources = [...resources.values()];
    const integrity = await Promise.allSettled(report.inputs.map(async input => hash(await readFile(input.path)) === input.sha256)); report.inputsUnchanged = integrity.every(result => result.status === "fulfilled" && result.value);
    if (!report.inputsUnchanged || report.cleanupErrors.length) { report.passed = false; report.status = !report.inputsUnchanged ? "input-integrity-failed" : "cleanup-failed"; process.exitCode = 2; }
    await writeFile(path.join(out, "playback-report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, passed: report.passed ?? null, out, error: report.error ?? null, failedChecks: report.checks.filter(check => !check.passed).map(check => check.name), productionApproval: false, visualAcceptance: false }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
