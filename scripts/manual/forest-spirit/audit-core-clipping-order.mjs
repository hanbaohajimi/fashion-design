import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Diagnostic for the single deliberately added inverse clip. No render or acceptance substitution.
const { values } = parseArgs({ options: { model: { type: "string" }, geometry: { type: "string" }, "baseline-geometry": { type: "string" }, contract: { type: "string" }, out: { type: "string" }, core: { type: "string", default: "output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5/Core/live2dcubismcore.min.js" } } });
assert.ok(values.model && values.geometry && values["baseline-geometry"] && values.contract && values.out);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const inputs = [];
async function input(filename, json = true) {
  const file = await realpath(path.resolve(repo, filename)), bytes = await readFile(file);
  inputs.push({ path: file, sha256: sha(bytes) });
  return { file, bytes, data: json ? JSON.parse(bytes) : undefined };
}
const model = await input(values.model), native = await input(values.geometry), baseline = await input(values["baseline-geometry"]), config = await input(values.contract), core = await input(values.core, false);
const expected = config.data;
assert.equal(expected.sourceSha256, "95e731a7589b14aff029dc5a8ea64cdb983178699ae2af561a2b838d26cac8a3");
assert.equal(baseline.data.sourceSha256, expected.sourceSha256);
assert.equal(expected.drawable, "Arm_R_Upper"); assert.equal(expected.invert, true); assert.equal(expected.parameter, "ParamFSHatTouch");
const necessaryOccluders = ["Cape_R", "Scarf_Back", "Scarf_Upper", "Scarf_Middle", "Scarf_Lower", "Braid_Root", "Braid_Mid", "Hair_Side_R"];
assert.ok(Array.isArray(expected.maskIds) && expected.maskIds.includes("Cape_R") && new Set(expected.maskIds).size === expected.maskIds.length && expected.maskIds.every(id => necessaryOccluders.includes(id) && typeof expected.maskReasons?.[id] === "string" && expected.maskReasons[id].trim()));
assert.ok(Array.isArray(expected.keys) && expected.keys.length === expected.front.length && expected.keys[0] === 0 && expected.keys.at(-1) === 1);
for (const geometry of [native.data, baseline.data]) {
  const source = await input(geometry.source, false); assert.equal(sha(source.bytes), geometry.sourceSha256);
  assert.equal(geometry.drawables.length, 72);
  for (const d of geometry.drawables) { assert.ok(Array.isArray(d.maskIds)); assert.equal(typeof d.invertMask, "boolean"); }
}
const reference = model.data.FileReferences.Moc;
assert.ok(typeof reference === "string" && !path.isAbsolute(reference) && !reference.includes(":"));
const moc = await input(path.resolve(path.dirname(model.file), reference), false);
assert.ok(moc.file.startsWith(path.dirname(model.file) + path.sep));
const output = path.resolve(repo, values.out), outputRoot = await realpath(path.join(repo, "output")); assert.ok(output.startsWith(outputRoot + path.sep)); await mkdir(output);
const report = { scope: "Actual official Core mask IDs/inverted flag and authored draw-order key behavior; anti-aliasing and visible arm/shoulder pixels require separate actual renders", productionApproval: false, inputs, checks: [], states: [] };
const check = (name, passed, detail) => report.checks.push({ name, passed: Boolean(passed), detail });
const priorById = new Map(baseline.data.drawables.map(d => [d.id, d]));
const nativeById = new Map(native.data.drawables.map(d => [d.id, d]));
for (const d of native.data.drawables) {
  const prior = priorById.get(d.id); assert.ok(prior);
  check(`${d.id} native explicit mask contract`, d.id === expected.drawable ? JSON.stringify(d.maskIds) === JSON.stringify(expected.maskIds) && d.invertMask : JSON.stringify(d.maskIds) === JSON.stringify(prior.maskIds) && d.invertMask === prior.invertMask);
}
const upper = nativeById.get(expected.drawable), order = upper.drawOrderGrid;
assert.equal(order.axes.length, 1); assert.equal(order.axes[0].id, expected.parameter); assert.deepEqual(order.axes[0].keys, expected.keys);
const expectedOrderValues = expected.keys.map((_, i) => order.cells.find(c => c.coordinate.length === 1 && c.coordinate[0] === i).value);
check("neutral native authored order retains baseline", expectedOrderValues[0] === priorById.get(expected.drawable).staticDrawOrder);
const samples = [...new Set([...expected.keys, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875])].sort((a, b) => a - b);
let browser;
try {
  const require = createRequire(import.meta.url), { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
  const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message)); await page.route("**/*", route => route.abort());
  await page.addScriptTag({ content: core.bytes.toString("utf8") }); await page.waitForFunction(() => { try { return globalThis.Live2DCubismCore?.Version?.csmGetVersion() > 0; } catch { return false; } });
  const data = await page.evaluate(({ bytes, samples }) => {
    const Core = globalThis.Live2DCubismCore, buffer = Uint8Array.from(bytes).buffer, moc = Core.Moc.fromArrayBuffer(buffer); let model;
    if (!moc || moc.hasMocConsistency(buffer) !== 1) throw new Error("MOC consistency failed");
    try {
      model = Core.Model.fromMoc(moc); if (!model) throw new Error("Model rejected");
      const parameter = model.parameters.ids.indexOf("ParamFSHatTouch"); if (parameter < 0) throw new Error("Hat parameter missing");
      if (model.parameters.minimumValues[parameter] !== 0 || model.parameters.maximumValues[parameter] !== 1 || model.parameters.defaultValues[parameter] !== 0) throw new Error("Hat bounds changed");
      const capture = () => model.drawables.ids.map((id, i) => ({ id, opacity: model.drawables.opacities[i], drawOrder: model.drawables.drawOrders[i], renderOrder: model.drawables.renderOrders[i], maskIds: Array.from(model.drawables.masks[i], index => model.drawables.ids[index]), invertMask: Core.Utils.hasIsInvertedMaskBit(model.drawables.constantFlags[i]) }));
      const full = () => JSON.stringify({ parameters: Array.from(model.parameters.values), drawables: capture(), positions: model.drawables.ids.map((_, i) => Array.from(model.drawables.vertexPositions[i])) });
      model.parameters.values.set(model.parameters.defaultValues); model.update(); const initial = full(); const states = [];
      for (const value of samples) { model.parameters.values.set(model.parameters.defaultValues); model.parameters.values[parameter] = value; model.update(); states.push({ value, drawables: capture() }); }
      model.parameters.values.set(model.parameters.defaultValues); model.update();
      return { coreVersion: Core.Version.csmGetVersion(), states, neutralRestoredExactly: initial === full(), consistency: 1 };
    } finally { try { model?.release(); } finally { moc._release(); } }
  }, { bytes: Array.from(moc.bytes), samples });
  report.coreVersion = data.coreVersion; report.states = data.states;
  check("official consistency and exact neutral restoration", data.consistency === 1 && data.neutralRestoredExactly);
  for (const state of data.states) {
    const byId = new Map(state.drawables.map(d => [d.id, d])); const arm = byId.get(expected.drawable), tie = byId.get("Hair_BraidTie"), cape = byId.get("Cape_R");
    check(`HatTouch ${state.value} all72 actual clipping fields equal native`, state.drawables.length === 72 && state.drawables.every(d => { const wanted = nativeById.get(d.id); return wanted && JSON.stringify(d.maskIds) === JSON.stringify(wanted.maskIds) && d.invertMask === wanted.invertMask; }));
    const keyIndex = expected.keys.indexOf(state.value);
    if (keyIndex >= 0) {
      const front = expected.front[keyIndex];
      check(`HatTouch key ${state.value} explicit Upper ordering`, front ? arm.renderOrder > tie.renderOrder : arm.renderOrder < tie.renderOrder && arm.renderOrder < cape.renderOrder, { nativeOrder: expectedOrderValues[keyIndex], actualOrder: arm.drawOrder, actualRenderOrder: arm.renderOrder, tieRenderOrder: tie.renderOrder, capeRenderOrder: cape.renderOrder, front });
    }
  }
  check("no browser errors", pageErrors.length === 0, pageErrors);
  const frozen = await Promise.all(inputs.map(async item => ({ ...item, unchanged: sha(await readFile(item.path)) === item.sha256 })));
  check("all recorded input files remain frozen", frozen.every(item => item.unchanged), frozen);
  report.passed = report.checks.every(item => item.passed); report.status = report.passed ? "actual-core-mask-order-contract-passed-visual-review-required" : "failed"; if (!report.passed) process.exitCode = 2;
} catch (error) { report.passed = false; report.status = "failed"; report.error = String(error); process.exitCode = 1; }
finally { try { await browser?.close(); } catch (error) { report.cleanupError = String(error); report.passed = false; report.status = "cleanup-failed"; process.exitCode = 1; } await writeFile(path.join(output, "actual-core-clipping-order-audit.json"), JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failed: report.checks.filter(item => !item.passed).map(item => item.name), error: report.error ?? null, output }));
