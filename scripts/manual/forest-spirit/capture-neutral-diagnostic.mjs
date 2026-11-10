/* global window */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import { productionOptions, readProductionContext } from "./production-context.mjs";
import { auditEyeDiagnostic, defaultEyeDrawableMap, eyeDiagnosticStates, inspectEyeDrawableInventory } from "./eye-diagnostic-audit.mjs";

// This capture requires a genuine model3 + moc3 + texture package. Program-exported
// research drafts must be explicitly labelled and never imply Editor acceptance.
// It never generates a stand-in model, copies a reference image onto the canvas,
// evaluates animation/physics, modifies the product manifest or enables a flag.
const { values } = parseArgs({ options: { ...productionOptions, model: { type: "string" }, runtime: { type: "string", default: "output/forest-spirit-runtime/front-v8" }, eyes: { type: "boolean", default: false }, "drawable-map": { type: "string" }, "capture-id": { type: "string", default: "neutral-runtime" }, "export-origin": { type: "string", default: "editor" } } });
assert.ok(["editor", "program"].includes(values["export-origin"]), "Use --export-origin editor|program");
assert.ok(values.model?.endsWith(".model3.json"), "Pass --model <actual exported model3.json>");
assert.ok(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(values["capture-id"]), "Use a safe versioned --capture-id");
const { repo, characterId, specification, outputRoot } = await readProductionContext(values);
assert.equal(characterId, "forest-spirit-front-v8", "This diagnostic is fixed to the v8 canvas");
assert.deepEqual(specification.working_canvas, [971, 1620]);
const modelPath = await realpath(path.resolve(repo, values.model));
const roots = { model: path.dirname(modelPath), runtime: await realpath(path.resolve(repo, values.runtime)) };
const output = path.join(outputRoot, "validation", values["capture-id"]);
await mkdir(output, { recursive: true });
assert.ok((await realpath(output)).startsWith((await realpath(outputRoot)) + path.sep));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function saveCapture(capture, name) {
  const { pngDataUrl, ...snapshot } = capture;
  const bytes = Buffer.from(pngDataUrl.replace(/^data:image\/png;base64,/u, ""), "base64");
  assert.equal(bytes.readUInt32BE(16), 971); assert.equal(bytes.readUInt32BE(20), 1620);
  assert.equal(bytes[24], 8, "Diagnostic PNG must be 8-bit");
  assert.equal(bytes[25], 6, "Diagnostic PNG must preserve RGBA channels");
  const filename = path.join(output, name);
  await writeFile(filename, bytes);
  for (const drawable of snapshot.drawables) drawable.vertexPositionsSha256 = sha(Buffer.from(Float32Array.from(drawable.vertexPositions).buffer));
  return { ...snapshot, pixelFingerprint: sha(bytes), png: { path: filename, bytes: bytes.length, sha256: sha(bytes) } };
}
const modelUrl = `/model/${encodeURIComponent(path.basename(modelPath))}`;
const html = `<!doctype html><html><meta charset="utf-8"><title>v8 actual neutral diagnostic — not production approval</title><style>html,body{margin:0;padding:0;background:transparent}canvas{display:block;width:971px;height:1620px}</style><canvas id="model" width="971" height="1620"></canvas><script src="/runtime/live2dcubismcore.min.js"></script><script type="module">
import {createNeutralDiagnosticRenderer,sdkVersion} from '/runtime/forest-spirit-runtime.js';
const errors=[];const canvas=document.querySelector('#model');
canvas.addEventListener('forest-spirit-error',event=>errors.push(String(event.detail)));
window.neutralProof={ready:false,errors,sdkVersion};
try{
 const renderer=createNeutralDiagnosticRenderer(canvas);window.neutralProof.renderer=renderer;
 await renderer.load({model3Url:${JSON.stringify(modelUrl)}},new AbortController().signal);
 window.neutralProof.ready=true;
}catch(error){errors.push(String(error));}
</script></html>`;
const resources = new Map();
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
    resources.set(url.pathname, { path: filename, bytes: bytes.length, sha256: sha(bytes) });
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(bytes);
  } catch { response.writeHead(404); response.end("Missing local diagnostic resource"); }
});
let browser;
const evidence = { characterId, scope: `${values["export-origin"] === "program" ? "Program-exported research draft; not an official Editor export. " : "Actual Editor-exported model. "}v8 neutral capture only; not a production rig or authored-motion acceptance`, exportOrigin: values["export-origin"], officialEditorExport: values["export-origin"] === "editor", status: "not_run", renderer: "Official Cubism SDK 5-r.5; headless Chromium SwiftShader software WebGL, not hardware performance evidence", canvas: { width: 971, height: 1620, devicePixelRatio: 1, fit: 1 }, motionAndPhysicsStopped: true, referenceImageSubstitution: false, model: { path: modelPath, sha256: sha(await readFile(modelPath)) }, pageErrors: [], capturedAt: new Date().toISOString() };
try {
  // Windows may allocate a Chromium-reserved port (observed: 4045) for port 0.
  // Bind an ordinary high local port; never disable browser port protections.
  for (let port = 48200; port < 48240 && !server.listening; port += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.removeListener("listening", onListening); reject(error); };
        const onListening = () => { server.removeListener("error", onError); resolve(); };
        server.once("error", onError); server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
    } catch (error) { if (error.code !== "EADDRINUSE") throw error; }
  }
  assert.ok(server.listening, "No available local diagnostic port");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const require = createRequire(import.meta.url);
  const { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 971, height: 1620 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  page.on("pageerror", error => evidence.pageErrors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => window.neutralProof?.ready || window.neutralProof?.errors.length, undefined, { timeout: 45000 });
  const loaded = await page.evaluate(() => ({ ready: window.neutralProof.ready, errors: window.neutralProof.errors }));
  assert.ok(loaded.ready && !loaded.errors.length, JSON.stringify(loaded));
  const first = await page.evaluate(() => window.neutralProof.renderer.captureNeutral());
  const second = await page.evaluate(() => window.neutralProof.renderer.captureNeutral());
  assert.equal(first.pngDataUrl, second.pngDataUrl, "Repeated neutral captures differ");
  assert.deepEqual(first.parameters, second.parameters, "Neutral parameter state changed");
  assert.ok(first.drawableCount > 0 && first.textureCount > 0 && first.motionsAdvanced === false && first.physicsAdvanced === false);
  assert.equal(evidence.pageErrors.length, 0, "Unexpected browser errors");
  const snapshot = await saveCapture(first, "neutral-971x1620.png");
  evidence.status = "captured_pending_pixel_and_visual_review";
  evidence.snapshot = snapshot;
  const mapping = values["drawable-map"] ? JSON.parse(await readFile(path.resolve(repo, values["drawable-map"]), "utf8")) : defaultEyeDrawableMap;
  evidence.eyeDrawableInventory = inspectEyeDrawableInventory(snapshot, mapping);
  evidence.repeatedCaptureIdentical = true;
  evidence.png = snapshot.png;
  if (values.eyes) {
    const manifest = JSON.parse(await readFile(path.join(outputRoot, "motion-drafts/motion-drafts.manifest.json"), "utf8"));
    assert.equal(manifest.characterId, characterId, "Parameter manifest belongs to another character");
    const expectedParameters = [...manifest.motionOwnedParameters, ...manifest.excludedPhysicsOutputParameters];
    assert.equal(expectedParameters.length, 17);
    const snapshots = { neutral: snapshot };
    const gradedStates = [
      { name: "quarter", left: 0.25, right: 0.25 }, { name: "threeQuarter", left: 0.75, right: 0.75 },
      { name: "leftQuarter", left: 0.25, right: 1 }, { name: "rightQuarter", left: 1, right: 0.25 },
      { name: "leftHalf", left: 0.5, right: 1 }, { name: "rightHalf", left: 1, right: 0.5 },
      { name: "leftThreeQuarter", left: 0.75, right: 1 }, { name: "rightThreeQuarter", left: 1, right: 0.75 },
    ];
    for (const state of [...eyeDiagnosticStates.slice(1), ...gradedStates]) {
      const capture = await page.evaluate(({ left, right }) => window.neutralProof.renderer.captureEyeState(left, right), state);
      assert.equal(capture.parameters.ParamEyeLOpen, state.left);
      assert.equal(capture.parameters.ParamEyeROpen, state.right);
      snapshots[state.name] = await saveCapture(capture, `eyes-${state.name}-971x1620.png`);
    }
    const restored = await page.evaluate(() => window.neutralProof.renderer.captureNeutral());
    assert.equal(restored.pngDataUrl, first.pngDataUrl, "Eye sweep did not restore exact neutral pixels");
    const audit = auditEyeDiagnostic(snapshots, expectedParameters, mapping);
    const sweepPath = path.join(output, "eye-sweep.json");
    const gradedSampleChecks = gradedStates.map(state => ({ name: state.name, passed: mapping.preserve.every(id => {
      const item = snapshots[state.name].drawables.find(drawable => drawable.id === id);
      return item && Math.abs(item.opacityDeltaFromNeutral) < 0.001 && Math.abs(item.maximumVertexDisplacementPixels) < 0.001;
    }) }));
    assert.ok(gradedSampleChecks.every(check => check.passed), "Graded eye sweep altered protected facial features");
    await writeFile(sweepPath, JSON.stringify({ characterId, model: evidence.model, exportOrigin: evidence.exportOrigin, officialEditorExport: evidence.officialEditorExport, scope: "Actual Core static eye parameter sweep; no authored-motion or visual approval", ...audit, gradedSampleChecks, neutralRestoredExactly: true, snapshots }, null, 2) + "\n", "utf8");
    evidence.eyeSweep = { path: sweepPath, passed: audit.passed, status: audit.status, failedChecks: audit.checks.filter(check => !check.passed).map(check => check.name) };
    if (!audit.passed) { evidence.status = "neutral_captured_eye_binding_checks_failed"; process.exitCode = 2; }
  }
  await page.evaluate(() => window.neutralProof.renderer.dispose());
} catch (error) {
  evidence.status = "failed"; evidence.failure = String(error); process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  evidence.resources = [...resources.values()];
  await writeFile(path.join(output, "neutral-runtime.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ status: evidence.status, output, failure: evidence.failure ?? null, productionApproval: false }));
}
