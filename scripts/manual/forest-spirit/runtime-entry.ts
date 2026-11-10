// Bundled separately against the pinned, locally supplied official SDK. Not part of Next's source graph.
import { CubismFramework, LogLevel } from "@cubism/live2dcubismframework";
import { CubismUserModel } from "@cubism/model/cubismusermodel";
import { CubismMoc } from "@cubism/model/cubismmoc";
import { CubismMatrix44 } from "@cubism/math/cubismmatrix44";
import { CubismMotion } from "@cubism/motion/cubismmotion";
import { CubismMotionQueueEntry } from "@cubism/motion/cubismmotionqueueentry";
import type { CubismModel } from "@cubism/model/cubismmodel";
import { CubismShaderManager_WebGL } from "@cubism/rendering/cubismshader_webgl";
import { animatedParameters, inspectModelPackage, inspectNeutralModelPackage, inspectMotion, inspectPhysics, motionNames } from "./asset-preflight.mjs";
import type { ReadySpiritAsset, SpiritMotion, SpiritRenderer } from "../../../apps/web/src/modules/forest-spirit/spirit-contract";

export const sdkVersion = "5-r.5";
const shaderPath = new URL("./shaders/", import.meta.url).href;
const neutralCaptureSize = { width: 971, height: 1620 } as const;
type ModelSource = Pick<ReadySpiritAsset, "model3Url"> & Partial<Pick<ReadySpiritAsset, "motions">>;
type DiagnosticBaseline = Array<{ vertices: Float32Array; opacity: number }>;

function configureMotionPlayback(motion: CubismMotion, name: SpiritMotion, parameterIds: string[]) {
  motion.setEffectIds([], []); // Authored curves own eyes/breath.
  // Animator does not export loop policy reliably; the official SDK requires setLoop.
  motion.setLoop(name === "idle");
  motion.setLoopFadeIn(false);
  motion.setFadeInTime(name === "drag_hold" ? 0 : 0.12);
  motion.setFadeOutTime(name === "drag_hold" ? 0 : 0.12);
  if (name === "drag_hold") {
    for (const id of parameterIds) motion.setParameterFadeOutTime(CubismFramework.getIdManager().getId(id), 0);
  }
}

class SpiritModel extends CubismUserModel {
  start(motion: CubismMotion): CubismMotionQueueEntry {
    this._motionManager.stopAllMotions();
    const entry = this._motionManager.startMotionPriority(motion, false, 3);
    if (!(entry instanceof CubismMotionQueueEntry)) throw new Error("Official SDK did not create a motion queue entry");
    return entry;
  }
  stop() { this._motionManager.stopAllMotions(); }
  stepMotion(dt: number) {
    // Match the official sample: preserve authored motion state before physics,
    // so fades blend from the preceding frame without feeding physics back.
    this._model.loadParameters();
    this._motionManager.updateMotion(this._model, dt);
    this._model.saveParameters();
  }
  step(dt: number) { this.stepMotion(dt); this._physics.evaluate(this._model, dt); }
  finished() { return this._motionManager.isFinished(); }
  stabilize() { this._physics.stabilization(this._model); }
}

/** R5 has no public per-context remove API. Keep this narrow compatibility shim version-pinned. */
function releaseShaderContext(gl: WebGLRenderingContext) {
  const manager = CubismShaderManager_WebGL.getInstance() as unknown as { _shaderMap: Map<WebGLRenderingContext, { release(): void }> };
  manager._shaderMap.get(gl)?.release();
  manager._shaderMap.delete(gl);
}

class OfficialCubismRenderer implements SpiritRenderer {
  private user?: SpiritModel;
  private gl?: WebGLRenderingContext;
  private textures: WebGLTexture[] = [];
  private textureSources: string[] = [];
  private motions = new Map<SpiritMotion, CubismMotion>();
  private controller = new AbortController();
  private paused = true;
  private disposed = false;
  private loading = false;
  private ready = false;
  private diagnosticMotion?: { motion: CubismMotion; entry: CubismMotionQueueEntry; baseline: DiagnosticBaseline; lastTime: number; name: SpiritMotion; mode: "raw_curve" | "application_policy" };
  private raf = 0;
  private lastFrame = 0;
  private current?: SpiritMotion;
  private complete?: () => void;
  private media = matchMedia("(prefers-reduced-motion: reduce)");
  private reduced = this.media.matches;

  constructor(private canvas: HTMLCanvasElement, private readonly neutralOnly = false) {
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.media.addEventListener("change", this.onReducedMotion);
  }

  private onVisibility = () => { this.cancelFrame(); this.schedule(); };
  private onReducedMotion = () => {
    if (this.neutralOnly) return;
    void this.play("idle", { interrupt: true, reducedMotion: this.media.matches }).catch(error => this.fail(error));
  };
  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.fail(new Error("Cubism WebGL context was lost"));
  };
  private fail(error: unknown) {
    this.dispose();
    this.canvas.dispatchEvent(new CustomEvent("forest-spirit-error", { detail: error instanceof Error ? error.message : String(error) }));
  }

  async load(asset: ModelSource, signal: AbortSignal) {
    if (this.disposed || this.loading || this.ready) throw new Error("Cubism renderer cannot be reused");
    this.loading = true;
    const combined = AbortSignal.any([signal, this.controller.signal, AbortSignal.timeout(30000)]);
    const read = async (url: string) => {
      const response = await fetch(url, { signal: combined, credentials: "same-origin", redirect: "error" });
      if (!response.ok) throw new Error(`Cubism resource HTTP ${response.status}: ${new URL(url, location.href).pathname}`);
      return response.arrayBuffer();
    };
    const json = (bytes: ArrayBuffer) => JSON.parse(new TextDecoder().decode(bytes));
    try {
      const modelUrl = new URL(asset.model3Url, location.href).href;
      if (new URL(modelUrl).origin !== location.origin) throw new Error("Model must be served from the current origin");
      const description = json(await read(modelUrl));
      const packageInfo = this.neutralOnly
        ? { ...inspectNeutralModelPackage(description, modelUrl), physics: undefined, motions: {} }
        : inspectModelPackage(description, modelUrl, asset.motions);
      this.textureSources = [...packageInfo.textures];
      const [moc, physics, motionBytes, textureBytes] = await Promise.all([
        read(packageInfo.moc), packageInfo.physics ? read(packageInfo.physics) : undefined,
        this.neutralOnly ? [] : Promise.all(motionNames.map(name => read(packageInfo.motions[name]))),
        Promise.all(packageInfo.textures.map((url: string) => read(url))),
      ]);
      const parameterOwners = new Set<string>();
      const movingParameters = new Set<string>();
      const fingerprints = new Set<string>();
      for (const [index, buffer] of motionBytes.entries()) {
        inspectMotion(json(buffer), motionNames[index]).forEach((id: string) => parameterOwners.add(id));
        animatedParameters(json(buffer)).forEach((id: string) => movingParameters.add(id));
        // Detect renamed copies of one action; this does not replace visual motion review.
        const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))).join(",");
        if (fingerprints.has(fingerprint)) throw new Error("Required motions contain duplicate files");
        fingerprints.add(fingerprint);
      }
      const physicsOutputs = physics ? inspectPhysics(json(physics)) : [];
      if (physicsOutputs.some((id: string) => movingParameters.has(id))) throw new Error("Motion and physics must not both animate the same parameter");
      combined.throwIfAborted();
      if (!CubismFramework.isStarted()) CubismFramework.startUp({ logFunction: (message: string) => console.warn(message), loggingLevel: LogLevel.LogLevel_Warning });
      if (!CubismFramework.isInitialized()) CubismFramework.initialize();
      if (!CubismMoc.hasMocConsistency(moc)) throw new Error("moc3 consistency check failed");
      const gl = this.canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
      if (!gl) throw new Error("WebGL is unavailable");
      this.gl = gl;
      const user = new SpiritModel();
      this.user = user;
      user.loadModel(moc, true);
      const model = user.getModel();
      if (!model) throw new Error("Cubism Core could not create the model");
      if (this.neutralOnly && (Math.abs(model.getCanvasWidth() * model.getPixelsPerUnit() - neutralCaptureSize.width) > 0.5 || Math.abs(model.getCanvasHeight() * model.getPixelsPerUnit() - neutralCaptureSize.height) > 0.5)) throw new Error("v8 neutral diagnostic requires the actual 971x1620 model canvas; no rescaling substitute is accepted");
      const actualParameters = new Set(Array.from({ length: model.getParameterCount() }, (_, index) => String(model.getParameterId(index).getString())));
      for (const id of [...parameterOwners, ...physicsOutputs]) {
        if (!actualParameters.has(id)) throw new Error(`Authored parameter is absent from moc3: ${id}`);
      }
      if (physics) { user.loadPhysics(physics, physics.byteLength); user.stabilize(); }
      for (const [index, buffer] of motionBytes.entries()) {
        const motion = CubismMotion.create(buffer, buffer.byteLength, undefined, undefined, true);
        if (!motion) throw new Error(`Cubism rejected ${motionNames[index]}`);
        configureMotionPlayback(motion, motionNames[index] as SpiritMotion, inspectMotion(json(buffer), motionNames[index]));
        this.motions.set(motionNames[index] as SpiritMotion, motion);
      }
      user.createRenderer(this.canvas.width, this.canvas.height);
      const renderer = user.getRenderer();
      renderer.startUp(gl);
      renderer.setIsPremultipliedAlpha(true);
      for (const [index, buffer] of textureBytes.entries()) {
        // ImageBitmap ignores UNPACK_PREMULTIPLY_ALPHA_WEBGL; decode it premultiplied.
        const image = await createImageBitmap(new Blob([buffer]), { premultiplyAlpha: "premultiply" });
        try {
          combined.throwIfAborted();
          const texture = gl.createTexture();
          if (!texture) throw new Error("WebGL texture allocation failed");
          this.textures.push(texture);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          renderer.bindTexture(index, texture);
        } finally { image.close(); }
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      // R5 loads shader files asynchronously. Route its private fetch through our abort signal.
      const shader = CubismShaderManager_WebGL.getInstance().getShader(gl) as unknown as {
        _isShaderLoaded: boolean; _isShaderLoading: boolean; loadShader(url: string): Promise<string>;
      };
      shader.loadShader = async (url) => new TextDecoder().decode(await read(url));
      renderer.loadShaders(shaderPath);
      const deadline = performance.now() + 15000;
      while (!shader._isShaderLoaded) {
        // Wait for the SDK's catch/compile to settle before releasing its GL resources.
        if (!shader._isShaderLoading) throw new Error("Cubism shader loading failed");
        if (performance.now() > deadline) this.controller.abort();
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      combined.throwIfAborted();
      this.ready = true;
      model.loadParameters();
      if (this.neutralOnly) this.resetNeutral();
      model.update();
      this.draw();
    } catch (error) {
      this.disposed = true;
      this.controller.abort();
      throw error;
    } finally {
      this.loading = false;
      if (this.disposed) this.dispose();
    }
  }

  play(name: SpiritMotion, options?: { interrupt?: boolean; reducedMotion?: boolean }): Promise<void> {
    if (this.neutralOnly) return Promise.reject(new Error("Neutral diagnostic does not play motions or evaluate physics"));
    if (!this.ready || this.disposed || !this.user) return Promise.resolve();
    this.reduced = this.media.matches || options?.reducedMotion === true;
    if (this.current && name !== "idle" && options?.interrupt === false) return Promise.resolve();
    this.complete?.();
    this.complete = undefined;
    this.user.stop();
    this.user.getModel().loadParameters();
    this.current = name;
    this.cancelFrame();
    if (this.reduced) {
      this.resetNeutral();
      this.user.getModel().update();
      try { this.draw(); } catch (error) { this.fail(error); return Promise.reject(error); }
      return Promise.resolve();
    }
    const motion = this.motions.get(name);
    if (!motion) return Promise.reject(new Error(`Missing motion: ${name}`));
    this.user.start(motion);
    this.schedule();
    return name === "idle" ? Promise.resolve() : new Promise(resolve => { this.complete = resolve; });
  }

  private draw() {
    if (!this.user || !this.gl || this.disposed) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const model = this.user.getModel();
    const aspect = this.canvas.width / this.canvas.height;
    const fit = Math.min(1, aspect / (model.getCanvasWidth() / model.getCanvasHeight())) * (this.neutralOnly ? 1 : 0.96);
    const matrix = new CubismMatrix44();
    matrix.scale(fit / aspect, fit);
    matrix.multiplyByMatrix(this.user.getModelMatrix());
    const renderer = this.user.getRenderer();
    renderer.setMvpMatrix(matrix);
    renderer.setRenderState(null, [0, 0, this.canvas.width, this.canvas.height]);
    renderer.drawModel(shaderPath);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.canAnimate() || !this.user) return;
    if (!this.lastFrame) this.lastFrame = now;
    if (now - this.lastFrame >= 1000 / 30) {
      const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
      this.lastFrame = now;
      try {
        this.user.step(dt);
        this.user.getModel().update();
        this.draw();
        if (this.current !== "idle" && this.user.finished()) {
          const completed = this.current;
          this.complete?.(); this.complete = undefined;
          // DragHold keeps its final frame until explicit PutDown; other one-shots return to Idle.
          if (completed === "drag_hold") { this.current = undefined; return; }
          void this.play("idle", { interrupt: true });
        }
      } catch (error) { this.fail(error); return; }
    }
    this.schedule();
  };
  private canAnimate() { return !this.neutralOnly && this.ready && !this.disposed && !this.paused && !document.hidden && !this.reduced && Boolean(this.current); }
  private schedule() { if (!this.raf && this.canAnimate()) this.raf = requestAnimationFrame(this.frame); }
  private cancelFrame() { cancelAnimationFrame(this.raf); this.raf = 0; this.lastFrame = 0; }
  pause() { this.paused = true; this.cancelFrame(); }
  resume() { if (!this.disposed) { this.paused = false; this.lastFrame = 0; this.schedule(); } }
  resize(width: number, height: number, dpr: number) {
    if (this.neutralOnly) { width = neutralCaptureSize.width; height = neutralCaptureSize.height; dpr = 1; }
    const finite = (value: number) => Number.isFinite(value) ? Math.max(1, value) : 1;
    this.canvas.width = Math.min(2048, Math.round(finite(width) * Math.min(2, finite(dpr))));
    this.canvas.height = Math.min(2048, Math.round(finite(height) * Math.min(2, finite(dpr))));
    if (this.ready && !this.disposed) {
      try { this.user?.setRenderTargetSize(this.canvas.width, this.canvas.height); this.draw(); }
      catch (error) { this.fail(error); }
    }
  }
  private resetNeutral() {
    this.endDiagnosticMotion();
    const model = this.user?.getModel();
    if (!model) return;
    this.user?.stop();
    this.cancelFrame();
    for (let index = 0; index < model.getParameterCount(); index++) model.setParameterValueByIndex(index, model.getParameterDefaultValue(index));
    model.saveParameters();
  }
  private captureDiagnosticState(eyes?: { left: number; right: number }, capturePng = true, parameters?: Record<string, number>, motionStep?: (model: CubismModel) => void, retainedBaseline?: DiagnosticBaseline) {
    if (!this.neutralOnly || !this.ready || this.disposed || !this.user || !this.gl) throw new Error("A loaded, real neutral diagnostic model is required");
    if (!motionStep) this.resetNeutral();
    const model = this.user.getModel();
    model.update();
    const baseline = retainedBaseline ?? Array.from({ length: model.getDrawableCount() }, (_, index) => ({
      vertices: model.getDrawableVertexPositions(index).slice(), opacity: model.getDrawableOpacity(index),
    }));
    if (eyes) {
      for (const value of [eyes.left, eyes.right]) {
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Eye diagnostics require finite values within 0..1");
        if (capturePng && ![0, 0.25, 0.5, 0.75, 1].includes(value)) throw new Error("Eye captures accept only explicit 0, 0.25, 0.5, 0.75 or 1 key samples");
      }
      // getParameterIndex fabricates virtual indices for absent IDs. Enumerate the
      // actual Core parameters instead so a missing exported binding cannot pass.
      const actual = new Map(Array.from({ length: model.getParameterCount() }, (_, index) => [String(model.getParameterId(index).getString()), index]));
      for (const [id, value] of [["ParamEyeLOpen", eyes.left], ["ParamEyeROpen", eyes.right]] as const) {
        const index = actual.get(id);
        if (index === undefined) throw new Error(`Actual moc3 parameter is missing: ${id}`);
        model.setParameterValueByIndex(index, value);
      }
      model.update();
    }
    if (parameters) {
      const actual = new Map(Array.from({ length: model.getParameterCount() }, (_, index) => [String(model.getParameterId(index).getString()), index]));
      for (const [id, value] of Object.entries(parameters)) {
        const index = actual.get(id);
        if (index === undefined) throw new Error(`Actual moc3 parameter is missing: ${id}`);
        if (!Number.isFinite(value) || value < model.getParameterMinimumValue(index) || value > model.getParameterMaximumValue(index)) throw new Error(`Diagnostic parameter is outside its exported bounds: ${id}=${value}`);
        model.setParameterValueByIndex(index, value);
      }
      model.update();
    }
    if (motionStep) { motionStep(model); model.update(); }
    this.draw();
    // Capture synchronously after draw; do not depend on a preserved WebGL buffer.
    const pngDataUrl = capturePng ? this.canvas.toDataURL("image/png") : undefined;
    const glError = this.gl.getError();
    if (glError !== this.gl.NO_ERROR) throw new Error(`Neutral capture WebGL error ${glError}`);
    return {
      pngDataUrl, ...neutralCaptureSize, devicePixelRatio: 1, fit: 1,
      pixelsPerUnit: model.getPixelsPerUnit(),
      canvasInfo: { widthPixels: model.getModel().canvasinfo.CanvasWidth, heightPixels: model.getModel().canvasinfo.CanvasHeight, originX: model.getModel().canvasinfo.CanvasOriginX, originY: model.getModel().canvasinfo.CanvasOriginY, pixelsPerUnit: model.getModel().canvasinfo.PixelsPerUnit },
      parameterBounds: Object.fromEntries(Array.from({ length: model.getParameterCount() }, (_, index) => [String(model.getParameterId(index).getString()), { minimum: model.getParameterMinimumValue(index), maximum: model.getParameterMaximumValue(index), default: model.getParameterDefaultValue(index) }])),
      scope: "Actual moc3 directly driven diagnostic only; no production approval or authored motion acceptance",
      requestedEyeState: eyes ?? null,
      requestedParameterState: parameters ?? null,
      motionsAdvanced: Boolean(motionStep), physicsAdvanced: false, drawableCount: model.getDrawableCount(), textureCount: this.textures.length,
      textures: this.textureSources.map((url, index) => ({ index, url })),
      parameters: Object.fromEntries(Array.from({ length: model.getParameterCount() }, (_, index) => [String(model.getParameterId(index).getString()), model.getParameterValueByIndex(index)])),
      drawables: Array.from({ length: model.getDrawableCount() }, (_, index) => {
        const vertices = model.getDrawableVertexPositions(index);
        let changedVertexCount = 0, maximumDisplacement = 0;
        for (let position = 0; position < vertices.length; position += 2) {
          const delta = Math.hypot(vertices[position] - baseline[index].vertices[position], vertices[position + 1] - baseline[index].vertices[position + 1]);
          if (delta > 1e-7) changedVertexCount++;
          maximumDisplacement = Math.max(maximumDisplacement, delta);
        }
        const opacity = model.getDrawableOpacity(index), textureIndex = model.getDrawableTextureIndex(index);
        return {
          id: String(model.getDrawableId(index).getString()), opacity,
          renderOrder: model.getRenderOrders()[index],
          vertexCount: model.getDrawableVertexCount(index), vertexIndexCount: model.getDrawableVertexIndexCount(index),
          textureIndex, textureIndexValid: textureIndex >= 0 && textureIndex < this.textures.length,
          visible: model.getDrawableDynamicFlagIsVisible(index), opacityDeltaFromNeutral: opacity - baseline[index].opacity,
          changedVertexCount, maximumVertexDisplacementPixels: maximumDisplacement * model.getPixelsPerUnit(),
          vertexPositions: Array.from(vertices),
          vertexIndices: Array.from(model.getDrawableVertexIndices(index)),
        };
      }),
    };
  }
  captureNeutral() { return this.captureDiagnosticState(); }
  captureEyeState(left: number, right: number) { return this.captureDiagnosticState({ left, right }); }
  renderEyeState(left: number, right: number) { return this.captureDiagnosticState({ left, right }, false); }
  captureParameterState(parameters: Record<string, number>, capturePng = true) { return this.captureDiagnosticState(undefined, capturePng, parameters); }
  startDiagnosticMotion(text: string, name: SpiritMotion, mode: "raw_curve" | "application_policy", initialParameters: Record<string, number> = {}) {
    if (!motionNames.includes(name) || !["raw_curve", "application_policy"].includes(mode)) throw new Error("Unsupported diagnostic motion policy");
    this.captureDiagnosticState(undefined, false);
    const model = this.user?.getModel();
    if (!model) throw new Error("A loaded actual model is required for diagnostic motion");
    const baseline = Array.from({ length: model.getDrawableCount() }, (_, index) => ({ vertices: model.getDrawableVertexPositions(index).slice(), opacity: model.getDrawableOpacity(index) }));
    const document = JSON.parse(text), parameterIds = inspectMotion(document, name);
    const actualIds = new Set(Array.from({ length: model.getParameterCount() }, (_, index) => String(model.getParameterId(index).getString())));
    for (const id of parameterIds) if (!actualIds.has(id)) throw new Error(`Actual moc3 motion parameter is missing: ${id}`);
    this.captureParameterState(initialParameters, false);
    const buffer = new TextEncoder().encode(text).buffer;
    const motion = CubismMotion.create(buffer, buffer.byteLength, undefined, undefined, true);
    if (!motion) throw new Error("Official SDK rejected diagnostic motion");
    let entry: CubismMotionQueueEntry | undefined;
    try {
      configureMotionPlayback(motion, name, parameterIds);
      if (mode === "raw_curve") {
        motion.setLoop(false); motion.setFadeInTime(0); motion.setFadeOutTime(0);
        for (const id of parameterIds) {
          const handle = CubismFramework.getIdManager().getId(id);
          motion.setParameterFadeInTime(handle, 0); motion.setParameterFadeOutTime(handle, 0);
        }
      }
      if (mode === "application_policy") {
        if (!this.user) throw new Error("Actual diagnostic model was disposed");
        model.saveParameters();
        entry = this.user.start(motion);
        this.user.stepMotion(0);
      } else {
        entry = new CubismMotionQueueEntry();
        entry._motion = motion;
        motion.setupMotionQueueEntry(entry, 0);
      }
      this.diagnosticMotion = { motion, entry, baseline, lastTime: mode === "application_policy" ? 0 : -1, name, mode };
      return { name, mode, sourceLoopMetadata: document.Meta.Loop, configuredLoop: motion.getLoop(), configuredFadeIn: motion.getFadeInTime(), configuredFadeOut: motion.getFadeOutTime(), duration: motion.getLoopDuration(), parameterIds, actualProductionMotionManager: mode === "application_policy", physicsAdvanced: false };
    } catch (error) { this.user?.stop(); entry?.release(); motion.release(); throw error; }
  }
  sampleDiagnosticMotion(timeSeconds: number, capturePng = false) {
    const session = this.diagnosticMotion;
    if (!session || !Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds < session.lastTime) throw new Error("Motion samples require an active session and finite nondecreasing time");
    const dt = timeSeconds - Math.max(0, session.lastTime);
    session.lastTime = timeSeconds;
    const state = this.captureDiagnosticState(undefined, capturePng, undefined, model => {
      if (session.mode === "application_policy") {
        if (!session.entry.isFinished()) this.user?.stepMotion(dt);
      } else session.motion.updateParameters(model, session.entry, timeSeconds);
    }, session.baseline);
    return { ...state, motionSample: { name: session.name, mode: session.mode, timeSeconds, finished: session.entry.isFinished(), weight: session.entry.getStateWeight(), configuredLoop: session.motion.getLoop() } };
  }
  endDiagnosticMotion() {
    if (this.diagnosticMotion?.mode === "application_policy") this.user?.stop();
    this.diagnosticMotion?.entry.release();
    this.diagnosticMotion?.motion.release();
    this.diagnosticMotion = undefined;
  }
  dispose() {
    this.endDiagnosticMotion();
    this.disposed = true;
    this.controller.abort();
    this.cancelFrame();
    this.complete?.(); this.complete = undefined;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.media.removeEventListener("change", this.onReducedMotion);
    if (!this.loading) this.release();
  }
  private release() {
    this.user?.release(); this.user = undefined;
    for (const motion of this.motions.values()) motion.release();
    this.motions.clear();
    if (this.gl) {
      for (const texture of this.textures) this.gl.deleteTexture(texture);
      releaseShaderContext(this.gl);
      this.gl.clearColor(0, 0, 0, 0); this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    this.textures = []; this.textureSources = []; this.gl = undefined; this.ready = false;
    // Framework/Core are shared. Never dispose the global framework for one canvas.
  }
}

export const createCubismRenderer = (canvas: HTMLCanvasElement): SpiritRenderer => new OfficialCubismRenderer(canvas);

/** Deliberately separate from the production factory and asset-readiness contract. */
export function createNeutralDiagnosticRenderer(canvas: HTMLCanvasElement) {
  const renderer = new OfficialCubismRenderer(canvas, true);
  renderer.resize(neutralCaptureSize.width, neutralCaptureSize.height, 1);
  return {
    load: (source: Pick<ModelSource, "model3Url">, signal: AbortSignal) => renderer.load(source, signal),
    captureNeutral: () => renderer.captureNeutral(),
    captureEyeState: (left: number, right: number) => renderer.captureEyeState(left, right),
    renderEyeState: (left: number, right: number) => renderer.renderEyeState(left, right),
    captureParameterState: (parameters: Record<string, number>, capturePng = true) => renderer.captureParameterState(parameters, capturePng),
    startDiagnosticMotion: (text: string, name: SpiritMotion, mode: "raw_curve" | "application_policy", initialParameters: Record<string, number> = {}) => renderer.startDiagnosticMotion(text, name, mode, initialParameters),
    sampleDiagnosticMotion: (timeSeconds: number, capturePng = false) => renderer.sampleDiagnosticMotion(timeSeconds, capturePng),
    endDiagnosticMotion: () => renderer.endDiagnosticMotion(),
    dispose: () => renderer.dispose(),
  };
}
