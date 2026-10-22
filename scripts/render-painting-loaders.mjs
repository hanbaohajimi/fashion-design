/* global window */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

// Offline authoring only. No p5 code or dependencies are shipped to the app.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2];
if (!source)
  throw new Error(
    "Usage: node scripts/render-painting-loaders.mjs <painting-loaders source directory>",
  );
const publicDir = resolve(source, "public");
const output = join(repository, "apps/web/public/painting-loaders");
const frames = join(repository, "output/painting-loaders");
const scenes = [
  ["dusk", "abstractionDusk", "abstraction-dusk"],
  ["willow", "impressionismWillow", "impressionism-willow"],
  ["irises", "impressionismIrises", "impressionism-irises"],
];
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}canvas{display:block}</style>
<script src="/vendor/p5.min.js"></script><script src="/vendor/p5.brush.js"></script><script src="/engine.js"></script><script src="/style-impressionism.js"></script><script src="/style-abstraction.js"></script></head><body><script>
let engine;
window.setup = () => { pixelDensity(1); Object.values(STYLES).forEach(s => s.canvasSize=480); engine=createEngine(STYLES.abstractionDusk); engine.setup(); noLoop(); window.paintReady=true; };
window.draw = () => {};
window.selectScene = key => engine.load(STYLES[key]);
window.paintFrame = t => { engine.renderTo(t); return engine.canvas.toDataURL('image/png').split(',')[1]; };
</script></body></html>`;
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
      return;
    }
    const path = resolve(
      publicDir,
      "." + new URL(request.url, "http://localhost").pathname,
    );
    if (
      !path.startsWith(publicDir + "/") &&
      !path.startsWith(publicDir + "\\")
    ) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-gpu", "--use-angle=d3d11"],
});
try {
  await mkdir(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
  page.on("pageerror", (error) => console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.paintReady, undefined, {
    timeout: 120_000,
  });
  for (const [name, config, still] of scenes) {
    const directory = join(frames, name);
    await mkdir(directory, { recursive: true });
    await page.evaluate((key) => window.selectScene(key), config);
    // Nine seconds of drawing plus a one second hold, deterministic 24 fps.
    for (let frame = 0; frame < 240; frame++) {
      const png = await page.evaluate(
        (t) => window.paintFrame(t),
        Math.min((frame / 24) * 1000, 9000),
      );
      await writeFile(
        join(directory, String(frame).padStart(4, "0") + ".png"),
        Buffer.from(png, "base64"),
      );
      if (frame % 24 === 0) console.log(`${name}: ${frame}/240`);
    }
    await copyFile(
      join(publicDir, "stills", still + ".webp"),
      join(output, name + ".webp"),
    );
    const encode = (args) =>
      new Promise((r, reject) => {
        const child = spawn(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-framerate",
            "24",
            "-i",
            join(directory, "%04d.png"),
            ...args,
          ],
          { stdio: "inherit", windowsHide: true },
        );
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 ? r() : reject(new Error(`ffmpeg: ${code}`)),
        );
      });
    await encode([
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      "36",
      "-pix_fmt",
      "yuv420p",
      "-an",
      join(output, name + ".webm"),
    ]);
    await encode([
      "-c:v",
      "libx264",
      "-crf",
      "27",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      join(output, name + ".mp4"),
    ]);
    console.log(`${name}: complete`);
  }
} finally {
  await browser.close();
  server.close();
}
