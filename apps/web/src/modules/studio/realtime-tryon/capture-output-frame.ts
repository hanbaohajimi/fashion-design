import { TryOnError } from "./realtime-tryon-types";

/** The caller must additionally verify the current session and presented-frame gate. */
export async function captureOutputFrame(video: HTMLVideoElement): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (video.readyState < 2 || !width || !height || video.ended || !video.srcObject) {
    throw new TryOnError("AI 输出尚无可保存画面，请等待真实输出帧。", "OUTPUT_NOT_READY");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new TryOnError("浏览器无法保存这一帧。", "CAPTURE_UNSUPPORTED");
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new TryOnError("截图失败，请重试。", "CAPTURE_FAILED"));
    }, "image/png");
  });
  return { blob, width, height };
}
