import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inspectRefinement } from "./refined-mesh-audit.mjs";

// Independent actual Core inspection, with no motions/physics or application activation.
const { values } = parseArgs({ options: { baseline: { type: "string" }, candidate: { type: "string" }, out: { type: "string" }, "refined-drawable": { type: "string", multiple: true, default: [] }, core: { type: "string", default: "output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5/Core/live2dcubismcore.min.js" } } });
assert.ok(values.baseline && values.candidate && values.out, "Pass --baseline, --candidate and --out");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(repo, values.out);
assert.ok(output.startsWith(path.join(repo, "output") + path.sep));
await mkdir(output, { recursive: true });
assert.ok((await realpath(output)).startsWith((await realpath(path.join(repo, "output"))) + path.sep));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function bundle(filename) {
  const modelPath = await realpath(path.resolve(repo, filename));
  const root = path.dirname(modelPath);
  const modelBytes = await readFile(modelPath), model = JSON.parse(modelBytes);
  async function resource(relative) {
    assert.ok(typeof relative === "string" && !path.isAbsolute(relative) && !relative.includes(":"));
    const file = await realpath(path.resolve(root, relative));
    assert.ok(file.startsWith(root + path.sep));
    const data = await readFile(file);
    return { path: file, bytes: data.length, sha256: sha(data), data };
  }
  const moc = await resource(model.FileReferences.Moc);
  const textures = await Promise.all(model.FileReferences.Textures.map(resource));
  return { model: { path: modelPath, sha256: sha(modelBytes) }, moc, textures };
}
const [baseline, candidate] = await Promise.all([bundle(values.baseline), bundle(values.candidate)]);
const corePath = await realpath(path.resolve(repo, values.core)), core = await readFile(corePath);
const require = createRequire(import.meta.url);
const { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
const report = { scope: "Actual official Core default-pose, UV, topology and texture comparison; no motion/physics evaluation or production approval", productionApproval: false, core: { path: corePath, sha256: sha(core) }, pageErrors: [], checks: [], createdAt: new Date().toISOString() };
report.expectedRefinedDrawables = values["refined-drawable"];
// A deliberate refinement must retain each old vertex/UV and describe the same
// affine textured surface. It is never labelled as unchanged topology.
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", error => report.pageErrors.push(error.message));
  await page.route("**/*", route => route.abort());
  await page.addScriptTag({ content: core.toString("utf8") });
  await page.waitForFunction(() => { try { return globalThis.Live2DCubismCore?.Version?.csmGetVersion() > 0; } catch { return false; } }, undefined, { timeout: 30000 });
  async function inspect(input) {
    const snapshot = await page.evaluate(bytes => {
      const Core = globalThis.Live2DCubismCore;
      const data = Uint8Array.from(bytes).buffer;
      const moc = Core.Moc.fromArrayBuffer(data);
      if (!moc) throw new Error("Official Core rejected MOC3");
      let model;
      try {
        if (moc.hasMocConsistency(data) !== 1) throw new Error("Official Core MOC3 consistency failed");
        model = Core.Model.fromMoc(moc);
        if (!model) throw new Error("Official Core rejected model");
        model.parameters.values.set(model.parameters.defaultValues);
        model.update();
        return {
          coreVersion: Core.Version.csmGetVersion(), consistency: 1,
          canvas: { width: model.canvasinfo.CanvasWidth, height: model.canvasinfo.CanvasHeight, pixelsPerUnit: model.canvasinfo.PixelsPerUnit, originX: model.canvasinfo.CanvasOriginX, originY: model.canvasinfo.CanvasOriginY },
          parameters: model.parameters.ids.map((id, index) => ({ id, min: model.parameters.minimumValues[index], max: model.parameters.maximumValues[index], default: model.parameters.defaultValues[index] })),
          drawables: model.drawables.ids.map((id, index) => ({ id, opacity: model.drawables.opacities[index], textureIndex: model.drawables.textureIndices[index], vertexCount: model.drawables.vertexCounts[index], indexCount: model.drawables.indexCounts[index], positions: Array.from(model.drawables.vertexPositions[index]), uvs: Array.from(model.drawables.vertexUvs[index]), indices: Array.from(model.drawables.indices[index]) })),
        };
      } finally { model?.release(); moc._release(); }
    }, Array.from(input.moc.data));
    return { model: input.model, moc: { path: input.moc.path, sha256: input.moc.sha256, bytes: input.moc.bytes }, textures: input.textures.map(texture => ({ path: texture.path, bytes: texture.bytes, sha256: texture.sha256 })), snapshot };
  }
  report.baseline = await inspect(baseline);
  report.candidate = await inspect(candidate);
  const a = report.baseline.snapshot, b = report.candidate.snapshot;
  const check = (name, passed, detail) => report.checks.push({ name, passed: Boolean(passed), ...(detail ? { detail } : {}) });
  check("both actual MOC3 packages pass official Core consistency", a.consistency === 1 && b.consistency === 1);
  check("native v8 canvas, origin and scale unchanged", JSON.stringify(a.canvas) === JSON.stringify(b.canvas) && a.canvas.width === 971 && a.canvas.height === 1620);
  check("seventeen actual parameter definitions unchanged", a.parameters.length === 17 && JSON.stringify(a.parameters) === JSON.stringify(b.parameters));
  check("actual Drawable IDs and ordering unchanged", JSON.stringify(a.drawables.map(d => d.id)) === JSON.stringify(b.drawables.map(d => d.id)));
  check("explicit refinement IDs exist exactly once", values["refined-drawable"].every(id => a.drawables.filter(d => d.id === id).length === 1 && b.drawables.filter(d => d.id === id).length === 1) && new Set(values["refined-drawable"]).size === values["refined-drawable"].length);
  check("texture PNG sequence byte identical", JSON.stringify(baseline.textures.map(t => t.sha256)) === JSON.stringify(candidate.textures.map(t => t.sha256)));
  report.drawableComparison = a.drawables.map(old => {
    const next = b.drawables.find(item => item.id === old.id);
    const arrayEqual = (x, y) => Array.isArray(y) && x.length === y.length && x.every((value, index) => value === y[index]);
    const positionDeltaPx = next?.positions.length === old.positions.length ? Math.max(0, ...old.positions.map((v, i) => Math.abs(v - next.positions[i]) * a.canvas.pixelsPerUnit)) : null;
    return { id: old.id, vertexCountUnchanged: old.vertexCount === next?.vertexCount, indicesExact: arrayEqual(old.indices, next?.indices), uvsExact: arrayEqual(old.uvs, next?.uvs), textureIndexUnchanged: old.textureIndex === next?.textureIndex, neutralOpacityExact: old.opacity === next?.opacity, maxNeutralPositionDeltaPx: positionDeltaPx };
  });
  for (const item of report.drawableComparison) {
    if (values["refined-drawable"].includes(item.id)) {
      const refinement = inspectRefinement(a.drawables.find(d => d.id === item.id), b.drawables.find(d => d.id === item.id));
      item.deliberateRefinement = refinement;
      check(`deliberate subdivision preserves neutral textured surface: ${item.id}`, refinement.passed, refinement);
      continue;
    }
    check(`exact UV/indices/texture binding: ${item.id}`, item.vertexCountUnchanged && item.indicesExact && item.uvsExact && item.textureIndexUnchanged, item);
    check(`default-pose geometry and opacity preserved: ${item.id}`, item.neutralOpacityExact && item.maxNeutralPositionDeltaPx !== null && item.maxNeutralPositionDeltaPx <= 0.001, item);
  }
  check("no browser errors", report.pageErrors.length === 0);
  report.passed = report.checks.every(check => check.passed);
  report.status = report.passed ? (values["refined-drawable"].length ? "actual-core-neutral-surface-preserved-with-explicit-refinement-raster-review-pending" : "actual-core-neutral-uv-topology-preservation-passed") : "comparison-failed";
  if (!report.passed) process.exitCode = 2;
} catch (error) {
  report.status = "failed"; report.failure = String(error); process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(path.join(output, "neutral-core-comparison.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ status: report.status, failedChecks: report.checks.filter(check => !check.passed).map(check => check.name), failure: report.failure ?? null, output, productionApproval: false }));
