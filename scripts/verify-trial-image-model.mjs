import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { createAiRuntimeFromEnv } from "../packages/ai/dist/index.js";

if (process.env.TRIAL_E2E !== "1" || !process.env.AMUX_API_KEY || process.env.AMUX_API_KEY === "trial-local-only") throw new Error("真实模型冒烟需隔离环境和真实令牌");
const require = createRequire(new URL("../apps/worker/package.json", import.meta.url));
const sharp = require("sharp");
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { getSignedUrl } = apiRequire("@aws-sdk/s3-request-presigner");
const storage = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
const prefix = `temporary/trial-smoke/${randomUUID()}`;
const keys = [];
const upload = async (name, body) => {
  const Key = `${prefix}/${name}`; keys.push(Key);
  await storage.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key, Body: body, ContentType: "image/png" }));
  return getSignedUrl(storage, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key }), { expiresIn: 3600 });
};
const output = resolve("output/trial-model-smoke");
await mkdir(output, { recursive: true });
const ai = createAiRuntimeFromEnv();
const generate = async (name, input) => {
  const submitted = await ai.submit(input);
  const result = await ai.getResult(submitted);
  const url = result.images[0]?.url;
  if (!url) throw new Error("模型没有返回图片");
  let bytes;
  if (url.startsWith("data:image/")) bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  else {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password || target.port && target.port !== "443") throw new Error("模型图片地址不符合下载要求");
    const addresses = await lookup(target.hostname, { all: true });
    const publicAddress = (address) => {
      if (address.includes(":")) return /^[23][0-9a-f]{3}:/iu.test(address);
      const [a, b] = address.split(".").map(Number);
      return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
    };
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("模型图片地址必须解析到公网");
    const response = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw new Error(`模型图片下载失败 (${response.status})`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 32 * 1024 * 1024) throw new Error("模型图片超过验证大小上限"); chunks.push(chunk); }
    bytes = Buffer.concat(chunks);
  }
  const png = await sharp(bytes).resize(1024, 1024, { fit: "contain" }).png().toBuffer();
  await writeFile(resolve(output, `${name}.png`), png);
  console.log(JSON.stringify({ phase: name, status: "passed", model: result.job.model, bytes: png.length }));
  return png;
};
try {
  const reference = await sharp(await readFile(resolve("output/workflow-verification/real-candidate.png"))).resize(1024, 1024, { fit: "contain" }).png().toBuffer();
  const first = await generate("reference-edit", { taskType: "i2i", referenceImageUrl: await upload("reference.png", reference),
    prompt: "Preserve this garment silhouette and composition. Change only its visible garment color to navy blue. Garment only, no people.", width: 1024, height: 1024, quality: "low", outputFormat: "png" });
  const mask = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: await sharp({ create: { width: 240, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 390, top: 390, blend: "dest-out" }]).png().toBuffer();
  await generate("masked-edit", { taskType: "inpaint", referenceImageUrl: await upload("source.png", first), maskImageUrl: await upload("mask.png", mask),
    prompt: "Inside the transparent mask only, simplify the garment surface texture. Preserve everything outside the mask.", width: 1024, height: 1024, quality: "low", outputFormat: "png" });
} finally {
  await Promise.allSettled(keys.map((Key) => storage.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key }))));
  storage.destroy();
}
