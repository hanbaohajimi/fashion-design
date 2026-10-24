import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// 审阅产物直接读取运行时 CSS；导出的 CSS 快照不导入应用。
const root = resolve(import.meta.dirname, "..");
const destination = resolve(
  root,
  process.argv[2] ?? "output/neutral-refactor/design-system",
);
const source = "apps/web/src/styles/design-system.css";
const css = readFileSync(resolve(root, source), "utf8").replace(
  /\/\*[\s\S]*?\*\//gu,
  "",
);
const declarations = Object.fromEntries(
  [...css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/gu)].map((m) => [
    m[1],
    m[2].trim(),
  ]),
);
function value(name, trail = []) {
  if (trail.includes(name) || !declarations[name])
    throw new Error(`无法解析 ${name}`);
  return declarations[name].replace(/var\((--[\w-]+)\)/gu, (_, alias) =>
    value(alias, [...trail, name]),
  );
}
const tokens = Object.fromEntries(
  Object.keys(declarations).map((name) => [name, value(name)]),
);
const colors = Object.fromEntries(
  Object.entries(tokens).filter(
    ([name, color]) =>
      /color-|image-stage/u.test(name) && /^#[\da-f]{6}$/iu.test(color),
  ),
);
function luminance(hex) {
  return [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
}
function ratio(fg, bg) {
  const a = luminance(fg),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const pairs = [];
function pair(name, foreground, background, minimum = 4.5) {
  const fg = value(foreground),
    bg = value(background);
  const contrast = ratio(fg, bg);
  pairs.push({
    name,
    foreground,
    background,
    fg,
    bg,
    ratio: Number(contrast.toFixed(2)),
    minimum,
    pass: contrast >= minimum,
  });
}
for (const surface of ["canvas", "paper", "surface"]) {
  for (const ink of ["ink", "ink-secondary", "ink-tertiary"])
    pair(`${ink} / ${surface}`, `--color-${ink}`, `--color-${surface}`);
  pair(
    `输入边界 / ${surface}`,
    "--color-control-border",
    `--color-${surface}`,
    3,
  );
  pair(`焦点 / ${surface}`, "--color-focus-ring", `--color-${surface}`, 3);
}
for (const action of ["action", "action-hover", "action-active"])
  pair(action, "--color-action-on", `--color-${action}`);
pair("选中文字", "--color-selection-ink", "--color-selection-bg");
pair("选中轮廓", "--color-selection-border", "--color-selection-bg", 3);
for (const state of ["success", "warning", "error", "info", "running"]) {
  pair(
    `${state} 提示`,
    `--color-status-${state}`,
    `--color-status-${state}-bg`,
  );
  pair(`${state} 文字`, `--color-status-${state}`, "--color-paper");
}
pair("禁用文字", "--color-disabled-ink", "--color-disabled-bg");
pair("反色提示", "--color-on-inverse", "--color-inverse");
pair("品牌展示", "--color-brand", "--color-brand-bg");
mkdirSync(destination, { recursive: true });
writeFileSync(
  resolve(destination, "design-tokens.json"),
  JSON.stringify({ source, tokens }, null, 2) + "\n",
);
writeFileSync(
  resolve(destination, "contrast-matrix.json"),
  JSON.stringify({ pairs }, null, 2) + "\n",
);
writeFileSync(
  resolve(destination, "skill-matrix.json"),
  JSON.stringify(
    {
      pairs: pairs
        .filter((p) => p.minimum === 4.5)
        .map(({ name, fg, bg }) => ({ name, fg, bg, size: "normal" })),
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  resolve(destination, "tokens.css"),
  `/* 只供审阅；运行时来源：${source} */\n:root {\n${Object.entries(tokens)
    .map(([name, token]) => `  ${name}: ${token};`)
    .join("\n")}\n}\n`,
);
writeFileSync(
  resolve(destination, "contrast-matrix.csv"),
  "用途,前景变量,背景变量,前景,背景,对比度,最低要求,通过\n" +
    pairs
      .map((p) =>
        [
          p.name,
          p.foreground,
          p.background,
          p.fg,
          p.bg,
          p.ratio,
          p.minimum,
          p.pass,
        ].join(","),
      )
      .join("\n") +
    "\n",
);
writeFileSync(
  resolve(destination, "preview.html"),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Atelier 实际颜色与对比度</title><style>body{font:14px/1.6 system-ui;margin:32px;background:${value("--color-canvas")};color:${value("--color-ink")}}h1{font-size:32px}.colors{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.color{background:white;padding:16px;border-radius:8px}.swatch{height:64px;border:1px solid #18181829}table{border-collapse:collapse;background:white;margin-top:24px}td,th{padding:8px 16px;border-bottom:1px solid #1818181a;text-align:left}</style><h1>Atelier 运行时设计变量</h1><p>来源：${source}。操作、选择、状态与品牌分别命名。</p><div class="colors">${Object.entries(
    colors,
  )
    .map(
      ([name, color]) =>
        `<div class="color"><div class="swatch" style="background:${color}"></div><strong>${name}</strong><br>${color}</div>`,
    )
    .join(
      "",
    )}</div><h2>允许的颜色配对</h2><table><tr><th>用途</th><th>前景 / 背景</th><th>对比度</th><th>要求</th></tr>${pairs.map((p) => `<tr><td>${p.name}</td><td style="color:${p.fg};background:${p.bg}">${p.fg} / ${p.bg}</td><td>${p.ratio}:1</td><td>${p.minimum}:1 · ${p.pass ? "通过" : "失败"}</td></tr>`).join("")}</table></html>`,
);
console.log(
  `已导出 ${Object.keys(tokens).length} 个变量、${pairs.length} 个颜色配对到 ${destination}`,
);
const failures = pairs.filter((p) => !p.pass);
if (failures.length) {
  console.error(failures);
  process.exitCode = 1;
}
