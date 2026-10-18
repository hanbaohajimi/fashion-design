import { privateFetch as fetch } from "../../auth/private-fetch";
async function averageTone(url: string): Promise<readonly [number, number, number]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("图片不可读取");
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法分析图片色调");
  context.drawImage(bitmap, 0, 0, 24, 24);
  bitmap.close();
  const pixels = context.getImageData(0, 0, 24, 24).data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if ((pixels[index + 3] ?? 0) < 16) continue;
    red += pixels[index] ?? 0;
    green += pixels[index + 1] ?? 0;
    blue += pixels[index + 2] ?? 0;
    count += 1;
  }
  return count
    ? [red / count, green / count, blue / count]
    : [0, 0, 0];
}

export async function hasToneMismatch(
  sourceUrl: string,
  resultUrl: string,
): Promise<boolean | null> {
  try {
    const [source, result] = await Promise.all([
      averageTone(sourceUrl),
      averageTone(resultUrl),
    ]);
    const distance = Math.sqrt(
      (source[0] - result[0]) ** 2 +
        (source[1] - result[1]) ** 2 +
        (source[2] - result[2]) ** 2,
    );
    return distance > 58;
  } catch {
    return null;
  }
}
