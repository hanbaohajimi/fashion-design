import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const source = resolve(root, "apps/web/src");
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
const all = walk(source);
const entries = all.filter(path => /[/\\]app[/\\]/u.test(path) && /[/\\](?:page|layout|error|global-error)\.tsx$/u.test(path) && !path.includes(`${process.platform === "win32" ? "\\" : "/"}prototypes`));
const visited = new Set();
const queue = [...entries];
while (queue.length) {
  const path = queue.pop();
  if (visited.has(path)) continue;
  visited.add(path);
  const content = readFileSync(path, "utf8");
  for (const match of content.matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.[^"']+)["']/gu)) {
    const target = resolve(dirname(path), match[1]);
    const dependency = [target, `${target}.tsx`, `${target}.ts`, `${target}/index.tsx`, `${target}/index.ts`].find(candidate => existsSync(candidate) && /\.(?:tsx?|css)$/u.test(candidate));
    if (dependency && !visited.has(dependency)) queue.push(dependency);
  }
}
const pathOf = path => relative(root, path).replaceAll("\\", "/");
const css = [...visited].filter(path => path.endsWith(".css"));
const report = { generatedAt: new Date().toISOString(), entries: entries.map(pathOf), reachable: [...visited].map(pathOf).sort(), activeCss: css.map(pathOf).sort(), cssOutsideProductionGraph: all.filter(path => path.endsWith(".css") && !visited.has(path)).map(pathOf).sort(), note: "相对导入图用于区分生产、兼容与原型；CSS选择器是否可见仍须真实渲染核对。" };
const output = resolve(root, "output/desktop-agent-ui");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "production-imports.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ entries: entries.length, reachable: visited.size, activeCss: css.length }));
