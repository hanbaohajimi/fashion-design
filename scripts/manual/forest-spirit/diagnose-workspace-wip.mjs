/* global window, document, requestAnimationFrame, getComputedStyle */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { routePlaybackPackage } from "./capture-fullbody-playback.mjs";
import { inspectModelPackage, inspectMotion, inspectPhysics } from "./asset-preflight.mjs";
import { runFocusBackgroundChecks } from "./workspace-focus-background-checks.mjs";
import { resolveDrawableContract } from "./drawable-source-contract.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."), stage = path.join(repo, "output/forest-spirit-production-v2/front-v8");
const { values } = parseArgs({ options: { model: { type: "string" }, motions: { type: "string" }, physics: { type: "string" }, contour: { type: "string" }, runtime: { type: "string", default: "output/forest-spirit-runtime/front-v8-fullbody-diagnostic-r3" }, out: { type: "string" }, "drawable-map": { type: "string" }, "review-page": { type: "string" }, scenario: { type: "string", default: "standard" }, headed: { type: "boolean", default: false }, help: { type: "boolean" } } });
if (values.help) { console.log("node scripts/manual/forest-spirit/diagnose-workspace-wip.mjs --model <actual Editor model3> --motions <actual four *_STAGE motions> --physics <actual physics3> --contour <explicit draft hit-area-candidate.json> --out <NEW output directory> [--runtime <official bundle>] [--drawable-map <explicit 72-source/73-drawable JSON>] [--review-page <existing static review index.html>] [--scenario standard|focus-background] [--headed]\nStarts and stops only its own isolated local Next server; one real browser. standard runs desktop/mobile; focus-background runs only the remaining actual callback/focus + trusted browser visibility supplement and requires --headed. Business APIs are explicit fixtures; shared Surface + Core/assets are real WIP. Never sends chat or promotes readiness."); process.exit(0); }
assert.ok(values.model && values.motions && values.physics && values.contour && values.out);
assert.ok(["standard", "focus-background"].includes(values.scenario));
assert.ok(values.scenario !== "focus-background" || values.headed, "The background supplement requires an explicitly headed owned browser");
const out = path.resolve(repo, values.out), outputRoot = await realpath(path.join(repo, "output"));
assert.ok(out.startsWith(path.join(repo, "output") + path.sep)); await mkdir(path.dirname(out), { recursive: true }); assert.ok((await realpath(path.dirname(out))).startsWith(outputRoot + path.sep)); await mkdir(out);
const sha = bytes => createHash("sha256").update(bytes).digest("hex"), inputs = new Map(), resources = new Map();
async function read(filename) { const actual = await realpath(path.resolve(repo, filename)), bytes = await readFile(actual), hash = sha(bytes); if (inputs.has(actual)) assert.equal(inputs.get(actual).sha256, hash); else inputs.set(actual, { path: actual, bytes: bytes.length, sha256: hash }); return { actual, bytes }; }
const report = { scope: "Actual supplied WIP assets + shared production resource Host, Core loader and Surface in the existing workspace; separate unapproved review policy and explicit business API fixture, not final product acceptance", productionApproval: false, visualAcceptance: false, modelVisualStatus: "WIP_UNACCEPTED", status: "preparing", checks: [], observations: [], pageErrors: [], fixtureInitializations: [], blockedMutations: [], blockedUnknownFixture: [], blockedExternal: [], cleanupErrors: [], snapshots: [], inputs: [], artifacts: [], bridgeDifference: "Uses existing toolbar onClick, not production spirit assistantFocusRequest callback; focus path remains explicitly unverified" };
report.scenario = values.scenario;
report.headed = values.headed;
if (values.scenario === "focus-background") report.bridgeDifference = "Manual fixture reads the current mounted ForestSpiritAssistant onOpenChat callback and invokes that actual closure. The shared Host/resource lifecycle is real, but the diagnostic candidate policy does not bypass the production ready gate.";
function check(name, condition, detail) { const item = { name, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) }; report.checks.push(item); assert.ok(condition, name); }
const artifact = async (name, bytes) => { const file = path.join(out, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); report.artifacts.push({ path: file, bytes: bytes.length, sha256: sha(bytes) }); };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const nextEnvPath = path.join(repo, "apps/web/next-env.d.ts"), nextEnvBefore = await readFile(nextEnvPath);
const protectedPaths = ["apps/web/public/live2d/forest-spirit/asset-manifest.json", "apps/web/src/modules/board/workflow/WorkflowCanvas.tsx"];
for (const filename of protectedPaths) await read(filename);
for (const filename of ["scripts/manual/forest-spirit/diagnose-workspace-wip.mjs", "scripts/manual/forest-spirit/workspace-focus-background-checks.mjs", "scripts/manual/forest-spirit/wip-workspace-entry.tsx", "scripts/manual/forest-spirit/wip-workspace-fixtures.ts", "apps/web/src/modules/forest-spirit/ForestSpiritAssistant.tsx", "apps/web/src/modules/forest-spirit/ForestSpiritSurface.tsx", "apps/web/src/modules/forest-spirit/spirit-contract.ts", "apps/web/src/modules/forest-spirit/spirit-interaction.ts", "apps/web/src/modules/forest-spirit/ForestSpiritAssistant.module.css"]) await read(filename);
for (const filename of ["apps/web/src/modules/forest-spirit/ForestSpiritResourceHost.tsx", "apps/web/src/modules/forest-spirit/cubism-resource-renderer.ts", "apps/web/src/modules/forest-spirit/official-spirit-renderer.ts", "scripts/manual/forest-spirit/review-spirit-resources.ts"]) await read(filename);
let nextProcess, nextLog, browser, desktop, mobile, activePage;
const contexts = [], videos = [];
async function allocatePort() {
  for (let port = 48420; port <= 48429; port++) {
    const server = createServer();
    try { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); await new Promise(resolve => server.close(resolve)); return port; }
    catch (error) { if (error.code !== "EADDRINUSE") throw error; }
  }
  throw new Error("No free diagnostic port 48420..48429");
}
async function stopOwnedServer() {
  if (!nextProcess || nextProcess.exitCode !== null) return;
  const pid = nextProcess.pid; assert.ok(Number.isInteger(pid) && pid > 0);
  if (process.platform === "win32") await new Promise((resolve, reject) => { const stop = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); stop.once("error", reject); stop.once("exit", code => code === 0 || nextProcess.exitCode !== null ? resolve() : reject(new Error(`Owned tree stop failed ${code}`))); });
  else { nextProcess.kill("SIGTERM"); await delay(500); }
  report.ownedServerStopped = { pid, onlySpawnedProcessTree: true };
}
try {
  const specification = JSON.parse((await read("doc/design/forest-spirit/production/front-v8/layers.json")).bytes);
  const mappingSource = values["drawable-map"] ? await read(values["drawable-map"]) : null;
  const drawableContract = resolveDrawableContract(specification, mappingSource ? JSON.parse(mappingSource.bytes) : null);
  const expectedDrawableIds = drawableContract.drawableIds;
  report.drawableContract = { ...drawableContract, mappingFile: mappingSource ? { path: mappingSource.actual, sha256: sha(mappingSource.bytes) } : null };
  await read(fileURLToPath(new URL("./drawable-source-contract.mjs", import.meta.url)));
  const gate = JSON.parse((await read(protectedPaths[0])).bytes); check("public production gate remains pending", gate.status === "awaiting-production-assets" && gate.visualReview.approved === false);
  const modelSource = await read(values.model), model = JSON.parse(modelSource.bytes), physicsSource = await read(values.physics), physics = JSON.parse(physicsSource.bytes), contourSource = await read(values.contour), contour = JSON.parse(contourSource.bytes);
  check("contour explicitly remains unapproved and uses corrected pixel centers/fit", contour.productionApproval === false && contour.hitArea.approved === false && contour.algorithm.pixelCentreOffset === .5 && contour.algorithm.productFit === .96);
  const runtime = await realpath(path.resolve(repo, values.runtime)), runtimeManifest = JSON.parse((await read(path.join(runtime, "build-manifest.json"))).bytes);
  assert.equal(runtimeManifest.sdkVersion, "5-r.5"); assert.match(runtimeManifest.sdkInfo, /a49bc546222194ac28326d20a46aa35ee4d1ce8e/u);
  const prefix = "/__forest_wip", routes = new Map(), register = (url, source) => { routes.set(url, source); return url; };
  const sourceCopy = structuredClone(model);
  sourceCopy.FileReferences.Moc = register(`${prefix}/model.moc3`, await read(path.resolve(path.dirname(modelSource.actual), model.FileReferences.Moc)));
  sourceCopy.FileReferences.Textures = await Promise.all(model.FileReferences.Textures.map(async (file, i) => register(`${prefix}/texture-${i}.png`, await read(path.resolve(path.dirname(modelSource.actual), file)))));
  const motionUrls = {}, physicsIds = inspectPhysics(physics);
  const motionManifest = JSON.parse((await read(path.join(stage, "revisions/motion-meta-v2/motion-drafts/motion-drafts.manifest.json"))).bytes);
  assert.equal(physics.Meta.Fps, 60); assert.deepEqual([...physicsIds].sort(), [...motionManifest.excludedPhysicsOutputParameters].sort());
  for (const [label, id] of [["Idle", "idle"], ["Hover", "hover_greet"], ["DragHold", "drag_hold"], ["PutDown", "put_down"]]) {
    const file = await read(path.join(path.resolve(repo, values.motions), `${label}_STAGE.motion3.json`)), ids = inspectMotion(JSON.parse(file.bytes), id);
    assert.deepEqual([...ids].sort(), [...motionManifest.motionOwnedParameters].sort()); assert.ok(ids.every(id => !physicsIds.includes(id)));
    motionUrls[id] = register(`${prefix}/${label}.motion3.json`, file);
  }
  const routingUrl = `${prefix}/routing.model3.json`, routing = routePlaybackPackage(sourceCopy, routingUrl, register(`${prefix}/selected.physics3.json`, physicsSource), motionUrls);
  inspectModelPackage(routing, `http://127.0.0.1${routingUrl}`, motionUrls);
  await artifact("diagnostic-routing.model3.json", Buffer.from(JSON.stringify(routing, null, 2) + "\n"));
  for (const name of ["forest-spirit-runtime.js", "live2dcubismcore.min.js"]) { const file = await read(path.join(runtime, name)); assert.equal(sha(file.bytes), runtimeManifest.files.find(item => item.path === name).sha256); register(`${prefix}/runtime/${name}`, file); }
  const require = createRequire(import.meta.url), appRequire = createRequire(path.join(repo, "apps/web/package.json"));
  let vitePath;
  for (const directory of ["apps/web", "output/live2d-proof-20261105"]) { try { vitePath = createRequire(path.join(repo, directory, "package.json")).resolve("vite"); break; } catch { /* Existing tools only. */ } }
  assert.ok(vitePath, "Existing Vite toolchain is required; nothing is installed");
  const localEsbuild = (await readdir(path.join(repo, "node_modules/.pnpm"))).filter(name => /^esbuild@\d/u.test(name));
  assert.equal(localEsbuild.length, 1, "Use the single existing lockfile-installed esbuild; no installation or implicit version choice");
  const { build } = await import(pathToFileURL(vitePath).href), esbuild = require(path.join(repo, "node_modules/.pnpm", localEsbuild[0], "node_modules/esbuild")), bundle = path.join(out, "bundle");
  console.log("Building test-only shared resource Host entry and existing API fixtures...");
  await build({ configFile: false, root: repo, logLevel: "error", define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_FOREST_SPIRIT_ENABLED": '"false"' }, esbuild: { jsx: "automatic" }, resolve: { alias: [{ find: /^react$/, replacement: appRequire.resolve("react") }, { find: /^react\/jsx-runtime$/, replacement: appRequire.resolve("react/jsx-runtime") }, { find: /^react-dom\/client$/, replacement: appRequire.resolve("react-dom/client") }] }, build: { target: "es2022", minify: false, emptyOutDir: false, outDir: bundle, lib: { entry: path.join(repo, "scripts/manual/forest-spirit/wip-workspace-entry.tsx"), name: "ForestSpiritWipEntry", formats: ["iife"], fileName: () => "wip-workspace.js", cssFileName: "wip-workspace" } } });
  await esbuild.build({ entryPoints: [path.join(repo, "scripts/manual/forest-spirit/wip-workspace-fixtures.ts")], outfile: path.join(bundle, "fixtures.mjs"), bundle: true, platform: "node", format: "esm", external: ["@playwright/test"], logLevel: "error" });
  for (const name of ["wip-workspace.js", "wip-workspace.css", "fixtures.mjs"]) { const built = await read(path.join(bundle, name)); report.artifacts.push({ path: built.actual, bytes: built.bytes.length, sha256: sha(built.bytes) }); }
  const { seedVisualApp, PROJECT, workspaceFixture } = await import(pathToFileURL(path.join(bundle, "fixtures.mjs")).href);
  const port = await allocatePort(), origin = `http://127.0.0.1:${port}`, distDir = `.next-forest-wip-${path.basename(out).replace(/[^a-z0-9-]/giu, "-").slice(-40)}`;
  nextLog = createWriteStream(path.join(out, "next-server.log"), { flags: "wx" });
  nextProcess = spawn(process.execPath, [appRequire.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: path.join(repo, "apps/web"), env: { ...process.env, NODE_ENV: "development", NEXT_PUBLIC_FOREST_SPIRIT_ENABLED: "false", NEXT_DIST_DIR: distDir }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  nextProcess.stdout.pipe(nextLog); nextProcess.stderr.pipe(nextLog); let serverError; nextProcess.on("error", error => { serverError = error; });
  report.ownedServer = { pid: nextProcess.pid, origin, distDir, productionSpiritEnabled: false }; console.log(`Starting owned isolated Next server ${origin}`);
  const deadline = Date.now() + 180000; let ready = false;
  while (Date.now() < deadline) { if (serverError) throw serverError; if (nextProcess.exitCode !== null) throw new Error(`Owned Next server exited ${nextProcess.exitCode}`); try { const response = await fetch(origin, { signal: AbortSignal.timeout(2500) }); if (response.status < 500) { ready = true; break; } } catch { /* Startup only. */ } await delay(500); }
  assert.ok(ready, "Owned Next startup timed out");
  const playwrightRequire = createRequire(require.resolve("@playwright/test/package.json")), { chromium } = playwrightRequire("playwright");
  if (values.scenario === "focus-background") {
    const corePackage = createRequire(playwrightRequire.resolve("playwright/package.json")).resolve("playwright-core/package.json"), packageInput = await read(corePackage);
    assert.equal(JSON.parse(packageInput.bytes).version, "1.58.2", "Private original-session diagnostic requires re-audit after Playwright changes");
    for (const name of ["lib/inProcessFactory.js", "lib/server/chromium/crPage.js", "lib/server/chromium/crConnection.js"]) await read(path.join(path.dirname(corePackage), name));
  }
  browser = await chromium.launch({ headless: !values.headed, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  let failTexture = false;
  const candidateManifestUrl = `${prefix}/review-candidate.json`;
  const candidate = { schemaVersion: 1, status: "diagnostic-candidate", characterId: "forest-spirit-front-v8", productionApproval: false, visualReview: { approved: false }, model3Url: routingUrl, coreUrl: `${prefix}/runtime/live2dcubismcore.min.js`, runtimeModuleUrl: `${prefix}/runtime/forest-spirit-runtime.js`, hitArea: { ...contour.hitArea, approved: false }, motions: motionUrls };
  const config = { status: "diagnostic-candidate", productionApproval: false, apiMode: "explicit-business-fixture", userId: "visual-designer", projectId: PROJECT, conversationId: "visual-chat", bridgeMode: values.scenario === "focus-background" ? "production-callback" : "toolbar", manifestUrl: candidateManifestUrl };
  await artifact("review-candidate.json", Buffer.from(JSON.stringify(candidate, null, 2) + "\n"));
  await artifact("wip-descriptor.json", Buffer.from(JSON.stringify(config, null, 2) + "\n"));
  async function setupContext(name, options) {
    const context = await browser.newContext({ ...options, serviceWorkers: "block", deviceScaleFactor: 1, recordVideo: { dir: path.join(out, `${name}-recording`), size: options.viewport } }); contexts.push(context);
    const page = await context.newPage(); videos.push({ name, video: page.video() }); activePage = page;
    if (values.scenario === "focus-background") {
      // Focus emulation owns a per-session Chromium capture handle. A fresh CDP
      // session cannot release Playwright's handle. Use the inspected, pinned
      // original session; no library/app files or visibility properties change.
      assert.equal(typeof page._connection?.toImpl, "function", "Pinned in-process Playwright bridge is unavailable");
      const originalSession = page._connection.toImpl(page)?.delegate?._mainFrameSession?._client;
      assert.equal(typeof originalSession?.send, "function", "Pinned original Chromium session is unavailable");
      await originalSession.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      await page.bringToFront();
      report.observations.push({ name: "Playwright forced focus disabled in its original CDP session", playwrightVersion: "1.58.2", command: "Emulation.setFocusEmulationEnabled", enabled: false, visibilityOverrideOrSyntheticEvent: false });
    }
    // Playwright handlers run newest first: known fixtures may fulfill, but an
    // unmatched GET can never reach the Next proxy or a real backend.
    await page.route("**/api/**", async route => { report.blockedUnknownFixture.push({ method: route.request().method(), path: new URL(route.request().url()).pathname }); await route.abort("blockedbyclient"); });
    // The screenshot fixture freezes Date and replaces timers/RAF. Skip only that
    // fixture side effect: gestures and Core must use the browser's native clock.
    const fixturePage = new Proxy(page, { get(target, key) {
      if (key === "clock") return { setFixedTime: async () => { report.observations.push({ page: name, screenshotFixtureClockDisabled: true, nativeBrowserTimersRequired: true }); } };
      const member = Reflect.get(target, key); return typeof member === "function" ? member.bind(target) : member;
    } });
    await seedVisualApp(fixturePage); await page.emulateMedia({ reducedMotion: options.reducedMotion });
    await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: workspaceFixture() }));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { report.blockedExternal.push({ url: request.url() }); await route.abort("blockedbyclient"); return; }
      if (request.method() === "POST" && url.pathname === `/api/projects/${PROJECT}/canvas/initialize`) {
        report.fixtureInitializations.push({ method: "POST", path: url.pathname, fulfilledLocally: true, networkSent: false });
        await route.fulfill({ json: { projectId: PROJECT, mode: "node", revision: 0, formatVersion: 1, snapshot: {}, bindings: [], initializedFrom: "workflow", canEdit: true } }); return;
      }
      if (url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedMutations.push({ method: request.method(), path: url.pathname }); await route.abort("blockedbyclient"); return; }
      if (url.pathname === candidateManifestUrl) {
        report.observations.push({ page: name, event: "shared-host-manifest-request", url: url.pathname, productionApproval: false });
        await route.fulfill({ json: candidate, headers: { "Cache-Control": "no-store" } }); return;
      }
      if (url.pathname === routingUrl) { await route.fulfill({ json: routing, headers: { "Cache-Control": "no-store" } }); return; }
      if (failTexture && url.pathname === `${prefix}/texture-0.png`) { await route.fulfill({ status: 404, body: "Intentional WIP load-failure diagnostic" }); return; }
      let file = routes.get(url.pathname);
      if (!file && url.pathname.startsWith(`${prefix}/runtime/shaders/`)) {
        const relative = decodeURIComponent(url.pathname.slice(`${prefix}/runtime/`.length)); const actual = await realpath(path.join(runtime, relative)); assert.ok(actual.startsWith(path.join(runtime, "shaders") + path.sep)); file = await read(actual);
      }
      if (file) { resources.set(file.actual, { path: file.actual, bytes: file.bytes.length, sha256: sha(file.bytes) }); await route.fulfill({ contentType: ({ ".js": "text/javascript", ".json": "application/json", ".png": "image/png" })[path.extname(file.actual)] ?? "text/plain", body: file.bytes, headers: { "Cache-Control": "no-store" } }); return; }
      if (url.pathname.startsWith(prefix)) { await route.abort("blockedbyclient"); return; }
      await route.fallback();
    });
    page.on("pageerror", error => report.pageErrors.push({ page: name, error: error.message }));
    await page.goto(`${origin}/${PROJECT}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "描述设计需求", includeHidden: true }).waitFor({ state: "attached", timeout: 90000 });
    if (values.scenario === "focus-background") await page.waitForFunction(() => { const input = document.querySelector('aside[aria-label="设计助手"] textarea'); return input && !input.disabled; });
    check(`${name}: native Date and RAF remain installed`, await page.evaluate(() => !Date.isFake && !globalThis.__pwClock && /native code/u.test(requestAnimationFrame.toString())));
    await page.addStyleTag({ path: path.join(bundle, "wip-workspace.css") });
    check(`${name}: Core was not preinjected by the diagnostic`, await page.evaluate(() => !("Live2DCubismCore" in window)));
    await page.addScriptTag({ path: path.join(bundle, "wip-workspace.js") });
    await page.evaluate(config => window.ForestSpiritWipEntry.mountWipSurface(config), config);
    await page.waitForFunction(() => window.forestSpiritWip?.events.some(event => event.event === "load-complete"), undefined, { timeout: 30000 });
    check(`${name}: shared resource Host fetched the explicit unapproved manifest`, report.observations.some(item => item.page === name && item.event === "shared-host-manifest-request"));
    check(`${name}: shared bootstrap loaded Core before importing runtime`, await page.evaluate(() => {
      const names = window.forestSpiritWip.events.map(event => event.event);
      return names.indexOf("core-load-start") >= 0 && names.indexOf("core-load-start") < names.indexOf("core-load-complete") && names.indexOf("core-load-complete") < names.indexOf("runtime-import-start") && names.indexOf("runtime-import-start") < names.indexOf("runtime-import-complete") && names.indexOf("runtime-import-complete") < names.indexOf("load-complete");
    }));
    return { context, page };
  }
  const snapshot = async (page, name) => { const state = await page.evaluate(() => ({ ...window.forestSpiritWip.snapshot(), events: window.forestSpiritWip.events })); report.snapshots.push({ name, state }); await artifact(`${name}.png`, await page.screenshot()); return state; };
  const count = (page, name) => page.evaluate(name => window.forestSpiritWip.events.filter(event => event.event === "play" && event.name === name).length, name);
  const hitFor = page => page.locator("[data-real-spirit-wip-mount] [data-forest-spirit-hit]");
  const pointFor = async page => hitFor(page).evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, outsideX: r.x + 2, outsideY: r.y + 2 }; });
  const closeChat = async page => { const button = page.getByRole("button", { name: "收起设计助手", exact: true }); if (await button.isVisible()) await button.click(); await hitFor(page).waitFor({ state: "visible" }); };
  if (values.scenario === "focus-background") {
    desktop = await setupContext("desktop", { viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
    await runFocusBackgroundChecks({ page: desktop.page, context: desktop.context, check, snapshot, report, expectedDrawableIds });
    await desktop.page.evaluate(() => window.forestSpiritWip.unmount());
  } else {
  desktop = await setupContext("desktop", { viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
  let page = desktop.page; const input = page.getByRole("textbox", { name: "描述设计需求", includeHidden: true }); await input.fill("真实 Live2D WIP：同一完整对话的未发送草稿");
  await closeChat(page); const hit = hitFor(page); let p = await pointFor(page);
  const initial = await snapshot(page, "desktop-real-loaded"); check("real exact declared drawable inventory and actual 17 parameters loaded", initial.drawableCount === expectedDrawableIds.length && JSON.stringify(initial.drawableIds) === JSON.stringify(expectedDrawableIds) && Object.keys(initial.parameters).length === 17);
  check("draft polygon transparent corner passes to workspace", await page.evaluate(({ outsideX, outsideY }) => !document.elementFromPoint(outsideX, outsideY)?.closest("[data-forest-spirit-hit]"), p));
  await page.mouse.move(p.outsideX, p.outsideY); await page.mouse.move(p.x, p.y); await page.waitForFunction(() => window.forestSpiritWip.events.some(event => event.event === "play" && event.name === "hover_greet"));
  await page.mouse.move(p.x + 1, p.y + 1); check("hover responds once for one entry", await count(page, "hover_greet") === 1);
  await page.mouse.move(p.outsideX, p.outsideY); await page.mouse.move(p.x, p.y); await delay(2050); check("hover does not queue a repeated entry while playing", await count(page, "hover_greet") === 1);
  await page.mouse.click(p.x, p.y); await input.waitFor({ state: "visible" });
  let state = await snapshot(page, "desktop-existing-chat"); const opened = state.events.findLast(event => event.event === "open-existing-chat"), released = state.events.filter(event => event.event === "pointerup" && event.time <= opened.time).at(-1);
  check("short release calls existing chat immediately, without waiting for animation", opened.time - released.time < 50, { elapsedMs: opened.time - released.time });
  check("same complete Panel and unsent draft survive opening", state.panelSame && await input.inputValue() === "真实 Live2D WIP：同一完整对话的未发送草稿"); check("chat opening hides and pauses the real instance", state.characterHidden && state.paused && state.raf === 0);
  await closeChat(page); p = await pointFor(page); const hoverBefore = await count(page, "hover_greet"); await page.mouse.move(p.x, p.y); await delay(100); check("restoring from outside allows first new hover", await count(page, "hover_greet") === hoverBefore + 1);
  await delay(2000); await page.mouse.click(p.x, p.y); await input.waitFor({ state: "visible" }); await page.mouse.move(p.x, p.y);
  const insideBefore = await count(page, "hover_greet"); await page.getByRole("button", { name: "收起设计助手", exact: true }).evaluate(button => button.click()); await hit.waitFor({ state: "visible" }); await page.mouse.move(p.x + 1, p.y + 1); await delay(150);
  check("restoration under stationary mouse does not trigger greeting", await count(page, "hover_greet") === insideBefore);
  await page.mouse.move(p.outsideX, p.outsideY); await page.mouse.move(p.x, p.y); await delay(100); check("leaving then entering after inside restoration greets once", await count(page, "hover_greet") === insideBefore + 1);
  const opensBeforeDrag = await page.evaluate(() => window.forestSpiritWip.events.filter(event => event.event === "open-existing-chat").length), holdBefore = await count(page, "drag_hold");
  await page.mouse.down(); await delay(250); state = await page.evaluate(() => window.forestSpiritWip.snapshot()); check("250ms press is not a drag", state.phase === "pressing" && await count(page, "drag_hold") === holdBefore);
  await delay(210); check("400ms threshold arms actual drag-hold", await hit.locator("..").getAttribute("data-phase") === "dragArmed" && await count(page, "drag_hold") === holdBefore + 1);
  check("accepted pointer uses real browser pointer capture", await hit.evaluate(node => node.hasPointerCapture(1)));
  await page.mouse.move(p.x - 110, p.y - 55, { steps: 5 }); await page.mouse.up(); await delay(150);
  state = await snapshot(page, "desktop-real-drag-release"); check("release persists normalized anchor and never opens chat", state.panelHidden && state.anchor !== null && state.events.filter(event => event.event === "open-existing-chat").length === opensBeforeDrag);
  const savedTransform = await hit.locator("..").evaluate(node => node.style.transform), savedAnchor = state.anchor;
  await hit.focus(); await page.keyboard.press("Enter"); await input.waitFor({ state: "visible" }); await closeChat(page);
  check("keyboard uses original chat and closing restores same position/draft", await input.inputValue() === "真实 Live2D WIP：同一完整对话的未发送草稿" && await hit.locator("..").evaluate(node => node.style.transform) === savedTransform && await page.evaluate(() => window.forestSpiritWip.snapshot().anchor) === savedAnchor);
  p = await pointFor(page); const cancelBefore = await count(page, "drag_hold"); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 9, p.y); await delay(450); await page.mouse.up();
  check("pre-arm movement greater than 6px cancels both click and drag", await count(page, "drag_hold") === cancelBefore && await page.evaluate(() => window.forestSpiritWip.snapshot().panelHidden));
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await delay(450); await page.mouse.move(p.x - 20, p.y - 10); await hit.evaluate(node => node.releasePointerCapture(1)); await delay(50); await page.mouse.up();
  check("real lost pointer capture restores drag origin without persisting", await hit.locator("..").evaluate(node => node.style.transform) === savedTransform && await page.evaluate(() => window.forestSpiritWip.snapshot().anchor) === savedAnchor);
  const foregroundProbe = await desktop.context.newPage(); await foregroundProbe.goto("about:blank"); await foregroundProbe.bringToFront(); await delay(150);
  const background = await page.evaluate(() => ({ hidden: document.hidden, ...window.forestSpiritWip.snapshot() }));
  if (background.hidden) check("actual background tab hides character and stops RAF", background.characterHidden && background.paused && background.raf === 0);
  else report.observations.push({ name: "background visibility", status: "NOT_EXERCISED_HEADLESS_BROWSER_KEEPS_PAGES_VISIBLE", note: "No fake visibility event or synthetic production pass; existing unit tests cover hidden-event semantics." });
  await foregroundProbe.close(); await page.bringToFront(); await hit.waitFor({ state: "visible" });
  await page.emulateMedia({ reducedMotion: "reduce" }); await delay(150); state = await snapshot(page, "desktop-reduced-motion");
  check("reduced motion stops actual RAF and restores exported defaults", state.raf === 0 && Object.values(state.parameters).every(parameter => Math.abs(parameter.value - parameter.default) < 1e-6));
  const reduceHoverBefore = await count(page, "hover_greet"); p = await pointFor(page); await page.mouse.move(p.outsideX, p.outsideY); await page.mouse.move(p.x, p.y); await delay(100); check("reduced motion has no greeting", await count(page, "hover_greet") === reduceHoverBefore);
  await page.emulateMedia({ reducedMotion: "no-preference" }); await delay(250); check("leaving reduce resumes actual drawing", (await page.evaluate(() => window.forestSpiritWip.snapshot())).drawCount > state.drawCount);
  const extensionAvailable = await page.locator("[data-real-spirit-wip-mount] canvas").evaluate(canvas => { const gl = canvas.getContext("webgl"); const extension = gl?.getExtension("WEBGL_lose_context"); extension?.loseContext(); return Boolean(extension); });
  check("actual WebGL context-loss extension exists", extensionAvailable); await hit.waitFor({ state: "hidden" }); state = await snapshot(page, "desktop-contextlost-fallback"); check("actual context loss disposes only character", state.disposed && state.panelSame);
  await page.getByRole("button", { name: "展开设计助手", exact: true }).click(); check("context-loss fallback retains original draft", await input.inputValue() === "真实 Live2D WIP：同一完整对话的未发送草稿");
  report.observations.push({ name: "desktop completed proof", proof: state });
  await page.evaluate(() => window.forestSpiritWip.unmount()); failTexture = true; await page.evaluate(config => window.ForestSpiritWipEntry.mountWipSurface(config), config);
  await page.waitForFunction(() => window.forestSpiritWip.events.some(event => event.event === "load-failed")); await delay(100); state = await snapshot(page, "desktop-real-load-failure");
  check("actual texture 404 leaves no empty clickable character and preserves Panel", state.characterHidden && state.disposed && state.panelSame && await input.inputValue() === "真实 Live2D WIP：同一完整对话的未发送草稿");
  await page.evaluate(() => window.forestSpiritWip.unmount()); failTexture = false; await desktop.context.close();
  mobile = await setupContext("mobile", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" }); page = mobile.page; await closeChat(page); p = await pointFor(page);
  await page.touchscreen.tap(p.x, p.y); const mobileInput = page.getByRole("textbox", { name: "描述设计需求" }); await mobileInput.waitFor({ state: "visible" }); await mobileInput.fill("手机 WIP 同一会话草稿"); await closeChat(page); p = await pointFor(page); await page.touchscreen.tap(p.x, p.y); await mobileInput.waitFor({ state: "visible" });
  state = await snapshot(page, "mobile-real-existing-chat"); check("actual mobile touch opens same complete chat with no hover", state.panelSame && await mobileInput.inputValue() === "手机 WIP 同一会话草稿" && await count(page, "hover_greet") === 0);
  check("mobile page has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.evaluate(() => window.forestSpiritWip.unmount()); await mobile.context.close();
  }
  if (values["review-page"]) {
    const reviewFile = await read(values["review-page"]); assert.ok(reviewFile.actual.startsWith(stage + path.sep));
    const reviewContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" }); contexts.push(reviewContext);
    const reviewPage = await reviewContext.newPage(); activePage = reviewPage;
    const reviewPrefix = "/__forest_review/", reviewUrl = origin + reviewPrefix + path.relative(stage, reviewFile.actual).split(path.sep).map(encodeURIComponent).join("/");
    await reviewPage.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || !url.pathname.startsWith(reviewPrefix) || route.request().method() !== "GET") { await route.abort("blockedbyclient"); return; }
      const requested = await realpath(path.resolve(stage, decodeURIComponent(url.pathname.slice(reviewPrefix.length)))); assert.ok(requested.startsWith(stage + path.sep));
      const file = await read(requested); await route.fulfill({ body: file.bytes, contentType: ({ ".html": "text/html; charset=utf-8", ".png": "image/png", ".webm": "video/webm", ".json": "application/json" })[path.extname(requested)] ?? "text/plain" });
    });
    await reviewPage.goto(reviewUrl, { waitUntil: "domcontentloaded" });
    await reviewPage.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0) && document.querySelector("video").readyState >= 1);
    const reviewState = await reviewPage.evaluate(() => ({ images: [...document.images].map(image => ({ width: image.naturalWidth, height: image.naturalHeight, cssHeight: image.getBoundingClientRect().height })), selection: document.querySelector("#size").value, duration: document.querySelector("video").duration, videoPaused: document.querySelector("video").paused }));
    check("review page has two unscaled source canvases with equal desktop CSS height", reviewState.images.length === 2 && reviewState.images.every(image => image.width === 971 && image.height === 1620 && image.cssHeight === 540) && reviewState.selection === "540", reviewState);
    check("review video metadata loads without claiming playback review", Number.isFinite(reviewState.duration) && reviewState.duration > 0 && reviewState.videoPaused, { duration: reviewState.duration });
    await reviewPage.selectOption("#background", "#1a3525"); await reviewPage.selectOption("#size", "220");
    check("review size and background selectors affect both images equally", await reviewPage.locator(".image").evaluateAll(images => images.every(image => image.getBoundingClientRect().height === 220 && getComputedStyle(image).backgroundColor === "rgb(26, 53, 37)")));
    await artifact("static-review-desktop.png", await reviewPage.screenshot());
    const links = await reviewPage.locator("a").evaluateAll(anchors => anchors.map(anchor => anchor.href));
    for (const href of links) check(`review artifact link ${new URL(href).pathname.split("/").at(-1)}`, await reviewPage.evaluate(async href => (await fetch(href)).ok, href));
    await reviewPage.setViewportSize({ width: 390, height: 844 }); await reviewPage.reload({ waitUntil: "domcontentloaded" });
    check("review mobile initial selector agrees with 280CSS images", await reviewPage.evaluate(() => document.querySelector("#size").value === "280" && [...document.images].every(image => image.getBoundingClientRect().height === 280)));
    await artifact("static-review-mobile.png", await reviewPage.screenshot()); await reviewContext.close();
  }
  check("no chat or other mutation request was sent", report.blockedMutations.length === 0, report.blockedMutations);
  check("all business reads used explicit fixtures", report.blockedUnknownFixture.length === 0, report.blockedUnknownFixture);
  check("no browser JavaScript errors", report.pageErrors.length === 0, report.pageErrors);
  report.status = "WIP_real_surface_interaction_diagnostic_completed_visual_failures_remain"; report.interactionDiagnosticPassed = true;
} catch (error) {
  report.status = "failed"; report.interactionDiagnosticPassed = false; report.error = String(error); process.exitCode = 1;
  if (activePage && !activePage.isClosed()) {
    try { await artifact("failure-page.png", await activePage.screenshot()); } catch (e) { report.cleanupErrors.push(String(e)); }
    try { report.failureState = await activePage.evaluate(() => window.forestSpiritWip ? { snapshot: window.forestSpiritWip.snapshot(), events: window.forestSpiritWip.events } : { noWip: true, body: document.body.innerText.slice(0, 4000) }); } catch (e) { report.cleanupErrors.push(String(e)); }
  }
} finally {
  for (const context of contexts) {
    for (const page of context.pages()) try { await page.evaluate(() => window.forestSpiritWip?.unmount()); } catch (error) { report.cleanupErrors.push(`unmount: ${error}`); }
    try { await context.close(); } catch (error) { report.cleanupErrors.push(`context: ${error}`); }
  }
  for (const { name, video } of videos) if (video) try { const file = path.join(out, `${name}-actual-interaction.webm`); await video.saveAs(file); const bytes = await readFile(file); report.artifacts.push({ path: file, bytes: bytes.length, sha256: sha(bytes) }); } catch (error) { report.cleanupErrors.push(`video: ${error}`); }
  try { await browser?.close(); } catch (error) { report.cleanupErrors.push(`browser: ${error}`); }
  try { await stopOwnedServer(); } catch (error) { report.cleanupErrors.push(`owned server: ${error}`); }
  if (nextLog) await new Promise(resolve => nextLog.end(resolve));
  try {
    const after = await readFile(nextEnvPath); report.nextEnv = { beforeSha256: sha(nextEnvBefore), afterServerSha256: sha(after), generatedChangeRestored: false };
    if (!after.equals(nextEnvBefore)) {
      const stripGeneratedReference = bytes => bytes.toString("utf8").split(/\r?\n/u).filter(line => !/^import "\.\/.next(?:-[^/]+)?\/(?:dev\/)?types\/(?:routes|root-params)\.d\.ts";$/u.test(line)).join("\n");
      assert.equal(stripGeneratedReference(after), stripGeneratedReference(nextEnvBefore), "Unexpected concurrent next-env change; do not overwrite"); await writeFile(nextEnvPath, nextEnvBefore); report.nextEnv.generatedChangeRestored = true;
    }
  } catch (error) { report.cleanupErrors.push(`next-env: ${error}`); }
  report.inputs = [...inputs.values()]; report.resources = [...resources.values()]; report.inputsUnchanged = (await Promise.all(report.inputs.map(async input => sha(await readFile(input.path)) === input.sha256))).every(Boolean);
  if (!report.inputsUnchanged || report.cleanupErrors.length) { report.interactionDiagnosticPassed = false; report.status = "cleanup_or_input_integrity_failed"; process.exitCode = 2; }
  await writeFile(path.join(out, "workspace-wip-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, passed: report.interactionDiagnosticPassed ?? false, checks: report.checks.length, failed: report.checks.filter(check => !check.passed).map(check => check.name), error: report.error ?? null, cleanupErrors: report.cleanupErrors, out, productionApproval: false, visualAcceptance: false }));
}
