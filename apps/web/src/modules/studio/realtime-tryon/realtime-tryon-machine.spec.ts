// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileTryOnPrompt, providerErrorMessage, RealtimeTryOnController } from "./realtime-tryon-machine";
import type { RealtimeTryOnApi, TryOnAdapter, TryOnConnection, TryOnGarment } from "./realtime-tryon-types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function stream() {
  const events = new EventTarget();
  const track = Object.assign(events, { readyState: "live", stop: vi.fn() });
  return {
    media: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
    track,
  };
}

function outputVideo() {
  const video = document.createElement("video");
  Object.defineProperties(video, {
    videoWidth: { value: 1280, configurable: true },
    videoHeight: { value: 720, configurable: true },
    readyState: { value: 2, configurable: true },
  });
  let callback: VideoFrameRequestCallback | null = null;
  video.requestVideoFrameCallback = vi.fn((next: VideoFrameRequestCallback) => { callback = next; return 1; });
  video.cancelVideoFrameCallback = vi.fn(() => { callback = null; });
  return {
    video,
    present() { const fn = callback; callback = null; fn?.(0, {} as VideoFrameCallbackMetadata); },
  };
}

const garment = (assetId: string): TryOnGarment => ({ assetId, file: new File(["reference"], `${assetId}.png`, { type: "image/png" }) });
const session = {
  sessionId: "session-1", clientToken: "fake-client-token-not-a-real-key", tokenExpiresAt: "2026-10-29T10:00:30.000Z",
  modelId: "lucy-vton-3.6", maxSessionSeconds: 60, serverNow: "2026-10-29T10:00:00.000Z", estimatedUsdPerSecond: "0.02",
};

function fixture() {
  const local = stream();
  const remote = stream();
  const connection: TryOnConnection = { set: vi.fn(async () => {}), disconnect: vi.fn() };
  let callbacks!: Parameters<TryOnAdapter["connect"]>[0];
  const adapter: TryOnAdapter = {
    connect: vi.fn(async (options) => { callbacks = options; options.onRemoteStream(remote.media); return connection; }),
  };
  const api: RealtimeTryOnApi = {
    create: vi.fn(async () => ({ ...session })), observe: vi.fn(async () => ({})), end: vi.fn(async () => ({})),
  };
  const camera = vi.fn(async () => local.media);
  const controller = new RealtimeTryOnController(api, adapter, camera);
  const output = outputVideo();
  controller.bindOutputVideo(output.video);
  return { local, remote, connection, adapter, api, camera, controller, output, callbacks: () => callbacks };
}

const owned: RealtimeTryOnController[] = [];
afterEach(() => {
  owned.splice(0).forEach((controller) => controller.stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function live() {
  const f = fixture();
  owned.push(f.controller);
  await f.controller.openCamera();
  await f.controller.start(garment("a"), "project", "2026-10-29");
  f.output.present();
  expect(f.controller.getSnapshot().status).toBe("live");
  return f;
}

describe("real-time try-on lifecycle with fake media and no vendor requests", () => {
  it("Strict Mode cleanup before any action preserves the initial idle label", () => {
    const f = fixture(); owned.push(f.controller);
    f.controller.stop("strict-mode-cleanup");
    expect(f.controller.getSnapshot().status).toBe("idle");
    expect(f.camera).not.toHaveBeenCalled();
    expect(f.api.create).not.toHaveBeenCalled();
  });

  it("construction and camera preview do not issue a token or connect", async () => {
    const f = fixture(); owned.push(f.controller);
    expect(f.camera).not.toHaveBeenCalled();
    await f.controller.openCamera();
    expect(f.controller.getSnapshot().status).toBe("local-preview");
    expect(f.api.create).not.toHaveBeenCalled();
    expect(f.adapter.connect).not.toHaveBeenCalled();
  });

  it("keeps late camera permission results out of a closed session", async () => {
    const f = fixture(); owned.push(f.controller);
    const permission = deferred<MediaStream>();
    vi.mocked(f.camera).mockReturnValueOnce(permission.promise);
    const opening = f.controller.openCamera();
    f.controller.stop();
    permission.resolve(f.local.media);
    await opening;
    expect(f.local.track.stop).toHaveBeenCalledOnce();
    expect(f.controller.getSnapshot().localStream).toBeNull();
    expect(f.api.create).not.toHaveBeenCalled();
  });

  it("locks double starts and waits for a presented remote frame", async () => {
    const f = fixture(); owned.push(f.controller);
    await f.controller.openCamera();
    await Promise.all([f.controller.start(garment("a"), "project", "2026-10-29"), f.controller.start(garment("a"), "project", "2026-10-29")]);
    expect(f.api.create).toHaveBeenCalledOnce();
    expect(f.adapter.connect).toHaveBeenCalledOnce();
    expect(f.controller.getSnapshot().status).toBe("connecting");
    expect(f.controller.getSnapshot().canCapture).toBe(false);
    await expect(f.controller.capture(f.output.video)).rejects.toMatchObject({ code: "OUTPUT_NOT_READY" });
    f.output.present();
    expect(f.controller.getSnapshot().status).toBe("live");
  });

  it("ends a token request that returns after stop without connecting", async () => {
    const f = fixture(); owned.push(f.controller);
    const token = deferred<typeof session>();
    vi.mocked(f.api.create).mockReturnValueOnce(token.promise);
    await f.controller.openCamera();
    const starting = f.controller.start(garment("a"), "project", "2026-10-29");
    f.controller.stop(); token.resolve(session); await starting;
    expect(f.api.end).toHaveBeenCalledWith("session-1", "cancelled-before-connect");
    expect(f.adapter.connect).not.toHaveBeenCalled();
    expect(f.local.track.stop).toHaveBeenCalledOnce();
  });

  it("disconnects late connections and rejects their late streams", async () => {
    const f = fixture(); owned.push(f.controller);
    const connection = deferred<TryOnConnection>();
    let remoteCallback!: (stream: MediaStream) => void;
    vi.mocked(f.adapter.connect).mockImplementationOnce((options) => { remoteCallback = options.onRemoteStream; return connection.promise; });
    await f.controller.openCamera();
    const starting = f.controller.start(garment("a"), "project", "2026-10-29");
    await Promise.resolve();
    f.controller.stop();
    remoteCallback(f.remote.media);
    connection.resolve(f.connection); await starting;
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.remote.track.stop).toHaveBeenCalledOnce();
    expect(f.output.video.srcObject).toBeNull();
    expect(f.controller.getSnapshot().status).toBe("ended");
  });

  it("coalesces B/C/D into one current and one latest full state update", async () => {
    const f = await live();
    const update = deferred<undefined>();
    vi.mocked(f.connection.set).mockReturnValueOnce(update.promise);
    f.controller.selectGarment(garment("b"));
    f.controller.selectGarment(garment("c"));
    f.controller.selectGarment(garment("d"));
    expect(f.connection.set).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().canCapture).toBe(false);
    f.output.present();
    update.resolve(undefined); await update.promise; await Promise.resolve(); await Promise.resolve();
    expect(vi.mocked(f.connection.set).mock.calls.map(([state]) => state.image.name)).toEqual(["b.png", "d.png"]);
    for (const [state] of vi.mocked(f.connection.set).mock.calls) {
      expect(state.enhance).toBe(false);
      expect(state.prompt).toContain("Substitute the current top");
    }
    expect(f.controller.getSnapshot().canCapture).toBe(false);
    f.output.present();
    expect(f.controller.getSnapshot()).toMatchObject({ status: "live", garmentAssetId: "d", garmentRevision: 3, canCapture: true });
    expect(f.adapter.connect).toHaveBeenCalledOnce();
  });

  it("a pending update cannot revive the state after stop", async () => {
    const f = await live();
    const update = deferred<undefined>();
    vi.mocked(f.connection.set).mockReturnValueOnce(update.promise);
    f.controller.selectGarment(garment("b"));
    f.controller.stop(); update.resolve(undefined); await update.promise; await Promise.resolve();
    expect(f.controller.getSnapshot().status).toBe("ended");
    expect(f.controller.getSnapshot().canCapture).toBe(false);
  });

  it("binds saved outfit identities independently of local update numbers and sends the latest complete state", async () => {
    const f = fixture(); owned.push(f.controller);
    const outfit = (id: string): TryOnGarment => ({ ...garment("same-reference"), outfitSnapshotId: id, outfitPrompt: `Complete outfit ${id}: top, bottom and hat. Remove previous items.` });
    await f.controller.openCamera();
    await f.controller.start(outfit("snapshot-v7"), "project", "2026-10-29");
    expect(f.api.create).toHaveBeenCalledWith(expect.objectContaining({ outfitSnapshotId: "snapshot-v7" }), expect.any(String));
    expect(f.callbacks().initialState.prompt).toContain("Complete outfit snapshot-v7");
    f.output.present();
    const update = deferred<undefined>();
    vi.mocked(f.connection.set).mockReturnValueOnce(update.promise);
    f.controller.selectGarment(outfit("snapshot-v8"));
    await Promise.resolve();
    f.controller.selectGarment(outfit("snapshot-v9"));
    f.controller.selectGarment(outfit("snapshot-v10"));
    f.output.present();
    expect(f.controller.getSnapshot().canCapture).toBe(false);
    update.resolve(undefined);
    for (let index = 0; index < 8; index++) await Promise.resolve();
    expect(vi.mocked(f.connection.set).mock.calls.map(([state]) => state.prompt)).toEqual([outfit("snapshot-v8").outfitPrompt, outfit("snapshot-v10").outfitPrompt]);
    expect(f.controller.getSnapshot()).toMatchObject({ garmentRevision: 3, outfitSnapshotId: "snapshot-v10", canCapture: false });
    expect(f.api.observe).toHaveBeenCalledWith("session-1", expect.objectContaining({ outfitSnapshotId: "snapshot-v10", garmentRevision: 3 }));
    f.output.present();
    expect(f.controller.getSnapshot().canCapture).toBe(true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["frame"])));
    expect(await f.controller.capture(f.output.video)).toMatchObject({ outfitSnapshotId: "snapshot-v10", garmentRevision: 3 });
    expect(f.adapter.connect).toHaveBeenCalledOnce();
  });

  it("stops before sending an outfit update when server validation rejects its snapshot", async () => {
    const f = await live();
    vi.mocked(f.api.observe).mockRejectedValueOnce(new Error("unverified outfit"));
    f.controller.selectGarment({ ...garment("outfit"), outfitSnapshotId: "unverified", outfitPrompt: "whole outfit" });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(f.connection.set).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().status).toBe("error");
    expect(f.local.track.stop).toHaveBeenCalled();
  });

  it("queues a replacement outfit during credential creation and applies it after the original connection", async () => {
    const f = fixture(); owned.push(f.controller);
    const token = deferred<typeof session>();
    vi.mocked(f.api.create).mockReturnValueOnce(token.promise);
    await f.controller.openCamera();
    const starting = f.controller.start({ ...garment("a"), outfitSnapshotId: "initial", outfitPrompt: "Initial full outfit" }, "project", "2026-10-29");
    f.controller.selectGarment({ ...garment("b"), outfitSnapshotId: "latest", outfitPrompt: "Latest full outfit" });
    token.resolve(session);
    await starting;
    for (let index = 0; index < 5; index++) await Promise.resolve();
    expect(f.api.create).toHaveBeenCalledOnce();
    expect(f.adapter.connect).toHaveBeenCalledOnce();
    expect(f.connection.set).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Latest full outfit" }));
    expect(f.controller.getSnapshot()).toMatchObject({ outfitSnapshotId: "latest", garmentRevision: 1, canCapture: false });
    f.output.present();
    expect(f.controller.getSnapshot().canCapture).toBe(true);
  });

  it("releases all tracks immediately even when disconnect and end fail", async () => {
    const f = await live();
    vi.mocked(f.connection.disconnect).mockImplementation(() => { throw new Error("transport error"); });
    vi.mocked(f.api.end).mockRejectedValue(new Error("offline"));
    f.controller.stop(); f.controller.stop();
    expect(f.local.track.stop).toHaveBeenCalledOnce();
    expect(f.remote.track.stop).toHaveBeenCalledOnce();
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.output.video.srcObject).toBeNull();
  });

  it("handles device loss and maps provider errors without exposing provider text", async () => {
    const f = await live();
    f.local.track.dispatchEvent(new Event("ended"));
    expect(f.controller.getSnapshot().status).toBe("error");
    expect(f.controller.getSnapshot().error).toContain("摄像头已断开");
    const g = await live();
    g.callbacks().onError("TOKEN_EXPIRED secret-api-key-must-never-render");
    expect(g.controller.getSnapshot().error).toContain("凭证无效或已过期");
    expect(g.controller.getSnapshot().error).not.toContain("secret");
  });

  it("treats generation ticks as monotonic cumulative observations", async () => {
    const f = await live();
    f.callbacks().onGeneration(3); f.callbacks().onGeneration(3); f.callbacks().onGeneration(2); f.callbacks().onGeneration(-1); f.callbacks().onGeneration(10000);
    expect(f.controller.getSnapshot().generationSeconds).toBe(3);
    f.callbacks().onGeneration(5);
    expect(f.controller.getSnapshot().generationSeconds).toBe(5);
  });

  it("stops on connection timeout and cannot be resurrected by a late connection", async () => {
    vi.useFakeTimers();
    const f = fixture(); owned.push(f.controller);
    const pending = deferred<TryOnConnection>();
    vi.mocked(f.adapter.connect).mockReturnValueOnce(pending.promise);
    await f.controller.openCamera();
    const connecting = f.controller.start(garment("a"), "project", "2026-10-29");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15001);
    expect(f.controller.getSnapshot().status).toBe("error");
    expect(f.local.track.stop).toHaveBeenCalledOnce();
    pending.resolve(f.connection); await connecting;
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
  });

  it("stops stalled output after five seconds instead of keeping a billable blank stream", async () => {
    vi.useFakeTimers();
    const f = await live();
    await vi.advanceTimersByTimeAsync(5001);
    expect(f.controller.getSnapshot().error).toContain("没有新画面");
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
  });

  it("stops at the server supplied session duration", async () => {
    vi.useFakeTimers();
    const f = await live();
    for (let i = 0; i < 59; i++) { await vi.advanceTimersByTimeAsync(1000); f.output.present(); }
    await vi.advanceTimersByTimeAsync(1001);
    expect(f.controller.getSnapshot().status).toBe("ended");
    expect(f.api.end).toHaveBeenCalledWith("session-1", "session-limit");
  });

  it("captures the remote frame at native resolution with provenance", async () => {
    const f = await live();
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
      expect(this.width).toBe(1280); expect(this.height).toBe(720);
      callback(new Blob(["output"], { type: "image/png" }));
    });
    const result = await f.controller.capture(f.output.video);
    expect(draw).toHaveBeenCalledWith(f.output.video, 0, 0, 1280, 720);
    expect(result).toMatchObject({ width: 1280, height: 720, sessionId: "session-1", garmentAssetId: "a", garmentRevision: 0 });
  });

  it("rejects local-camera and zero-dimension frames even while live", async () => {
    const f = await live();
    const otherVideo = outputVideo(); otherVideo.video.srcObject = f.local.media;
    await expect(f.controller.capture(otherVideo.video)).rejects.toMatchObject({ code: "OUTPUT_NOT_READY" });
    Object.defineProperty(f.output.video, "videoWidth", { value: 0 });
    await expect(f.controller.capture(f.output.video)).rejects.toMatchObject({ code: "OUTPUT_NOT_READY" });
  });

  it("keeps prompt input bounded and strips control characters", () => {
    const prompt = compileTryOnPrompt("jacket\u0000\n" + "x".repeat(5000));
    expect(prompt).not.toMatch(/[\u0000-\u001f]/);
    expect(prompt.length).toBeLessThan(1000);
  });

  it.each([
    ["INVALID_API_KEY", "凭证无效或已过期"], ["insufficient_credits", "额度不足"],
    ["session_limit", "并发上限"], ["moderation_violation", "未通过服务审核"],
  ])("maps supplier code %s to the corresponding action", (code, description) => {
    expect(providerErrorMessage(code)).toContain(description);
  });
});
