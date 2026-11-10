import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resolveDrawableContract } from "./drawable-source-contract.mjs";
import { validateDynamicFrontOrder } from "./front-dynamic-order-contract.mjs";
import { validateOcclusionComposition, validateStorageOrderRepair } from "./occlusion-composition-contract.mjs";

// Actual official Core against the separately audited native sampling mesh and atlas.
// Atlas/source changes are expected for b12; compare to their explicit native result,
// never weaken the historical exact r7/r8 package comparison or any image quality gate.
const { values } = parseArgs({ options: { model: { type: "string" }, geometry: { type: "string" }, baseline: { type: "string" }, out: { type: "string" }, "verify-masks": { type: "boolean", default: false }, "drawable-map": { type: "string" }, "source-metadata": { type: "string" }, "front-order-plan": { type: "string" }, "front-order-plan-sha256": { type: "string" }, "front-dynamic-order-plan": { type: "string" }, "front-dynamic-order-plan-sha256": { type: "string" }, "occlusion-plan": { type: "string" }, "occlusion-plan-sha256": { type: "string" }, "order-baseline-audit": { type: "string" }, core: { type: "string", default: "output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5/Core/live2dcubismcore.min.js" } } });
assert.ok(values.model && values.geometry && values.baseline && values.out);
assert.equal(Boolean(values["front-order-plan"]), Boolean(values["front-order-plan-sha256"]), "The explicit Front order plan and its frozen SHA-256 must be supplied together");
assert.equal(Boolean(values["front-dynamic-order-plan"]), Boolean(values["front-dynamic-order-plan-sha256"]), "Dynamic Front plan and SHA-256 are required together");
assert.equal(Boolean(values["occlusion-plan"]), Boolean(values["occlusion-plan-sha256"]), "Occlusion composition plan and SHA-256 are required together");
assert.equal(Boolean(values["front-dynamic-order-plan"] || values["occlusion-plan"]), Boolean(values["order-baseline-audit"]), "Dynamic Front or composition contracts require the frozen actual baseline Core audit");
assert.ok(["front-order-plan", "front-dynamic-order-plan", "occlusion-plan"].filter(key => values[key]).length <= 1, "Constant, dynamic Front, and occlusion composition contracts are mutually exclusive");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(repo, values.out), outputRoot = await realpath(path.join(repo, "output"));
assert.ok(output.startsWith(outputRoot + path.sep));
await mkdir(output);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const modelPath = await realpath(path.resolve(repo, values.model)), modelBytes = await readFile(modelPath), config = JSON.parse(modelBytes);
async function resource(relative) {
  assert.ok(typeof relative === "string" && !path.isAbsolute(relative) && !relative.includes(":"));
  const file = await realpath(path.resolve(path.dirname(modelPath), relative));
  assert.ok(file.startsWith(path.dirname(modelPath) + path.sep));
  const bytes = await readFile(file); return { file, bytes, sha256: sha(bytes) };
}
const moc = await resource(config.FileReferences.Moc), textures = await Promise.all(config.FileReferences.Textures.map(resource));
const geometryPath = await realpath(path.resolve(repo, values.geometry)), geometryBytes = await readFile(geometryPath), geometry = JSON.parse(geometryBytes);
const baselinePath = await realpath(path.resolve(repo, values.baseline)), baselineBytes = await readFile(baselinePath), baseline = JSON.parse(baselineBytes).candidate.snapshot;
const nativeBytes = await readFile(geometry.source); assert.equal(sha(nativeBytes), geometry.sourceSha256);
const contractInputs = [];
let contract = null;
let frontOrderPlan = null;
let dynamicOrder = null, occlusionComposition = null, orderBaselineMocBytes = null;
let frontNeighbors = { previous: "Hair_BraidTie", next: "Hair_Bangs_Center" };
if (values["front-order-plan"]) {
  assert.ok(values["drawable-map"] && values["verify-masks"], "The Front order experiment requires the explicit split-source and mask audit");
  assert.match(values["front-order-plan-sha256"], /^[a-f0-9]{64}$/u);
  const file = await realpath(path.resolve(repo, values["front-order-plan"]));
  const bytes = await readFile(file), fingerprint = sha(bytes), plan = JSON.parse(bytes);
  assert.equal(fingerprint, values["front-order-plan-sha256"], "Front order plan differs from the caller's frozen evidence");
  assert.equal(plan.drawableId, "Arm_R_Upper_Front");
  assert.equal(plan.retainedConstantDrawOrder, 500);
  assert.equal(plan.originalRuntimePreviousId, "Hair_BraidTie");
  assert.equal(plan.originalRuntimeNextId, "Hair_Bangs_Center");
  assert.equal(plan.targetRuntimePreviousId, "Hair_Side_R");
  assert.equal(plan.targetRuntimeNextId, "Hair_Side_L");
  assert.equal(plan.noDynamicDrawOrderKey, true);
  assert.equal(plan.productionApproval, false);
  frontNeighbors = { previous: plan.targetRuntimePreviousId, next: plan.targetRuntimeNextId };
  frontOrderPlan = { path: file, sha256: fingerprint, expectedConstantDrawOrder: 500, expectedNeighbors: frontNeighbors, productionApproval: false };
  contractInputs.push([file, fingerprint]);
}
if (values["front-dynamic-order-plan"]) {
  assert.ok(values["drawable-map"] && values["verify-masks"]);
  assert.match(values["front-dynamic-order-plan-sha256"], /^[a-f0-9]{64}$/u);
  const file = await realpath(path.resolve(repo, values["front-dynamic-order-plan"]));
  const bytes = await readFile(file), fingerprint = sha(bytes), plan = JSON.parse(bytes);
  assert.equal(fingerprint, values["front-dynamic-order-plan-sha256"]);
  const auditPath = await realpath(path.resolve(repo, values["order-baseline-audit"])), auditBytes = await readFile(auditPath), audit = JSON.parse(auditBytes);
  dynamicOrder = validateDynamicFrontOrder(plan, geometry, audit);
  orderBaselineMocBytes = await readFile(dynamicOrder.baselineMoc.path);
  assert.equal(sha(orderBaselineMocBytes), dynamicOrder.baselineMoc.sha256);
  assert.equal(sha(await readFile(dynamicOrder.baselineModel.path)), dynamicOrder.baselineModel.sha256);
  frontNeighbors = { previous: "Arm_R_Lower", next: null };
  frontOrderPlan = { path: file, sha256: fingerprint, mode: "explicit-native19-integral-dynamic-order", baselineAudit: { path: auditPath, sha256: sha(auditBytes) }, expectedNeutralPrevious: "Arm_R_Lower", keys: dynamicOrder.keys, orders: dynamicOrder.orders, productionApproval: false };
  contractInputs.push([file, fingerprint], [auditPath, sha(auditBytes)], [dynamicOrder.baselineMoc.path, dynamicOrder.baselineMoc.sha256], [dynamicOrder.baselineModel.path, dynamicOrder.baselineModel.sha256]);
  const validatorPath = fileURLToPath(new URL("./front-dynamic-order-contract.mjs", import.meta.url)), validatorSha256 = sha(await readFile(validatorPath));
  frontOrderPlan.validator = { path: validatorPath, sha256: validatorSha256 };
  contractInputs.push([validatorPath, validatorSha256]);
}
if (values["occlusion-plan"]) {
  assert.ok(values["drawable-map"] && values["verify-masks"]);
  assert.match(values["occlusion-plan-sha256"], /^[a-f0-9]{64}$/u);
  const file = await realpath(path.resolve(repo, values["occlusion-plan"]));
  const bytes = await readFile(file), fingerprint = sha(bytes), plan = JSON.parse(bytes);
  assert.equal(fingerprint, values["occlusion-plan-sha256"]);
  const oldGeometryPath = await realpath(plan.sourceGeometryPath), oldGeometryBytes = await readFile(oldGeometryPath);
  assert.equal(sha(oldGeometryBytes), plan.sourceGeometrySha256);
  const auditPath = await realpath(path.resolve(repo, values["order-baseline-audit"])), auditBytes = await readFile(auditPath), audit = JSON.parse(auditBytes);
  occlusionComposition = validateOcclusionComposition(plan, geometry, JSON.parse(oldGeometryBytes), audit);
  if (plan.storageRepair) {
    const repair = plan.storageRepair;
    const failedGeometryPath = await realpath(repair.sourceGeometryPath), failedGeometryBytes = await readFile(failedGeometryPath);
    assert.equal(sha(failedGeometryBytes), repair.sourceGeometrySha256);
    assert.equal(sha(await readFile(repair.sourceCmoPath)), repair.sourceCmoSha256);
    occlusionComposition.storageRepair = validateStorageOrderRepair(repair, geometry, JSON.parse(failedGeometryBytes));
    contractInputs.push([failedGeometryPath, repair.sourceGeometrySha256], [repair.sourceCmoPath, repair.sourceCmoSha256]);
  }
  orderBaselineMocBytes = await readFile(occlusionComposition.baselineMoc.path);
  assert.equal(sha(orderBaselineMocBytes), occlusionComposition.baselineMoc.sha256);
  assert.equal(sha(await readFile(occlusionComposition.baselineModel.path)), occlusionComposition.baselineModel.sha256);
  assert.equal(sha(await readFile(plan.sourceCmoPath)), plan.sourceCmoSha256);
  assert.equal(sha(await readFile(plan.elbowPlanPath)), plan.elbowPlanSha256);
  const validatorPath = fileURLToPath(new URL("./occlusion-composition-contract.mjs", import.meta.url)), validatorSha256 = sha(await readFile(validatorPath));
  frontOrderPlan = { path: file, sha256: fingerprint, mode: "explicit-visible-cape-fixed-order-composition", baselineAudit: { path: auditPath, sha256: sha(auditBytes) }, orders: occlusionComposition.orders, expectedPaintOrder: occlusionComposition.expectedPaintOrder, validator: { path: validatorPath, sha256: validatorSha256 }, productionApproval: false };
  if (occlusionComposition.storageRepair) frontOrderPlan.storageRepair = occlusionComposition.storageRepair;
  contractInputs.push([file, fingerprint], [oldGeometryPath, plan.sourceGeometrySha256], [auditPath, sha(auditBytes)], [occlusionComposition.baselineMoc.path, occlusionComposition.baselineMoc.sha256], [occlusionComposition.baselineModel.path, occlusionComposition.baselineModel.sha256], [plan.sourceCmoPath, plan.sourceCmoSha256], [plan.elbowPlanPath, plan.elbowPlanSha256], [validatorPath, validatorSha256]);
}
if (values["drawable-map"]) {
  assert.ok(values["source-metadata"] && values["verify-masks"], "A split model requires frozen source metadata and actual mask checks");
  const declarationPath = await realpath(path.resolve(repo, values["drawable-map"]));
  const metadataPath = await realpath(path.resolve(repo, values["source-metadata"]));
  const declarationBytes = await readFile(declarationPath), metadataBytes = await readFile(metadataPath);
  const declaration = JSON.parse(declarationBytes), metadata = JSON.parse(metadataBytes);
  const specification = JSON.parse(await readFile(path.join(repo, "doc/design/forest-spirit/production/front-v8/layers.json")));
  contract = resolveDrawableContract(specification, declaration);
  assert.equal(declaration.sourceMetadataSha256, sha(metadataBytes));
  assert.deepEqual(metadata.layers.map(layer => layer.id).sort(), contract.sourceIds);
  assert.equal(geometry.sourceMetadataSha256, sha(metadataBytes));
  assert.equal(geometry.drawableDeclarationSha256, sha(declarationBytes));
  assert.deepEqual(geometry.drawables.map(drawable => drawable.id).sort(), contract.drawableIds);
  for (const [source, drawables] of Object.entries(contract.sourceToDrawables)) for (const id of drawables) {
    const native = geometry.drawables.find(d => d.id === id), original = geometry.drawables.find(d => d.id === source);
    assert.equal(native.sourceLayerId, source); assert.equal(native.sourceTileId, original.sourceTileId);
  }
  contractInputs.push([declarationPath, sha(declarationBytes)], [metadataPath, sha(metadataBytes)]);
}
const corePath = await realpath(path.resolve(repo, values.core)), coreBytes = await readFile(corePath);
const require = createRequire(import.meta.url), { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
const report = { scope: "Actual official Core at exported defaults vs independently audited native canvas sampling and explicit rebuilt atlas; no visual/motion acceptance", productionApproval: false, inputs: { model: { path: modelPath, sha256: sha(modelBytes) }, moc: { path: moc.file, sha256: moc.sha256 }, nativeGeometry: { path: geometryPath, sha256: sha(geometryBytes), nativeCmoSha256: geometry.sourceSha256 }, baseline: { path: baselinePath, sha256: sha(baselineBytes) }, core: { path: corePath, sha256: sha(coreBytes) }, textures: textures.map(t => ({ path: t.file, sha256: t.sha256, bytes: t.bytes.length })) }, checks: [], pageErrors: [] };
if (frontOrderPlan) report.inputs.frontOrderPlan = frontOrderPlan;
const check = (name, passed, detail) => report.checks.push({ name, passed: Boolean(passed), detail });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); page.on("pageerror", error => report.pageErrors.push(error.message));
  await page.route("**/*", route => route.abort()); await page.addScriptTag({ content: coreBytes.toString("utf8") });
  await page.waitForFunction(() => { try { return globalThis.Live2DCubismCore?.Version?.csmGetVersion() > 0; } catch { return false; } });
  const snapshot = await page.evaluate(input => {
    const bytes = input.bytes;
    const Core = globalThis.Live2DCubismCore, data = Uint8Array.from(bytes).buffer, moc = Core.Moc.fromArrayBuffer(data);
    if (!moc || moc.hasMocConsistency(data) !== 1) throw new Error("Actual MOC consistency failed");
    let model;
    try {
      model = Core.Model.fromMoc(moc); if (!model) throw new Error("Actual Core model rejected");
      model.parameters.values.set(model.parameters.defaultValues); model.update();
      const neutral = { coreVersion: Core.Version.csmGetVersion(), consistency: 1, canvas: { width: model.canvasinfo.CanvasWidth, height: model.canvasinfo.CanvasHeight, pixelsPerUnit: model.canvasinfo.PixelsPerUnit, originX: model.canvasinfo.CanvasOriginX, originY: model.canvasinfo.CanvasOriginY }, parameters: model.parameters.ids.map((id, i) => ({ id, min: model.parameters.minimumValues[i], max: model.parameters.maximumValues[i], default: model.parameters.defaultValues[i] })), drawables: model.drawables.ids.map((id, i) => ({ id, opacity: model.drawables.opacities[i], textureIndex: model.drawables.textureIndices[i], positions: Array.from(model.drawables.vertexPositions[i]), uvs: Array.from(model.drawables.vertexUvs[i]), indices: Array.from(model.drawables.indices[i]), maskIds: Array.from(model.drawables.masks[i], index => model.drawables.ids[index]), invertMask: Core.Utils.hasIsInvertedMaskBit(model.drawables.constantFlags[i]), drawOrder: model.drawables.drawOrders[i], renderOrder: model.getRenderOrders()[i] })) };
      if (input.orderKeys) {
        const previousData = Uint8Array.from(input.baselineBytes).buffer, previousMoc = Core.Moc.fromArrayBuffer(previousData);
        if (!previousMoc || previousMoc.hasMocConsistency(previousData) !== 1) throw new Error("Order baseline MOC consistency failed");
        let previous;
        try {
          previous = Core.Model.fromMoc(previousMoc); if (!previous) throw new Error("Order baseline model failed");
          const readOrder = target => target.drawables.ids.map((id, i) => ({ id, drawOrder: target.drawables.drawOrders[i], renderOrder: target.getRenderOrders()[i] }));
          neutral.dynamicOrderSamples = [];
          if (input.composition) neutral.occlusionOrderSamples = [];
          for (const z of [-30, 0, 30]) for (const h of input.orderKeys) {
            for (const target of [model, previous]) {
              target.parameters.values.set(target.parameters.defaultValues);
              target.parameters.values[target.parameters.ids.indexOf("ParamFSHatTouch")] = h;
              target.parameters.values[target.parameters.ids.indexOf("ParamAngleZ")] = z;
              target.update();
            }
            const current = readOrder(model), old = readOrder(previous), front = current.find(d => d.id === "Arm_R_Upper_Front"), lower = current.find(d => d.id === "Arm_R_Lower");
            if (input.composition) {
              const assignments = input.composition.orders;
              const untouched = rows => rows.filter(d => !(d.id in assignments));
              const orderedIds = rows => [...rows].sort((a, b) => a.renderOrder - b.renderOrder).map(d => d.id);
              const wrongAssignments = current.filter(d => d.id in assignments && d.drawOrder !== assignments[d.id]);
              const changedOtherOrders = untouched(current).filter(d => d.drawOrder !== old.find(p => p.id === d.id)?.drawOrder);
              const actualPaintOrder = orderedIds(current);
              const exactPaintOrder = JSON.stringify(actualPaintOrder) === JSON.stringify(input.composition.expectedPaintOrder);
              neutral.occlusionOrderSamples.push({ h, z, assignedDrawables: current.filter(d => d.id in assignments), fixed12OrdersMatch: wrongAssignments.length === 0, other61RawOrdersUnchanged: untouched(current).length === 61 && changedOtherOrders.length === 0, other61RelativeOrderUnchanged: JSON.stringify(orderedIds(untouched(current))) === JSON.stringify(orderedIds(untouched(old))), exactPaintOrder, ...(wrongAssignments.length ? { wrongAssignments } : {}), ...(changedOtherOrders.length ? { changedOtherOrders } : {}), ...(!exactPaintOrder ? { actualPaintOrder } : {}) });
              continue;
            }
            const other = rows => rows.filter(d => d.id !== "Arm_R_Upper_Front");
            const ranks = rows => other(rows).sort((a, b) => a.renderOrder - b.renderOrder).map(d => d.id);
            const frontVertices = model.drawables.vertexPositions[model.drawables.ids.indexOf("Arm_R_Upper_Front")], oldFrontVertices = previous.drawables.vertexPositions[previous.drawables.ids.indexOf("Arm_R_Upper_Front")];
            if (frontVertices.length !== oldFrontVertices.length) throw new Error("Front vertex inventory changed during order-only refinement");
            let maximumFrontDisplacementPx = 0;
            for (let i = 0; i < frontVertices.length; i += 2) maximumFrontDisplacementPx = Math.max(maximumFrontDisplacementPx, Math.hypot(frontVertices[i] - oldFrontVertices[i], frontVertices[i + 1] - oldFrontVertices[i + 1]) * 971);
            const nearAddedKey = Math.min(Math.abs(h - .45), Math.abs(h - .55)) <= .00100001;
            neutral.dynamicOrderSamples.push({ h, z, frontDrawOrder: front.drawOrder, lowerDrawOrder: lower.drawOrder, frontRenderOrder: front.renderOrder, lowerRenderOrder: lower.renderOrder, frontAfterLower: front.renderOrder > lower.renderOrder && front.drawOrder >= lower.drawOrder, frontDirectlyAfterLower: front.renderOrder === lower.renderOrder + 1, interveningDrawableIds: current.filter(d => d.renderOrder > lower.renderOrder && d.renderOrder < front.renderOrder).sort((a, b) => a.renderOrder - b.renderOrder).map(d => d.id), other72RawOrdersUnchanged: other(current).every(d => d.drawOrder === old.find(p => p.id === d.id)?.drawOrder), other72RelativeOrderUnchanged: JSON.stringify(ranks(current)) === JSON.stringify(ranks(old)), maximumFrontDisplacementPx, nearAddedKey, ...(nearAddedKey ? { frontCoreVertices: Array.from(frontVertices), baselineFrontCoreVertices: Array.from(oldFrontVertices) } : {}) });
          }
        } finally { try { previous?.release(); } finally { previousMoc._release(); } }
      }
      return neutral;
    } finally { try { model?.release(); } finally { moc._release(); } }
  }, { bytes: Array.from(moc.bytes), baselineBytes: orderBaselineMocBytes ? Array.from(orderBaselineMocBytes) : null, orderKeys: dynamicOrder?.sampleKeys ?? occlusionComposition?.sampleKeys ?? null, composition: occlusionComposition ? { orders: occlusionComposition.orders, expectedPaintOrder: occlusionComposition.expectedPaintOrder } : null });
  report.snapshot = snapshot;
  check("actual model passes official consistency", snapshot.consistency === 1);
  check("fixed971x1620 origin and PPU", JSON.stringify(snapshot.canvas) === JSON.stringify(baseline.canvas) && snapshot.canvas.width === 971 && snapshot.canvas.height === 1620 && snapshot.canvas.pixelsPerUnit === 971);
  check("seventeen parameter definitions and defaults identical", snapshot.parameters.length === 17 && JSON.stringify(snapshot.parameters) === JSON.stringify(baseline.parameters));
  if (contract) {
    check("73 actual meshes from explicit72-source declaration", JSON.stringify(snapshot.drawables.map(d => d.id).sort()) === JSON.stringify(contract.drawableIds));
    check("all original72 IDs retain relative runtime indexing", JSON.stringify(snapshot.drawables.filter(d => d.id !== "Arm_R_Upper_Front").map(d => d.id)) === JSON.stringify(baseline.drawables.map(d => d.id)));
    const back = snapshot.drawables.find(d => d.id === "Arm_R_Upper"), front = snapshot.drawables.find(d => d.id === "Arm_R_Upper_Front");
    check("actual split uses same texture page and UV array", back && front && back.textureIndex === front.textureIndex && JSON.stringify(back.uvs) === JSON.stringify(front.uvs));
    const previous = snapshot.drawables.find(d => d.id === frontNeighbors.previous), next = snapshot.drawables.find(d => d.id === frontNeighbors.next);
    if (occlusionComposition) {
      const neutralPaint = [...snapshot.drawables].sort((a, b) => a.renderOrder - b.renderOrder).map(d => d.id);
      check("actual neutral follows frozen fixed12 order and visible-Cape composition", JSON.stringify(neutralPaint) === JSON.stringify(occlusionComposition.expectedPaintOrder) && Object.entries(occlusionComposition.orders).every(([id, value]) => snapshot.drawables.find(d => d.id === id)?.drawOrder === value), { actualPaintOrder: neutralPaint, explicitFrozenOrderPlan: frontOrderPlan });
      const samples = snapshot.occlusionOrderSamples ?? [];
      const passed = row => row.fixed12OrdersMatch && row.other61RawOrdersUnchanged && row.other61RelativeOrderUnchanged && row.exactPaintOrder;
      check("actual Core fixed composition remains stable across Hat and three head axes", samples.length === occlusionComposition.sampleKeys.length * 3 && samples.every(passed), { sampleCount: samples.length, failed: samples.filter(row => !passed(row)), interpretation: "Actual Core integer drawOrder and render rank are measured directly. Twelve explicitly approved assignments are constant; the other61 raw orders and relative order are compared to frozen r17. Local elbow and negative-head geometry changes are checked against the explicit native target plan, not the old order-only geometry invariant. No visual approval." });
    } else if (dynamicOrder) {
      check("actual neutral Front500 lies directly after Lower500", front && previous && front.drawOrder === 500 && previous.drawOrder === 500 && front.renderOrder === previous.renderOrder + 1, { frontRenderOrder: front?.renderOrder, lowerRenderOrder: previous?.renderOrder, explicitFrozenOrderPlan: frontOrderPlan });
      const samples = snapshot.dynamicOrderSamples ?? [];
      check("actual Core dynamic Front19 stays after Lower and preserves all other72 orders", samples.length === dynamicOrder.sampleKeys.length * 3 && samples.every(s => s.frontAfterLower && s.other72RawOrdersUnchanged && s.other72RelativeOrderUnchanged), { sampleCount: samples.length, failed: samples.filter(s => !s.frontAfterLower || !s.other72RawOrdersUnchanged || !s.other72RelativeOrderUnchanged), nonAdjacentSamples: samples.filter(s => !s.frontDirectlyAfterLower).map(({ h, z, frontDrawOrder, lowerDrawOrder, interveningDrawableIds }) => ({ h, z, frontDrawOrder, lowerDrawOrder, interveningDrawableIds })), interpretation: "Core integral drawOrder and actual rank compared against frozen r16 at the same Hat/head. Legal integer quantization may place intervening original layers between Front and Lower; adjacency is reported for visual inspection, not invented as a release gate. No assumed native-float rounding rule." });
      check("actual Front geometry remains within.001px outside explicit new-key inspection windows", samples.every(s => s.nearAddedKey || s.maximumFrontDisplacementPx <= .001), { maximumOutsideWindowPx: Math.max(...samples.filter(s => !s.nearAddedKey).map(s => s.maximumFrontDisplacementPx)), maximumInsideWindowPx: Math.max(...samples.filter(s => s.nearAddedKey).map(s => s.maximumFrontDisplacementPx)), interpretation: "Only h within.001 of new.45/.55 is separated for official-Core snap investigation; these measured values are not declared visual acceptance, and Umamo CPU EPS is not assumed to be Core behavior" });
    } else check(`actual neutral Front stable tie lies directly after ${frontNeighbors.previous} before ${frontNeighbors.next}`, front && previous && next && front.drawOrder === 500 && front.renderOrder === previous.renderOrder + 1 && front.renderOrder === next.renderOrder - 1, { frontRenderOrder: front?.renderOrder, frontDrawOrder: front?.drawOrder, previousId: frontNeighbors.previous, previousRenderOrder: previous?.renderOrder, nextId: frontNeighbors.next, nextRenderOrder: next?.renderOrder, explicitFrozenOrderPlan: frontOrderPlan });
  } else check("all72 IDs and runtime ordering retained", snapshot.drawables.length === 72 && JSON.stringify(snapshot.drawables.map(d => d.id)) === JSON.stringify(baseline.drawables.map(d => d.id)));
  check("two actual2048 PNG textures", textures.length === 2 && textures.every(t => t.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && t.bytes.readUInt32BE(16) === 2048 && t.bytes.readUInt32BE(20) === 2048));
  report.drawableChecks = snapshot.drawables.map(d => {
    const source = geometry.drawables.find(s => s.id === d.id), priorId = contract && d.id === "Arm_R_Upper_Front" ? "Arm_R_Upper" : d.id, prior = baseline.drawables.find(s => s.id === priorId);
    assert.ok(source && prior);
    let worldError = 0, uvError = 0;
    const sameSize = source.positions.length === d.positions.length && source.uvs.length === d.uvs.length;
    if (sameSize) for (let i = 0; i < source.positions.length; i += 2) {
      worldError = Math.max(worldError, Math.abs(d.positions[i] * 971 + 485.5 - source.positions[i]), Math.abs(810 - d.positions[i + 1] * 971 - source.positions[i + 1]));
      // Actual Core flips V relative to native image sampling. This fixed convention was
      // independently verified against the unchanged actual r7/r8 package.
      uvError = Math.max(uvError, Math.abs(d.uvs[i] - source.uvs[i]), Math.abs(d.uvs[i + 1] - (1 - source.uvs[i + 1])));
    }
    assert.equal(source.indices.length % 3, 0);
    // Editor reverses each ordered triangle when converting image-Y-down to Core-Y-up.
    // All 3,432 triangles of the actual unchanged r8 control prove this exact convention.
    // Keep triangle order and every vertex index strict; no set/area equivalence fallback.
    const coreOrderedIndices = [];
    for (let i = 0; i < source.indices.length; i += 3) coreOrderedIndices.push(source.indices[i + 2], source.indices[i + 1], source.indices[i]);
    const row = { id: d.id, vertexCount: d.positions.length / 2, maxNeutralSourceErrorPx: worldError, maxNativeUvError: uvError, exactIndicesAfterFixedCoordinateWinding: JSON.stringify(d.indices) === JSON.stringify(coreOrderedIndices), texturePageMatches: d.textureIndex === source.placement.page, opacityPreserved: d.opacity === prior.opacity, sameVertexCount: sameSize };
    check(`${d.id} actual neutral world matches source sampling`, sameSize && Number.isFinite(worldError) && worldError <= .001, row);
    check(`${d.id} actual UV page topology match audited native`, sameSize && Number.isFinite(uvError) && uvError <= .000001 && row.exactIndicesAfterFixedCoordinateWinding && row.texturePageMatches, row);
    check(`${d.id} effective neutral opacity retained`, row.opacityPreserved, row);
    if (values["verify-masks"]) check(`${d.id} exact actual mask IDs and inversion match native`, Array.isArray(source.maskIds) && typeof source.invertMask === "boolean" && JSON.stringify(d.maskIds) === JSON.stringify(source.maskIds) && d.invertMask === source.invertMask, { actualMaskIds: d.maskIds, nativeMaskIds: source.maskIds, actualInvertMask: d.invertMask, nativeInvertMask: source.invertMask });
    return row;
  });
  check("no browser errors", report.pageErrors.length === 0);
  const frozenInputs = [
    [modelPath, sha(modelBytes)], [moc.file, moc.sha256],
    ...textures.map(t => [t.file, t.sha256]), [geometry.source, geometry.sourceSha256],
    [geometryPath, sha(geometryBytes)], [baselinePath, sha(baselineBytes)], [corePath, sha(coreBytes)], ...contractInputs,
  ];
  const frozenChecks = await Promise.all(frozenInputs.map(async ([file, expected]) => ({ path: file, expectedSha256: expected, actualSha256: sha(await readFile(file)) })));
  check("all native model texture baseline and Core inputs remain frozen", frozenChecks.every(row => row.expectedSha256 === row.actualSha256), frozenChecks);
  report.passed = report.checks.every(c => c.passed); report.status = report.passed ? "actual-core-native-sampling-neutral-checks-passed-visual-review-required" : "actual-core-native-checks-failed";
  if (!report.passed) process.exitCode = 2;
} catch (error) { report.passed = false; report.status = "failed"; report.error = String(error); process.exitCode = 1; }
finally {
  try { await browser?.close(); }
  catch (error) { report.cleanupError = String(error); report.passed = false; report.status = "cleanup-failed"; process.exitCode = 1; }
  await writeFile(path.join(output, "actual-core-native-audit.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failed: report.checks.filter(c => !c.passed).map(c => c.name), error: report.error ?? null, output, productionApproval: false }));
