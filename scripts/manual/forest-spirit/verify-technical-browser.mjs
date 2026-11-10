/* global window, document */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Uses the already installed Playwright browser library, never a test runner/CI/download.
const require = createRequire(import.meta.url);
const playwrightRequire = createRequire(require.resolve("@playwright/test/package.json"));
const { chromium } = playwrightRequire("playwright");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { values } = parseArgs({ options: { url: { type: "string", default: "http://127.0.0.1:4189" }, out: { type: "string", default: "output/forest-spirit-runtime/technical-evidence" } } });
const origin = new URL(values.url);
assert.equal(origin.hostname, "127.0.0.1");
const output = path.resolve(repo, values.out);
assert.ok(output.startsWith(path.join(repo, "output") + path.sep));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1120, height: 880 }, reducedMotion: "no-preference" });
const pageErrors = [];
const resourceReads = [], resources = new Map();
page.on("pageerror", error => pageErrors.push(error.message));
page.on("response", response => {
  if (!response.url().startsWith(origin.origin + "/") || response.status() !== 200 || response.request().resourceType() === "document") return;
  resourceReads.push(response.body().then(bytes => resources.set(new URL(response.url()).pathname, { url: new URL(response.url()).pathname, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })));
});
const evidence = { scope: "Official unmodified Haru SDK sample only; NOT forest-spirit production character or authored Hover/DragHold/PutDown acceptance", browser: "Headless Chromium with explicit SwiftShader software WebGL; not a hardware performance benchmark", checks: [], pageErrors };
const check = (name, result) => { assert.ok(result, name); evidence.checks.push({ name, passed: true }); console.log(`PASS ${name}`); };
const snapshot = () => page.evaluate(() => window.tech.snapshot());
try {
  await page.route("**/*", route => route.request().url().startsWith(origin.origin + "/") ? route.continue() : route.abort());
  await page.goto(origin.href);
  await page.waitForFunction(() => window.tech?.ready || window.tech?.snapshot().errors.length, undefined, { timeout: 30000 });
  const initial = await snapshot();
  evidence.initial = initial;
  check("runtime finished loading without error", initial.ready && !initial.errors.length);
  await page.waitForTimeout(1200);
  const animated = await snapshot();
  evidence.animated = animated;
  check("real model, two textures, 84 drawables, zero WebGL error", animated.ready && animated.textureCount === 2 && animated.drawableCount === 84 && animated.glError === 0 && !animated.errors.length);
  check("authored motion changes real model parameters", Object.keys(animated.parameters).filter(id => animated.parameters[id] !== initial.parameters[id]).length > 3);
  check("real physics produces nonzero hair/scarf output", ["ParamHairFront", "ParamHairSide", "ParamScarf"].some(id => Math.abs(animated.parameters[id]) > 0.001));
  evidence.fadePolicy = await page.evaluate(() => Object.fromEntries([...window.tech.renderer.motions].map(([name, motion]) => [name, { loop: motion.getLoop(), fadeIn: motion.getFadeInTime(), fadeOut: motion.getFadeOutTime() }])));
  check("actual adapter configures only Idle loop and zero DragHold fades", Object.entries(evidence.fadePolicy).every(([name, config]) => config.loop === (name === "idle") && config.fadeIn === (name === "drag_hold" ? 0 : 0.12) && config.fadeOut === (name === "drag_hold" ? 0 : 0.12)));
  await page.evaluate(() => {
    const user = window.tech.renderer.user, model = user.getModel(), order = [], restores = [];
    for (const [object, key, label] of [[model, "loadParameters", "load"], [user._motionManager, "updateMotion", "motion"], [model, "saveParameters", "save"], [user._physics, "evaluate", "physics"]]) {
      const original = object[key];
      object[key] = function (...args) { order.push(label); return original.apply(this, args); };
      restores.push(() => { object[key] = original; });
    }
    window.tech.frameOrderProbe = { order, restore: () => restores.forEach(restore => restore()) };
  });
  await page.waitForTimeout(250);
  evidence.frameOrder = await page.evaluate(() => { const probe = window.tech.frameOrderProbe; probe.restore(); return probe.order; });
  check("unfinished actual RAF frames execute load -> motion -> save -> physics", evidence.frameOrder.length >= 4 && evidence.frameOrder.length % 4 === 0 && evidence.frameOrder.every((name, index) => name === ["load", "motion", "save", "physics"][index % 4]));
  await page.screenshot({ path: path.join(output, "official-haru-technical-only.png"), fullPage: true });
  await page.evaluate(() => window.tech.renderer.pause());
  const paused = await snapshot();
  await page.waitForTimeout(250);
  check("pause cancels RAF and freezes parameters", JSON.stringify((await snapshot()).parameters) === JSON.stringify(paused.parameters) && paused.raf === 0);
  await page.evaluate(() => window.tech.renderer.resume());
  await page.waitForTimeout(250);
  check("resume restarts real motion", (await snapshot()).lastFrame > 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  const reduced = await snapshot();
  check("dynamic reduced motion stops RAF", reduced.reduced && reduced.raf === 0);
  evidence.reducedNeutral = await page.evaluate(() => {
    const model = window.tech.renderer.user.getModel();
    return Array.from({ length: model.getParameterCount() }, (_, index) => ({ id: String(model.getParameterId(index).getString()), value: model.getParameterValueByIndex(index), expected: model.getParameterDefaultValue(index) }));
  });
  check("reduced motion restores actual exported parameter defaults", evidence.reducedNeutral.every(parameter => parameter.value === parameter.expected));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(250);
  const restored = await snapshot();
  check("leaving reduced motion restarts Idle", !restored.reduced && restored.current === "idle" && restored.raf > 0 && restored.lastFrame > 0);
  await page.evaluate(() => window.tech.renderer.play("hover_greet", { interrupt: true }));
  check("hover channel completion returns to Idle (original Haru m15)", (await snapshot()).current === "idle");
  await page.evaluate(() => window.tech.renderer.play("drag_hold", { interrupt: true }));
  const held = await snapshot();
  await page.evaluate(() => {
    const renderer = window.tech.renderer, model = renderer.user.getModel(), original = model.loadParameters;
    window.tech.heldProbe = { loads: 0, positions: Array.from({ length: model.getDrawableCount() }, (_, i) => Array.from(model.getDrawableVertexPositions(i))), restore: () => { model.loadParameters = original; } };
    model.loadParameters = function () { window.tech.heldProbe.loads++; return original.call(this); };
    renderer.resume();
  });
  await page.waitForTimeout(250);
  check("drag channel completion holds final frame (original Haru m26)", held.raf === 0 && JSON.stringify((await snapshot()).parameters) === JSON.stringify(held.parameters));
  evidence.holdAfterFinished = await page.evaluate(() => {
    const probe = window.tech.heldProbe, model = window.tech.renderer.user.getModel();
    const unchangedVertices = JSON.stringify(probe.positions) === JSON.stringify(Array.from({ length: model.getDrawableCount() }, (_, i) => Array.from(model.getDrawableVertexPositions(i))));
    probe.restore(); return { loads: probe.loads, unchangedVertices, raf: window.tech.renderer.raf };
  });
  check("finished DragHold does not load/reset or advance its real vertices", evidence.holdAfterFinished.loads === 0 && evidence.holdAfterFinished.unchangedVertices && evidence.holdAfterFinished.raf === 0);
  await page.evaluate(() => window.tech.renderer.play("put_down", { interrupt: true }));
  check("put-down channel completion returns to Idle (original Haru m06)", (await snapshot()).current === "idle");
  await page.evaluate(() => window.tech.renderer.play("drag_hold", { interrupt: true, reducedMotion: true }));
  check("explicit reduced-motion gesture stays neutral and never schedules a hold animation", await page.evaluate(() => {
    const renderer = window.tech.renderer, model = renderer.user.getModel();
    return renderer.reduced && renderer.raf === 0 && Array.from({ length: model.getParameterCount() }, (_, index) => model.getParameterValueByIndex(index) === model.getParameterDefaultValue(index)).every(Boolean);
  }));
  await page.evaluate(() => window.tech.renderer.play("idle", { interrupt: true, reducedMotion: false }));
  evidence.resourceRejection = await page.evaluate(async () => {
    const renderer = window.tech.createCubismRenderer(document.createElement("canvas"));
    try { await renderer.load({ ...window.tech.asset, model3Url: "/sprout/SproutProof.model3.json" }, new AbortController().signal); return "UNEXPECTED_ACCEPTANCE"; }
    catch (error) { return String(error); } finally { renderer.dispose(); }
  });
  check("old SproutProof rejected by strict package gate", /physics3/.test(evidence.resourceRejection));
  evidence.abort = await page.evaluate(async () => {
    const renderer = window.tech.createCubismRenderer(document.createElement("canvas"));
    const controller = new AbortController();
    const loading = renderer.load(window.tech.asset, controller.signal); controller.abort();
    try { await loading; return "UNEXPECTED_ACCEPTANCE"; }
    catch (error) { return error.name; } finally { renderer.dispose(); renderer.dispose(); }
  });
  check("aborted resource load settles cleanly", evidence.abort === "AbortError");
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); document.body.append(canvas);
    const other = window.tech.createCubismRenderer(canvas); other.resize(240, 320, 1);
    await other.load(window.tech.asset, new AbortController().signal); other.resume(); await other.play("idle");
    window.tech.other = other; window.tech.renderer.dispose();
  });
  await page.waitForTimeout(250);
  const other = await page.evaluate(() => ({ ready: window.tech.other.ready, raf: window.tech.other.raf, glError: window.tech.other.gl.getError(), drawableCount: window.tech.other.user.getModel().getDrawableCount() }));
  check("disposing first instance preserves second official model and shared Framework", other.ready && other.raf > 0 && other.glError === 0 && other.drawableCount === 84);
  await page.evaluate(() => {
    window.tech.contextError = null;
    window.tech.other.canvas.addEventListener("forest-spirit-error", event => { window.tech.contextError = event.detail; });
    window.tech.other.gl.getExtension("WEBGL_lose_context").loseContext();
  });
  await page.waitForFunction(() => Boolean(window.tech.contextError));
  check("context loss disposes renderer and reports fallback event", await page.evaluate(() => window.tech.other.disposed && window.tech.other.raf === 0 && /context/.test(window.tech.contextError)));
  check("no uncaught page errors", pageErrors.length === 0);
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed"; evidence.failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  const reads = await Promise.allSettled(resourceReads);
  evidence.resources = [...resources.values()];
  evidence.resourceHashErrors = reads.filter(result => result.status === "rejected").map(result => String(result.reason));
  if (evidence.resourceHashErrors.length) { evidence.status = "resource-evidence-failed"; process.exitCode = 1; }
  await writeFile(path.join(output, "technical-browser.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  await browser.close();
}
