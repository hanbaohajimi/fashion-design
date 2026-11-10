import { parseSpiritRenderAsset, type SpiritRenderAsset, type SpiritRenderer, type SpiritRendererFactory } from "./spirit-contract";

interface RuntimeModule {
  sdkVersion: string;
  createCubismRenderer: SpiritRendererFactory;
}

export interface RuntimeDependencies {
  loadCore(url: string): Promise<void>;
  importRuntime(url: string): Promise<RuntimeModule>;
}

const coreLoads = new Map<string, Promise<void>>();
let selectedCore: string | undefined;

function loadOfficialCore(url: string): Promise<void> {
  if (selectedCore && selectedCore !== url) return Promise.reject(new Error("Cubism Core version conflict"));
  const existing = coreLoads.get(url);
  if (existing) return existing;
  selectedCore = url;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (error?: Error) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve();
    };
    script.src = url;
    script.async = true;
    script.onload = () => finish("Live2DCubismCore" in window ? undefined : new Error("Cubism Core did not initialize"));
    script.onerror = () => finish(new Error("Cubism Core could not be loaded"));
    const timer = setTimeout(() => finish(new Error("Cubism Core load timed out")), 15000);
    document.head.append(script);
  });
  coreLoads.set(url, promise);
  void promise.catch(() => { coreLoads.delete(url); selectedCore = undefined; });
  return promise;
}

/** Manual instrumentation may wrap importRuntime while retaining this actual Core script loader. */
export const cubismResourceDependencies: Readonly<RuntimeDependencies> = Object.freeze({
  loadCore: loadOfficialCore,
  importRuntime: (url: string) => import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<RuntimeModule>,
});

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Shared resource mechanism, not an approval policy. Production must use the official factory. */
export function createCubismResourceRenderer(canvas: HTMLCanvasElement, loader: RuntimeDependencies = cubismResourceDependencies): SpiritRenderer {
  let instance: SpiritRenderer | undefined;
  let disposed = false;
  let loading = false;
  let paused = true;
  let size: [number, number, number] = [1, 1, 1];
  const lifetime = new AbortController();
  return {
    async load(asset: SpiritRenderAsset, signal: AbortSignal) {
      if (disposed || loading) throw new Error("Renderer is disposed or already loading");
      if (!parseSpiritRenderAsset(asset)) throw new Error("Valid local Cubism render resources are required");
      loading = true;
      const combined = AbortSignal.any([signal, lifetime.signal]);
      try {
        combined.throwIfAborted();
        await waitFor(loader.loadCore(asset.coreUrl), combined);
        combined.throwIfAborted();
        const runtime = await waitFor(loader.importRuntime(asset.runtimeModuleUrl), combined);
        combined.throwIfAborted();
        if (runtime.sdkVersion !== "5-r.5" || typeof runtime.createCubismRenderer !== "function") throw new Error("Unexpected Cubism runtime version");
        instance = runtime.createCubismRenderer(canvas);
        instance.resize(...size);
        await instance.load(asset, combined);
        combined.throwIfAborted();
        if (paused) instance.pause();
        else instance.resume();
      } catch (error) {
        instance?.dispose();
        instance = undefined;
        throw error;
      }
    },
    play: (motion, options) => instance?.play(motion, options) ?? Promise.resolve(),
    pause() { paused = true; instance?.pause(); },
    resume() { if (!disposed) { paused = false; instance?.resume(); } },
    resize(width, height, dpr) {
      size = [Number.isFinite(width) ? Math.max(1, width) : 1, Number.isFinite(height) ? Math.max(1, height) : 1, Number.isFinite(dpr) ? Math.max(1, Math.min(2, dpr)) : 1];
      instance?.resize(...size);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      instance?.dispose();
      instance = undefined;
    },
  };
}
