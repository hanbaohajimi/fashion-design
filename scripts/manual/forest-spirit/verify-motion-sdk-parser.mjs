import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// Actual official SDK parsing, not a JSON-schema substitute or a model test.
const { values } = parseArgs({ options: { motions: { type: "string" }, out: { type: "string" }, sdk: { type: "string", default: "output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5" } } });
assert.ok(values.motions && values.out, "Pass --motions <new draft directory> --out <unused output directory>");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(repo, values.out), motions = await realpath(path.resolve(repo, values.motions));
assert.ok(output.startsWith(path.join(repo, "output") + path.sep));
await mkdir(output, { recursive: true });
assert.ok((await realpath(output)).startsWith((await realpath(path.join(repo, "output"))) + path.sep));
const sdk = await realpath(path.resolve(repo, values.sdk));
assert.match(await readFile(path.join(sdk, "cubism-info.yml"), "utf8"), /^version: 5-r\.5\s*$/mu);
const manifest = JSON.parse(await readFile(path.join(motions, "motion-drafts.manifest.json"), "utf8"));
const require = createRequire(import.meta.url);
let vitePath;
for (const directory of ["apps/web", "output/live2d-proof-20261105"]) {
  try { vitePath = createRequire(path.join(repo, directory, "package.json")).resolve("vite"); break; } catch { /* Only use an existing local toolchain. */ }
}
assert.ok(vitePath, "An existing local Vite toolchain is required; nothing is installed implicitly");
const { build } = await import(pathToFileURL(vitePath).href);
const entry = path.join(output, "official-sdk-probe.ts");
await writeFile(entry, `
import { CubismFramework } from "@cubism/live2dcubismframework";
import { CubismMotion } from "@cubism/motion/cubismmotion";
import { CubismMotionJson } from "@cubism/motion/cubismmotionjson";
import "@cubism/rendering/cubismrenderer_webgl"; // Official static-release registration used by Framework.dispose.
export function initialize() { CubismFramework.startUp(); CubismFramework.initialize(); }
export function dispose() { CubismFramework.dispose(); CubismFramework.cleanUp(); }
export function inspect(text: string) {
  const buffer = new TextEncoder().encode(text).buffer;
  const json = new CubismMotionJson(buffer, buffer.byteLength);
  let motion;
  try {
    const consistent = json.hasConsistency();
    if (!consistent) return { consistent };
    motion = CubismMotion.create(buffer, buffer.byteLength, undefined, undefined, true);
    if (!motion) throw new Error("Official SDK rejected a consistent motion");
    const ids = Array.from({ length: json.getMotionCurveCount() }, (_, i) => String(json.getMotionCurveId(i).getString()));
    const loopFromMeta = json.isMotionLoop();
    const loopBeforeExplicitConfiguration = motion.getLoop();
    motion.setLoop(loopFromMeta); // SDK requires the application to apply loop policy.
    return { consistent, duration: json.getMotionDuration(), fps: json.getMotionFps(), ids,
      metaFadePresent: json.isExistMotionFadeInTime() && json.isExistMotionFadeOutTime(),
      fadeIn: motion.getFadeInTime(), fadeOut: motion.getFadeOutTime(), loopFromMeta,
      loopBeforeExplicitConfiguration, configuredLoop: motion.getLoop(), loopDuration: motion.getLoopDuration(),
      parameterFadeOut: ids.map((_, i) => motion.getParameterFadeOutTime(json.getMotionCurveId(i))) };
  } finally { motion?.release(); json.release(); }
}
`, "utf8");
await build({ configFile: false, root: repo, logLevel: "error", resolve: { alias: { "@cubism": path.join(sdk, "Framework/src") } }, build: { minify: false, emptyOutDir: false, outDir: output, lib: { entry, name: "OfficialMotionProbe", formats: ["iife"], fileName: () => "official-sdk-probe.js" } } });
const core = await readFile(path.join(sdk, "Core/live2dcubismcore.min.js"));
const sha = data => createHash("sha256").update(data).digest("hex");
const report = { scope: "Actual local official SDK 5-r.5 parser regression tests; no model rendering or animation acceptance", coreSha256: sha(core), cases: [], pageErrors: [], productionApproval: false };
let browser;
try {
  const { chromium } = createRequire(require.resolve("@playwright/test/package.json"))("playwright");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", error => report.pageErrors.push(error.message));
  await page.route("**/*", route => route.abort());
  await page.addScriptTag({ content: core.toString("utf8") });
  await page.waitForFunction(() => { try { return globalThis.Live2DCubismCore?.Version?.csmGetVersion() > 0; } catch { return false; } });
  await page.addScriptTag({ path: path.join(output, "official-sdk-probe.js") });
  await page.evaluate(() => globalThis.OfficialMotionProbe.initialize());
  const inspect = text => page.evaluate(text => globalThis.OfficialMotionProbe.inspect(text), text);
  for (const file of manifest.files) {
    const source = await readFile(path.join(motions, file.path), "utf8");
    assert.equal(sha(source), file.sha256);
    const motion = JSON.parse(source), actual = await inspect(source), fade = file.id === "drag_hold" ? 0 : 0.12;
    assert.equal(actual.consistent, true); assert.equal(actual.duration, file.durationSeconds); assert.equal(actual.fps, 60);
    assert.equal(actual.metaFadePresent, true); assert.equal(actual.fadeIn, fade); assert.equal(actual.fadeOut, fade);
    assert.equal(actual.loopFromMeta, file.loop); assert.equal(actual.configuredLoop, file.loop); assert.equal(actual.loopDuration, file.durationSeconds);
    assert.deepEqual(actual.ids, manifest.motionOwnedParameters);
    assert.ok(actual.ids.every(id => !manifest.excludedPhysicsOutputParameters.includes(id)));
    if (file.id === "drag_hold") assert.ok(actual.parameterFadeOut.every(value => value === 0));
    report.cases.push({ name: file.id, sha256: sha(source), passed: true, actual });
    if (file.id === "idle") {
      // Regression: the previous root-only spelling must demonstrably be ignored.
      const rootOnly = structuredClone(motion);
      rootOnly.FadeInTime = rootOnly.Meta.FadeInTime; rootOnly.FadeOutTime = rootOnly.Meta.FadeOutTime;
      delete rootOnly.Meta.FadeInTime; delete rootOnly.Meta.FadeOutTime;
      const ignored = await inspect(JSON.stringify(rootOnly));
      assert.equal(ignored.metaFadePresent, false); assert.equal(ignored.fadeIn, 1); assert.equal(ignored.fadeOut, 1);
      report.cases.push({ name: "root-only fade regression reproduces SDK one-second fallback", passed: true, actual: ignored });
      const invalid = structuredClone(motion); invalid.Meta.CurveCount++;
      assert.equal((await inspect(JSON.stringify(invalid))).consistent, false);
      report.cases.push({ name: "official consistency check rejects incorrect curve count", passed: true });
    }
  }
  await page.evaluate(() => globalThis.OfficialMotionProbe.dispose());
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error); process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(path.join(output, "official-sdk-parser-tests.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, error: report.error ?? null, output, productionApproval: false }));
