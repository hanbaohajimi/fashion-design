import type { CreateRealtimeTryOnSession } from "@fashion/shared";
import { captureOutputFrame } from "./capture-output-frame";
import { requestTryOnCamera, stopMediaStream } from "./camera-controller";
import {
  TryOnError,
  type RealtimeTryOnApi,
  type TryOnAdapter,
  type TryOnCapture,
  type TryOnConnection,
  type TryOnGarment,
  type TryOnGenerationState,
  type TryOnSnapshot,
} from "./realtime-tryon-types";

export function compileTryOnPrompt(description = ""): string {
  const detail = description.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500).trim();
  return [
    "Substitute the current top with the garment shown in the reference image.",
    "Preserve the garment's color, silhouette, neckline, sleeves, closures and pattern placement.",
    "Keep the person's identity, pose and background unchanged.",
    detail ? `Garment reference details: ${detail}` : "",
  ].filter(Boolean).join(" ");
}

function generationState(garment: TryOnGarment): TryOnGenerationState {
  return { image: garment.file, prompt: garment.outfitSnapshotId && garment.outfitPrompt ? garment.outfitPrompt : compileTryOnPrompt(garment.description), enhance: false };
}

const initialSnapshot: TryOnSnapshot = {
  status: "idle", localStream: null, remoteStream: null, error: null,
  sessionId: null, garmentAssetId: null, outfitSnapshotId: null, garmentRevision: 0,
  canCapture: false, generationSeconds: null,
};

/** One owner for camera, connection, frame gating and every asynchronous lifetime. */
export class RealtimeTryOnController {
  private snapshot: TryOnSnapshot = initialSnapshot;
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private connection: TryOnConnection | null = null;
  private connectionAbort: AbortController | null = null;
  private starting = false;
  private updating = false;
  private pendingGarment: { garment: TryOnGarment; revision: number } | null = null;
  private selectedGarment: TryOnGarment | null = null;
  private outputVideo: HTMLVideoElement | null = null;
  private frameCallback: number | null = null;
  private frameFallback: ReturnType<typeof setInterval> | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private sessionTimeout: ReturnType<typeof setTimeout> | null = null;
  private stallTimeout: ReturnType<typeof setTimeout> | null = null;
  private trackCleanups: Array<() => void> = [];
  private frameNumber = 0;
  private requiredFrame = Infinity;
  private appliedRevision = 0;
  private sequence = 0;
  private lastObservationAt = -Infinity;
  private capturing = false;

  constructor(
    private readonly api: RealtimeTryOnApi,
    private readonly adapter: TryOnAdapter,
    private readonly camera: () => Promise<MediaStream> = requestTryOnCamera,
    private readonly timeouts = { connectMs: 15_000, stallMs: 5_000 },
  ) {}

  readonly getSnapshot = (): TryOnSnapshot => this.snapshot;
  readonly getServerSnapshot = (): TryOnSnapshot => initialSnapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(patch: Partial<TryOnSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async openCamera(): Promise<void> {
    if (["requesting-camera", "local-preview", "creating-session", "connecting", "live", "updating-garment"].includes(this.snapshot.status)) return;
    const epoch = ++this.epoch;
    this.publish({ ...initialSnapshot, status: "requesting-camera" });
    try {
      const stream = await this.camera();
      if (epoch !== this.epoch) { stopMediaStream(stream); return; }
      if (!stream.getVideoTracks().some((track) => track.readyState === "live")) {
        stopMediaStream(stream);
        throw new TryOnError("摄像头没有有效视频轨道，请重试。", "CAMERA_NOT_READY");
      }
      for (const track of stream.getVideoTracks()) {
        const ended = () => this.fail("摄像头已断开，请检查设备后重新开启。", "camera-ended");
        track.addEventListener("ended", ended);
        this.trackCleanups.push(() => track.removeEventListener("ended", ended));
      }
      this.publish({ localStream: stream, status: "local-preview" });
    } catch (error) {
      if (epoch === this.epoch) this.fail(error instanceof TryOnError ? error.message : "无法开启摄像头，请检查设备与权限。", "camera-error");
    }
  }

  async start(garment: TryOnGarment, projectId: string, consentVersion: CreateRealtimeTryOnSession["consentVersion"]): Promise<void> {
    if (this.starting || this.snapshot.status !== "local-preview" || !this.snapshot.localStream) return;
    this.starting = true;
    const epoch = this.epoch;
    const localStream = this.snapshot.localStream;
    this.selectedGarment = garment;
    this.appliedRevision = 0;
    this.frameNumber = 0;
    this.requiredFrame = Infinity;
    this.sequence = 0;
    this.lastObservationAt = -Infinity;
    this.publish({ status: "creating-session", garmentAssetId: garment.assetId, outfitSnapshotId: garment.outfitSnapshotId ?? null, garmentRevision: 0, error: null, canCapture: false });
    this.connectionTimeout = setTimeout(() => {
      if (epoch === this.epoch) this.fail("连接等待超时，已停止本次试穿。请检查网络后手动重试。", "connect-timeout");
    }, this.timeouts.connectMs);
    try {
      const session = await this.api.create({ projectId, garmentAssetId: garment.assetId, ...(garment.outfitSnapshotId ? { outfitSnapshotId: garment.outfitSnapshotId } : {}), consentVersion }, crypto.randomUUID());
      if (epoch !== this.epoch) {
        void this.api.end(session.sessionId, "cancelled-before-connect").catch(() => {});
        return;
      }
      this.publish({ status: "connecting", sessionId: session.sessionId });
      // A bounded local deadline supplements, rather than replaces, upstream constraints.
      this.sessionTimeout = setTimeout(() => {
        if (epoch === this.epoch) this.stop("session-limit");
      }, session.maxSessionSeconds * 1000);
      this.requiredFrame = this.frameNumber;
      this.connectionAbort = new AbortController();
      const connection = await this.adapter.connect({
        token: session.clientToken,
        modelId: session.modelId,
        signal: this.connectionAbort.signal,
        stream: localStream,
        initialState: generationState(garment),
        onRemoteStream: (stream) => {
          if (epoch !== this.epoch) { stopMediaStream(stream); return; }
          if (this.snapshot.remoteStream && this.snapshot.remoteStream !== stream) stopMediaStream(this.snapshot.remoteStream);
          this.publish({ remoteStream: stream });
          this.attachOutputStream();
        },
        onError: (code) => { if (epoch === this.epoch) this.fail(providerErrorMessage(code), "provider-error"); },
        onEnded: () => { if (epoch === this.epoch) this.stop("provider-ended"); },
        onGeneration: (seconds) => {
          if (epoch !== this.epoch || !Number.isFinite(seconds) || seconds < 0 || seconds > session.maxSessionSeconds) return;
          const cumulative = Math.max(this.snapshot.generationSeconds ?? 0, seconds);
          this.publish({ generationSeconds: cumulative });
          this.observe();
        },
      });
      if (epoch !== this.epoch) { this.disconnect(connection); return; }
      this.connection = connection;
      this.starting = false;
      if (this.pendingGarment) void this.drainGarments(epoch);
      else this.allowPresentedFrame();
    } catch (error) {
      if (epoch === this.epoch) {
        this.fail(error instanceof TryOnError ? error.message : "实时试穿连接失败，请检查配置、额度和网络后重试。", "start-error");
      }
    } finally {
      if (epoch === this.epoch) this.starting = false;
    }
  }

  selectGarment(garment: TryOnGarment): void {
    if (!["creating-session", "connecting", "live", "updating-garment"].includes(this.snapshot.status)) return;
    if (garment.assetId === this.selectedGarment?.assetId && garment.outfitSnapshotId === this.selectedGarment?.outfitSnapshotId) return;
    this.selectedGarment = garment;
    const revision = this.snapshot.garmentRevision + 1;
    this.pendingGarment = { garment, revision };
    this.requiredFrame = Infinity;
    this.publish({ status: "updating-garment", garmentAssetId: garment.assetId, outfitSnapshotId: garment.outfitSnapshotId ?? null, garmentRevision: revision, canCapture: false });
    if (this.connection) void this.drainGarments(this.epoch);
  }

  private async drainGarments(epoch: number): Promise<void> {
    if (this.updating || !this.connection) return;
    this.updating = true;
    try {
      while (this.pendingGarment && epoch === this.epoch && this.connection) {
        const next = this.pendingGarment;
        this.pendingGarment = null;
        // Validate and durably bind the complete snapshot before sending its image upstream.
        if (next.garment.outfitSnapshotId && this.snapshot.sessionId) {
          await this.api.observe(this.snapshot.sessionId, {
            sequence: ++this.sequence, garmentAssetId: next.garment.assetId,
            outfitSnapshotId: next.garment.outfitSnapshotId, garmentRevision: next.revision,
            connectionState: "updating-garment",
          });
          if (epoch !== this.epoch || !this.connection) return;
        }
        await this.connection.set(generationState(next.garment));
        if (epoch !== this.epoch) return;
        this.appliedRevision = next.revision;
        // Only a frame presented AFTER acknowledgement unlocks capture.
        this.requiredFrame = this.frameNumber;
      }
      if (epoch === this.epoch) this.observe(true);
    } catch {
      if (epoch === this.epoch) this.fail("服装更新失败，已停止试穿。请检查图片或稍后重试。", "garment-update-error");
    } finally {
      if (epoch === this.epoch) this.updating = false;
    }
  }

  bindOutputVideo(video: HTMLVideoElement | null): void {
    if (this.outputVideo === video) return;
    this.cancelFrameMonitoring();
    if (this.outputVideo) this.outputVideo.srcObject = null;
    this.outputVideo = video;
    this.attachOutputStream();
  }

  private attachOutputStream(): void {
    const video = this.outputVideo;
    if (!video) return;
    video.srcObject = this.snapshot.remoteStream;
    this.cancelFrameMonitoring();
    if (!this.snapshot.remoteStream) return;
    const epoch = this.epoch;
    if (typeof video.requestVideoFrameCallback === "function") {
      const frame = () => {
        this.frameCallback = null;
        if (epoch !== this.epoch || video !== this.outputVideo || !this.snapshot.remoteStream || video.srcObject !== this.snapshot.remoteStream) return;
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) this.outputFramePresented();
        if (epoch === this.epoch && this.snapshot.remoteStream && video.srcObject === this.snapshot.remoteStream) {
          this.frameCallback = video.requestVideoFrameCallback(frame);
        }
      };
      this.frameCallback = video.requestVideoFrameCallback(frame);
    } else {
      let previousTime = video.currentTime;
      let previousFrames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      this.frameFallback = setInterval(() => {
        if (epoch !== this.epoch || video.srcObject !== this.snapshot.remoteStream) return;
        const frames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && (video.currentTime !== previousTime || frames > previousFrames)) {
          this.outputFramePresented();
        }
        previousTime = video.currentTime;
        previousFrames = frames;
      }, 100);
    }
  }

  private outputFramePresented(): void {
    this.frameNumber += 1;
    if (this.stallTimeout) clearTimeout(this.stallTimeout);
    const epoch = this.epoch;
    this.stallTimeout = setTimeout(() => {
      if (epoch === this.epoch) this.fail("AI 输出长时间没有新画面，已停止连接以避免继续消耗额度。", "output-stalled");
    }, this.timeouts.stallMs);
    this.allowPresentedFrame();
  }

  private allowPresentedFrame(): void {
    if (!this.connection || this.starting || this.updating || this.pendingGarment || this.appliedRevision !== this.snapshot.garmentRevision || this.frameNumber <= this.requiredFrame) return;
    if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
    this.connectionTimeout = null;
    if (!this.snapshot.canCapture || this.snapshot.status !== "live") {
      this.publish({ status: "live", canCapture: true });
      this.observe(true);
    }
  }

  async capture(video: HTMLVideoElement): Promise<TryOnCapture> {
    const { sessionId, garmentAssetId, outfitSnapshotId, garmentRevision, remoteStream, canCapture } = this.snapshot;
    if (this.capturing || !canCapture || this.snapshot.status !== "live" || !sessionId || !garmentAssetId || video !== this.outputVideo || video.srcObject !== remoteStream) {
      throw new TryOnError("请等待 AI 试穿输出稳定后再保存这一帧。", "OUTPUT_NOT_READY");
    }
    this.capturing = true;
    const epoch = this.epoch;
    const capturedAt = new Date().toISOString();
    try {
      const frame = await captureOutputFrame(video);
      if (epoch !== this.epoch || !this.snapshot.canCapture || garmentRevision !== this.snapshot.garmentRevision) {
        throw new TryOnError("试穿状态已变化，请重新保存当前画面。", "CAPTURE_STALE");
      }
      return { ...frame, sessionId, garmentAssetId, ...(outfitSnapshotId ? { outfitSnapshotId } : {}), garmentRevision, capturedAt };
    } finally { this.capturing = false; }
  }

  /** Synchronous resource release; an unreachable API cannot delay camera cleanup. */
  stop(reason = "user-stop"): void {
    const wasIdle = this.snapshot.status === "idle";
    this.epoch += 1;
    const sessionId = this.snapshot.sessionId;
    const connection = this.connection;
    this.connection = null;
    this.connectionAbort?.abort();
    this.connectionAbort = null;
    this.starting = false;
    this.updating = false;
    this.pendingGarment = null;
    this.selectedGarment = null;
    this.requiredFrame = Infinity;
    this.cancelFrameMonitoring();
    for (const timer of [this.connectionTimeout, this.sessionTimeout, this.stallTimeout]) if (timer) clearTimeout(timer);
    this.connectionTimeout = null;
    this.sessionTimeout = null;
    this.stallTimeout = null;
    this.trackCleanups.forEach((cleanup) => cleanup());
    this.trackCleanups = [];
    if (connection) this.disconnect(connection);
    stopMediaStream(this.snapshot.localStream);
    stopMediaStream(this.snapshot.remoteStream);
    if (this.outputVideo) this.outputVideo.srcObject = null;
    this.publish({ status: wasIdle ? "idle" : "ended", localStream: null, remoteStream: null, sessionId: null, canCapture: false, error: null });
    if (sessionId) void this.api.end(sessionId, reason.slice(0, 100)).catch(() => {});
  }

  private fail(message: string, reason: string): void {
    this.stop(reason);
    this.publish({ status: "error", error: message });
  }

  private disconnect(connection: TryOnConnection): void {
    try { void Promise.resolve(connection.disconnect()).catch(() => {}); } catch { /* Track cleanup must continue. */ }
  }

  private cancelFrameMonitoring(): void {
    if (this.frameCallback !== null && this.outputVideo?.cancelVideoFrameCallback) this.outputVideo.cancelVideoFrameCallback(this.frameCallback);
    this.frameCallback = null;
    if (this.frameFallback) clearInterval(this.frameFallback);
    this.frameFallback = null;
  }

  private observe(force = false): void {
    const id = this.snapshot.sessionId;
    if (!id || (!force && Date.now() - this.lastObservationAt < 2000)) return;
    this.lastObservationAt = Date.now();
    void this.api.observe(id, {
      sequence: ++this.sequence,
      ...(this.snapshot.generationSeconds === null ? {} : { generationSeconds: this.snapshot.generationSeconds }),
      garmentRevision: this.snapshot.garmentRevision,
      ...(this.snapshot.garmentAssetId ? { garmentAssetId: this.snapshot.garmentAssetId } : {}),
      ...(this.snapshot.outfitSnapshotId ? { outfitSnapshotId: this.snapshot.outfitSnapshotId } : {}),
      connectionState: this.snapshot.status,
    }).catch(() => {});
  }
}

export function providerErrorMessage(code: string): string {
  if (/AUTH|TOKEN|API_KEY|UNAUTHORIZED/i.test(code)) return "试穿凭证无效或已过期，已停止连接，请重新确认后重试。";
  if (/BALANCE|CREDIT|PAYMENT/i.test(code)) return "AI 服务额度不足，已停止连接，请联系管理员。";
  if (/CAPACITY|CONCURRENCY|RATE_LIMIT|SESSION_LIMIT/i.test(code)) return "AI 服务暂时繁忙或达到并发上限，请稍后手动重试。";
  if (/MODERAT|CONTENT|SAFETY|POLICY/i.test(code)) return "服装参考未通过服务审核，请选择合适的服装图片。";
  return "AI 服务连接中断，已停止试穿。请检查网络后手动重试。";
}
