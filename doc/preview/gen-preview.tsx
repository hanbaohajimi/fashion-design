/**
 * gen-preview.tsx
 * Run: cd apps/web && npx tsx --tsconfig ../../doc/preview/tsconfig.preview.json ../../doc/preview/gen-preview.tsx
 *
 * Mounts are rendered via the production React components — no manual sync needed.
 * Background / edge / substrate helpers stay here (not part of the shared library).
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MountRenderer } from '../../apps/web/src/modules/board/shapes/mount-renderers';
import {
  generateMaterialAppearance,
  type MaterialPreset,
} from '../../apps/web/src/modules/board/shapes/material-appearance';
import type { BoardElementRole } from '../../packages/shared/src/index';

// ─── card dimensions ──────────────────────────────────────────────────────────
const W = 420, H = 300, PAD = 20, EX = 28;
const SW = W + PAD * 2, SH = H + PAD * 2;
// Content-area origin inside the SVG viewport
const OX = EX + PAD, OY = EX + PAD; // 48, 48

// ─── seeded RNG ───────────────────────────────────────────────────────────────
function seededRng(seed: number) {
  let s = (seed + 1) | 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1) ^ (s + Math.imul(s ^ (s >>> 7), s | 61));
    return ((s ^ (s >>> 14)) >>> 0) / 0xffffffff;
  };
}

// ─── edge generators ──────────────────────────────────────────────────────────
function tornEdge(w: number, h: number, seed: number, dev: number): string {
  const rng = seededRng(seed);
  const pts: string[] = [];
  const steps = 38;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const dx = (rng() - 0.5) * dev * 2;
    const dy = (rng() - 0.5) * dev * 2;
    pts.push(`${(t * w + dx).toFixed(1)},${dy.toFixed(1)}`);
  }
  const top = pts.join(' L ');
  const rpts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const dx = (rng() - 0.5) * dev * 2;
    const dy = (rng() - 0.5) * dev * 2;
    rpts.push(`${(w - t * w + dx).toFixed(1)},${(h + dy).toFixed(1)}`);
  }
  const bot = rpts.join(' L ');
  return `M 0,0 L ${top} L ${w},0 L ${w},${h} L ${bot} L 0,${h} Z`;
}

function deckledEdge(w: number, h: number, seed: number, dev: number): string {
  const rng = seededRng(seed);
  const segs = 26;
  const pts: string[] = [`0,0`];
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    pts.push(`${(t * w + (rng() - 0.5) * dev).toFixed(1)},${((rng() - 0.5) * dev).toFixed(1)}`);
  }
  pts.push(`${w},0`, `${w},${h}`);
  for (let i = segs - 1; i > 0; i--) {
    const t = i / segs;
    pts.push(`${(t * w + (rng() - 0.5) * dev).toFixed(1)},${(h + (rng() - 0.5) * dev).toFixed(1)}`);
  }
  pts.push(`0,${h}`);
  return `M ${pts.join(' L ')} Z`;
}

function pinkedEdge(w: number, h: number, seed: number, depth: number): string {
  const step = 16;
  const pts: string[] = [`0,0`];
  for (let x = step / 2; x < w; x += step) {
    pts.push(`${x},${-depth}`, `${Math.min(x + step / 2, w)},0`);
  }
  pts.push(`${w},0`, `${w},${h}`);
  for (let x = w - step / 2; x > 0; x -= step) {
    pts.push(`${x},${h + depth}`, `${Math.max(x - step / 2, 0)},${h}`);
  }
  pts.push(`0,${h}`);
  return `M ${pts.join(' L ')} Z`;
}

// ─── mount rendering (uses production React components) ───────────────────────
function renderMounts(preset: MaterialPreset, role: BoardElementRole, seed: number): string {
  const appearance = generateMaterialAppearance(preset, seed, role);
  if (appearance.mounts.length === 0) return '';
  const parts = appearance.mounts.map(mount => {
    // Wrap in <svg> so React renders SVG elements (radialGradient etc.) with correct casing.
    const wrapped = renderToStaticMarkup(
      React.createElement('svg', null,
        React.createElement(MountRenderer, { mount, shapeWidth: W, shapeHeight: H })
      )
    );
    // Strip the outer <svg> wrapper — we're inserting into an existing SVG.
    return wrapped.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  });
  return `<g transform="translate(${OX}, ${OY})">${parts.join('')}</g>`;
}

// ─── card HTML builder ────────────────────────────────────────────────────────
function card(
  title: string,
  note: string,
  bg: string,
  edgePath: string,
  mountsSvgStr: string,
  extraDefs: string,
  extraOverlay: string,
): string {
  const TW = SW + EX * 2, TH = SH + EX * 2;
  const slug = title.replace(/[^a-z0-9]/gi, '').slice(0, 10);
  const clipId = 'clip-' + slug;
  return [
    '<div style="display:inline-block;vertical-align:top;margin:0 40px 72px 0">',
    `<div style="font:700 10.5px/1 system-ui;letter-spacing:.11em;text-transform:uppercase;color:#999;margin-bottom:18px">${title}</div>`,
    `<div style="position:relative;width:${TW}px;height:${TH}px">`,
    `<svg width="${TW}" height="${TH}" style="position:absolute;top:0;left:0;overflow:visible">`,
    '<defs>',
    `<filter id="shad-${slug}">`,
    '  <feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dx="0" dy="1" result="s1"/>',
    '  <feGaussianBlur in="SourceAlpha" stdDeviation="8"/><feOffset dx="4" dy="7" result="s2"/>',
    '  <feGaussianBlur in="SourceAlpha" stdDeviation="18"/><feOffset dx="8" dy="14" result="s3"/>',
    '  <feMerge><feMergeNode in="s3"/><feMergeNode in="s2"/><feMergeNode in="s1"/></feMerge>',
    '  <feComponentTransfer><feFuncA type="linear" slope="0.62"/></feComponentTransfer>',
    '</filter>',
    `<clipPath id="${clipId}"><path d="${edgePath}" transform="translate(${EX},${EX})"/></clipPath>`,
    extraDefs,
    '</defs>',
    `<path d="${edgePath}" transform="translate(${EX},${EX})" fill="rgb(10,8,6)" filter="url(#shad-${slug})" opacity="0.6"/>`,
    `<path d="${edgePath}" transform="translate(${EX},${EX})" fill="${bg}"/>`,
    `<rect x="${EX}" y="${EX}" width="${SW}" height="${SH}" fill="rgb(20,16,12)" clip-path="url(#${clipId})" opacity="0.05"/>`,
    extraOverlay,
    `<rect x="${OX}" y="${OY}" width="${W}" height="${H}" fill="rgba(18,14,10,0.035)" rx="2"/>`,
    `<text x="${OX + W / 2}" y="${OY + H / 2}" text-anchor="middle" dominant-baseline="middle" fill="rgba(18,14,10,0.16)" font-size="12" font-family="system-ui" letter-spacing="0.1em">CONTENT AREA</text>`,
    mountsSvgStr,
    '</svg>',
    '</div>',
    `<div style="margin-top:14px;padding:14px 16px;background:rgba(255,255,255,0.55);border-radius:8px;font:12px/1.8 system-ui;color:#666;max-width:${TW}px">${note}</div>`,
    '</div>',
  ].join('\n');
}

// ─── edge paths ───────────────────────────────────────────────────────────────
const straight = `M 0 0 L ${SW} 0 L ${SW} ${SH} L 0 ${SH} Z`;
const torn     = tornEdge(SW, SH, 42, 22);
const deckled  = deckledEdge(SW, SH, 77, 13);
const pinked   = pinkedEdge(SW, SH, 19, 19);

// ─── material-specific overlays ───────────────────────────────────────────────
const photoDefs = [
  `<linearGradient id="pg-gloss" x1="0%" y1="0%" x2="100%" y2="100%">`,
  `  <stop offset="0%" stop-color="white" stop-opacity="0.18"/>`,
  `  <stop offset="55%" stop-color="white" stop-opacity="0.04"/>`,
  `  <stop offset="100%" stop-color="black" stop-opacity="0.06"/>`,
  `</linearGradient>`,
  `<clipPath id="clip-photo-ov"><path d="${straight}" transform="translate(${EX},${EX})"/></clipPath>`,
].join('\n');
const photoOv = `<rect x="${EX}" y="${EX}" width="${SW}" height="${SH}" fill="url(#pg-gloss)" clip-path="url(#clip-photo-ov)"/>`;

const fabricDefs = [
  `<pattern id="weave" x="0" y="0" width="7" height="7" patternUnits="userSpaceOnUse">`,
  `  <line x1="0" y1="0" x2="7" y2="0" stroke="rgba(18,14,10,0.16)" stroke-width="0.7"/>`,
  `  <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(18,14,10,0.16)" stroke-width="0.7"/>`,
  `  <line x1="0" y1="3.5" x2="7" y2="3.5" stroke="rgba(255,255,255,0.09)" stroke-width="0.5"/>`,
  `  <line x1="3.5" y1="0" x2="3.5" y2="7" stroke="rgba(255,255,255,0.09)" stroke-width="0.5"/>`,
  `</pattern>`,
  `<clipPath id="clip-fabric-ov"><path d="${pinked}" transform="translate(${EX},${EX})"/></clipPath>`,
].join('\n');
const fabricOv = `<rect x="${EX}" y="${EX}" width="${SW}" height="${SH}" fill="url(#weave)" clip-path="url(#clip-fabric-ov)" opacity="0.82"/>`;

const cardDefs = [
  `<linearGradient id="card-sides" x1="0%" y1="0%" x2="100%" y2="0%">`,
  `  <stop offset="0%" stop-color="rgba(18,14,10,0.12)"/>`,
  `  <stop offset="3%" stop-color="rgba(18,14,10,0)"/>`,
  `  <stop offset="97%" stop-color="rgba(18,14,10,0)"/>`,
  `  <stop offset="100%" stop-color="rgba(18,14,10,0.15)"/>`,
  `</linearGradient>`,
  `<clipPath id="clip-card-ov"><path d="${straight}" transform="translate(${EX},${EX})"/></clipPath>`,
].join('\n');
const cardOv = [
  `<rect x="${EX}" y="${EX}" width="${SW}" height="${SH}" fill="url(#card-sides)" clip-path="url(#clip-card-ov)"/>`,
  `<rect x="${EX}" y="${EX}" width="${SW}" height="3" fill="white" opacity="0.35" clip-path="url(#clip-card-ov)"/>`,
].join('\n');

const archDefs = [
  `<radialGradient id="arch-wear" cx="50%" cy="50%" r="75%">`,
  `  <stop offset="60%" stop-color="transparent"/>`,
  `  <stop offset="100%" stop-color="rgba(18,14,10,0.14)"/>`,
  `</radialGradient>`,
  `<clipPath id="clip-arch-ov"><path d="${deckled}" transform="translate(${EX},${EX})"/></clipPath>`,
].join('\n');
const archOv = `<rect x="${EX}" y="${EX}" width="${SW}" height="${SH}" fill="url(#arch-wear)" clip-path="url(#clip-arch-ov)"/>`;

// ─── cards ────────────────────────────────────────────────────────────────────
const avoidPhotoDefs = photoDefs.replace(/clip-photo-ov/g, 'clip-avoid-ov');
const avoidPhotoOv   = photoOv.replace(/clip-photo-ov/g, 'clip-avoid-ov');

const cards = [
  card('Editorial Photo / 照片纸',
    '<b>边缘</b>：直边　<b>固定</b>：黄铜图钉　<b>材质</b>：照片高光渐变　<b>阴影</b>：三层，偏移 (8,14)px',
    '#f8f6f2', straight, renderMounts('editorial-photo', 'style_ref', 101), photoDefs, photoOv),

  card('Sketch Paper / 素描纸',
    '<b>边缘</b>：撕裂边 ±22px　<b>固定</b>：遮蔽胶带（生产组件）　<b>材质</b>：纸张颗粒　<b>阴影</b>：沿撕裂边漫散',
    '#f4f1ea', torn, renderMounts('sketch-paper', 'silhouette_ref', 42), '', ''),

  card('Fabric Swatch / 面料',
    '<b>边缘</b>：锯齿边，齿深 19px　<b>固定</b>：黄铜图钉　<b>材质</b>：7px 经纬编织纹理',
    '#f9f7f3', pinked, renderMounts('fabric-swatch', 'fabric_ref', 77), fabricDefs, fabricOv),

  card('Color Card / 卡纸',
    '<b>边缘</b>：直边 + 侧边厚度阴影　<b>固定</b>：居中黄铜图钉　<b>材质</b>：顶切高光线 + 侧边渐变',
    '#fdfcfa', straight, renderMounts('color-card', 'palette', 19), cardDefs, cardOv),

  card('Archive Note / 备注纸',
    '<b>边缘</b>：毛边 ±13px，26段　<b>固定</b>：黄铜图钉　<b>材质</b>：旧纸色 #f2ede3 + 四角磨损',
    '#f2ede3', deckled, renderMounts('archive-note', 'note', 55), archDefs, archOv),

  card('AVOID / 排除 — 红色图钉',
    '<b>边缘</b>：直边　<b>固定</b>：红色图钉（语义强调）　<b>材质</b>：照片纸',
    '#f8f6f2', straight, renderMounts('editorial-photo', 'avoid', 88), avoidPhotoDefs, avoidPhotoOv),
].join('\n\n');

// ─── HTML output ──────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>素材装裱物理真实感验证</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#e8e4de;padding:60px;font-family:system-ui}
h1{font:600 13px/1 system-ui;letter-spacing:.14em;text-transform:uppercase;color:#888;margin-bottom:52px}
.grid{display:flex;flex-wrap:wrap;align-items:flex-start}
</style></head>
<body>
<h1>Material Mounting — Visual Verification (mounts rendered via production React components)</h1>
<div class="grid">${cards}</div>
</body></html>`;

const outPath = path.resolve(__dirname, 'material-preview.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Written ${fs.statSync(outPath).size} bytes → doc/preview/material-preview.html`);
