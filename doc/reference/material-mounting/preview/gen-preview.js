const fs = require('fs');
const path = require('node:path');

function seededRng(seed) {
  let s = (seed + 1) | 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= (s >>> 16);
    return (s >>> 0) / 0xffffffff;
  };
}

function tornEdge(w, h, seed, dev) {
  const r = seededRng(seed);
  const segs = 14;
  let d = 'M ' + (r()*dev*0.3).toFixed(1) + ' ' + (r()*dev*0.3).toFixed(1);
  for (let i = 1; i <= segs; i++) {
    const x = (w/segs*i).toFixed(1), y = (r()*dev*2-dev).toFixed(1);
    const c1x = (w/segs*i - w/segs*0.6).toFixed(1), c1y = (r()*dev*2.8-dev*1.2).toFixed(1);
    const c2x = (w/segs*i - w/segs*0.15).toFixed(1), c2y = (r()*dev*2.8-dev*1.2).toFixed(1);
    d += ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + x + ' ' + y;
  }
  for (let i = 1; i <= segs; i++) {
    const x = (w+r()*dev*2-dev).toFixed(1), y = (h/segs*i).toFixed(1);
    const c1x = (w+r()*dev*2.8-dev*1.2).toFixed(1), c1y = (h/segs*i - h/segs*0.6).toFixed(1);
    const c2x = (w+r()*dev*2.8-dev*1.2).toFixed(1), c2y = (h/segs*i - h/segs*0.15).toFixed(1);
    d += ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + x + ' ' + y;
  }
  for (let i = segs; i >= 0; i--) {
    const x = (w/segs*i).toFixed(1), y = (h+r()*dev*2-dev).toFixed(1);
    const c1x = (w/segs*i + w/segs*0.6).toFixed(1), c1y = (h+r()*dev*2.8-dev*1.2).toFixed(1);
    const c2x = (w/segs*i + w/segs*0.15).toFixed(1), c2y = (h+r()*dev*2.8-dev*1.2).toFixed(1);
    d += ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + x + ' ' + y;
  }
  for (let i = segs; i >= 0; i--) {
    const x = (r()*dev*1.1-dev*0.4).toFixed(1), y = (h/segs*i).toFixed(1);
    const c1x = (r()*dev*2.8-dev*1.2).toFixed(1), c1y = (h/segs*i + h/segs*0.6).toFixed(1);
    const c2x = (r()*dev*2.8-dev*1.2).toFixed(1), c2y = (h/segs*i + h/segs*0.15).toFixed(1);
    d += ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + x + ' ' + y;
  }
  return d + ' Z';
}

function deckledEdge(w, h, seed, dev) {
  const r = seededRng(seed);
  const segs = 26;
  let d = 'M 0 ' + (r()*dev*0.6).toFixed(1);
  for (let i = 1; i <= segs; i++) d += ' L ' + (w/segs*i).toFixed(1) + ' ' + (r()*dev*2-dev).toFixed(1);
  for (let i = 1; i <= segs; i++) d += ' L ' + (w+r()*dev*2-dev).toFixed(1) + ' ' + (h/segs*i).toFixed(1);
  for (let i = segs; i >= 0; i--) d += ' L ' + (w/segs*i).toFixed(1) + ' ' + (h+r()*dev*2-dev).toFixed(1);
  for (let i = segs; i >= 0; i--) d += ' L ' + (r()*dev*2-dev).toFixed(1) + ' ' + (h/segs*i).toFixed(1);
  return d + ' Z';
}

function pinkedEdge(w, h, seed, depth) {
  const r = seededRng(seed);
  const step = 16;
  let d = 'M 0 0';
  for (let x = 0; x < w; x += step) {
    d += ' L ' + (x+step/2).toFixed(1) + ' ' + (-(depth*(0.8+r()*0.4))).toFixed(1);
    d += ' L ' + Math.min(x+step, w).toFixed(1) + ' 0';
  }
  for (let y = 0; y < h; y += step) {
    d += ' L ' + (w+depth*(0.8+r()*0.4)).toFixed(1) + ' ' + (y+step/2).toFixed(1);
    d += ' L ' + w + ' ' + Math.min(y+step, h).toFixed(1);
  }
  for (let x = w; x > 0; x -= step) {
    d += ' L ' + (x-step/2).toFixed(1) + ' ' + (h+depth*(0.8+r()*0.4)).toFixed(1);
    d += ' L ' + Math.max(x-step, 0).toFixed(1) + ' ' + h;
  }
  for (let y = h; y > 0; y -= step) {
    d += ' L ' + (-depth*(0.8+r()*0.4)).toFixed(1) + ' ' + (y-step/2).toFixed(1);
    d += ' L 0 ' + Math.max(y-step, 0).toFixed(1);
  }
  return d + ' Z';
}

function pinHash(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 33) ^ id.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pin(cx, cy, radius, variant, mountId) {
  // Flat oxidized brass / matte lacquer cap.
  // Deformed ellipse, no perfect circle, no pure-white highlight, no halo.
  const id  = mountId || (variant + Math.round(cx) + '_' + Math.round(cy));
  const h   = pinHash(id);
  const sx  = (0.974 + (h & 0xF) * 0.0035).toFixed(4);
  const sy  = (0.935 + ((h >> 4) & 0xF) * 0.0035).toFixed(4);
  const hlx = ((h >> 8) & 3) - 1;
  const hly = ((h >> 12) & 3) - 1;
  const gid = 'pc-' + id;
  const r   = radius;
  const red = variant === 'red';

  const stops = red
    ? ['<stop offset="0%"   stop-color="#A34B3F"/>',
       '<stop offset="52%"  stop-color="#8A3A30"/>',
       '<stop offset="100%" stop-color="#5C2820"/>']
    : ['<stop offset="0%"   stop-color="#A88A43"/>',
       '<stop offset="35%"  stop-color="#8B6C27"/>',
       '<stop offset="70%"  stop-color="#756331"/>',
       '<stop offset="100%" stop-color="#5F4B20"/>'];
  const rim   = red ? '#5C2820' : '#5F4B20';
  const hiClr = red ? 'rgba(210,160,145,0.38)' : 'rgba(222,204,145,0.45)';
  const hiRx  = (r * (red ? 0.23 : 0.26)).toFixed(2);
  const hiRy  = (r * (red ? 0.16 : 0.18)).toFixed(2);

  return [
    '<radialGradient id="'+gid+'" cx="36%" cy="32%" r="68%">',
    stops.join('\n'),
    '</radialGradient>',
    // Paper pressure imprint — ≤0.06 opacity, only visible up close
    '<ellipse cx="'+cx+'" cy="'+(cy+r+1.8).toFixed(2)+'"',
    '  rx="'+(r*0.71).toFixed(2)+'" ry="'+(r*0.29).toFixed(2)+'"',
    '  fill="rgba(45,37,24,0.06)" filter="url(#pinblur)"/>',
    // Contact shadow — tight, warm-grey
    '<ellipse cx="'+(cx+0.8)+'" cy="'+(cy+1.5)+'"',
    '  rx="'+(r*0.9).toFixed(2)+'" ry="'+(r*0.7).toFixed(2)+'"',
    '  fill="rgba(45,37,24,0.18)" filter="url(#pinblur)"/>',
    // Pin cap — deformed ellipse, not perfect circle
    '<ellipse cx="'+cx+'" cy="'+cy+'"',
    '  rx="'+(r*sx)+'" ry="'+(r*sy)+'" fill="url(#'+gid+')"/>',
    // Bottom contact darkening — metal touching paper
    '<ellipse cx="'+cx+'" cy="'+(cy+r*sy*0.65).toFixed(2)+'"',
    '  rx="'+(r*sx*0.70).toFixed(2)+'" ry="'+(r*sy*0.34).toFixed(2)+'"',
    '  fill="rgba(45,37,24,0.14)"/>',
    // Diffuse highlight — warm, small, position varies per pin
    '<ellipse cx="'+(cx - r*0.28 + hlx).toFixed(2)+'" cy="'+(cy - r*0.32 + hly).toFixed(2)+'"',
    '  rx="'+hiRx+'" ry="'+hiRy+'" fill="'+hiClr+'"/>',
    // Rim — barely visible
    '<ellipse cx="'+cx+'" cy="'+cy+'"',
    '  rx="'+(r*sx)+'" ry="'+(r*sy)+'"',
    '  fill="none" stroke="'+rim+'" stroke-width="0.5" opacity="0.22"/>',
    // Shaft
    '<line x1="'+(cx+0.3)+'" y1="'+(cy+r*sy*0.5).toFixed(2)+'"',
    '  x2="'+(cx+0.5)+'" y2="'+(cy+r+3.5)+'"',
    '  stroke="'+rim+'" stroke-width="1.2" stroke-linecap="round" opacity="0.38"/>',
    // Center dimple
    '<circle cx="'+cx+'" cy="'+cy+'" r="1" fill="'+rim+'" opacity="0.32"/>',
  ].join('\n');
}

function tape(cx, cy, w, rot) {
  const h = 28;
  const hx = -w/2, hy = 0;
  return [
    '<g transform="translate('+cx+','+cy+') rotate('+rot+')">',
    '  <rect x="'+(hx+3)+'" y="5" width="'+w+'" height="'+h+'" rx="2" fill="rgba(18,14,10,0.16)" filter="url(#tapeblur)"/>',
    '  <rect x="'+hx+'" y="0" width="'+w+'" height="'+h+'" rx="1.5" fill="#ede0c8" opacity="0.88" stroke="rgba(18,14,10,0.2)" stroke-width="0.6"/>',
    '  <rect x="'+hx+'" y="0" width="'+w+'" height="'+h+'" rx="1.5" fill="url(#tapetex)" opacity="0.5"/>',
    '  <rect x="'+(hx+3)+'" y="2" width="'+(w-6)+'" height="9" rx="1" fill="white" opacity="0.28"/>',
    '  <line x1="'+hx+'" y1="4" x2="'+hx+'" y2="'+(h-4)+'" stroke="rgba(18,14,10,0.22)" stroke-width="0.5" stroke-dasharray="2,3"/>',
    '  <line x1="'+(hx+w)+'" y1="4" x2="'+(hx+w)+'" y2="'+(h-4)+'" stroke="rgba(18,14,10,0.22)" stroke-width="0.5" stroke-dasharray="2,3"/>',
    '  <line x1="'+(hx+w*0.3)+'" y1="0" x2="'+(hx+w*0.28)+'" y2="'+h+'" stroke="rgba(18,14,10,0.09)" stroke-width="0.7"/>',
    '  <line x1="'+(hx+w*0.68)+'" y1="0" x2="'+(hx+w*0.7)+'" y2="'+h+'" stroke="rgba(18,14,10,0.07)" stroke-width="0.7"/>',
    '  <ellipse cx="'+(hx+w*0.44)+'" cy="'+(h/2)+'" rx="6" ry="3.5" fill="white" opacity="0.16"/>',
    '  <ellipse cx="'+(hx+w*0.72)+'" cy="'+(h*0.4)+'" rx="5" ry="3" fill="white" opacity="0.13"/>',
    '  <path d="M '+(hx+w-22)+' 0 L '+(hx+w)+' 0 L '+(hx+w)+' 18 Q '+(hx+w-8)+' 9 '+(hx+w-16)+' 5 Z" fill="#c8b598" opacity="0.72"/>',
    '  <line x1="'+(hx+w-20)+'" y1="1" x2="'+(hx+w-1)+'" y2="1" stroke="white" stroke-width="1" opacity="0.55"/>',
    '  <ellipse cx="'+(hx+w-9)+'" cy="9" rx="7" ry="4" fill="rgba(8,6,4,0.09)"/>',
    '</g>',
  ].join('\n');
}

const W = 420, H = 300, PAD = 20, EX = 28;

function card(title, note, bg, edgePath, mountsSvg, extraDefs, extraOverlay) {
  const TW = W + PAD*2 + EX*2, TH = H + PAD*2 + EX*2;
  const slug = title.replace(/[^a-z0-9]/gi, '').slice(0, 10);
  const clipId = 'clip-' + slug;
  const grainId = 'grain-' + slug;
  return [
    '<div style="display:inline-block;vertical-align:top;margin:0 40px 72px 0">',
    '<div style="font:700 10.5px/1 system-ui;letter-spacing:.11em;text-transform:uppercase;color:#999;margin-bottom:18px">'+title+'</div>',
    '<div style="position:relative;width:'+TW+'px;height:'+TH+'px">',
    '<svg width="'+TW+'" height="'+TH+'" style="position:absolute;top:0;left:0;overflow:visible">',
    '<defs>',
    '<filter id="shad-'+slug+'">',
    '  <feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dx="0" dy="1" result="s1"/>',
    '  <feGaussianBlur in="SourceAlpha" stdDeviation="8"/><feOffset dx="4" dy="7" result="s2"/>',
    '  <feGaussianBlur in="SourceAlpha" stdDeviation="18"/><feOffset dx="8" dy="14" result="s3"/>',
    '  <feMerge><feMergeNode in="s3"/><feMergeNode in="s2"/><feMergeNode in="s1"/></feMerge>',
    '  <feComponentTransfer><feFuncA type="linear" slope="0.62"/></feComponentTransfer>',
    '</filter>',
    '<filter id="pinblur"><feGaussianBlur stdDeviation="3.5"/></filter>',
    '<filter id="tapeblur"><feGaussianBlur stdDeviation="4"/></filter>',
    '<filter id="'+grainId+'">',
    '  <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="4" seed="42"/>',
    '  <feColorMatrix type="saturate" values="0"/>',
    '  <feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>',
    '</filter>',
    '<pattern id="tapetex" x="0" y="0" width="5" height="5" patternUnits="userSpaceOnUse">',
    '  <rect width="5" height="5" fill="rgba(18,14,10,0.035)"/></pattern>',
    '<clipPath id="'+clipId+'"><path d="'+edgePath+'" transform="translate('+EX+','+EX+')"/></clipPath>',
    extraDefs || '',
    '</defs>',
    '<!-- shadow -->',
    '<path d="'+edgePath+'" transform="translate('+EX+','+EX+')" fill="rgb(10,8,6)" filter="url(#shad-'+slug+')" opacity="0.6"/>',
    '<!-- substrate -->',
    '<path d="'+edgePath+'" transform="translate('+EX+','+EX+')" fill="'+bg+'"/>',
    '<!-- grain -->',
    '<rect x="'+EX+'" y="'+EX+'" width="'+(W+PAD*2)+'" height="'+(H+PAD*2)+'" fill="rgb(20,16,12)" filter="url(#'+grainId+')" clip-path="url(#'+clipId+')" opacity="0.88"/>',
    '<rect x="'+EX+'" y="'+EX+'" width="'+(W+PAD*2)+'" height="'+(H+PAD*2)+'" fill="white" filter="url(#'+grainId+')" clip-path="url(#'+clipId+')" opacity="0.32"/>',
    extraOverlay || '',
    '<!-- content area -->',
    '<rect x="'+(EX+PAD)+'" y="'+(EX+PAD)+'" width="'+W+'" height="'+H+'" fill="rgba(18,14,10,0.035)" rx="2"/>',
    '<text x="'+(EX+PAD+W/2)+'" y="'+(EX+PAD+H/2)+'" text-anchor="middle" dominant-baseline="middle" fill="rgba(18,14,10,0.16)" font-size="12" font-family="system-ui" letter-spacing="0.1em">CONTENT AREA</text>',
    '<!-- mounts -->',
    mountsSvg,
    '</svg>',
    '</div>',
    '<div style="margin-top:14px;padding:14px 16px;background:rgba(255,255,255,0.55);border-radius:8px;font:12px/1.8 system-ui;color:#666;max-width:'+TW+'px">'+note+'</div>',
    '</div>',
  ].join('\n');
}

// Edge paths (full substrate w×h including padding)
const SW = W + PAD*2, SH = H + PAD*2;
const straight = 'M 0 0 L '+SW+' 0 L '+SW+' '+SH+' L 0 '+SH+' Z';
const torn     = tornEdge(SW, SH, 42, 22);
const deckled  = deckledEdge(SW, SH, 77, 13);
const pinked   = pinkedEdge(SW, SH, 19, 19);

// Photo gloss overlay
const photoDefs = [
  '<linearGradient id="pg-gloss" x1="0%" y1="0%" x2="88%" y2="88%">',
  '  <stop offset="0%" stop-color="white" stop-opacity="0.4"/>',
  '  <stop offset="38%" stop-color="white" stop-opacity="0.12"/>',
  '  <stop offset="100%" stop-color="white" stop-opacity="0"/>',
  '</linearGradient>',
  '<clipPath id="clip-photo-ov"><path d="'+straight+'" transform="translate('+EX+','+EX+')"/></clipPath>',
].join('\n');
const photoOv = '<rect x="'+EX+'" y="'+EX+'" width="'+SW+'" height="'+SH+'" fill="url(#pg-gloss)" clip-path="url(#clip-photo-ov)"/>';

// Fabric weave overlay
const fabricDefs = [
  '<pattern id="weave" x="0" y="0" width="7" height="7" patternUnits="userSpaceOnUse">',
  '  <line x1="0" y1="0" x2="7" y2="0" stroke="rgba(18,14,10,0.16)" stroke-width="0.7"/>',
  '  <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(18,14,10,0.16)" stroke-width="0.7"/>',
  '  <line x1="0" y1="3.5" x2="7" y2="3.5" stroke="rgba(255,255,255,0.09)" stroke-width="0.5"/>',
  '  <line x1="3.5" y1="0" x2="3.5" y2="7" stroke="rgba(255,255,255,0.09)" stroke-width="0.5"/>',
  '</pattern>',
  '<clipPath id="clip-fabric-ov"><path d="'+pinked+'" transform="translate('+EX+','+EX+')"/></clipPath>',
].join('\n');
const fabricOv = '<rect x="'+EX+'" y="'+EX+'" width="'+SW+'" height="'+SH+'" fill="url(#weave)" clip-path="url(#clip-fabric-ov)" opacity="0.82"/>';

// Card edge overlay
const cardDefs = [
  '<linearGradient id="card-sides" x1="0%" y1="0%" x2="100%" y2="0%">',
  '  <stop offset="0%" stop-color="rgba(18,14,10,0.13)"/>',
  '  <stop offset="4%" stop-color="rgba(18,14,10,0)"/>',
  '  <stop offset="96%" stop-color="rgba(18,14,10,0)"/>',
  '  <stop offset="100%" stop-color="rgba(18,14,10,0.13)"/>',
  '</linearGradient>',
  '<clipPath id="clip-card-ov"><path d="'+straight+'" transform="translate('+EX+','+EX+')"/></clipPath>',
].join('\n');
const cardOv = [
  '<rect x="'+EX+'" y="'+EX+'" width="'+SW+'" height="'+SH+'" fill="url(#card-sides)" clip-path="url(#clip-card-ov)"/>',
  '<rect x="'+EX+'" y="'+EX+'" width="'+SW+'" height="3" fill="white" opacity="0.35" clip-path="url(#clip-card-ov)"/>',
].join('\n');

// Corner wear for archive note
const archDefs = [
  '<radialGradient id="cwear" cx="0%" cy="0%" r="100%">',
  '  <stop offset="0%" stop-color="rgba(18,14,10,0.3)"/>',
  '  <stop offset="100%" stop-color="rgba(18,14,10,0)"/>',
  '</radialGradient>',
  '<clipPath id="clip-arch-ov"><path d="'+deckled+'" transform="translate('+EX+','+EX+')"/></clipPath>',
].join('\n');
const archOv = [
  '<ellipse cx="'+EX+'" cy="'+EX+'" rx="62" ry="62" fill="url(#cwear)" clip-path="url(#clip-arch-ov)"/>',
  '<ellipse cx="'+(EX+SW)+'" cy="'+EX+'" rx="54" ry="54" fill="url(#cwear)" clip-path="url(#clip-arch-ov)"/>',
  '<ellipse cx="'+EX+'" cy="'+(EX+SH)+'" rx="58" ry="58" fill="url(#cwear)" clip-path="url(#clip-arch-ov)"/>',
].join('\n');

const cards = [
  card(
    'Editorial Photo / 照片纸',
    '<b>边缘</b>：直边 (straight)　<b>固定</b>：黄铜图钉 r=12px，针孔径向阴影 r=21px　<b>材质</b>：照片高光（左上→右下渐变）　<b>阴影</b>：三层，偏移 (8,14)px',
    '#f8f6f2', straight,
    pin(EX+28, EX+28, 9, 'brass'),
    photoDefs, photoOv
  ),
  card(
    'Sketch Paper / 素描纸',
    '<b>边缘</b>：撕裂边 (torn) ±22px 贝塞尔　<b>固定</b>：遮蔽胶带 w=180px，右侧翘起　<b>材质</b>：低频纸张颗粒 (0.02)　<b>阴影</b>：沿撕裂边漫散',
    '#f4f1ea', torn,
    tape(EX+PAD+W/2, EX-14, 180, -1.8),
    '', ''
  ),
  card(
    'Fabric Swatch / 面料',
    '<b>边缘</b>：锯齿边 (pinked) 齿深 19px，步距 16px　<b>固定</b>：黄铜图钉　<b>材质</b>：7px 经纬编织纹理　<b>阴影</b>：偏移 (6,8)px',
    '#f9f7f3', pinked,
    pin(EX+28, EX+28, 9, 'brass'),
    fabricDefs, fabricOv
  ),
  card(
    'Color Card / 卡纸',
    '<b>边缘</b>：直边 + 侧边阴影（模拟卡纸厚度）　<b>固定</b>：顶部居中黄铜图钉 r=10px　<b>材质</b>：顶切高光线 + 侧边渐变　<b>阴影</b>：偏移 (4,6)px',
    '#fdfcfa', straight,
    pin(EX+PAD+W/2, EX+20, 8, 'brass'),
    cardDefs, cardOv
  ),
  card(
    'Archive Note / 备注纸',
    '<b>边缘</b>：毛边 (deckled) ±13px 折线，26段　<b>固定</b>：黄铜图钉　<b>材质</b>：旧纸色 #f2ede3 + 四角磨损渐变　<b>阴影</b>：偏移 (6,10)px',
    '#f2ede3', deckled,
    pin(EX+28, EX+28, 9, 'brass'),
    archDefs, archOv
  ),
  card(
    'AVOID / 排除 — 红色图钉',
    '<b>边缘</b>：直边（同照片纸）　<b>固定</b>：红色图钉，外发光圈 r=21px 语义强调　<b>材质</b>：照片纸（仅固定件颜色差异）　<b>阴影</b>：偏移 (8,14)px',
    '#f8f6f2', straight,
    pin(EX+28, EX+28, 9, 'red'),
    photoDefs.replace(/clip-photo-ov/g,'clip-avoid-ov'),
    photoOv.replace(/clip-photo-ov/g,'clip-avoid-ov')
  ),
].join('\n\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>素材装裱物理真实感验证</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  background:
    linear-gradient(90deg,rgba(155,150,138,0.18) 1px,transparent 1px) 0 0/88px 100%,
    linear-gradient(rgba(155,150,138,0.1) 1px,transparent 1px) 0 0/100% 88px,
    #f0ede6;
  padding:52px 60px 100px;
  font-family:system-ui,sans-serif;
  min-height:100vh;
}
h1{font-size:2rem;font-weight:900;letter-spacing:-.025em;color:#18191a;margin-bottom:10px}
.sub{font-size:.88rem;color:#777;line-height:1.85;margin-bottom:56px;max-width:740px}
.sub b{color:#444;font-weight:600}
.grid{display:flex;flex-wrap:wrap}
.footer{margin-top:52px;padding:22px 26px;background:rgba(255,255,255,0.55);border-radius:10px;font:12.5px/1.85 system-ui;color:#666;max-width:960px}
.footer b{color:#333;font-weight:700;display:block;margin-bottom:10px}
</style></head>
<body>
<h1>素材装裱 — 物理真实感验证</h1>
<p class="sub">请逐项对比以下效果：<br>
<b>① 阴影</b> — 每张素材是否有清晰的偏移阴影（有重量感），而非悬浮感？<br>
<b>② 边缘</b> — 撕裂 / 毛边 / 锯齿 / 直边 肉眼是否有明显区别？<br>
<b>③ 图钉</b> — 是否有金属光泽 + 针孔压痕（径向渐变）+ 针杆 + 阴影？<br>
<b>④ 胶带</b> — 是否半透明暖米色 + 右侧翘起角 + 竖向折痕 + 气泡？<br>
<b>⑤ 材质纹理</b> — 不同材质（纸/面料/卡纸）视觉上是否可辨？</p>
<div class="grid">${cards}</div>
<div class="footer"><b>审核要点 — 如何判断效果是否达标</b>
每张素材卡片应看起来像放在工作台上的物理素材，而不是屏幕上的数字矩形。<br>
关键感受：<b>重量感</b>（阴影有偏移，告诉你它离桌面有距离）、<b>材质感</b>（直觉区分纸张/面料/卡纸）、<b>手工感</b>（边缘非完美矩形）、<b>固定感</b>（图钉/胶带明确指示素材被固定在哪里）。<br>
如有不达标项，请截图标注反馈，将据此调整实际组件参数。
</div>
</body></html>`;

fs.writeFileSync(path.join(__dirname, 'material-preview.html'), html, 'utf8');
console.log('Written ' + html.length + ' bytes → doc/reference/material-mounting/preview/material-preview.html');
