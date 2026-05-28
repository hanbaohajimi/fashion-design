const root = document.documentElement;
const body = document.body;

const state = {
  theme: 'dark',
  consoleCollapsed: false,
  pointerX: window.innerWidth * 0.5,
  pointerY: window.innerHeight * 0.4,
  raf: 0,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const lerp = (from, to, t) => from + (to - from) * t;

function setPointerVars(x, y) {
  root.style.setProperty('--mouse-x', `${(x / window.innerWidth) * 100}%`);
  root.style.setProperty('--mouse-y', `${(y / window.innerHeight) * 100}%`);
  root.style.setProperty('--fluid-x', `${(x / window.innerWidth) * 100}%`);
  root.style.setProperty('--fluid-y', `${(y / window.innerHeight) * 100}%`);
}

function schedulePointerUpdate() {
  if (state.raf) return;
  state.raf = window.requestAnimationFrame(() => {
    state.raf = 0;
    const currentX = lerp(parseFloat(getComputedStyle(root).getPropertyValue('--fluid-x')) || 50, (state.pointerX / window.innerWidth) * 100, 0.35);
    const currentY = lerp(parseFloat(getComputedStyle(root).getPropertyValue('--fluid-y')) || 50, (state.pointerY / window.innerHeight) * 100, 0.35);
    root.style.setProperty('--mouse-x', `${currentX}%`);
    root.style.setProperty('--mouse-y', `${currentY}%`);
    root.style.setProperty('--fluid-x', `${currentX}%`);
    root.style.setProperty('--fluid-y', `${currentY}%`);
  });
}

function updateTheme(nextTheme) {
  state.theme = nextTheme;
  body.dataset.theme = nextTheme;
  if (nextTheme === 'light') {
    body.style.background =
      'radial-gradient(circle at 20% 10%, rgba(0,47,167,0.12), transparent 24%), radial-gradient(circle at 80% 20%, rgba(124,58,237,0.09), transparent 20%), linear-gradient(180deg, #f5f5f7 0%, #ececef 100%)';
    body.style.color = '#0a0a0a';
    root.style.setProperty('--bg', '#f5f5f7');
    root.style.setProperty('--text', '#0a0a0a');
    root.style.setProperty('--text-soft', 'rgba(10,10,10,0.68)');
    root.style.setProperty('--panel', 'rgba(255,255,255,0.74)');
    root.style.setProperty('--panel-strong', 'rgba(255,255,255,0.9)');
    root.style.setProperty('--line', 'rgba(10,10,10,0.08)');
    root.style.setProperty('--line-strong', 'rgba(10,10,10,0.14)');
  } else {
    body.style.background =
      'radial-gradient(circle at var(--mouse-x) var(--mouse-y), rgba(57,255,20,0.14), transparent 18%), radial-gradient(circle at 20% 20%, rgba(0,47,167,0.18), transparent 30%), radial-gradient(circle at 75% 80%, rgba(124,58,237,0.12), transparent 24%), #0a0a0a';
    body.style.color = '#f5f5f7';
    root.style.setProperty('--bg', '#0a0a0a');
    root.style.setProperty('--text', '#f5f5f7');
    root.style.setProperty('--text-soft', 'rgba(245,245,247,0.72)');
    root.style.setProperty('--panel', 'rgba(17,17,20,0.68)');
    root.style.setProperty('--panel-strong', 'rgba(12,12,14,0.88)');
    root.style.setProperty('--line', 'rgba(255,255,255,0.1)');
    root.style.setProperty('--line-strong', 'rgba(255,255,255,0.18)');
  }
}

function focusSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function createFloatingClone(img, host, index) {
  const rect = host.getBoundingClientRect();
  const clone = document.createElement('img');
  clone.src = img.src;
  clone.alt = img.alt;
  clone.className = 'floating-asset';
  clone.dataset.index = String(index);

  const baseW = clamp(rect.width * 0.3 + index * 18, 120, 190);
  const baseH = baseW * 1.18;
  const startX = clamp(rect.width * (0.08 + index * 0.25), 12, rect.width - baseW - 12);
  const startY = clamp(rect.height * (0.12 + index * 0.1), 12, rect.height - baseH - 12);

  clone.style.position = 'absolute';
  clone.style.left = `${startX}px`;
  clone.style.top = `${startY}px`;
  clone.style.width = `${baseW}px`;
  clone.style.height = `${baseH}px`;
  clone.style.objectFit = 'cover';
  clone.style.borderRadius = '20px';
  clone.style.boxShadow = '0 24px 54px rgba(0,0,0,0.36)';
  clone.style.cursor = 'grab';
  clone.style.userSelect = 'none';
  clone.style.touchAction = 'none';
  clone.style.zIndex = String(20 - index);
  clone.style.transform = `rotate(${index === 0 ? -4 : index === 1 ? 3 : 6}deg) scale(1)`;

  host.appendChild(clone);

  const motion = {
    x: startX,
    y: startY,
    vx: index % 2 === 0 ? 0.24 : -0.18,
    vy: index % 2 === 0 ? 0.16 : -0.12,
    dragging: false,
    offsetX: 0,
    offsetY: 0,
  };

  const tick = () => {
    if (!motion.dragging) {
      motion.x += motion.vx;
      motion.y += motion.vy;

      if (motion.x < 8 || motion.x > rect.width - clone.offsetWidth - 8) motion.vx *= -1;
      if (motion.y < 8 || motion.y > rect.height - clone.offsetHeight - 8) motion.vy *= -1;
      motion.x = clamp(motion.x, 8, rect.width - clone.offsetWidth - 8);
      motion.y = clamp(motion.y, 8, rect.height - clone.offsetHeight - 8);

      clone.style.left = `${motion.x}px`;
      clone.style.top = `${motion.y}px`;
      clone.style.transform = `translate3d(0,0,0) rotate(${index === 0 ? -4 : index === 1 ? 3 : 6}deg) scale(${1 + Math.sin((motion.x + motion.y) * 0.008) * 0.015})`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const onDown = (e) => {
    motion.dragging = true;
    clone.style.cursor = 'grabbing';
    clone.style.zIndex = '50';
    const point = e.touches ? e.touches[0] : e;
    motion.offsetX = point.clientX - rect.left - motion.x;
    motion.offsetY = point.clientY - rect.top - motion.y;
  };

  const onMove = (e) => {
    if (!motion.dragging) return;
    const point = e.touches ? e.touches[0] : e;
    const nextX = point.clientX - rect.left - motion.offsetX;
    const nextY = point.clientY - rect.top - motion.offsetY;
    motion.x = clamp(nextX, 8, rect.width - clone.offsetWidth - 8);
    motion.y = clamp(nextY, 8, rect.height - clone.offsetHeight - 8);
    clone.style.left = `${motion.x}px`;
    clone.style.top = `${motion.y}px`;
  };

  const onUp = () => {
    if (!motion.dragging) return;
    motion.dragging = false;
    clone.style.cursor = 'grab';
    clone.style.zIndex = String(20 - index);
  };

  clone.addEventListener('pointerdown', onDown);
  clone.addEventListener('touchstart', onDown, { passive: true });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('touchend', onUp);
}

function initMoodboardField() {
  const card = document.querySelector('[data-card="moodboard"]');
  if (!card) return;
  const host = card.querySelector('.path-visual');
  if (!host || host.dataset.enhanced === '1') return;
  host.dataset.enhanced = '1';
  const imgs = Array.from(host.querySelectorAll('img')).slice(0, 3);
  host.innerHTML = '';
  host.style.position = 'relative';
  host.style.minHeight = '260px';
  imgs.forEach((img, index) => createFloatingClone(img, host, index));
}

function initColorField() {
  const card = document.querySelector('[data-card="color"]');
  if (!card) return;
  const swatches = Array.from(card.querySelectorAll('.swatch'));
  card.addEventListener('pointermove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    root.style.setProperty('--fluid-x', `${x * 100}%`);
    root.style.setProperty('--fluid-y', `${y * 100}%`);
    swatches.forEach((swatch, index) => {
      const offsetX = (x - 0.5) * (index + 1) * 8;
      const offsetY = (y - 0.5) * (index + 1) * 8;
      swatch.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${1 + (index % 2) * 0.03})`;
      swatch.style.boxShadow = `0 0 ${24 + index * 10}px rgba(57,255,20,${0.08 + index * 0.03})`;
    });
  });
}

function initParallaxStage() {
  const stage = document.querySelector('[data-stage]');
  if (!stage) return;
  const cards = Array.from(stage.querySelectorAll('.stage-card'));
  const update = () => {
    const viewportMid = window.innerHeight * 0.55;
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const distance = (rect.top + rect.height * 0.5 - viewportMid) / window.innerHeight;
      const shift = clamp(distance * -48, -48, 48);
      const parallax = distance * -22;
      card.style.setProperty('--parallax', `${parallax}px`);
      card.style.transform = `translate3d(${parallax}px, ${shift * 0.12}px, 0)`;
      card.style.opacity = `${clamp(1 - Math.abs(distance) * 0.22, 0.75, 1)}`;
      card.style.filter = `blur(${Math.abs(distance) * 0.08}px)`;
      card.style.setProperty('--stage-shift', `${shift}px`);
      if (index % 2 === 1) {
        card.style.marginTop = `${clamp(Math.abs(distance) * 18, 0, 24)}px`;
      }
    });
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

function initCompareDiagram() {
  const fluidDiagram = document.querySelector('.fluid-diagram');
  if (!fluidDiagram) return;
  const nodes = Array.from(fluidDiagram.querySelectorAll('.node'));
  fluidDiagram.addEventListener('pointermove', (e) => {
    const rect = fluidDiagram.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    nodes.forEach((node, index) => {
      const dx = (x - 0.5) * (index + 1) * 6;
      const dy = (y - 0.5) * (index + 1) * 4;
      node.style.transform = `translate(${dx}px, ${dy}px) scale(${1 + index * 0.008})`;
      node.style.boxShadow = `0 0 ${18 + index * 6}px rgba(0,47,167,${0.06 + index * 0.02})`;
    });
  });
}

function initConsole() {
  const consoleEl = document.querySelector('.floating-console');
  if (!consoleEl) return;
  const collapseBtn = consoleEl.querySelector('[data-action="collapse-console"]');
  collapseBtn?.addEventListener('click', () => {
    state.consoleCollapsed = !state.consoleCollapsed;
    consoleEl.classList.toggle('collapsed', state.consoleCollapsed);
    consoleEl.querySelector('.console-body')?.setAttribute('aria-hidden', state.consoleCollapsed ? 'true' : 'false');
  });
}

function initTopbarActions() {
  document.querySelector('[data-action="toggle-theme"]')?.addEventListener('click', () => {
    updateTheme(state.theme === 'dark' ? 'light' : 'dark');
  });
  document.querySelector('[data-action="focus-moodboard"]')?.addEventListener('click', () => focusSection('paths'));
  document.querySelector('[data-action="focus-theater"]')?.addEventListener('click', () => focusSection('theater'));
  document.querySelector('[data-action="play"]')?.addEventListener('click', () => {
    document.body.classList.toggle('motion-paused');
  });
}

function initResponsiveGrid() {
  const update = () => {
    const width = window.innerWidth;
    const rootCols = width < 560 ? 4 : width < 1180 ? 6 : 12;
    document.documentElement.style.setProperty('--grid-cols', String(rootCols));
  };
  window.addEventListener('resize', update);
  update();
}

function initPointer() {
  setPointerVars(state.pointerX, state.pointerY);
  window.addEventListener('pointermove', (e) => {
    state.pointerX = e.clientX;
    state.pointerY = e.clientY;
    schedulePointerUpdate();
  });
}

function initIntersectionGlow() {
  const targets = document.querySelectorAll('.path-card, .matrix-card, .compare-panel, .token-card');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
      }
    });
  }, { threshold: 0.22 });
  targets.forEach((target) => observer.observe(target));
}

function initDragTilt() {
  const cards = document.querySelectorAll('.path-card, .hero-panel, .matrix-card, .compare-panel, .token-card');
  cards.forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      const rotateX = clamp(y * -4, -4, 4);
      const rotateY = clamp(x * 4, -4, 4);
      card.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
    });
    card.addEventListener('pointerleave', () => {
      card.style.transform = '';
    });
  });
}

function initNoiseShift() {
  const noise = document.querySelector('.noise-overlay');
  if (!noise) return;
  let frame = 0;
  const tick = () => {
    frame += 1;
    noise.style.transform = `translate3d(${Math.sin(frame * 0.01) * 4}px, ${Math.cos(frame * 0.012) * 3}px, 0)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function bootstrap() {
  updateTheme('dark');
  initPointer();
  initTopbarActions();
  initConsole();
  initResponsiveGrid();
  initMoodboardField();
  initColorField();
  initParallaxStage();
  initCompareDiagram();
  initIntersectionGlow();
  initDragTilt();
  initNoiseShift();
}

window.addEventListener('DOMContentLoaded', bootstrap);
window.addEventListener('resize', () => {
  initMoodboardField();
  setPointerVars(state.pointerX, state.pointerY);
});
