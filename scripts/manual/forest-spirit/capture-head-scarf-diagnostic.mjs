/* global window */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import { productionOptions, readProductionContext } from "./production-context.mjs";
import { inspectEyeOpacityInvariant, inspectTriangleDeformation, makeHeadScarfStates } from "./head-scarf-diagnostic-audit.mjs";

const { values } = parseArgs({ options: { ...productionOptions, model: { type: "string" }, runtime: { type: "string", default: "output/forest-spirit-runtime/front-v8-head-diagnostic" }, "capture-id": { type: "string", default: "r11-head-scarf-editor-r1" }, baseline: { type: "string", default: "output/forest-spirit-production-v2/front-v8/validation/r10-blink-editor-r2/neutral-971x1620.png" } } });
assert.ok(values.model?.endsWith(".model3.json"), "Pass the actual Editor-exported --model path");
assert.match(values["capture-id"], /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u);
const { repo, characterId, specification, outputRoot } = await readProductionContext(values);
assert.equal(characterId, "forest-spirit-front-v8"); assert.deepEqual(specification.working_canvas, [971, 1620]);
const modelPath = await realpath(path.resolve(repo, values.model));
const roots = { model: path.dirname(modelPath), runtime: await realpath(path.resolve(repo, values.runtime)) };
const output = path.join(outputRoot, "validation", values["capture-id"]);
await mkdir(output, { recursive: true });
assert.ok((await realpath(output)).startsWith((await realpath(outputRoot)) + path.sep));
try { await access(path.join(output, "head-scarf-diagnostic.json")); throw new Error("Use a new capture-id; previous evidence is immutable"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const modelUrl = `/model/${encodeURIComponent(path.basename(modelPath))}`;
const html = `<!doctype html><html><meta charset="utf-8"><title>Actual r11 head/scarf diagnostic</title><style>html,body{margin:0;padding:0;background:transparent}canvas{display:block;width:971px;height:1620px}</style><canvas id="model" width="971" height="1620"></canvas><script src="/runtime/live2dcubismcore.min.js"></script><script type="module">
import {createNeutralDiagnosticRenderer,sdkVersion} from '/runtime/forest-spirit-runtime.js';
const errors=[],canvas=document.querySelector('#model');canvas.addEventListener('forest-spirit-error',event=>errors.push(String(event.detail)));
window.headProof={ready:false,errors,sdkVersion};
try{const renderer=createNeutralDiagnosticRenderer(canvas);window.headProof.renderer=renderer;await renderer.load({model3Url:${JSON.stringify(modelUrl)}},new AbortController().signal);window.headProof.ready=true;}catch(error){errors.push(String(error));}
</script></html>`;
const resources = new Map();
const mime = { ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".vert": "text/plain", ".frag": "text/plain" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" }); response.end(html); return; }
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean), root = roots[parts.shift()];
    if (!root) throw new Error("Unknown resource root");
    const filename = await realpath(path.resolve(root, ...parts));
    if (!filename.startsWith(root + path.sep)) throw new Error("Resource escaped diagnostic root");
    const bytes = await readFile(filename);
    resources.set(url.pathname, { path: filename, bytes: bytes.length, sha256: sha(bytes) });
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] ?? "application/octet-stream", "Cache-Control": "no-store" }); response.end(bytes);
  } catch { response.writeHead(404); response.end("Missing local diagnostic resource"); }
});
const report = { characterId, scope: "Actual Editor-exported 22-layer internal head stage; direct parameters, not authored motions or 72-part production approval", productionApproval: false, visualAcceptance: false, officialEditorExport: true, status: "not_run", renderer: "Official Cubism SDK 5-r.5 / headless Chromium SwiftShader software WebGL", canvas: { width: 971, height: 1620, devicePixelRatio: 1, fit: 1 }, model: { path: modelPath, sha256: sha(await readFile(modelPath)) }, checks: [], states: [], captures: {}, pageErrors: [], createdAt: new Date().toISOString() };
const record = (name, passed, detail) => report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
async function saveCapture(capture, name) {
  const { pngDataUrl, ...snapshot } = capture;
  const bytes = Buffer.from(pngDataUrl.replace(/^data:image\/png;base64,/u, ""), "base64");
  assert.equal(bytes.readUInt32BE(16), 971); assert.equal(bytes.readUInt32BE(20), 1620); assert.equal(bytes[25], 6);
  const filename = path.join(output, `${name}-971x1620.png`);
  await writeFile(filename, bytes);
  return { ...snapshot, png: { path: filename, bytes: bytes.length, sha256: sha(bytes) } };
}
let browser;
try {
  for (let port = 48300; port < 48340 && !server.listening; port++) {
    try {
      await new Promise((resolve, reject) => {
        const error = value => { server.removeListener("listening", ready); reject(value); };
        const ready = () => { server.removeListener("error", error); resolve(); };
        server.once("error", error); server.once("listening", ready); server.listen(port, "127.0.0.1");
      });
    } catch (error) { if (error.code !== "EADDRINUSE") throw error; }
  }
  assert.ok(server.listening, "No local diagnostic port available");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const require = createRequire(import.meta.url), { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 971, height: 1620 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  page.on("pageerror", error => report.pageErrors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => window.headProof?.ready || window.headProof?.errors.length, undefined, { timeout: 45000 });
  const loaded = await page.evaluate(() => ({ ready: window.headProof.ready, errors: window.headProof.errors }));
  assert.ok(loaded.ready && !loaded.errors.length, JSON.stringify(loaded));
  const neutral = await page.evaluate(() => window.headProof.renderer.captureNeutral());
  report.captures.neutral = await saveCapture(neutral, "neutral");
  const baselineBytes = await readFile(path.resolve(repo, values.baseline));
  record("neutral PNG exactly equals r10 baseline", report.captures.neutral.png.sha256 === sha(baselineBytes), { baseline: path.resolve(repo, values.baseline), sha256: sha(baselineBytes), actual: report.captures.neutral.png.sha256 });
  const manifest = JSON.parse(await readFile(path.join(outputRoot, "motion-drafts/motion-drafts.manifest.json"), "utf8"));
  const expected = [...manifest.motionOwnedParameters, ...manifest.excludedPhysicsOutputParameters].sort();
  record("actual seventeen parameter inventory", expected.length === 17 && JSON.stringify(Object.keys(neutral.parameters).sort()) === JSON.stringify(expected));
  record("internal head stage drawable count", neutral.drawables.length === 19, { editorArtMeshes: 22, enabledExportedDrawables: neutral.drawables.length });
  // Compare each pose against the same eye state at neutral head/scarf, so normal
  // eyelid compression is not mistaken for a head-driven triangle defect.
  const eyeBases = new Map();
  for (const state of makeHeadScarfStates()) {
    const parameters = state.parameters, key = `${parameters.ParamEyeLOpen},${parameters.ParamEyeROpen}`;
    if (!eyeBases.has(key)) eyeBases.set(key, await page.evaluate(({ left, right }) => window.headProof.renderer.captureParameterState({ ParamEyeLOpen: left, ParamEyeROpen: right }, false), { left: parameters.ParamEyeLOpen, right: parameters.ParamEyeROpen }));
    const capture = await page.evaluate(({ parameters, capture }) => window.headProof.renderer.captureParameterState(parameters, capture), state);
    const triangles = inspectTriangleDeformation(eyeBases.get(key), capture);
    const eyeOpacityInvariant = inspectEyeOpacityInvariant(eyeBases.get(key), capture);
    const body = capture.drawables.find(drawable => drawable.id === "__TEMP_Body2");
    const eyes = ["L", "R"].map(side => {
      const value = parameters[`ParamEye${side}Open`], open = capture.drawables.find(d => d.id === `Eye_${side}_Open`), cross = capture.drawables.find(d => d.id === `Eye_${side}_Cross`), closed = capture.drawables.find(d => d.id === `Eye_${side}_Closed`);
      return { side, value, open: open?.opacity, cross: cross?.opacity, closed: closed?.opacity, passed: !!open && !!cross && !!closed && Math.abs(open.opacity - cross.opacity) < 1e-6 && (value !== 0 || (open.opacity === 0 && cross.opacity === 0 && closed.opacity === 1)) };
    });
    const fixed = capture.width === 971 && capture.height === 1620 && capture.devicePixelRatio === 1 && capture.fit === 1 && !capture.motionsAdvanced && !capture.physicsAdvanced;
    const paramsCorrect = Object.entries(parameters).every(([id, value]) => capture.parameters[id] === value);
    const bodyFixed = body && body.maximumVertexDisplacementPixels < 0.001 && body.opacityDeltaFromNeutral === 0;
    const passed = triangles.passed && fixed && paramsCorrect && bodyFixed && eyes.every(eye => eye.passed) && eyeOpacityInvariant.every(check => check.passed);
    report.states.push({ name: state.name, parameters, passed, fixed, paramsCorrect, bodyFixed, eyes, eyeOpacityInvariant, triangles, maximumDisplacements: Object.fromEntries(capture.drawables.map(drawable => [drawable.id, drawable.maximumVertexDisplacementPixels])), vertexFingerprint: sha(Buffer.from(JSON.stringify(capture.drawables.map(drawable => [drawable.id, drawable.vertexPositions, drawable.opacity])))) });
    if (state.capture && state.name !== "neutral") report.captures[state.name] = await saveCapture(capture, state.name);
  }
  record("all sampled head scarf and blink combinations pass structural checks", report.states.every(state => state.passed), { samples: report.states.length, failed: report.states.filter(state => !state.passed).map(state => state.name) });
  for (const [name, id] of [["head-up", "Face_Base"], ["head-z-positive", "Face_Base"], ["scarf-positive", "Scarf_Lower"]]) record(`actual mesh movement ${name}`, report.captures[name].drawables.find(drawable => drawable.id === id)?.maximumVertexDisplacementPixels > 0.1);
  record("scarf output does not move upper wrap", report.captures["scarf-positive"].drawables.find(drawable => drawable.id === "Scarf_Upper")?.maximumVertexDisplacementPixels < 0.001);
  const restored = await page.evaluate(() => window.headProof.renderer.captureNeutral());
  record("exact neutral restoration after entire grid", restored.pngDataUrl === neutral.pngDataUrl && JSON.stringify(restored.parameters) === JSON.stringify(neutral.parameters));
  const invalid = await page.evaluate(() => {
    const cases = [{ MissingParameter: 1 }, { ParamAngleY: 31 }, { ParamFSScarfSway: NaN }];
    return cases.map(parameters => { try { window.headProof.renderer.captureParameterState(parameters, false); return false; } catch { return true; } });
  });
  record("missing non-finite and out-of-range parameters rejected", invalid.every(Boolean));
  record("no browser errors", report.pageErrors.length === 0);
  report.passed = report.checks.every(check => check.passed);
  report.status = report.passed ? "actual-core-structural-checks-passed-visual-review-pending" : "actual-core-checks-failed";
  if (!report.passed) process.exitCode = 2;
  await page.evaluate(() => window.headProof.renderer.dispose());
} catch (error) { report.status = "failed"; report.failure = String(error); process.exitCode = 1; }
finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  report.resources = [...resources.values()];
  await writeFile(path.join(output, "head-scarf-diagnostic.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ status: report.status, samples: report.states.length, captures: Object.keys(report.captures).length, failedChecks: report.checks.filter(check => !check.passed).map(check => check.name), failure: report.failure ?? null, output, productionApproval: false }));
