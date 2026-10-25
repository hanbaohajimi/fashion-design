const fs = require('fs');

function seededRng(seed) {
  let s = seed + 1;
  return function() {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= (s >>> 16);
    return (s >>> 0) / 0xffffffff;
  };
}

function tornEdge(w, h, seed, dev) {
  const r = seededRng(seed);
  const segs = 14;
  let d = `M ${(r()*dev*0.4).toFixed(1)} ${(r()*dev*0.4).toFixed(1)}`;
  for (let i = 1; i <= segs; i++) {
    const x = (w/segs*i).toFixed(1);
    const y = (r()*dev*2 - dev*0.8).toFixed(1);
    const c1x = (w/segs*i - w/segs*0.6).toFixed(1);
    const c1y = (r()*dev*2.5 - dev).toFixed(1);
    const c2x = (w/segs*i - w/segs*0.15).toFixed(1);
    const c2y = (r()*dev*2.5 - dev).toFixed(1);
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`;
  }
  for (let i = 1; i <= segs; i++) {
    const x = (w + r()*dev*2 - dev*0.8).toFixed(1);
    const y = (h/segs*i).toFixed(1);
    const c1x = (w + r()*dev*2.5 - dev).toFixed(1);
    const c1y = (h/segs*i - h/segs*0.6).toFixed(1);
    const c2x = (w + r()*dev*2.5 - dev).toFixed(1);
    const c2y = (h/segs*i - h/segs*0.15).toFixed(1);
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`;
  }
  for (let i = segs; i >= 0; i--) {
    const x = (w/segs*i).toFixed(1);
    const y = (h + r()*dev*2 - dev*0.8).toFixed(1);
    const c1x = (w/segs*i + w/segs*0.6).toFixed(1);
    const c1y = (h + r()*dev*2.5 - dev).toFixed(1);
    const c2x = (w/segs*i + w/segs*0.15).toFixed(1);
    const c2y = (h + r()*dev*2.5 - dev).toFixed(1);
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`;
  }
  for (let i = segs; i >= 0; i--) {
    const x = (r()*dev*1.2 - dev*0.4).toFixed(1);
    const y = (h/segs*i).toFixed(1);
    const c1x = (r()*dev*2.5 - dev).toFixed(1);
    const c1y = (h/segs*i + h/segs*0.6).toFixed(1);
    const c2x = (r()*dev*2.5 - dev).toFixed(1);
    const c2y = (h/segs*i + h/segs*0.15).toFixed(1);
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`;
  }
  return d + ' Z';
}

function deckledEdge(w, h, seed, dev) {
  const r = seededRng(seed);
  const segs = 24;
  let d = `M 0 ${(r()*dev*0.5).toFixed(1)}`;
  for (let i = 1; i <= segs; i++) d += ` L ${(w/segs*i).toFixed(1)} ${(r()*dev*2 - dev).toFixed(1)}`;
  for (let i = 1; i <= segs; i++) d += ` L ${(w + r()*dev*2 - dev).toFixed(1)} ${(h/segs*i).toFixed(1)}`;
  for (let i = segs; i >= 0; i--) d += ` L ${(w/segs*i).toFixed(1)} ${(h + r()*dev*2 - dev).toFixed(1)}`;
  for (let i = segs; i >= 0; i--) d += ` L ${(r()*dev*2 - dev).toFixed(1)} ${(h/segs*i).toFixed(1)}`;
  return d + ' Z';
}

function pinkedEdge(w, h, seed, depth) {
  const r = seededRng(seed);
  const step = 14;
  let d = 'M 0 0';
  for (let x = 0; x < w; x += step) {
    d += ` L ${(x+step/2).toFixed(1)} ${(-(depth*(0.85+r()*0.3))).toFixed(1)} L ${(x+step).toFixed(1)} 0`;
  }
  for (let y = 0; y < h; y += step) {
    d += ` L ${(w+depth*(0.85+r()*0.3)).toFixed(1)} ${(y+step/2).toFixed(1)} L ${w} ${(y+step).toFixed(1)}`;
  }
  for (let x = w; x > 0; x -= step) {
    d += ` L ${(x-step/2).toFixed(1)} ${(h+depth*(0.85+r()*0.3)).toFixed(1)} L ${(x-step).toFixed(1)} ${h}`;
  }
  for (let y = h; y > 0; y -= step) {
    d += ` L ${(-depth*(0.85+r()*0.3)).toFixed(1)} ${(y-step/2).toFixed(1)} L 0 ${(y-step).toFixed(1)}`;
  }
  return d + ' Z';
}

module.exports = { tornEdge, deckledEdge, pinkedEdge };
