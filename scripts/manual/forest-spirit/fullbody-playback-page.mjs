/* global window, document */

/** Synchronous freeze; no digest/await and therefore no RAF boundary inside it. */
export function freezeCompletedCheckpoint(instance, name, wallElapsedMs, controlState) {
  const completed = instance.lastCompletedFrame;
  if (!completed) throw new Error("No completed production draw available for checkpoint");
  const snapshot = structuredClone(completed.state), bytes = completed.bytes.slice(0);
  const image = (kind, canvas) => ({ name, instance: instance.id, kind, sourceFrameCounter: snapshot.frameCounter, sourceFrameWallElapsedMs: completed.wallElapsedMs, wallElapsedMs, pngDataUrl: canvas.toDataURL("image/png") });
  const images = [image("transparent-actual-frame", instance.cache), ...instance.contexts.map(item => image(item.background, item.canvas)), ...instance.rois.map(roi => image(`crop-${roi.id}`, roi.canvas))];
  return { id: instance.id, state: snapshot, controlState: structuredClone(controlState), sourceFrameWallElapsedMs: completed.wallElapsedMs, wallElapsedMs, bytes, images };
}

// Browser-only observer for the *production* renderer. It never evaluates a
// motion or physics itself and never sets a model parameter.
export async function preparePlaybackPage(config, createCubismRenderer) {
  const proof = window.fullbodyPlayback = { ready: false, done: false, errors: [], frames: [], events: [], snapshots: [], holds: [], instances: [], rawFrames: [] };
  let started = 0, phase = "loaded-neutral";
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const fail = message => { throw new Error(message); };
  const label = document.querySelector("#status");
  const now = () => started ? performance.now() - started : 0;
  const instances = [];
  const physicsIds = config.physicsIds;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const state = renderer => {
    const model = renderer.user.getModel(), orders = model.getRenderOrders(), raw = model.getModel().canvasinfo;
    const parameters = Object.fromEntries(Array.from({ length: model.getParameterCount() }, (_, i) => [String(model.getParameterId(i).getString()), model.getParameterValueByIndex(i)]));
    const drawables = Array.from({ length: model.getDrawableCount() }, (_, i) => {
      const vertices = model.getDrawableVertexPositions(i); let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let n = 0; n < vertices.length; n += 2) {
        const x = vertices[n] * raw.PixelsPerUnit + raw.CanvasOriginX, y = raw.CanvasOriginY - vertices[n + 1] * raw.PixelsPerUnit;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      return { id: String(model.getDrawableId(i).getString()), vertexCount: vertices.length / 2, finiteVertices: vertices.every(Number.isFinite), opacity: model.getDrawableOpacity(i), renderOrder: orders[i], canvasBounds: [minX, minY, maxX, maxY] };
    });
    return { parameters, drawables, current: renderer.current ?? null, finished: renderer.user.finished(), raf: renderer.raf, frameCounter: renderer.__observedFrames, canvasInfo: { width: raw.CanvasWidth, height: raw.CanvasHeight, originX: raw.CanvasOriginX, originY: raw.CanvasOriginY, pixelsPerUnit: raw.PixelsPerUnit } };
  };
  const geometryBytes = renderer => {
    const model = renderer.user.getModel(), chunks = Array.from({ length: model.getDrawableCount() }, (_, i) => model.getDrawableVertexPositions(i).slice());
    const joined = new Float32Array(chunks.reduce((n, chunk) => n + chunk.length, 0)); let at = 0;
    for (const chunk of chunks) { joined.set(chunk, at); at += chunk.length; }
    return joined.buffer;
  };
  function paint(instance) {
    const { cache, rawCanvas, contexts } = instance;
    const cacheContext = cache.getContext("2d"); cacheContext.clearRect(0, 0, cache.width, cache.height); cacheContext.drawImage(rawCanvas, 0, 0);
    for (const { context, rgb } of contexts) { context.fillStyle = `rgb(${rgb.join(",")})`; context.fillRect(0, 0, cache.width, cache.height); context.drawImage(cache, 0, 0); }
    if (instance.id === "zoom") {
      for (const { context, rect, scale } of instance.rois) {
        context.fillStyle = "#e0ead8"; context.fillRect(0, 0, context.canvas.width, context.canvas.height);
        // These are fixed canvas pixel crops of the actual 0.96-fit production
        // frame. No registration, source substitution or neutral metric claim.
        context.drawImage(cache, rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1], 0, 0, (rect[2] - rect[0]) * scale, (rect[3] - rect[1]) * scale);
      }
    }
  }
  function makeCanvas(width, height) { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas; }
  function buildInstance(id, height) {
    const width = Math.round(height * 971 / 1620), rawCanvas = makeCanvas(width, height), cache = makeCanvas(width, height);
    rawCanvas.className = "source"; document.body.append(rawCanvas);
    const section = document.createElement("section"); section.innerHTML = `<h2>${id === "zoom" ? "Actual 971×1620 production render / fixed crops" : `${height} CSS px height · DPR 1`}</h2>`;
    document.querySelector(id === "zoom" ? "#zoom" : "#sizes").append(section);
    const contexts = [], rois = [];
    if (id !== "zoom") {
      for (const background of config.backgrounds) {
        const title = document.createElement("div"); title.textContent = background.id; section.append(title);
        const canvas = makeCanvas(width, height); canvas.style.width = `${height * 971 / 1620}px`; canvas.style.height = `${height}px`; section.append(canvas); contexts.push({ context: canvas.getContext("2d"), rgb: background.rgb8, background: background.id, canvas });
      }
    } else {
      for (const region of config.zoomRegions) {
        const scale = region.id === "face" ? 1.5 : 1;
        const title = document.createElement("div"); title.textContent = `${region.id}: fixed actual frame crop`; section.append(title);
        const canvas = makeCanvas(Math.round((region.rect[2] - region.rect[0]) * scale), Math.round((region.rect[3] - region.rect[1]) * scale)); section.append(canvas);
        rois.push({ context: canvas.getContext("2d"), rect: region.rect, scale, id: region.id, canvas });
      }
    }
    const renderer = createCubismRenderer(rawCanvas); renderer.resize(width, height, 1);
    const instance = { id, height, width, rawCanvas, cache, contexts, rois, renderer, previousStep: undefined, frameOrder: [], original: {} };
    rawCanvas.addEventListener("forest-spirit-error", event => proof.errors.push({ instance: id, error: String(event.detail) }));
    instances.push(instance); return instance;
  }
  async function checkpoint(name) {
    // No await until all Core values, vertex bytes and cached actual-frame PNGs
    // have been copied. Otherwise the RAF could advance between metadata and PNG.
    // This observes live playback; it does not pause/restart the renderer.
    const frozen = instances.map(instance => {
      const live = state(instance.renderer);
      return freezeCompletedCheckpoint(instance, name, now(), { current: live.current, raf: live.raf, parameters: live.parameters });
    });
    const result = { name, wallElapsedMs: frozen[0].wallElapsedMs, instances: await Promise.all(frozen.map(async item => ({ id: item.id, state: item.state, controlState: item.controlState, sourceFrameWallElapsedMs: item.sourceFrameWallElapsedMs, wallElapsedMs: item.wallElapsedMs, geometrySha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", item.bytes))].map(v => v.toString(16).padStart(2, "0")).join("") }))) };
    proof.snapshots.push(...frozen.flatMap(item => item.images));
    proof.events.push({ type: "checkpoint", ...result }); return result;
  }
  function command(name, reason) {
    phase = reason; label.textContent = `${reason} / actual production play(${name}) + physics`;
    proof.events.push({ type: "command", name, reason, wallElapsedMs: now(), before: instances.map(i => ({ id: i.id, ...state(i.renderer) })) });
    return Promise.all(instances.map(async instance => {
      await instance.renderer.play(name, { interrupt: true });
      proof.events.push({ type: "promise-resolved", name, reason, instance: instance.id, wallElapsedMs: now(), state: state(instance.renderer), note: "A play promise also resolves on interruption; this event alone does not prove natural completion." });
    }));
  }
  async function bounded(promise, milliseconds = 15000) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Actual production action timed out")), milliseconds); })]); }
    finally { clearTimeout(timer); }
  }
  async function hold(name, milliseconds) {
    await sleep(20); const before = await checkpoint(`${name}-start`); await sleep(milliseconds); const after = await checkpoint(`${name}-end`);
    proof.holds.push({ name, durationMs: after.wallElapsedMs - before.wallElapsedMs, instances: before.instances.map((a, n) => {
      const b = after.instances[n]; return { id: a.id, parametersUnchanged: same(a.state.parameters, b.state.parameters) && same(a.controlState.parameters, b.controlState.parameters) && same(b.state.parameters, b.controlState.parameters), geometryUnchanged: a.geometrySha256 === b.geometrySha256, noNewRenderedFrame: a.state.frameCounter === b.state.frameCounter, stopped: b.controlState.raf === 0 && b.controlState.current === null, pickup: b.controlState.parameters.ParamFSPickup, before: a, after: b };
    }) });
  }
  proof.dispose = () => {
    for (const instance of instances) {
      try { instance.renderer.pause(); } catch (error) { proof.errors.push({ cleanup: instance.id, error: String(error) }); }
      for (const restore of instance.restores ?? []) try { restore(); } catch (error) { proof.errors.push({ cleanup: instance.id, error: String(error) }); }
      try { instance.renderer.dispose(); } catch (error) { proof.errors.push({ cleanup: instance.id, error: String(error) }); }
    }
  };
  try {
    for (const height of [160, 220, 280, 1620]) {
      const instance = buildInstance(height === 1620 ? "zoom" : String(height), height), renderer = instance.renderer;
      await renderer.load(config.asset, new AbortController().signal);
      const model = renderer.user?.getModel(); if (!model || !renderer.user._physics || typeof renderer.draw !== "function") fail("Pinned production renderer observer interface is unavailable");
      const actual = state(renderer), actualIds = actual.drawables.map(d => d.id).sort();
      if (!same(actualIds, [...config.drawableIds].sort()) || actualIds.some(id => id.startsWith("__TEMP_"))) fail("Require the exact declared drawable inventory for all 72 P0 sources, without temporary composites");
      if (!same(Object.keys(actual.parameters).sort(), Object.keys(config.parameterBounds).sort())) fail("Require exactly the 17 approved real Core parameters");
      for (let index = 0; index < model.getParameterCount(); index++) {
        const id = String(model.getParameterId(index).getString()), expected = config.parameterBounds[id];
        if (model.getParameterMinimumValue(index) !== expected.minimum || model.getParameterMaximumValue(index) !== expected.maximum || model.getParameterDefaultValue(index) !== expected.default) fail(`Actual parameter range differs: ${id}`);
      }
      if (actual.canvasInfo.width !== 971 || actual.canvasInfo.height !== 1620) fail("Actual Core canvas must remain 971×1620");
      instance.restores = []; renderer.__observedFrames = 0;
      for (const [object, key, name] of [[model, "loadParameters", "load"], [renderer.user._motionManager, "updateMotion", "motion"], [model, "saveParameters", "save"], [renderer.user._physics, "evaluate", "physics"]]) {
        const original = object[key]; object[key] = function (...args) { instance.frameOrder.push(name); return original.apply(this, args); }; instance.restores.push(() => { object[key] = original; });
      }
      const user = renderer.user, step = user.step, draw = renderer.draw;
      user.step = function (dt) { instance.frameOrder = []; instance.previousStep = { dt, startMs: performance.now(), phase }; return step.call(this, dt); };
      renderer.draw = function () {
        const result = draw.call(this); paint(instance);
        if (instance.previousStep) renderer.__observedFrames++;
        const snapshot = state(renderer);
        // Store metadata/vertex bytes at the same completed draw as the cached
        // image. A later play() may load saved parameters before another draw.
        instance.lastCompletedFrame = { state: snapshot, bytes: geometryBytes(renderer), wallElapsedMs: now() };
        if (instance.previousStep) {
          const frame = { instance: instance.id, index: renderer.__observedFrames - 1, wallElapsedMs: instance.lastCompletedFrame.wallElapsedMs, phase: instance.previousStep.phase, dt: instance.previousStep.dt, drawCompletedMs: performance.now(), stepAndDrawMs: performance.now() - instance.previousStep.startMs, order: [...instance.frameOrder], ...snapshot };
          proof.frames.push(frame); instance.previousStep = undefined;
          if (config.rawFrameEvidence && (instance.id === "280" || instance.id === "zoom")) {
            // Freeze synchronously at the completed production draw. PNG encoding
            // adds observer overhead: this is evidence, never a performance run.
            if (proof.rawFrames.length >= 2400) fail("Raw frame evidence limit reached; do not silently drop frames");
            const rect = instance.id === "zoom" ? [120, 560, 425, 975] : [0, 0, instance.width, instance.height];
            const evidence = makeCanvas(rect[2] - rect[0], rect[3] - rect[1]);
            evidence.getContext("2d").drawImage(instance.cache, rect[0], rect[1], evidence.width, evidence.height, 0, 0, evidence.width, evidence.height);
            proof.rawFrames.push({ instance: instance.id, frameCounter: frame.frameCounter, frameIndex: frame.index, wallElapsedMs: frame.wallElapsedMs, drawCompletedMs: frame.drawCompletedMs, dt: frame.dt, phase: frame.phase, parameters: frame.parameters, cropRect: rect, width: evidence.width, height: evidence.height, pngDataUrl: evidence.toDataURL("image/png") });
          }
        }
        return result;
      };
      instance.restores.push(() => { user.step = step; renderer.draw = draw; });
      // Capture the actual already-loaded frame immediately by redrawing through
      // the production renderer, before any animation starts. No parameter reset.
      renderer.draw();
      proof.instances.push({ id: instance.id, cssHeight: height === 1620 ? null : height, buffer: { width: instance.width, height }, fit: .96, parameterBounds: config.parameterBounds, initial: actual, playbackPolicy: Object.fromEntries([...renderer.motions].map(([name, motion]) => [name, { loop: motion.getLoop(), fadeIn: motion.getFadeInTime(), fadeOut: motion.getFadeOutTime() }])) });
    }
    await checkpoint("loaded-neutral"); proof.ready = true;
    proof.start = async () => {
      if (started) fail("Recording cannot be restarted"); started = performance.now();
      try {
        for (const i of instances) i.renderer.resume();
        await command("idle", "idle-loop"); await sleep(6300); await checkpoint("idle-loop");
        const hover = command("hover_greet", "hover-complete"); await sleep(650); await checkpoint("hover-middle"); await bounded(hover); await sleep(100);
        await bounded(command("drag_hold", "drag-hold-complete")); await hold("first-hold", 1500);
        await bounded(command("put_down", "put-down-complete")); await sleep(900); await checkpoint("put-down-returned-idle");
        const interruptedHover = command("hover_greet", "hover-to-drag-interrupt"); await sleep(350); await checkpoint("before-hover-interrupt");
        await bounded(command("drag_hold", "interrupt-hover-with-drag")); await interruptedHover; await hold("second-hold", 900);
        const interruptedDown = command("put_down", "put-down-to-hover-interrupt"); await sleep(200); await checkpoint("before-put-down-interrupt");
        await bounded(command("hover_greet", "interrupt-put-down-with-hover")); await interruptedDown;
        await command("idle", "final-idle"); await sleep(2200); await checkpoint("final-idle");
        proof.done = true;
      } catch (error) { proof.errors.push({ phase, error: String(error) }); throw error; }
      finally { for (const i of instances) i.renderer.pause(); proof.wallDurationMs = now(); }
    };
    proof.physicsIds = physicsIds;
  } catch (error) { proof.errors.push({ phase, error: String(error) }); proof.dispose(); }
  return proof;
}
