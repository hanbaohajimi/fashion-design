/* global window, document, requestAnimationFrame */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { model: { type: "string" }, motions: { type: "string" }, drafts: { type: "string" }, out: { type: "string" }, runtime: { type: "string", default: "output/forest-spirit-runtime/front-v8-motion-replay-r2" }, scope: { type: "string", default: "internal-stage" }, video: { type: "boolean", default: false } } });
assert.ok(values.model && values.motions && values.drafts && values.out, "Pass --model --motions --drafts --out");
assert.ok(["internal-stage", "fullbody-candidate"].includes(values.scope));
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(repo, values.out);
assert.ok(output.startsWith(path.join(repo, "output") + path.sep));
await mkdir(output, { recursive: true });
assert.ok((await realpath(output)).startsWith((await realpath(path.join(repo, "output"))) + path.sep));
const modelPath = await realpath(path.resolve(repo, values.model));
const motionDir = await realpath(path.resolve(repo, values.motions));
const drafts = await realpath(path.resolve(repo, values.drafts));
const runtime = await realpath(path.resolve(repo, values.runtime));
const sha = data => createHash("sha256").update(data).digest("hex");
const manifestPath = path.join(drafts, "motion-drafts.manifest.json"), manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const names = [["Idle", "idle"], ["Hover", "hover_greet"], ["DragHold", "drag_hold"], ["PutDown", "put_down"]];
const report = { scope: `${values.scope}: actual official Core/SDK motion sampling; no production or final animation acceptance`, productionApproval: false, visualAcceptance: false, checks: [], motions: [], snapshots: [], sessions: [], resources: [], pageErrors: [], createdAt: new Date().toISOString(), loopPolicyEvidence: ["https://docs.live2d.com/en/cubism-sdk-manual/motion/#1-b-set-a-playback-method-for-each-motion-file", "https://docs.live2d.com/en/cubism-sdk-manual/sdk-type-for-motion/"], loopPolicy: "Preserve actual Editor JSON unchanged; use official setLoop(true) only for idle and setLoop(false) for the three one-shot actions. Animator cannot reflect its scene loop settings in motion3 reliably." };
const check = (name, passed, detail) => report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
const inputHashes = new Map();
inputHashes.set(manifestPath, sha(manifestBytes));
inputHashes.set(fileURLToPath(import.meta.url), sha(await readFile(fileURLToPath(import.meta.url))));
const inputs = [];
function parseCurve(curve) {
  const list = curve.Segments, anchors = [{ time: list[0], value: list[1] }], points = [{ time: list[0], value: list[1] }], types = [];
  for (let at = 2; at < list.length; at += 7) {
    assert.equal(list[at], 1, "This verified four-scene input uses cubic Bezier segments only");
    types.push(list[at]);
    for (let i = 1; i <= 5; i += 2) points.push({ time: list[at + i], value: list[at + i + 1] });
    anchors.push({ time: list[at + 5], value: list[at + 6] });
  }
  return { anchors, points, types };
}
for (const [label, name] of names) {
  const filename = path.join(motionDir, `${label}_STAGE.motion3.json`), bytes = await readFile(filename), text = bytes.toString("utf8"), actual = JSON.parse(text);
  const draftPath = path.join(drafts, `${label}.motion3.json`), draftBytes = await readFile(draftPath), draft = JSON.parse(draftBytes);
  inputHashes.set(filename, sha(bytes)); inputHashes.set(draftPath, sha(draftBytes));
  assert.equal(actual.Version, 3);
  const curveComparison = draft.Curves.map(curve => {
    const candidate = actual.Curves.find(item => item.Target === curve.Target && item.Id === curve.Id);
    assert.ok(candidate, `${label}: missing ${curve.Id}`);
    const a = parseCurve(curve), b = parseCurve(candidate);
    const timeError = a.points.length === b.points.length ? Math.max(0, ...a.points.map((p, i) => Math.abs(p.time - b.points[i].time))) : Infinity;
    const valueError = a.points.length === b.points.length ? Math.max(0, ...a.points.map((p, i) => Math.abs(p.value - b.points[i].value))) : Infinity;
    return { id: curve.Id, first: b.anchors[0], last: b.anchors.at(-1), maximumTimeQuantizationSeconds: timeError, maximumValueDifference: valueError, passed: timeError <= 0.000500001 && valueError <= 1e-9 && JSON.stringify(a.types) === JSON.stringify(b.types) && candidate.FadeInTime === curve.FadeInTime && candidate.FadeOutTime === curve.FadeOutTime };
  });
  const metaMatches = Object.keys(draft.Meta).filter(key => key !== "Loop").every(key => draft.Meta[key] === actual.Meta[key]);
  check(`${label}: metadata except documented Editor loop limitation`, metaMatches);
  check(`${label}: 11 parameter curves and six physics exclusions`, actual.Curves.length === 11 && actual.Curves.every(c => c.Target === "Parameter" && manifest.motionOwnedParameters.includes(c.Id)) && new Set(actual.Curves.map(c => c.Id)).size === 11 && actual.Curves.every(c => !manifest.excludedPhysicsOutputParameters.includes(c.Id)));
  check(`${label}: all anchors controls and per-curve fades retained within native time precision`, curveComparison.every(c => c.passed));
  report.motions.push({ label, name, file: filename, sha256: sha(bytes), draftSha256: sha(draftBytes), meta: actual.Meta, rawLoopMetadataMatchesPlan: actual.Meta.Loop === draft.Meta.Loop, intendedRuntimeLoop: name === "idle", curveComparison });
  inputs.push({ label, name, text, actual, draft });
}

const toUrl = file => "/data/" + path.relative(repo, file).split(path.sep).map(encodeURIComponent).join("/");
const runtimeUrl = toUrl(path.join(runtime, "forest-spirit-runtime.js")), coreUrl = toUrl(path.join(runtime, "live2dcubismcore.min.js"));
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#e0ead8;color:#1a3525;font:16px sans-serif}header{padding:16px}canvas{width:420px;height:auto;margin:0 24px}small{display:block}</style><header>Actual SDK motion diagnostic<small>${values.scope}; no full animation acceptance</small><div id="label">Loading actual MOC3</div></header><canvas id="model" width="971" height="1620"></canvas><script src="${coreUrl}"></script><script type="module">import {createNeutralDiagnosticRenderer} from ${JSON.stringify(runtimeUrl)};window.motionProof={errors:[]};try{const renderer=createNeutralDiagnosticRenderer(document.querySelector('canvas'));window.motionProof.renderer=renderer;await renderer.load({model3Url:location.origin+${JSON.stringify(toUrl(modelPath))}},new AbortController().signal);window.motionProof.ready=true;}catch(e){window.motionProof.errors.push(String(e));}</script>`;
const resources = new Map();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end(html); return; }
    assert.ok(url.pathname.startsWith("/data/"));
    const file = await realpath(path.resolve(repo, decodeURIComponent(url.pathname.slice(6))));
    assert.ok(file.startsWith(path.join(repo, "output") + path.sep));
    const bytes = await readFile(file), hash = sha(bytes);
    if (resources.has(file)) assert.equal(resources.get(file).sha256, hash, "A served diagnostic input changed during capture");
    else resources.set(file, { path: file, bytes: bytes.length, sha256: hash });
    response.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".json": "application/json", ".png": "image/png" })[path.extname(file)] ?? "text/plain", "Cache-Control": "no-store" }); response.end(bytes);
  } catch { response.writeHead(404); response.end("Missing local motion diagnostic resource"); }
});
let browser, context, video;
async function saveSnapshot(state, label) {
  const { pngDataUrl, ...metadata } = state, bytes = Buffer.from(pngDataUrl.replace(/^data:image\/png;base64,/u, ""), "base64");
  const file = path.join(output, `${label}.png`); await writeFile(file, bytes);
  const evidence = { file, sha256: sha(bytes), ...metadata };
  await writeFile(path.join(output, `${label}.json`), JSON.stringify(evidence, null, 2) + "\n");
  report.snapshots.push({ file, sha256: sha(bytes) });
}
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const require = createRequire(import.meta.url), { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  context = await browser.newContext({ viewport: { width: 600, height: 860 }, deviceScaleFactor: 1, ...(values.video ? { recordVideo: { dir: path.join(output, "recordings"), size: { width: 600, height: 860 } } } : {}) });
  const page = await context.newPage(); video = page.video();
  page.on("pageerror", error => report.pageErrors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  await page.goto(origin); await page.waitForFunction(() => window.motionProof?.ready || window.motionProof?.errors.length, undefined, { timeout: 45000 });
  const loaded = await page.evaluate(() => ({ ready: window.motionProof.ready, errors: window.motionProof.errors })); assert.ok(loaded.ready && !loaded.errors.length, JSON.stringify(loaded));
  const neutral = await page.evaluate(() => window.motionProof.renderer.captureNeutral());
  await saveSnapshot(neutral, "neutral-before");
  check("seventeen actual exported parameters", JSON.stringify(Object.keys(neutral.parameters).sort()) === JSON.stringify([...manifest.motionOwnedParameters, ...manifest.excludedPhysicsOutputParameters].sort()));
  report.actualDrawableIds = neutral.drawables.map(d => d.id);
  report.containsTemporaryDrawables = report.actualDrawableIds.some(id => id.startsWith("__TEMP_"));
  if (values.scope === "fullbody-candidate") assert.ok(!report.containsTemporaryDrawables, "A fullbody candidate cannot contain temporary composite drawables");
  for (const mode of ["raw_curve", "application_policy"]) for (const input of inputs) {
    const initial = Object.fromEntries(input.actual.Curves.map(c => [c.Id, c.Segments[1]]));
    const configuration = await page.evaluate(({ text, name, mode, initial }) => window.motionProof.renderer.startDiagnosticMotion(text, name, mode, initial), { text: input.text, name: input.name, mode, initial });
    const duration = input.actual.Meta.Duration;
    const times = new Set(Array.from({ length: Math.round(duration * 60) + 1 }, (_, frame) => frame / 60));
    for (const c of input.actual.Curves) for (const anchor of parseCurve(c).anchors) times.add(anchor.time);
    times.add(duration + 0.25); times.add(duration + 0.75);
    const states = [];
    for (const time of [...times].sort((a, b) => a - b)) {
      const state = await page.evaluate(time => {
        const r = window.motionProof.renderer.sampleDiagnosticMotion(time, false);
        return { parameters: r.parameters, motion: r.motionSample, finiteVertices: r.drawables.every(d => d.vertexPositions.every(Number.isFinite)), maximumDisplacements: Object.fromEntries(r.drawables.map(d => [d.id, d.maximumVertexDisplacementPixels])), opacity: Object.fromEntries(r.drawables.map(d => [d.id, d.opacity])) };
      }, time);
      states.push({ time, ...state });
    }
    const keyChecks = mode === "raw_curve" ? input.actual.Curves.flatMap(curve => parseCurve(curve).anchors.map(anchor => ({ id: curve.Id, time: anchor.time, expected: anchor.value, actual: states.find(state => state.time === anchor.time).parameters[curve.Id] }))) : [];
    check(`${mode}/${input.label}: actual Core finite and physics parameters unchanged`, states.every(s => s.finiteVertices && Object.values(s.parameters).every(Number.isFinite) && manifest.excludedPhysicsOutputParameters.every(id => s.parameters[id] === neutral.parameters[id])));
    if (mode === "raw_curve") check(`${input.label}: official SDK evaluates every exported key value`, keyChecks.every(c => Math.abs(c.expected - c.actual) < 1e-5), { count: keyChecks.length, maximumError: Math.max(...keyChecks.map(c => Math.abs(c.expected - c.actual))) });
    if (mode === "application_policy") {
      check(`${input.label}: shared production motion manager loop policy and completion`, configuration.actualProductionMotionManager === true && configuration.configuredLoop === (input.name === "idle") && states.at(-1).motion.finished === (input.name !== "idle"));
      if (input.name === "drag_hold") check("DragHold: actual SDK end pose remains held after completion", states.filter(s => s.time >= duration).every(s => Math.abs(s.parameters.ParamFSPickup - 1) < 1e-6 && Math.abs(s.parameters.ParamAngleZ + 1.5) < 1e-6));
    }
    const final = await page.evaluate(time => window.motionProof.renderer.sampleDiagnosticMotion(time, true), duration + 0.75);
    await saveSnapshot(final, `${mode}-${input.label}-post-end`);
    report.sessions.push({ mode, name: input.name, configuration, samples: states.length, keyChecks, states });
  }
  report.transition = await page.evaluate(inputs => {
    const renderer = window.motionProof.renderer, trace = [], jumps = [];
    let seed = renderer.captureNeutral().parameters;
    for (const name of ["drag_hold", "put_down", "idle"]) {
      const input = inputs.find(item => item.name === name);
      const before = seed;
      renderer.startDiagnosticMotion(input.text, name, "application_policy", seed);
      const length = name === "idle" ? 0.3 : input.actual.Meta.Duration;
      const times = [...new Set([...Array.from({ length: Math.round(length * 60) + 1 }, (_, frame) => frame / 60), length, length + (name === "drag_hold" ? 0.75 : 0)])].sort((a, b) => a - b);
      for (const time of times) {
        const state = renderer.sampleDiagnosticMotion(time, false);
        seed = state.parameters;
        if (time === 0) jumps.push({ name, maximumParameterJump: Math.max(...Object.keys(seed).map(id => Math.abs(seed[id] - before[id]))), before, after: seed });
        trace.push({ name, time, parameters: seed, motion: state.motionSample });
      }
    }
    return { scope: "Actual production motion-manager stepping; source-state seeding reproduces prior authored frame. Physics and production RAF scheduling remain excluded.", trace, jumps };
  }, inputs);
  check("DragHold -> PutDown -> Idle: parameter continuity at transition starts", report.transition.jumps.every(jump => jump.maximumParameterJump <= 1e-6), report.transition.jumps.map(({ name, maximumParameterJump }) => ({ name, maximumParameterJump })));
  check("PutDown -> Idle: pickup returns to zero", Math.abs(report.transition.trace.at(-1).parameters.ParamFSPickup) < 1e-6);
  if (values.video) {
    report.replay = await page.evaluate(async inputs => {
      const renderer = window.motionProof.renderer, trace = [];
      let seed = renderer.captureNeutral().parameters;
      for (const input of inputs) {
        renderer.startDiagnosticMotion(input.text, input.name, "application_policy", seed);
        document.querySelector("#label").textContent = input.label;
        const length = input.actual.Meta.Duration + (input.name === "drag_hold" ? 0.8 : 0.12);
        await new Promise(resolve => {
          let start, previous = -1;
          function frame(now) {
            start ??= now;
            const elapsed = Math.min(length, (now - start) / 1000);
            if (elapsed === length || previous < 0 || elapsed - previous >= 1 / 30) {
              const state = renderer.sampleDiagnosticMotion(elapsed, false); seed = state.parameters; previous = elapsed;
              trace.push({ name: input.name, elapsed, timestamp: now, parameters: state.parameters, motion: state.motionSample });
            }
            if (elapsed >= length) resolve(); else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
      }
      return { actualRequestAnimationFrame: true, maximumRequestedFps: 30, softwareWebGLNotPerformanceEvidence: true, trace };
    }, inputs);
  }
  const restored = await page.evaluate(() => window.motionProof.renderer.captureNeutral());
  check("neutral restored after all actual SDK sessions", restored.pngDataUrl === neutral.pngDataUrl);
  await saveSnapshot(restored, "neutral-restored");
  const rejected = await page.evaluate(({ text, name }) => {
    const r = window.motionProof.renderer;
    r.startDiagnosticMotion(text, name, "application_policy"); r.sampleDiagnosticMotion(0.2, false);
    return [NaN, -1, 0.1].map(time => { try { r.sampleDiagnosticMotion(time, false); return false; } catch { return true; } });
  }, inputs[0]);
  check("nonfinite negative and backwards diagnostic time rejected", rejected.every(Boolean));
  await page.evaluate(() => window.motionProof.renderer.dispose());
  check("no browser errors", report.pageErrors.length === 0);
  report.passed = report.checks.every(c => c.passed);
  report.status = report.passed ? "actual-sdk-timing-and-policy-verified-visual-acceptance-pending" : "diagnostic-checks-failed";
  if (!report.passed) process.exitCode = 2;
} catch (error) {
  report.passed = false; report.status = "failed"; report.error = String(error); process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  try { await context?.close(); } catch (error) { cleanupErrors.push(`context: ${String(error)}`); }
  if (video) {
    try { const file = path.join(output, "actual-motion-browser-replay.webm"); await video.saveAs(file); report.video = { path: file, sha256: sha(await readFile(file)), limitation: "Includes numerical sampling before the final realtime sequence; software recording is not performance evidence" }; }
    catch (error) { cleanupErrors.push(`video: ${String(error)}`); }
  }
  try { await browser?.close(); } catch (error) { cleanupErrors.push(`browser: ${String(error)}`); }
  try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } catch (error) { cleanupErrors.push(`server: ${String(error)}`); }
  report.cleanupErrors = cleanupErrors;
  if (cleanupErrors.length) { report.passed = false; report.status = "cleanup-failed"; process.exitCode = 2; }
  report.resources = [...resources.values()];
  for (const file of report.resources) inputHashes.set(file.path, file.sha256);
  report.inputHashes = [...inputHashes].map(([file, sha256]) => ({ file, sha256 }));
  const inputChecks = await Promise.allSettled([...inputHashes].map(async ([file, hash]) => sha(await readFile(file)) === hash));
  report.inputsUnchanged = inputChecks.every(result => result.status === "fulfilled" && result.value);
  if (!report.inputsUnchanged) { check("all inputs unchanged throughout capture", false); report.passed = false; report.status = "input-integrity-failed"; process.exitCode = 2; }
  await writeFile(path.join(output, "actual-motion-sdk-replay.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ passed: report.passed, status: report.status, failedChecks: report.checks.filter(c => !c.passed).map(c => c.name), error: report.error ?? null, output, productionApproval: false }));
