import { createBodySurface } from "./plush-body";
import type { CharacterPresentation } from "./project-activity";

type Scene = "idle" | "thinking" | "working" | "needs_attention" | "sleeping";
type Action = "" | "hello" | "notice" | "curious" | "success" | "failure" | "land" | "wake";
type Press = { id: number; pointerType: string; clientX: number; clientY: number; lastClientX: number; lastClientY: number; x: number; y: number; time: number; canceled: boolean };
export interface PlushOptions {
  size: 72 | 96;
  paused: boolean;
  storageKey: string;
  onOpenChat: (focusInput: boolean) => void;
  onActiveChange: (active: boolean) => void;
  onInteraction: () => void;
}
export interface PlushRuntime {
  update: (presentation: CharacterPresentation, paused: boolean, size: 72 | 96) => void;
  dispose: () => void;
}

/** Approved plush rig. Springs write only to its own DOM, never to React or the board store. */
export function createPlushRuntime(root: HTMLDivElement, options: PlushOptions): PlushRuntime {
  const $ = <T extends Element = HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error("织芽资源未准备完成");
    return element;
  };
  const all = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
  const stage = $(".pp-stage"), position = $(".pp-position"), button = $<SVGSVGElement>(".pp-hit");
  const rise = $(".pp-rise"), lean = $(".pp-lean"), form = $(".pp-form");
  const upperParts = all(".pp-upper");
  const bodyImage = $<HTMLImageElement>(".pp-body-fallback"), contact = $(".pp-contact");
  const face = $(".pp-face"), eyes = $(".pp-eyes");
  const openEyes = all(".pp-eye-open"), restEyes = all(".pp-eye-rest"), happyEyes = all(".pp-eye-happy");
  const brows = all(".pp-brow");
  const leaves = [$(".pp-leaf-big"), $(".pp-leaf-small")] as const;
  const mouth = $(".pp-mouth"), mouthRest = $(".pp-mouth-rest"), mouthOh = $(".pp-mouth-oh"), shadow = $(".pp-shadow");
  const kit = $(".pp-work-kit"), pencil = $(".pp-pencil-motion"), question = $(".pp-question");
  const dots = [$(".pp-dot-one"), $(".pp-dot-two")] as const;
  const thoughtMarks = all(".pp-thought-mark");
  const sparks = [$(".pp-spark-primary"), $(".pp-spark-secondary")] as const;
  const caption = $(".pp-caption"), expression = $(".pp-expression");
  const labelButton = $<HTMLButtonElement>(".pp-label"), labelAnchor = $(".pp-label-anchor");
  const speechText = $(".pp-speech"), announcement = $(".pp-announcement");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const abort = new AbortController();
  const on = <K extends keyof (GlobalEventHandlersEventMap & DocumentEventMap & WindowEventMap)>(target: EventTarget, event: K, handler: (event: (GlobalEventHandlersEventMap & DocumentEventMap & WindowEventMap)[K]) => void, settings: AddEventListenerOptions = {}) =>
    target.addEventListener(event, handler as EventListener, { ...settings, signal: abort.signal });
  const now = () => performance.now() / 1000;
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const smooth = (v: number) => { const n = clamp(v, 0, 1); return n * n * (3 - 2 * n); };
  const random = (min: number, max: number) => min + Math.random() * (max - min);
  const spring = (value: number, stiffness: number, damping: number) => ({ value, target: value, velocity: 0, stiffness, damping });
  const s = {
    x: spring(0, 140, 19), y: spring(0, 140, 19),
    eyeX: spring(0, 330, 34), eyeY: spring(0, 330, 34),
    faceX: spring(0, 120, 21), faceY: spring(0, 120, 21),
    angle: spring(0, 100, 10), lift: spring(0, 140, 19), squash: spring(0, 150, 17),
    nod: spring(0, 140, 19), roll: spring(0, 100, 10),
    smile: spring(0, 220, 28), surprise: spring(0, 250, 30), sleep: spring(0, 220, 28),
    lid: spring(1, 220, 28), asymmetry: spring(0, 220, 28),
    leaf: spring(0, 105, 11), smallLeaf: spring(0, 74, 9),
    kit: spring(0, 220, 28), pencilAngle: spring(0, 140, 19),
    pencilX: spring(0, 140, 19), pencilY: spring(0, 140, 19),
    question: spring(0, 220, 28), thought: spring(0, 170, 25), dotOne: spring(0, 220, 28), dotTwo: spring(0, 220, 28),
    sparkOne: spring(0, 220, 28), sparkTwo: spring(0, 220, 28)
  };
  const particles = Object.values(s);
  const config = { follow: true, energy: .82, size: options.size };
  const sizes = { 96: 96, 72: 72 };

  const expressions: Partial<Record<Scene | Exclude<Action, "">, string>> = {
    thinking: "( ˘･ᴗ･˘ )", working: "φ(•ᴗ•๑)", success: "( •̀ᴗ•́ )و",
    needs_attention: "(・◇・)?", failure: "(・◇・)?", sleeping: "(˘ω˘) zZ",
  };
  const durations = { hello: 1.65, notice: .95, curious: 2.6, success: 2.6, failure: 2.6, land: .86, wake: 1.25 };
  const strokeDuration = 2.5;
  let scene: Scene = "idle", action: Action = "", actionAt = 0;
  let presentation: CharacterPresentation = { scene: "idle", status: "idle", label: "", activityKey: "" };
  let speechId = "", speechTimer = 0, speechRemaining = 0, speechDeadline = 0, speechEpoch = 0;
  let speechVisible = false, speechHovered = false, speechFocused = false, speechExiting = false;
  let speechAnimation: Animation | null = null;
  let speechPointer = "mouse";
  let feedbackId = "";
  let raf = 0, timer = 0, previousTime = 0, disposed = false, inView = true, focused = true, chatOpen = options.paused;
  let lastActive: boolean | null = null;
  let blinkAt = now() + 3.6, blinkStart = -100, doubleBlink = false;
  let glanceAt = now() + 11, glanceEnd = -100, glanceX = 0, glanceY = 0;
  let nextThought = now() + 5, nextStroke = now() + 1, strokeStart = -100;
  let workDirection = 1;
  let lookInside = false, gazeX = 0, gazeY = 0, gazeUntil = -100, gazeChangeAt = -100, lateX = 0, lateY = 0;
  let quietUntil = -100, lastHello = -100, hoverTimer = 0;
  let press: Press | null = null, pendingTap: { pointerType: string; at: number } | null = null;
  let held = false, holdTimer = 0, velocityX = 0, velocityY = 0;
  let width = 0, height = 0, unit = options.size / 240, stageRect: DOMRect | null = null;
  let anchor: { x: number; y: number } | null = null;
  const cache = new WeakMap<HTMLElement | SVGElement, Record<string, string>>();
  const bodySurface = createBodySurface(root, $<HTMLCanvasElement>(".pp-body-mesh"), bodyImage, () => { if (active()) { render(now()); wake(); } });
  function style(element: HTMLElement | SVGElement, property: string, value: string) {
    let values = cache.get(element);
    if (!values) { values = {}; cache.set(element, values); }
    if (values[property] !== value) {
      element.style.setProperty(property.replace(/[A-Z]/g, char => "-" + char.toLowerCase()), value);
      values[property] = value;
    }
  }
  const active = () => !disposed && inView && focused && !document.hidden && !chatOpen;
  const moving = () => particles.some(p => Math.abs(p.target - p.value) > .001 || Math.abs(p.velocity) > .003);
  function bounds() {
    const side = 18 + 120 * unit;
    // Reserve the bottom controls plus an expression and up to two caption lines.
    const bottomClearance = 88 + 72;
    return { minX: side, maxX: Math.max(side, width - side), minY: 58 + 290 * unit, maxY: Math.max(58 + 290 * unit, height - bottomClearance) };
  }
  function constrainPosition() {
    const b = bounds();
    const axes = [["x", b.minX, b.maxX], ["y", b.minY, b.maxY]] as const;
    for (const [key, min, max] of axes) {
      const p = s[key]; p.target = clamp(p.target, min, max);
      if (p.value < min || p.value > max) { p.value = clamp(p.value, min, max); p.velocity = 0; }
    }
  }
  function syncLabel() {
    const current = held ? "held" : action || scene;
    const label = held ? "松手放下，Esc 取消" : presentation.label;
    if (caption.textContent !== label) caption.textContent = label;
    const cue = held ? "" : expressions[action || scene] ?? "";
    expression.textContent = cue;
    expression.hidden = !cue;
    labelButton.hidden = !label && !speechVisible;
    labelButton.dataset.speaking = String(speechVisible);
    labelButton.setAttribute("aria-label", `${speechVisible ? speechText.textContent : label}，打开设计助手`);
    button.setAttribute("aria-label", "织芽，" + (label ? label + "，" : "") + "轻点打开设计助手，长按移动");
    root.dataset.scene = scene; root.dataset.action = current; root.dataset.held = String(held);
    button.dataset.held = String(held);
  }
  function clearSpeech() {
    ++speechEpoch;
    clearTimeout(speechTimer); speechTimer = 0;
    speechAnimation?.cancel(); speechAnimation = null;
    speechExiting = false;
    speechVisible = false; speechText.hidden = true;
    announcement.textContent = "";
    syncLabel();
  }
  function scheduleSpeech() {
    clearTimeout(speechTimer); speechTimer = 0;
    if (!speechVisible || speechHovered || speechFocused || !active()) return;
    speechDeadline = performance.now() + speechRemaining;
    const epoch = speechEpoch;
    speechTimer = window.setTimeout(() => {
      speechTimer = 0;
      if (epoch !== speechEpoch) return;
      const finish = () => { if (epoch === speechEpoch) clearSpeech(); };
      if (reduced.matches || !active()) { finish(); return; }
      speechAnimation?.cancel();
      speechExiting = true;
      speechAnimation = speechText.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(2px)" }], { duration: 120, easing: "ease-out" });
      speechAnimation.onfinish = finish;
    }, speechRemaining);
  }
  function pauseSpeechTimer() {
    if (speechTimer) speechRemaining = Math.max(0, speechDeadline - performance.now());
    clearTimeout(speechTimer); speechTimer = 0;
    if (speechExiting) {
      // Hover/focus can arrive after the timeout, while the native exit is still running.
      ++speechEpoch;
      speechAnimation?.cancel(); speechAnimation = null;
      speechExiting = false; speechRemaining = 0;
    }
  }
  function showSpeech(next: NonNullable<CharacterPresentation["speech"]>) {
    clearSpeech();
    speechId = next.id;
    speechText.textContent = next.text; speechText.hidden = false;
    announcement.textContent = next.text;
    speechVisible = true; speechRemaining = next.duration;
    syncLabel(); renderPosition();
    if (!reduced.matches) speechAnimation = speechText.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "cubic-bezier(.23,1,.32,1)" });
    scheduleSpeech();
  }
  function setAction(next: Action) { action = next; actionAt = now(); syncLabel(); wake(); }
  function greet() {
    if (held || !active() || action) return;
    const sleeping = scene === "sleeping";
    if (sleeping) scene = "idle";
    lastHello = now(); quietUntil = -100;
    strokeStart = -100; nextStroke = now() + 1.7;
    setAction(sleeping ? "wake" : scene === "idle" ? "hello" : "notice");
  }
  function targets(t: number, dt: number) {
    if (action && t - actionAt >= durations[action]) { action = ""; syncLabel(); }
    const poseScene = action === "failure" ? "needs_attention" : scene;
    if (!reduced.matches && !held) {
      if (t >= glanceAt && poseScene === "idle" && !lookInside && t > quietUntil && !action) {
        glanceX = (Math.random() > .5 ? 1 : -1) * .4; glanceY = -.12;
        glanceEnd = t + .85; glanceAt = t + random(10, 17);
      }
      if (poseScene === "thinking" && t >= nextThought) {
        glanceX = -.24; glanceY = -.02;
        glanceEnd = t + 1.15; nextThought = t + random(5.4, 8.2);
        blinkAt = Math.min(blinkAt, t + .06);
      }
      if (poseScene === "working" && !action && t >= nextStroke) {
        strokeStart = t; nextStroke = t + random(5.8, 8.4);
        workDirection = Math.random() < .35 ? -1 : 1;
      }
    }
    let gx = 0, gy = 0, angle = 0, nod = 0, roll = 0, lift = 0, squash = 0, smile = 0, surprise = 0, lid = 1, sleep = 0, asymmetry = 0;
    let pencilAngle = 0, pencilX = 0, pencilY = 0;
    const pointer = config.follow && lookInside && t < gazeUntil && t > quietUntil;
    if (pointer) { gx = gazeX; gy = gazeY; }
    else if (t < glanceEnd && t > quietUntil) { gx = glanceX; gy = glanceY; }
    if (poseScene === "thinking") {
      gx = .3; gy = -.4; angle = -3.1; nod = -1.2; lid = .94; asymmetry = .045;
      if (t < glanceEnd) { gx = glanceX; gy = glanceY; angle = -.8; nod = .5; }
    } else if (poseScene === "working") {
      gx = .15; gy = .34; angle = 1; nod = 2.4; lid = .95;
      const stroke = !action ? t - strokeStart : -1;
      // Two unequal strokes, a lifted pencil, then a pause to consider the work.
      // Every target uses the existing springs so interruptions keep continuity.
      if (stroke >= 0 && stroke < .35) {
        gx = .36; gy = .53; nod = 2.8; pencilAngle = -3; pencilX = -2; pencilY = -.8;
      } else if (stroke >= .35 && stroke < .62) {
        gx = .23; gy = .56; nod = 3.2; pencilAngle = 4; pencilX = 2; pencilY = 1.5;
      } else if (stroke >= .62 && stroke < .86) {
        gx = .23; gy = .54; nod = 2.8; pencilAngle = 1; pencilX = .6;
      } else if (stroke >= .86 && stroke < 1.18) {
        gx = .08 * workDirection; gy = .56; nod = 3; pencilAngle = -4; pencilX = -2.5; pencilY = 1.8;
      } else if (stroke >= 1.18 && stroke < 1.46) {
        gx = .12; gy = .35; nod = 1.6; pencilAngle = -6; pencilX = -1; pencilY = -3;
      } else if (stroke >= 1.46 && stroke < strokeDuration) {
        gx = .04; gy = -.08; angle = -.25; nod = -.45; lid = 1; smile = .14; pencilAngle = -4; pencilY = -2;
      }
    } else if (poseScene === "needs_attention") {
      gx = 0; gy = -.08; angle = -4.8; nod = -.45; surprise = .82; asymmetry = .11;
      if (pointer) { gx = gazeX * .5; gy = gazeY * .5; }
    } else if (poseScene === "sleeping") {
      gx = 0; gy = .1; angle = -1.8; nod = 5; squash = -.011; sleep = 1;
    }
    if (action === "curious") {
      const e = t - actionAt;
      if (e < .15) { gx = .68; gy = -.18; angle = 0; }
      else if (e < .86) { gx = .56; gy = -.2; angle = -4.6; nod = -.55; }
      else if (e < 1.4) { gx = .22; gy = -.04; angle = -4.6; lid = .97; }
      else if (e < 1.9) { gx = -.3; gy = .04; angle = 1.4; nod = .2; }
      else { gx = 0; gy = 0; angle = 0; smile = .24; }
    } else if (action === "hello") {
      const e = t - actionAt;
      gx = pointer ? gazeX * .5 : 0; gy = -.04;
      if (e < .18) { surprise = .18; angle = 0; nod = -.3; }
      else if (e < .46) { angle = -1.8; nod = -.5; lid = 1.02; smile = .16; }
      else if (e < .84) { angle = -1.3; nod = 2.6; smile = .62; }
      else if (e < 1.2) { angle = -.4; nod = -.5; smile = .48; }
      else { smile = .26; angle = 0; nod = 0; }
    } else if (action === "notice") {
      gx = pointer ? gazeX * .55 : 0; gy = -.04; angle *= .2;
      nod = t - actionAt < .32 ? .8 : -.4; smile = .26; lid = 1; surprise = .12;
    } else if (action === "success") {
      const e = t - actionAt;
      gx = 0; gy = -.08;
      if (e < .17) { surprise = .28; nod = -.4; }
      else if (e < .35) { nod = 1.8; squash = -.02; smile = .7; }
      else if (e < .62) { lift = -8; squash = .014; nod = -.8; smile = 1; angle = -1.8; }
      else if (e < .82) { lift = -3; smile = 1; angle = -.8; }
      else if (e < 1.04) { squash = -.022; nod = 1.2; smile = 1; }
      else if (e < 1.75) { smile = .88; angle = -.65; nod = -.3; }
      else { smile = .34; nod = 0; }
    } else if (action === "land") {
      const e = t - actionAt;
      if (e < .18) { squash = -.022; nod = 2; surprise = .12; }
      else if (e < .52) { smile = .4; nod = -.3; }
    } else if (action === "wake") {
      const e = t - actionAt;
      gx = pointer ? gazeX * .4 : 0; gy = -.08;
      if (e < .2) { sleep = .65; nod = 3.8; }
      else if (e < .58) { surprise = .25; angle = -1.1; nod = -1; lid = 1.04; }
      else { smile = .32; nod = 0; }
    }
    if (press && !held && !press.canceled) squash -= .012;
    if (held) {
      gx = clamp(velocityX / 900, -.65, .65); gy = .22;
      roll = clamp(-velocityX * .007, -7.5, 7.5);
      angle = clamp(-velocityX * .0025, -2, 2); nod = 1; lift = -5;
      squash = clamp(.018 - velocityY * .000025, -.012, .04);
      smile = 0; surprise = .65; lid = 1.03; sleep = 0; asymmetry = 0;
    }
    if (Math.abs(gx - s.eyeX.target) + Math.abs(gy - s.eyeY.target) > .12 && t - gazeChangeAt > .14) {
      lateX = s.eyeX.value; lateY = s.eyeY.value; gazeChangeAt = t;
    }
    const bx = t - gazeChangeAt < .095 ? lateX : gx, by = t - gazeChangeAt < .095 ? lateY : gy;
    s.eyeX.target = gx; s.eyeY.target = gy;
    s.faceX.target = bx * .75; s.faceY.target = by * .55;
    s.angle.target = (angle + bx * 1.35) * config.energy;
    s.nod.target = (nod + by * .45) * config.energy;
    s.roll.target = roll * config.energy;
    s.lift.target = lift * config.energy; s.squash.target = squash * config.energy;
    s.smile.target = smile; s.surprise.target = surprise; s.lid.target = lid; s.sleep.target = sleep; s.asymmetry.target = asymmetry;
    const elapsed = t - actionAt;
    s.kit.target = poseScene === "working" && !held ? 1 : 0;
    s.pencilAngle.target = (held ? 0 : pencilAngle) * config.energy;
    s.pencilX.target = (held ? 0 : pencilX) * config.energy;
    s.pencilY.target = (held ? 0 : pencilY) * config.energy;
    s.question.target = poseScene === "needs_attention" && !held && action !== "notice" ? 1 : 0;
    s.thought.target = poseScene === "thinking" && !held && action !== "notice" ? 1 : 0;
    s.dotOne.target = action === "curious" && elapsed > .22 && elapsed < 1.5 ? 1 : 0;
    s.dotTwo.target = action === "curious" && elapsed > .36 && elapsed < 1.5 ? 1 : 0;
    s.sparkOne.target = action === "success" && elapsed > .42 && elapsed < 1.38 ? 1 : 0;
    s.sparkTwo.target = action === "success" && elapsed > .62 && elapsed < 1.52 ? 1 : 0;
    s.leaf.target = clamp(-s.angle.velocity * .12 - s.roll.velocity * .1 - s.lift.velocity * .04 - s.nod.velocity * .12, -5.5, 5.5);
    s.smallLeaf.target = -s.leaf.target * .68;
    velocityX *= Math.exp(-dt * 8); velocityY *= Math.exp(-dt * 8);
    if (reduced.matches) {
      for (const [key, p] of Object.entries(s)) {
        if (["x", "y"].includes(key)) p.value = p.target;
        else p.value = p.target = key === "smile" ? (action === "success" ? .9 : 0)
          : key === "surprise" ? (held ? .65 : poseScene === "needs_attention" ? .82 : 0)
          : key === "kit" ? (poseScene === "working" && !held ? 1 : 0)
          : key === "question" ? (poseScene === "needs_attention" && !held ? 1 : 0)
          : key === "thought" ? (poseScene === "thinking" && !held ? 1 : 0)
          : key === "dotOne" || key === "dotTwo" ? (action === "curious" ? .85 : 0)
          : key === "sparkOne" || key === "sparkTwo" ? (action === "success" ? .85 : 0)
          : key === "sleep" ? (poseScene === "sleeping" ? 1 : 0) : key === "lid" ? 1 : 0;
        p.velocity = 0;
      }
    } else {
      const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
      for (let i = 0; i < steps; i++) {
        for (const p of particles) {
          p.velocity += ((p.target - p.value) * p.stiffness - p.velocity * p.damping) * h;
          p.value += p.velocity * h;
          if (Math.abs(p.target - p.value) < .001 && Math.abs(p.velocity) < .003) { p.value = p.target; p.velocity = 0; }
        }
      }
    }
    constrainPosition();
  }
  function renderPosition() {
    style(labelAnchor, "left", (sizes[config.size] / 2 + clamp(s.x.value, 124, Math.max(124, width - 124)) - s.x.value).toFixed(1) + "px");
    labelAnchor.dataset.side = s.y.value - 290 * unit < 164 ? "below" : "above";
    style(position, "transform", "translate(" + (s.x.value - sizes[config.size] / 2).toFixed(3) + "px," + (s.y.value - 290 * unit).toFixed(3) + "px)");
  }
  function render(t: number) {
    const f = (value: number) => value.toFixed(3);
    const smile = smooth(s.smile.value), sleep = smooth(s.sleep.value), oh = clamp(s.surprise.value, 0, 1);
    const bt = t - blinkStart;
    let blink = 1;
    if (!reduced.matches && sleep < .5) {
      if (bt >= 0 && bt < .055) blink = 1 - .96 * smooth(bt / .055);
      else if (bt >= .055 && bt < .075) blink = .04;
      else if (bt >= .075 && bt < .19) blink = .04 + .96 * smooth((bt - .075) / .115);
    }
    renderPosition();
    style(rise, "transform", "translateY(" + f(s.lift.value * unit) + "px)");
    style(lean, "transform", "rotate(" + f(s.roll.value) + "deg)");
    const upperTransform = "translateY(" + f(s.nod.value * unit) + "px) rotate(" + f(s.angle.value) + "deg)";
    upperParts.forEach((el) => style(el, "transform", upperTransform));
    style(bodyImage, "transform", upperTransform);
    bodySurface.draw(s.angle.value, s.nod.value);
    const sy = 1 + s.squash.value;
    style(form, "transform", "scale(" + f(1 / sy) + "," + f(sy) + ")");
    style(face, "transform", "translate(" + f(s.faceX.value * unit) + "px," + f(s.faceY.value * unit) + "px)");
    style(eyes, "transform", "translate(" + f(s.eyeX.value * 2.35 * unit) + "px," + f(s.eyeY.value * 1.75 * unit) + "px)");
    const happy = smooth((smile - .2) / .65) * (1 - sleep);
    const closure = Math.max(happy, sleep, 1 - blink);
    openEyes.forEach((el, i) => {
      const eyelid = Math.max(.035, (1 - closure * .96) * (s.lid.value - (i === 0 ? s.asymmetry.value : 0)));
      style(el, "transform", "scale(" + f(1 + oh * .035) + "," + f(eyelid) + ")");
      style(el, "opacity", f(1 - smooth((closure - .55) / .4)));
    });
    restEyes.forEach((el) => style(el, "opacity", f(Math.max(sleep, 1 - blink) * (1 - happy) * smooth((closure - .35) / .65))));
    happyEyes.forEach((el) => {
      style(el, "opacity", f(happy * smooth((closure - .35) / .65)));
      style(el, "transform", "scaleY(" + f(.7 + closure * .3) + ")");
    });
    brows.forEach((el, i) => {
      const waiting = i === 0 ? s.asymmetry.value * -7 : 0;
      style(el, "transform", "translateY(" + f((-oh * 1.6 + sleep * .65 - happy * .7 + waiting) * unit) + "px) rotate(" + f((i === 0 ? -1 : 1) * (sleep * 3 - oh * 3)) + "deg)");
    });
    style(mouth, "transform", "translate(" + f(s.eyeX.value * .2 * unit) + "px,0) scale(" + f(1 + smile * .1) + "," + f(1 + smile * .12 - sleep * .12) + ")");
    const surpriseMouth = smooth((oh - .22) / .55);
    style(mouthRest, "opacity", f(1 - surpriseMouth));
    style(mouthOh, "opacity", f(surpriseMouth));
    style(leaves[0], "transform", "rotate(" + f(s.leaf.value) + "deg)");
    style(leaves[1], "transform", "rotate(" + f(s.smallLeaf.value) + "deg)");
    const altitude = Math.max(0, -s.lift.value) + (held ? 22 : 0);
    style(shadow, "transform", "scale(" + f(1 - Math.min(.28, altitude / 160)) + ")");
    style(shadow, "opacity", f(1 - Math.min(.5, altitude / 110)));
    style(contact, "transform", "scaleX(" + f(1 - Math.min(.4, altitude / 85)) + ")");
    style(contact, "opacity", f(1 - Math.min(.94, altitude / 27)));
    const kitAmount = clamp(s.kit.value, 0, 1);
    style(kit, "opacity", f(kitAmount));
    style(kit, "transform", "translateY(" + f((reduced.matches ? 0 : (1 - kitAmount) * 13) * unit) + "px) rotate(-5deg)");
    style(pencil, "transform", "translate(" + f(s.pencilX.value * unit) + "px," + f(s.pencilY.value * unit) + "px) rotate(" + f(24 + s.pencilAngle.value) + "deg)");
    const questionAmount = clamp(s.question.value, 0, 1);
    style(question, "opacity", f(questionAmount));
    style(question, "transform", "translateY(" + f((reduced.matches ? 0 : (1 - questionAmount) * 2) * unit) + "px) rotate(8deg)");
    thoughtMarks.forEach((el, i) => {
      const amount = smooth((s.thought.value - i * .17) / (1 - i * .17));
      style(el, "opacity", f(amount));
      style(el, "transform", "translateY(" + f((reduced.matches ? 0 : (1 - amount) * 2) * unit) + "px) rotate(" + (i - 1) * 10 + "deg)");
    });
    dots.forEach((el, i) => {
      const amount = clamp((i ? s.dotTwo : s.dotOne).value, 0, 1);
      style(el, "opacity", f(amount));
      style(el, "transform", "translate(" + f(i * 10 * unit) + "px," + f((-i * 8 + (reduced.matches ? 0 : (1 - amount) * 2)) * unit) + "px) scale(" + f(i ? .78 : 1) + ")");
    });
    sparks.forEach((el, i) => {
      const amount = clamp((i ? s.sparkTwo : s.sparkOne).value, 0, 1);
      const scale = reduced.matches ? 1 : .94 + amount * .06;
      style(el, "opacity", f(amount));
      style(el, "transform", "translateY(" + f((reduced.matches ? 0 : (1 - amount) * 2.5) * unit) + "px) rotate(" + (i ? 12 : -8) + "deg) scale(" + f(scale) + ")");
    });
  }
  function deadlines(t: number) {
    const values = [];
    if (action) values.push(actionAt + durations[action]);
    if (!reduced.matches) {
      if (scene !== "sleeping") values.push(blinkAt);
      if (scene === "idle" && !lookInside && !action) values.push(Math.max(glanceAt, quietUntil));
      if (scene === "thinking") values.push(nextThought);
      if (scene === "working") values.push(nextStroke);
      if (glanceEnd > t) values.push(glanceEnd);
      if (lookInside && gazeUntil > t) values.push(gazeUntil);
    }
    return values.filter((value) => value > t);
  }
  function frame() {
    raf = 0;
    if (!active()) { previousTime = 0; return; }
    const start = performance.now(), t = start / 1000;
    const dt = previousTime ? clamp(t - previousTime, 0, .04) : 1 / 60;
    previousTime = t;
    if (!reduced.matches && t >= blinkAt) {
      if (!held && s.smile.value < .6 && scene !== "sleeping") blinkStart = t;
      if (!doubleBlink && Math.random() < .13 && scene !== "sleeping") { doubleBlink = true; blinkAt = t + .31; }
      else { doubleBlink = false; blinkAt = t + random(3.2, 6.3); }
    }
    targets(t, dt); render(t);
    const eventActive = Boolean(action) || (scene === "working" && t >= strokeStart && t < strokeStart + strokeDuration);
    const blinkActive = t >= blinkStart && t < blinkStart + .2;
    const motionActive = !reduced.matches && (moving() || eventActive || blinkActive || t - gazeChangeAt < .11);
    if (motionActive) raf = requestAnimationFrame(frame);
    else {
      previousTime = 0;
      const future = deadlines(t);
      if (future.length) timer = window.setTimeout(wake, Math.max(12, (Math.min(...future) - t) * 1000 + 3));
    }
    root.dataset.rendering = String(Boolean(raf));

  }
  function wake() { clearTimeout(timer); timer = 0; if (active() && !raf) raf = requestAnimationFrame(frame); }
  function stop() { cancelAnimationFrame(raf); clearTimeout(timer); raf = 0; timer = 0; previousTime = 0; }
  function sync() {
    stop();
    if (!active()) {
      clearSpeech();
      if (press) finish(null, true);
      pendingTap = null;
      clearTimeout(hoverTimer);
      action = ""; glanceEnd = -100; lookInside = false; strokeStart = -100;
      root.dataset.rendering = "false";
    } else {
      blinkAt = now() + random(3.2, 5.2);
      glanceAt = now() + 11; nextThought = now() + 5; nextStroke = now() + 1.7;
      wake();
    }
    root.dataset.active = String(active());
    if (lastActive !== active()) { lastActive = active(); options.onActiveChange(lastActive); }
    root.dataset.reduced = String(reduced.matches);
    syncLabel();
  }
  function measure() {
    const nextWidth = stage.clientWidth, nextHeight = stage.clientHeight;
    // A hidden chat entry has no layout box; retain the last visible dimensions.
    if (!nextWidth || !nextHeight) return;
    width = nextWidth; height = nextHeight; unit = sizes[config.size] / 240;
    bodySurface.resize(sizes[config.size]);
    stageRect = stage.getBoundingClientRect();
  }
  function placeFromAnchor() {
    const b = bounds();
    s.x.value = s.x.target = anchor ? anchor.x * width : b.maxX - 6;
    s.y.value = s.y.target = anchor ? anchor.y * height : b.maxY;
    s.x.velocity = s.y.velocity = 0;
    constrainPosition(); renderPosition(); if (active()) render(now());
  }
  function rememberAnchor() { if (width && height) anchor = { x: s.x.target / width, y: s.y.target / height }; }
  function pointerLook(event: PointerEvent) {
    if (!fine.matches || event.pointerType === "touch" || held || reduced.matches || !config.follow || !active()) return;
    if (!stageRect) return;
    const dx = event.clientX - stageRect.left - s.x.value;
    const dy = event.clientY - stageRect.top - (s.y.value - 116 * unit);
    const t = now(), x = clamp(dx / (100 * unit + 55), -1, 1), y = clamp(dy / (80 * unit + 40), -.8, .8);
    if (Math.abs(x - gazeX) + Math.abs(y - gazeY) < .025 && lookInside && t < gazeUntil - .3) return;
    gazeX = x; gazeY = y; gazeUntil = t + 2.8; lookInside = true; quietUntil = -100;
    wake();
  }
  function dragTo(event: PointerEvent) {
    if (!press) return;
    const b = bounds();
    const x = clamp(press.x + event.clientX - press.clientX, b.minX, b.maxX);
    const y = clamp(press.y + event.clientY - press.clientY, b.minY, b.maxY);
    const dt = Math.max(.008, (event.timeStamp - press.time) / 1000);
    velocityX = clamp((x - s.x.value) / dt, -1100, 1100);
    velocityY = clamp((y - s.y.value) / dt, -1100, 1100);
    s.x.value = s.x.target = x; s.y.value = s.y.target = y;
    s.x.velocity = s.y.velocity = 0; press.time = event.timeStamp;
    if (active()) { render(now()); wake(); }
  }
  function finish(event: PointerEvent | null, canceled: boolean) {
    if (!press || (event && event.pointerId !== press.id)) return;
    const p = press, wasHeld = held;
    clearTimeout(holdTimer); holdTimer = 0;
    const finalSlop = event ? Math.hypot(event.clientX - p.clientX, event.clientY - p.clientY) : 0;
    if (wasHeld && event && !canceled && finalSlop > 0) {
      if (Math.abs(event.clientX - p.lastClientX) + Math.abs(event.clientY - p.lastClientY) > .5) dragTo(event);
    }
    press = null; held = false;
    if (canceled) {
      s.x.value = s.x.target = p.x; s.y.value = s.y.target = p.y;
      s.x.velocity = s.y.velocity = 0; action = "";
      velocityX = velocityY = 0; if (active()) render(now());
    } else if (wasHeld) {
      const b = bounds();
      if (!reduced.matches) {
        s.x.target = clamp(s.x.value + clamp(velocityX * .026, -12, 12), b.minX, b.maxX);
        s.y.target = clamp(s.y.value + clamp(velocityY * .018, -7, 7), b.minY, b.maxY);
      }
      setAction("land"); rememberAnchor(); save();
    }
    if (button.hasPointerCapture(p.id)) button.releasePointerCapture(p.id);
    syncLabel();
    pendingTap = !canceled && !wasHeld && !p.canceled && finalSlop <= 6
      ? { pointerType: p.pointerType, at: now() }
      : null;
    wake();
  }
  on(root.parentElement ?? stage, "pointermove", pointerLook, { passive: true });
  on(root.parentElement ?? stage, "pointerleave", () => {
    lookInside = false; glanceX = gazeX * .35; glanceY = gazeY * .25;
    glanceEnd = now() + .4; glanceAt = now() + 11; wake();
  });
  on(button, "pointerenter", (event) => {
    if (!fine.matches || event.pointerType === "touch" || reduced.matches || now() - lastHello < 8 || held) return;
    clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => { if (active() && !press && !held) greet(); }, 180);
  });
  on(button, "pointerleave", () => clearTimeout(hoverTimer));
  on(position, "pointerenter", event => {
    if (event.pointerType === "touch" || !fine.matches) return;
    speechHovered = true; pauseSpeechTimer();
  });
  on(position, "pointerleave", () => { speechHovered = false; scheduleSpeech(); });
  on(position, "focusin", () => { speechFocused = true; pauseSpeechTimer(); });
  on(position, "focusout", event => {
    speechFocused = event.relatedTarget instanceof Node && position.contains(event.relatedTarget);
    if (!speechFocused) scheduleSpeech();
  });
  on(labelButton, "pointerdown", event => { speechPointer = event.pointerType; event.stopPropagation(); });
  on(labelButton, "click", event => {
    event.stopPropagation();
    if (active()) options.onOpenChat(event.detail === 0 || speechPointer !== "touch");
  });
  on(button, "contextmenu", (event) => event.preventDefault());
  on(button, "pointerdown", (event) => {
    if (press || !event.isPrimary || event.button !== 0 || !active()) return;
    pendingTap = null;
    action = "";
    options.onInteraction();
    stageRect = stage.getBoundingClientRect();
    if (event.pointerType === "mouse") button.focus({ preventScroll: true });
    clearTimeout(hoverTimer);
    press = { id: event.pointerId, pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY, lastClientX: event.clientX, lastClientY: event.clientY, x: s.x.value, y: s.y.value, time: event.timeStamp, canceled: false };
    // The suspended mass pivots at the actual grab point, not at the floor.
    const gripX = (event.clientX - stageRect.left - s.x.value + sizes[config.size] / 2) / sizes[config.size] * 100;
    const gripY = (event.clientY - stageRect.top - s.y.value + 290 * unit) / (300 * unit) * 100;
    style(lean, "transformOrigin", clamp(gripX, 10, 90).toFixed(3) + "% " + clamp(gripY, 15, 95).toFixed(3) + "%");
    s.x.target = s.x.value; s.y.target = s.y.value; s.x.velocity = s.y.velocity = 0;
    button.setPointerCapture(event.pointerId);
    holdTimer = window.setTimeout(() => {
      if (!press || press.canceled || !active()) return;
      held = true; action = ""; velocityX = velocityY = 0;
      clearSpeech();
      strokeStart = -100; nextStroke = now() + 1.7;
      syncLabel(); wake();
    }, 400);
    wake();
  });
  on(button, "pointermove", (event) => {
    if (!press || press.id !== event.pointerId || press.canceled) return;
    const distance = Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY);
    if (!held && distance > 6) { press.canceled = true; clearTimeout(holdTimer); wake(); return; }
    if (held) dragTo(event);
    press.lastClientX = event.clientX; press.lastClientY = event.clientY;
  });
  on(button, "pointerup", (event) => finish(event, false));
  on(button, "pointercancel", (event) => finish(event, true));
  on(button, "lostpointercapture", (event) => finish(event, true));
  on(button, "click", (event) => {
    if (press) return;
    const tap = pendingTap;
    pendingTap = null;
    if (event.detail === 0) { options.onOpenChat(true); return; }
    // Wait for the native click before replacing the touch target with the draft.
    if (tap && now() - tap.at < 1.2) options.onOpenChat(tap.pointerType !== "touch");
  });

  on(button, "keydown", event => {
    if (event.isComposing || event.repeat) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!press && active()) options.onOpenChat(true);
    }
  });
  on(window, "keydown", event => {
    if (event.key === "Escape" && !event.isComposing && press) {
      event.preventDefault(); event.stopPropagation(); finish(null, true);
    }
  }, { capture: true });
  function save() {
    try { localStorage.setItem(options.storageKey, JSON.stringify(anchor)); } catch { /* Optional position preference. */ }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(options.storageKey) ?? "null") as { x?: number; y?: number } | null;
    if (saved && typeof saved.x === "number" && Number.isFinite(saved.x) && typeof saved.y === "number" && Number.isFinite(saved.y))
      anchor = { x: clamp(saved.x, 0, 1), y: clamp(saved.y, 0, 1) };
  } catch { /* A corrupt preference uses the default corner. */ }
  on(document, "visibilitychange", sync);
  on(window, "blur", () => { focused = false; sync(); });
  on(window, "focus", () => { focused = true; sync(); });
  const reducedChange = () => sync();
  reduced.addEventListener("change", reducedChange);
  on(window, "scroll", () => { stageRect = stage.getBoundingClientRect(); }, { passive: true, capture: true });
  on(window, "pagehide", () => { focused = false; sync(); });
  on(window, "pageshow", () => { focused = true; sync(); });
  const resize = new ResizeObserver(() => {
    if (press) finish(null, true);
    measure(); placeFromAnchor(); wake();
  });
  resize.observe(stage);
  const intersection = new IntersectionObserver(entries => {
    inView = Boolean(entries[0]?.isIntersecting); sync();
  });
  intersection.observe(root);
  root.style.setProperty("--pp-size", options.size + "px");
  measure(); placeFromAnchor(); syncLabel(); sync();
  return {
    update(next, paused, size) {
      if (disposed) return;
      const changed = next.activityKey !== presentation.activityKey || next.scene !== scene;
      const visibilityChanged = paused !== chatOpen;
      presentation = next;
      if (changed) {
        scene = next.scene; action = ""; glanceEnd = -100; strokeStart = -100;
        nextThought = now() + 4.4; nextStroke = now() + .9;
      }
      chatOpen = paused;
      const sizeChanged = size !== config.size;
      if (sizeChanged) {
        if (press) finish(null, true);
        config.size = size; root.style.setProperty("--pp-size", size + "px");
      }
      if (sizeChanged || visibilityChanged && !paused) {
        // Runs from the component's layout effect, before the first visible paint.
        measure(); placeFromAnchor();
      }
      if (next.feedback && next.feedback.id !== feedbackId) {
        feedbackId = next.feedback.id;
        if (active() && !held && !visibilityChanged) setAction(next.feedback.kind === "success" ? "success" : "failure");
      }
      if (visibilityChanged) sync();
      else { syncLabel(); if (changed) wake(); }
      if (!next.speech) { if (speechVisible) clearSpeech(); }
      else if (next.speech.id !== speechId) {
        if (active() && !held && !visibilityChanged) showSpeech(next.speech);
        else speechId = next.speech.id;
      }
    },
    dispose() {
      if (disposed) return;
      if (press) finish(null, true);
      disposed = true; stop(); clearTimeout(holdTimer); clearTimeout(hoverTimer);
      clearSpeech();
      abort.abort(); reduced.removeEventListener("change", reducedChange);
      resize.disconnect(); intersection.disconnect(); bodySurface.dispose();
      root.dataset.active = "false"; root.dataset.rendering = "false";
    },
  };
}
