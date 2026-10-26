/** Real local MinIO + browser XHR validation; no model, API mutation, or database call. */
/* global window */
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
const rootRequire = createRequire(resolve(root, "package.json"));
const { parse } = apiRequire("dotenv");
const env = { ...parse(await readFile(resolve(root, ".env"), "utf8")), ...process.env };
const endpoint = new URL(env.S3_ENDPOINT ?? "http://localhost:9000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error("此验证只允许本地 MinIO");
const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } = apiRequire("@aws-sdk/client-s3");
const { getSignedUrl } = apiRequire("@aws-sdk/s3-request-presigner");
const esbuildRequire = createRequire(apiRequire.resolve("tsx"));
const { build } = esbuildRequire("esbuild");
const { chromium } = rootRequire("@playwright/test");
const bucket = env.S3_BUCKET ?? "fashion-assets";
const key = `.validation/ui-motion/${randomUUID()}.png`;
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const checksum = createHash("sha256").update(bytes).digest("base64");
const client = new S3Client({ endpoint: endpoint.href, region: env.S3_REGION ?? "us-east-1", forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false", credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } });
const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "image/png", ContentLength: bytes.length, ChecksumSHA256: checksum }), { expiresIn: 120, signableHeaders: new Set(["content-length", "content-type"]) });
const bundle = await build({ entryPoints: [resolve(root, "apps/web/src/modules/board/file-upload-api.ts")], bundle: true, write: false, format: "iife", globalName: "UiMotionUpload", platform: "browser", target: "es2022", absWorkingDir: root });
const browser = await chromium.launch();
const report = { storage: "local MinIO", source: "actual bundled putOriginal", modelCalls: 0, bytes: bytes.length, progress: [], headMatches: false, cleaned: false };
try {
  const page = await browser.newPage();
  const origin = env.APP_ORIGIN ?? "http://localhost:3000";
  await page.goto(new URL("/login", origin).href);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  report.progress = await page.evaluate(async ({ url, checksum, base64 }) => {
    const content = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
    const file = new File([content], "motion-validation.png", { type: "image/png" });
    const events = [];
    await window.UiMotionUpload.putOriginal({ method: "PUT", url, headers: { "Content-Type": "image/png", "x-amz-checksum-sha256": checksum } }, file, { onProgress: value => events.push(value) });
    return events;
  }, { url, checksum, base64: bytes.toString("base64") });
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }));
  report.headMatches = head.ContentLength === bytes.length && head.ChecksumSHA256 === checksum;
  if (!report.headMatches || !report.progress.some(event => event.lengthComputable && event.loaded === bytes.length)) throw new Error("上传字节或校验和未通过");
} finally {
  await browser.close();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  report.cleaned = true;
  await mkdir(resolve(root, "output/ui-motion"), { recursive: true });
  await writeFile(resolve(root, "output/ui-motion/minio-upload.json"), JSON.stringify(report, null, 2));
  client.destroy();
}
console.log(JSON.stringify(report));
