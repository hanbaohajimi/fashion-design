import { createRequire } from "node:module";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const runtimeModules = "C:/Users/朱奕玮/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const { createCanvas } = require(`${runtimeModules}/@napi-rs/canvas`);
const pdfjs = await import(
  pathToFileURL(`${runtimeModules}/pdfjs-dist/legacy/build/pdf.mjs`).href
);

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const work = path.join(root, ".codex-work");
const entries = (await readdir(work, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^render-0\d$/.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name));

for (const entry of entries) {
  const folder = path.join(work, entry.name);
  const files = await readdir(folder);
  const pdfs = files.filter((file) => file.toLowerCase().endsWith(".pdf"));
  const selectedPdf =
    pdfs.find((file) => file.includes("面料视觉版-v8")) ??
    pdfs.find((file) => file.includes("面料视觉版-v7")) ??
    pdfs.find((file) => file.includes("最终指定服装版-v6")) ??
    pdfs.find((file) => file.includes("最终指定服装版-v5")) ??
    pdfs.find((file) => file.includes("指定服装版-v4")) ??
    pdfs.find((file) => file.includes("严格图片名称版-v3")) ??
    pdfs.find((file) => file.includes("图片名称版-v2")) ??
    pdfs.find((file) => file.includes("图片名称版")) ??
    pdfs.find((file) => file.includes("面料库修订")) ??
    (pdfs.length === 1 ? pdfs[0] : undefined);
  if (!selectedPdf) throw new Error(`expected a selected PDF in ${folder}`);
  for (const file of files.filter((file) => /^page-\d+\.png$/.test(file))) {
    await rm(path.join(folder, file));
  }
  const bytes = new Uint8Array(await readFile(path.join(folder, selectedPdf)));
  const pdf = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 160 / 72 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    const target = path.join(folder, `page-${String(index).padStart(2, "0")}.png`);
    await writeFile(target, canvas.toBuffer("image/png"));
  }
  process.stdout.write(`${entry.name}: ${pdf.numPages} pages\n`);
}
