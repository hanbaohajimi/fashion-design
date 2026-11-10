/* global window, document, Image */
// Direct actual Core parameter poses. Never plays a motion or approves production art/animation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inspectTriangleDeformation, inspectEyeOpacityInvariant, inspectEyeStateOpacity } from "./head-scarf-diagnostic-audit.mjs";
import { resolveDrawableContract } from "./drawable-source-contract.mjs";

const { values } = parseArgs({ options: {
  model: { type: "string" }, out: { type: "string" },
  runtime: { type: "string", default: "output/forest-spirit-runtime/front-v8-fullbody-diagnostic-r3" },
  mode: { type: "string", default: "schema-only" },
  "drawable-map": { type: "string" },
} });
assert.ok(values.model?.endsWith(".model3.json") && values.out, "Pass actual --model and a NEW --out directory");
assert.ok(["schema-only", "bound-candidate"].includes(values.mode));
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(repo, values.out);
assert.ok(output.startsWith(path.join(repo, "output") + path.sep));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); // EEXIST is intentional: evidence is immutable.
assert.ok((await realpath(output)).startsWith((await realpath(path.join(repo, "output"))) + path.sep));
const source = await realpath(path.resolve(repo, values.model));
const roots = { model: path.dirname(source), runtime: await realpath(path.resolve(repo, values.runtime)) };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const specPath = path.join(repo, "doc/design/forest-spirit/production/front-v8/layers.json");
const qualityPath = path.join(repo, "doc/design/forest-spirit/production/front-v8/quality-spec.json");
const specBytes = await readFile(specPath), qualityBytes = await readFile(qualityPath);
const spec = JSON.parse(specBytes), quality = JSON.parse(qualityBytes);
assert.equal(spec.characterId, "forest-spirit-front-v8");
assert.deepEqual(spec.working_canvas, [971, 1620]);
const mappingPath = values["drawable-map"] ? await realpath(path.resolve(repo, values["drawable-map"])) : null;
const mappingBytes = mappingPath ? await readFile(mappingPath) : null;
const drawableContract = resolveDrawableContract(spec, mappingBytes ? JSON.parse(mappingBytes) : null);
const expectedDrawables = drawableContract.drawableIds;
const eyeIds = ["L", "R"].flatMap(side => ["Open", "Cross", "Closed"].map(kind => `Eye_${side}_${kind}`));
const physics = ["ParamFSHairBackSway", "ParamFSBraidSway", "ParamFSHatBrimSway", "ParamFSScarfSway", "ParamFSSkirtSway", "ParamFSPouchSway"];
const owners = {
  ParamAngleX: ["Face_Base"], ParamAngleY: ["Face_Base"], ParamAngleZ: ["Face_Base"],
  ParamBodyAngleX: ["Body_Base"], ParamBodyAngleZ: ["Body_Base"], ParamBreath: ["Bodice_Olive"],
  ParamEyeLOpen: ["Eye_L_Open", "Eye_L_Cross", "Eye_L_Closed"], ParamEyeROpen: ["Eye_R_Open", "Eye_R_Cross", "Eye_R_Closed"],
  ParamFSHatTouch: ["Hand_R"], ParamFSPickup: ["Hand_R", "Hand_L"], ParamFSSettle: ["Skirt_Base"],
  ParamFSHairBackSway: ["Hair_BackMass"], ParamFSBraidSway: ["Braid_Tip"], ParamFSHatBrimSway: ["Hat_Brim_Front"],
  ParamFSScarfSway: ["Scarf_Lower"], ParamFSSkirtSway: ["Skirt_Base"], ParamFSPouchSway: ["Pouch_Front"],
};
const expectedParameters = Object.keys(owners).sort();
const parameterContractPath = path.join(repo, "output/forest-spirit-production-v2/front-v8/validation/production-parameters.csv");
const parameterContractBytes = await readFile(parameterContractPath);
const parameterContractSha = "37bfcd1277085dabb51b7f27fe88024d96971e5f015d012506e4f1c6fe79a8f3";
assert.equal(sha(parameterContractBytes), parameterContractSha, "Approved fixed parameter contract changed; do not silently accept a new range");
// This exact hash pins the inspected, unquoted CSV. Refuse a different structure instead of guessing.
const csvRows = parameterContractBytes.toString("utf8").replace(/^\uFEFF/u, "").trim().split(/\r?\n/u).map(line => line.split(","));
assert.deepEqual(csvRows[0].slice(1, 8), ["类型", "ID", "名称", "群组", "最低值", "基准值", "最大值"]);
const approvedBounds = Object.fromEntries(csvRows.slice(1).map(row => {
  assert.equal(row[1], "PARAMETER"); assert.ok(row.length >= 8);
  const bounds = { minimum: Number(row[5]), default: Number(row[6]), maximum: Number(row[7]) };
  assert.ok(Object.values(bounds).every(Number.isFinite)); return [row[2], bounds];
}));
assert.deepEqual(Object.keys(approvedBounds).sort(), expectedParameters);
assert.equal(csvRows.length - 1, 17);
const rigidIds = ["Tool_Scissors", "Tool_Roll_A", "Tool_Roll_B", "Tool_Roll_C", "Chest_Button", "Hat_Acorns", "Hat_Berries", "Boot_L", "Boot_R"];
const inputs = new Map([[source, sha(await readFile(source))], [specPath, sha(specBytes)], [qualityPath, sha(qualityBytes)], [fileURLToPath(import.meta.url), sha(await readFile(fileURLToPath(import.meta.url)))]]);
const auditModule = fileURLToPath(new URL("./head-scarf-diagnostic-audit.mjs", import.meta.url));
inputs.set(auditModule, sha(await readFile(auditModule)));
const contractModule = fileURLToPath(new URL("./drawable-source-contract.mjs", import.meta.url));
inputs.set(contractModule, sha(await readFile(contractModule)));
if (mappingPath) inputs.set(mappingPath, sha(mappingBytes));
inputs.set(parameterContractPath, parameterContractSha);
const report = {
  schemaVersion: 1, mode: values.mode, characterId: spec.characterId,
  scope: "Actual Core direct parameter poses; no motion playback, physics simulation, visual or production approval",
  productionApproval: false, visualAcceptance: false, authoredMotionAcceptance: false,
  schemaPassed: false, bindingChecksPassed: false, officialEditorProvenance: "not inferred from filename; caller must supply separate Editor export evidence",
  model: { path: source, sha256: inputs.get(source) }, expectedDrawables, expectedParameters,
  drawableContract: { ...drawableContract, mappingFile: mappingPath ? { path: mappingPath, sha256: sha(mappingBytes) } : null },
  approvedParameterContract: { path: parameterContractPath, sha256: parameterContractSha, bounds: approvedBounds },
  canvas: { width: 971, height: 1620, devicePixelRatio: 1, fit: 1 },
  renderer: "Official Cubism SDK/Core; headless software WebGL is not performance evidence",
  checks: [], states: [], captures: [], contactSheets: [], resources: [], pageErrors: [], createdAt: new Date().toISOString(),
};
const check = (name, passed, detail, scope = "schema") => report.checks.push({ name, passed: Boolean(passed), scope, ...(detail === undefined ? {} : { detail }) });
const resources = new Map();
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}canvas{display:block;width:971px;height:1620px}</style><canvas width="971" height="1620"></canvas><script src="/runtime/live2dcubismcore.min.js"></script><script type="module">
import {createNeutralDiagnosticRenderer} from '/runtime/forest-spirit-runtime.js';
window.fullProof={ready:false,errors:[]};try{const r=createNeutralDiagnosticRenderer(document.querySelector('canvas'));window.fullProof.renderer=r;await r.load({model3Url:${JSON.stringify(`/model/${encodeURIComponent(path.basename(source))}`)}},new AbortController().signal);window.fullProof.ready=true;}catch(e){window.fullProof.errors.push(String(e));}</script>`;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" }); response.end(html); return; }
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean), root = roots[parts.shift()];
    assert.ok(root);
    const file = await realpath(path.resolve(root, ...parts)); assert.ok(file.startsWith(root + path.sep));
    const bytes = await readFile(file), fingerprint = sha(bytes);
    if (inputs.has(file)) assert.equal(inputs.get(file), fingerprint, "Resource changed during capture");
    inputs.set(file, fingerprint); resources.set(file, { path: file, bytes: bytes.length, sha256: fingerprint });
    response.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".json": "application/json", ".png": "image/png" })[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }); response.end(bytes);
  } catch { response.writeHead(404); response.end("Missing or changed local diagnostic resource"); }
});
const capturedData = [];
async function saveCapture(state, name) {
  assert.match(name, /^[A-Za-z0-9_.-]+$/u);
  const { pngDataUrl, ...measured } = state;
  assert.ok(pngDataUrl?.startsWith("data:image/png;base64,"));
  const bytes = Buffer.from(pngDataUrl.slice("data:image/png;base64,".length), "base64");
  assert.equal(bytes.readUInt32BE(16), 971); assert.equal(bytes.readUInt32BE(20), 1620); assert.equal(bytes[25], 6);
  const file = path.join(output, `${name}.png`);
  await writeFile(file, bytes, { flag: "wx" });
  await writeFile(path.join(output, `${name}.json`), JSON.stringify({ ...measured, png: { path: file, sha256: sha(bytes) } }, null, 2) + "\n", { flag: "wx" });
  capturedData.push({ name, data: pngDataUrl }); report.captures.push({ name, path: file, sha256: sha(bytes) });
}
function inspectRigid(base, current, ppu) {
  const byId = new Map(base.drawables.map(d => [d.id, d]));
  return rigidIds.map(id => {
    const a = byId.get(id), b = current.drawables.find(d => d.id === id);
    if (!a || !b) return { id, passed: false, reason: "missing rigid part" };
    let maximumEdgeLengthErrorPx = 0;
    for (let at = 0; at < b.vertexIndices.length; at += 3) {
      const t = b.vertexIndices.slice(at, at + 3);
      for (const [u, v] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
        const length = d => Math.hypot(d.vertexPositions[u * 2] - d.vertexPositions[v * 2], d.vertexPositions[u * 2 + 1] - d.vertexPositions[v * 2 + 1]) * ppu;
        maximumEdgeLengthErrorPx = Math.max(maximumEdgeLengthErrorPx, Math.abs(length(a) - length(b)));
      }
    }
    return { id, maximumEdgeLengthErrorPx, tolerancePx: 0.05, passed: Number.isFinite(maximumEdgeLengthErrorPx) && maximumEdgeLengthErrorPx <= 0.05 };
  });
}
function handCanvasBounds(snapshot) {
  const info = snapshot.canvasInfo;
  if (!info || ![info.widthPixels, info.heightPixels, info.originX, info.originY, info.pixelsPerUnit].every(Number.isFinite))
    return { status: "visual_only_missing_actual_Core_canvas_info", coordinateSource: null };
  return {
    status: "actual_Core_mesh_bbox_measured_visible_alpha_clipping_requires_review",
    coordinateSource: { api: "CubismModel.getModel().canvasinfo", ...info, formula: "canvasX=CanvasOriginX+coreX*PixelsPerUnit; canvasY=CanvasOriginY-coreY*PixelsPerUnit", fittedRegistration: false },
    hands: ["Hand_R", "Hand_L"].map(id => {
      const d = snapshot.drawables.find(item => item.id === id);
      if (!d) return { id, missing: true, meshCrossesCanvas: true };
      const x = [], y = [];
      for (let i = 0; i < d.vertexPositions.length; i += 2) { x.push(info.originX + d.vertexPositions[i] * info.pixelsPerUnit); y.push(info.originY - d.vertexPositions[i + 1] * info.pixelsPerUnit); }
      const bbox = [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)];
      return { id, bbox, meshCrossesCanvas: bbox[0] < 0 || bbox[1] < 0 || bbox[2] > info.widthPixels || bbox[3] > info.heightPixels, includesTransparentMeshPadding: true };
    }),
  };
}
function makeStates(bounds) {
  const states = [], keys = new Set();
  const add = (name, parameters, capture = false, singleParameter = undefined) => {
    assert.ok(!keys.has(name)); keys.add(name); states.push({ name, parameters, capture, singleParameter });
  };
  for (const id of expectedParameters) for (const end of ["minimum", "maximum"]) add(`axis-${id}-${end}`, { [id]: bounds[id][end] }, true, id);
  for (let l = 0; l <= 8; l++) for (let r = 0; r <= 8; r++) add(`eyes-${l}-${r}`, { ParamEyeLOpen: l / 8, ParamEyeROpen: r / 8 }, (l === r && [0, 4, 8].includes(l)) || (l === 0 && r === 8) || (l === 8 && r === 0));
  const signed = (id, t) => bounds[id].default + (t < 0 ? bounds[id].default - bounds[id].minimum : bounds[id].maximum - bounds[id].default) * t;
  for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) for (const s of [-1, 0, 1]) for (const e of [0, .5, 1])
    add(`head-y${y}-z${z}-s${s}-e${e}`, { ParamAngleY: signed("ParamAngleY", y), ParamAngleZ: signed("ParamAngleZ", z), ParamFSScarfSway: signed("ParamFSScarfSway", s), ParamEyeLOpen: e, ParamEyeROpen: e }, y === z && z === s && z !== 0 && e === 1);
  for (let i = 0; i <= 16; i++) for (const z of [-1, -.5, 0, .5, 1]) for (const e of [0, .5, 1])
    add(`hat-${i}-head${z}-e${e}`, { ParamFSHatTouch: signed("ParamFSHatTouch", i / 16), ParamAngleZ: signed("ParamAngleZ", z), ParamEyeLOpen: e, ParamEyeROpen: e }, [0, 8, 16].includes(i) && [-1, 0, 1].includes(z) && e === 1);
  for (const action of ["ParamFSPickup", "ParamFSSettle"]) for (const a of [0, .5, 1]) for (const physical of physics) for (const v of [-1, 1])
    add(`combo-${action}-${a}-${physical}-${v}`, { [action]: signed(action, a), [physical]: signed(physical, v) }, a === 1 && v === 1);
  return states;
}
let browser, page;
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const require = createRequire(import.meta.url), { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  page = await browser.newPage({ viewport: { width: 971, height: 1620 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  page.on("pageerror", error => report.pageErrors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  await page.goto(origin); await page.waitForFunction(() => window.fullProof?.ready || window.fullProof?.errors.length, undefined, { timeout: 45000 });
  const loaded = await page.evaluate(() => ({ ready: window.fullProof.ready, errors: window.fullProof.errors })); assert.ok(loaded.ready && !loaded.errors.length, JSON.stringify(loaded));
  const neutral = await page.evaluate(() => window.fullProof.renderer.captureNeutral());
  await saveCapture(neutral, "neutral");
  const actualIds = neutral.drawables.map(d => d.id).sort(), actualParameters = Object.keys(neutral.parameters).sort();
  report.actualDrawableIds = actualIds; report.actualParameterIds = actualParameters;
  report.actualParameterBounds = neutral.parameterBounds; report.pixelsPerUnit = neutral.pixelsPerUnit;
  report.actualCanvasInfo = neutral.canvasInfo; report.neutralHandCanvasBounds = handCanvasBounds(neutral);
  check(`${drawableContract.sourceLayerCount} frozen sources / ${expectedDrawables.length} exact declared drawable IDs with no temporary composite`, JSON.stringify(actualIds) === JSON.stringify(expectedDrawables), { missing: expectedDrawables.filter(id => !actualIds.includes(id)), unexpected: actualIds.filter(id => !expectedDrawables.includes(id)) });
  check("native fixed canvas capture", neutral.width === 971 && neutral.height === 1620 && neutral.fit === 1 && neutral.devicePixelRatio === 1 && !neutral.motionsAdvanced && !neutral.physicsAdvanced);
  check("actual pixels-per-unit and parameter bounds present", Number.isFinite(neutral.pixelsPerUnit) && neutral.pixelsPerUnit > 0 && actualParameters.every(id => {
    const b = neutral.parameterBounds?.[id]; return b && [b.minimum, b.maximum, b.default].every(Number.isFinite) && b.minimum <= b.default && b.default <= b.maximum;
  }));
  check("actual Core canvas mapping has native dimensions", neutral.canvasInfo?.widthPixels === 971 && neutral.canvasInfo?.heightPixels === 1620 && neutral.canvasInfo?.pixelsPerUnit === neutral.pixelsPerUnit && [neutral.canvasInfo?.originX, neutral.canvasInfo?.originY].every(Number.isFinite));
  check("all real drawable meshes textures and render orders", neutral.drawables.every(d => d.vertexCount >= 3 && d.vertexIndexCount >= 3 && d.vertexIndexCount % 3 === 0 && d.vertexPositions.length === d.vertexCount * 2 && d.vertexPositions.every(Number.isFinite) && d.textureIndexValid && Number.isInteger(d.renderOrder)));
  const inventory17 = JSON.stringify(actualParameters) === JSON.stringify(expectedParameters);
  check("seventeen actual frozen parameter IDs", inventory17, { actualParameters }, values.mode === "schema-only" ? "binding-not-evaluated" : "binding");
  const rangeComparison = expectedParameters.map(id => ({ id, approved: approvedBounds[id], actual: neutral.parameterBounds?.[id] ?? null, passed: ["minimum", "default", "maximum"].every(key => neutral.parameterBounds?.[id]?.[key] === approvedBounds[id][key]) }));
  const fixedBounds = inventory17 && rangeComparison.every(item => item.passed);
  check("all actual parameter ranges and defaults equal frozen approved CSV", fixedBounds, { contractSha256: parameterContractSha, rangeComparison }, values.mode === "schema-only" ? "binding-not-evaluated" : "binding");
  const topology = inspectTriangleDeformation(neutral, neutral, neutral.pixelsPerUnit);
  check("neutral topology has no invalid or degenerate triangles", topology.passed && topology.baselineDegenerate === 0, topology);
  if (values.mode === "bound-candidate") {
    assert.ok(fixedBounds, "Actual rig parameters/ranges/defaults differ from approved fixed CSV; refusing changed or shrunken bounds");
    assert.ok(report.checks.filter(c => c.scope === "schema").every(c => c.passed), "Core inventory/schema must pass before pose sampling");
    const states = makeStates(approvedBounds), eyeBaselines = new Map();
    const responsiveness = Object.fromEntries(expectedParameters.map(id => [id, Object.fromEntries(owners[id].map(part => [part, 0]))]));
    for (const state of states) {
      const left = state.parameters.ParamEyeLOpen ?? neutral.parameters.ParamEyeLOpen, right = state.parameters.ParamEyeROpen ?? neutral.parameters.ParamEyeROpen;
      const key = `${left},${right}`;
      if (!eyeBaselines.has(key)) eyeBaselines.set(key, await page.evaluate(({ left, right }) => window.fullProof.renderer.captureParameterState({ ParamEyeLOpen: left, ParamEyeROpen: right }, false), { left, right }));
      const eyeBase = eyeBaselines.get(key);
      const sample = await page.evaluate(({ parameters, capture }) => window.fullProof.renderer.captureParameterState(parameters, capture), state);
      const triangles = inspectTriangleDeformation(eyeBase, sample, neutral.pixelsPerUnit);
      const opacityInvariants = inspectEyeOpacityInvariant(eyeBase, sample);
      const rigid = inspectRigid(neutral, sample, neutral.pixelsPerUnit);
      const eyes = ["L", "R"].map(side => {
        const get = kind => sample.drawables.find(d => d.id === `Eye_${side}_${kind}`)?.opacity;
        const value = side === "L" ? left : right, open = get("Open"), cross = get("Cross"), closed = get("Closed");
        return inspectEyeStateOpacity({ side, value, open, cross, closed });
      });
      const direct = !sample.motionsAdvanced && !sample.physicsAdvanced && Object.entries(state.parameters).every(([id, value]) => Math.abs(sample.parameters[id] - value) < 1e-6);
      const blinkIsolation = !state.name.startsWith("eyes-") || sample.drawables.filter(d => !eyeIds.includes(d.id)).every(d => d.maximumVertexDisplacementPixels < .005 && Math.abs(d.opacityDeltaFromNeutral) < 1e-6);
      const nonEyeOpacityInvariant = sample.drawables.filter(d => !eyeIds.includes(d.id)).every(d => Math.abs(d.opacityDeltaFromNeutral) < 1e-6);
      const holdOrder = state.parameters.ParamFSHatTouch !== neutral.parameterBounds.ParamFSHatTouch.maximum || ["Hand_R", "Arm_R_Lower"].every(id => sample.drawables.find(d => d.id === id).renderOrder > sample.drawables.find(d => d.id === "Hat_Brim_Front").renderOrder);
      const passed = direct && triangles.passed && triangles.baselineDegenerate === 0 && opacityInvariants.every(c => c.passed) && eyes.every(c => c.passed) && rigid.every(c => c.passed) && blinkIsolation && nonEyeOpacityInvariant && holdOrder;
      if (state.singleParameter) for (const id of owners[state.singleParameter]) {
        const d = sample.drawables.find(d => d.id === id);
        const response = Math.max(d.maximumVertexDisplacementPixels, Math.abs(d.opacityDeltaFromNeutral));
        responsiveness[state.singleParameter][id] = Math.max(responsiveness[state.singleParameter][id], response);
      }
      report.states.push({ name: state.name, parameters: state.parameters, passed, direct, blinkIsolation, nonEyeOpacityInvariant, handOverBrimOrder: holdOrder, triangles, eyes, opacityInvariants, rigid,
        handCanvasBounds: handCanvasBounds(sample),
        maximumDisplacements: Object.fromEntries(sample.drawables.map(d => [d.id, d.maximumVertexDisplacementPixels])),
        renderOrders: Object.fromEntries(sample.drawables.map(d => [d.id, d.renderOrder])),
        vertexFingerprint: sha(Buffer.from(JSON.stringify(sample.drawables.map(d => [d.id, d.vertexPositions, d.opacity, d.renderOrder])))) });
      if (state.capture) await saveCapture(sample, state.name);
    }
    check("all direct Core poses pass structural checks", report.states.every(s => s.passed), { samples: states.length, failed: report.states.filter(s => !s.passed).map(s => s.name) }, "binding");
    for (const [id, response] of Object.entries(responsiveness)) check(`actual expected drawable response: ${id}`, Object.values(response).every(value => value > .02), response, "binding");
    report.responsiveness = responsiveness;
  }
  const restored = await page.evaluate(() => window.fullProof.renderer.captureNeutral());
  check("exact neutral pixels parameters and vertex state restored", neutral.pngDataUrl === restored.pngDataUrl && JSON.stringify(neutral.parameters) === JSON.stringify(restored.parameters) && JSON.stringify(neutral.drawables.map(d => [d.id, d.vertexPositions, d.opacity, d.renderOrder])) === JSON.stringify(restored.drawables.map(d => [d.id, d.vertexPositions, d.opacity, d.renderOrder])));
  await saveCapture(restored, "neutral-restored");
  // Preview sheets are explicitly downsampled; native PNGs and measured coordinates remain untouched.
  for (const background of quality.backgrounds) for (let offset = 0; offset < capturedData.length; offset += 16) {
    const sheet = await page.evaluate(async ({ entries, background }) => {
      const width = 194, height = 324, label = 38, cols = 4, rows = Math.ceil(entries.length / cols);
      const canvas = document.createElement("canvas"); canvas.width = cols * width; canvas.height = rows * (height + label);
      const ctx = canvas.getContext("2d"); ctx.fillStyle = `rgb(${background.rgb8.join(",")})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < entries.length; i++) {
        const image = new Image(); image.src = entries[i].data; await image.decode();
        const x = i % cols * width, y = Math.floor(i / cols) * (height + label);
        ctx.drawImage(image, x, y, width, height); ctx.fillStyle = background.id === "deep_green" ? "white" : "black"; ctx.font = "10px sans-serif";
        ctx.fillText(entries[i].name.slice(0, 29), x + 3, y + height + 12); ctx.fillText(entries[i].name.slice(29, 58), x + 3, y + height + 25);
      }
      return canvas.toDataURL("image/png");
    }, { entries: capturedData.slice(offset, offset + 16), background });
    const bytes = Buffer.from(sheet.slice("data:image/png;base64,".length), "base64"), file = path.join(output, `contact-${background.id}-${offset / 16 + 1}.png`);
    await writeFile(file, bytes, { flag: "wx" }); report.contactSheets.push({ path: file, sha256: sha(bytes), background, downsampledPreviewOnly: true, sourceNames: capturedData.slice(offset, offset + 16).map(s => s.name) });
  }
  check("no browser errors", report.pageErrors.length === 0);
  report.schemaPassed = report.checks.filter(c => c.scope === "schema").every(c => c.passed);
  report.bindingChecksPassed = values.mode === "bound-candidate" && report.schemaPassed && report.checks.filter(c => c.scope === "binding").every(c => c.passed);
  report.status = values.mode === "schema-only" ? (report.schemaPassed ? "SCHEMA_ONLY_MEASURED_BINDINGS_NOT_EVALUATED" : "SCHEMA_FAILED_BINDINGS_NOT_EVALUATED") : (report.bindingChecksPassed ? "ACTUAL_CORE_STRUCTURAL_CHECKS_PASSED_VISUAL_AND_MOTION_PENDING" : "ACTUAL_CORE_BINDING_CHECKS_FAILED");
  if (!report.schemaPassed || values.mode === "bound-candidate" && !report.bindingChecksPassed) process.exitCode = 2;
} catch (error) { report.status = "FAILED"; report.error = String(error); report.bindingChecksPassed = false; process.exitCode = 1; }
finally {
  const cleanupErrors = [];
  try { if (page && !page.isClosed()) await page.evaluate(() => window.fullProof?.renderer?.dispose()); } catch (e) { cleanupErrors.push(`renderer: ${String(e)}`); }
  try { await browser?.close(); } catch (e) { cleanupErrors.push(`browser: ${String(e)}`); }
  try { if (server.listening) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); } catch (e) { cleanupErrors.push(`server: ${String(e)}`); }
  report.cleanupErrors = cleanupErrors; report.resources = [...resources.values()]; report.inputHashes = [...inputs].map(([file, sha256]) => ({ file, sha256 }));
  const integrity = await Promise.allSettled([...inputs].map(async ([file, hash]) => sha(await readFile(file)) === hash));
  report.inputsUnchanged = integrity.every(r => r.status === "fulfilled" && r.value);
  if (cleanupErrors.length || !report.inputsUnchanged) { report.status = cleanupErrors.length ? "CLEANUP_FAILED" : "INPUT_INTEGRITY_FAILED"; report.schemaPassed = false; report.bindingChecksPassed = false; process.exitCode = 2; }
  report.limitations = ["No authored motion or physics solver was advanced.", "Finite, nonflipped, responsive geometry and opacity cannot establish seam coverage, material quality, facial likeness, natural timing, or production acceptance.", "Contact sheets are reduced previews; review the native 971x1620 PNGs for seam, hand/hat contact, scarf neck coverage and peripheral clipping.", "Schema-only static source results never count as binding checks passed."];
  await writeFile(path.join(output, "fullbody-rig-diagnostic.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
}
console.log(JSON.stringify({ status: report.status, schemaPassed: report.schemaPassed, bindingChecksPassed: report.bindingChecksPassed, states: report.states.length, captures: report.captures.length, output, productionApproval: false }));
