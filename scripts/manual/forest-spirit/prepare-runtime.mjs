import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { values } = parseArgs({ options: { sdk: { type: "string" }, out: { type: "string", default: "output/forest-spirit-runtime" }, toolchain: { type: "string" } } });
if (!values.sdk) throw new Error("Usage: node scripts/manual/forest-spirit/prepare-runtime.mjs --sdk <official CubismSdkForWeb-5-r.5> [--toolchain <local package directory containing vite>]");
const sdk = await realpath(path.resolve(values.sdk));
const output = path.resolve(repo, values.out);
const allowedOutput = path.resolve(repo, "output");
if (!output.startsWith(allowedOutput + path.sep)) throw new Error("Generated files must stay inside the repository output/ directory");
await mkdir(output, { recursive: true });
if (!(await realpath(output)).startsWith((await realpath(allowedOutput)) + path.sep)) throw new Error("Output symlink escapes repository output/");
const sdkInfo = await readFile(path.join(sdk, "cubism-info.yml"), "utf8");
if (!/^version: 5-r\.5\s*$/mu.test(sdkInfo)) throw new Error("Only the inspected official SDK version 5-r.5 is supported");
if (!sdkInfo.includes("a49bc546222194ac28326d20a46aa35ee4d1ce8e")) throw new Error("Unexpected official Framework revision");
let vitePath;
const searchRoots = values.toolchain ? [path.resolve(values.toolchain)] : [path.join(repo, "apps/web"), path.join(repo, "output/live2d-proof-20261105")];
for (const root of searchRoots) {
  try { vitePath = createRequire(path.join(root, "package.json")).resolve("vite"); break; } catch { /* Try the next existing local toolchain. Never install or download implicitly. */ }
}
if (!vitePath) throw new Error("A local Vite toolchain is required; pass --toolchain. No packages were downloaded.");
const { build } = await import(pathToFileURL(vitePath).href);
const tsconfig = path.join(output, "tsconfig.runtime.json");
await writeFile(tsconfig, JSON.stringify({
  compilerOptions: { noEmit: true, strict: false, useDefineForClassFields: false, skipLibCheck: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", allowJs: true, checkJs: false, types: [], lib: ["ES2022", "DOM"], paths: { "@cubism/*": [path.join(sdk, "Framework/src/*").replaceAll("\\", "/")] } },
  files: [path.join(repo, "scripts/manual/forest-spirit/runtime-entry.ts"), path.join(sdk, "Core/live2dcubismcore.d.ts")],
}, null, 2), "utf8");
const tsc = createRequire(path.join(repo, "package.json")).resolve("typescript/bin/tsc");
const checked = spawnSync(process.execPath, [tsc, "--project", tsconfig], { cwd: repo, encoding: "utf8" });
if (checked.status !== 0) throw new Error(`Standalone runtime typecheck failed:\n${checked.stdout}\n${checked.stderr}`);
console.log("Standalone runtime + official Framework TypeScript check passed (SDK-compatible strict:false).");
await build({
  configFile: false,
  root: repo,
  resolve: { alias: { "@cubism": path.join(sdk, "Framework/src") } },
  build: {
    target: "es2022", minify: false, emptyOutDir: false, outDir: output,
    lib: { entry: path.join(repo, "scripts/manual/forest-spirit/runtime-entry.ts"), formats: ["es"], fileName: () => "forest-spirit-runtime.js" },
  },
});
await cp(path.join(sdk, "Core/live2dcubismcore.min.js"), path.join(output, "live2dcubismcore.min.js"));
await cp(path.join(sdk, "Framework/Shaders/WebGL"), path.join(output, "shaders"), { recursive: true });
await mkdir(path.join(output, "licenses"), { recursive: true });
for (const [from, name] of [["LICENSE.md", "SDK-LICENSE.md"], ["NOTICE.md", "SDK-NOTICE.md"], ["Core/LICENSE.md", "CORE-LICENSE.md"], ["Framework/LICENSE.md", "FRAMEWORK-LICENSE.md"]]) {
  await cp(path.join(sdk, from), path.join(output, "licenses", name));
}
async function inventory(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await inventory(filename, base));
    else if (entry.name !== "build-manifest.json") {
      const bytes = await readFile(filename);
      files.push({ path: path.relative(base, filename).replaceAll("\\", "/"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
  return files;
}
await writeFile(path.join(output, "build-manifest.json"), JSON.stringify({ sdkVersion: "5-r.5", sdkInfo, source: "Locally supplied official Live2D Cubism SDK; no model, art or approval is generated", files: await inventory(output) }, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output, sdkVersion: "5-r.5", runtime: "forest-spirit-runtime.js", modelCopied: false, paidRequests: 0 }));
