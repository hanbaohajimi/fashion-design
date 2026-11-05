import { TryOnError } from "./realtime-tryon-types";

export function stopMediaStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    try { track.stop(); } catch { /* Release every track, even when one fails. */ }
  }
}

export async function requestTryOnCamera(): Promise<MediaStream> {
  if (!globalThis.isSecureContext) {
    throw new TryOnError("请通过 HTTPS 或 localhost 使用摄像头。", "CAMERA_INSECURE_CONTEXT");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new TryOnError("此浏览器不支持摄像头，请使用支持摄像头的浏览器。", "CAMERA_UNSUPPORTED");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new TryOnError("摄像头权限被拒绝，请在浏览器设置中允许访问后重试。", "CAMERA_DENIED");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new TryOnError("没有可用的摄像头，请连接设备后重试。", "CAMERA_NOT_FOUND");
    }
    if (name === "NotReadableError" || name === "AbortError") {
      throw new TryOnError("摄像头可能被其他应用占用，请关闭占用后重试。", "CAMERA_BUSY");
    }
    throw new TryOnError("无法开启摄像头，请检查设备与浏览器权限。", "CAMERA_FAILED");
  }
}
