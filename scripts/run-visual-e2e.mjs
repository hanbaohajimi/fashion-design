import { spawn, execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

// Browser, OS and installed fonts are identical locally and in CI.
const DRIVER_VERSION = "1.58.2";
const IMAGE = `atelier-visual-chromium:${DRIVER_VERSION}`;
const BASE_IMAGE = "node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392";
const PLATFORM = "linux/amd64";
const CHROMIUM_VERSION = "145.0.7632.6";
const archiveUrl = process.env.ATELIER_CHROMIUM_ARCHIVE_URL ?? `https://cdn.playwright.dev/builds/cft/${CHROMIUM_VERSION}/linux64/chrome-headless-shell-linux64.zip`;
const parsedArchive = new URL(archiveUrl);
if (parsedArchive.protocol !== "https:" || parsedArchive.username || parsedArchive.password) throw new Error("Chromium 归档必须使用无需认证的 HTTPS 地址");
const WEB_PORT = 4400;
const CDP_PORT = 9222;
const root = resolve(import.meta.dirname, "..");
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("请通过 pnpm test:e2e:visual 启动视觉验收");
const name = `atelier-visual-${process.pid}`;
const docker = (args) => execFileSync("docker", args, { cwd: root, encoding: "utf8", windowsHide: true });
const browserSource = `
  const fs = require('node:fs'), net = require('node:net'), cp = require('node:child_process');
  function locate(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const path = dir + '/' + entry.name; if (entry.isFile() && ['chrome', 'chrome-headless-shell', 'headless_shell'].includes(entry.name)) return path; if (entry.isDirectory()) { const found = locate(path); if (found) return found; } } }
  const chrome = locate('/ms-playwright');
  if (!chrome) throw new Error('Pinned Chromium binary missing');
  fs.chmodSync(chrome, 0o755);
  const child = cp.spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-lcd-text', '--force-color-profile=srgb', '--font-render-hinting=none', '--remote-debugging-port=${CDP_PORT + 1}', '--remote-allow-origins=*', '--user-data-dir=/tmp/atelier-profile'], {stdio: 'inherit'});
  child.on('exit', code => process.exit(code || 0));
  net.createServer(socket => { const upstream = net.connect(${CDP_PORT + 1}, '127.0.0.1'); socket.pipe(upstream); upstream.pipe(socket); upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); }).listen(${CDP_PORT}, '0.0.0.0');
`;
const context = resolve(root, "output/visual-docker-context");
mkdirSync(context, { recursive: true });
const require = createRequire(import.meta.url);
const testRequire = createRequire(require.resolve("@playwright/test/package.json"));
const browserRequire = createRequire(testRequire.resolve("playwright/package.json"));
const core = browserRequire.resolve("playwright-core/package.json");
if (JSON.parse(readFileSync(core, "utf8")).version !== DRIVER_VERSION) throw new Error("请同步视觉验收镜像与仓库 Playwright 版本");
cpSync(dirname(core), resolve(context, "playwright-core"), { recursive: true });
const dockerfile = `FROM ${BASE_IMAGE}
ARG APT_MIRROR=https://deb.debian.org
ARG CHROMIUM_ARCHIVE_URL
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node -e "const fs=require('fs');fs.mkdirSync('/etc/ssl/certs',{recursive:true});fs.writeFileSync('/etc/ssl/certs/ca-certificates.crt',require('tls').rootCertificates.join('\\n'));const path='/etc/apt/sources.list.d/debian.sources';fs.writeFileSync(path,fs.readFileSync(path,'utf8').replaceAll('http://deb.debian.org',process.env.APT_MIRROR));"
COPY playwright-core/ /opt/atelier-visual/playwright-core/
RUN node /opt/atelier-visual/playwright-core/cli.js install-deps chromium && apt-get install -y --no-install-recommends fonts-noto-cjk=1:20220127+repack1-1
RUN node -e "const fs=require('fs');const {pipeline}=require('stream/promises');const {Readable}=require('stream');(async()=>{const response=await fetch(process.env.CHROMIUM_ARCHIVE_URL,{signal:AbortSignal.timeout(300000)});if(!response.ok)throw new Error('Chromium download failed: '+response.status);await pipeline(Readable.fromWeb(response.body),fs.createWriteStream('/tmp/chromium.zip'));await require('/opt/atelier-visual/playwright-core/lib/zipBundle').extract('/tmp/chromium.zip',{dir:'/ms-playwright/browser'});fs.unlinkSync('/tmp/chromium.zip');})().catch(error=>{console.error(error);process.exit(1);});"
`;
const signature = createHash("sha256").update(dockerfile).digest("hex");
let installedSignature = "";
try { installedSignature = execFileSync("docker", ["image", "inspect", IMAGE, "--format", '{{ index .Config.Labels "atelier.visual.signature" }}'], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim(); } catch { /* First build */ }
if (installedSignature !== signature) execFileSync("docker", ["build", "--platform", PLATFORM, "--progress=plain", "--file", "-", "--tag", IMAGE, "--build-arg", `CHROMIUM_ARCHIVE_URL=${archiveUrl}`, ...(process.env.ATELIER_APT_MIRROR ? ["--build-arg", `APT_MIRROR=${process.env.ATELIER_APT_MIRROR}`] : []), context], { cwd: root, input: `${dockerfile}LABEL atelier.visual.signature="${signature}"\n`, stdio: ["pipe", "inherit", "inherit"], windowsHide: true });
if (process.argv.includes("--prepare")) process.exit(0);
try {
  console.log(`视觉验收环境：${IMAGE}`);
  docker(["run", "--platform", PLATFORM, "--detach", "--rm", "--name", name, "--shm-size=1g", "--publish", `127.0.0.1::${CDP_PORT}`, ...(process.platform === "linux" ? ["--add-host", "host.docker.internal:host-gateway"] : []), IMAGE, "node", "-e", browserSource]);
  const mapping = docker(["port", name, `${CDP_PORT}/tcp`]).trim();
  const endpoint = `http://${mapping}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Chromium startup */ }
    await new Promise(done => setTimeout(done, 500));
  }
  if (!ready) throw new Error(`视觉浏览器未就绪\n${docker(["logs", name])}`);
  const code = await new Promise((done, fail) => {
    const child = spawn(process.execPath, [pnpm, "exec", "playwright", "test", "--config", "playwright.visual.config.ts", ...process.argv.slice(2)], {
      cwd: root, stdio: "inherit", windowsHide: true,
      env: { ...process.env, NEXT_PUBLIC_SENTRY_DSN: "", NEXT_PUBLIC_POSTHOG_KEY: "", ATELIER_VISUAL_CDP: endpoint, ATELIER_VISUAL_PORT: String(WEB_PORT), ATELIER_CHROMIUM_VERSION: CHROMIUM_VERSION },
    });
    child.on("error", fail); child.on("exit", done);
  });
  process.exitCode = code ?? 1;
} finally {
  try { docker(["rm", "--force", name]); } catch { /* Already stopped */ }
}
