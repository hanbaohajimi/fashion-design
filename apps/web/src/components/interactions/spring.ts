import { reducedMotion } from "./motion-policy";

export const SPRINGS = {
  drag:   { stiffness: 1200, damping: 80,  mass: 1, clamp: true  },
  button: { stiffness:  380, damping: 18,  mass: 1, clamp: false },
  /** 按钮 press：短促即时，90ms 内稳定 */
  press:  { stiffness:  520, damping: 22,  mass: 1, clamp: true  },
  /** 卡片/工具条 hover lift：轻盈上浮，带温柔过冲 */
  lift:   { stiffness:  300, damping: 26,  mass: 1, clamp: true  },
  /** 面板开合：饱满的入场弹性，退出时 clamp 避免拖尾 */
  panel:  { stiffness:  220, damping: 30,  mass: 1, clamp: true  },
} as const;
export type SpringPresetName = keyof typeof SPRINGS;
export type SpringPreset = { stiffness: number; damping: number; mass: number; clamp: boolean };

/** Exact unit-step response; independent of frame rate and background-tab timing. */
export function springProgress(seconds: number, preset: SpringPreset): number {
  const w = Math.sqrt(preset.stiffness / preset.mass);
  const a = preset.damping / (2 * preset.mass);
  let displacement: number;
  if (Math.abs(a - w) < 1e-6) displacement = (1 + w * seconds) * Math.exp(-w * seconds);
  else if (a < w) {
    const b = Math.sqrt(w * w - a * a);
    displacement = Math.exp(-a * seconds) * (Math.cos(b * seconds) + a / b * Math.sin(b * seconds));
  } else {
    const b = Math.sqrt(a * a - w * w);
    const r1 = -a + b;
    const r2 = -a - b;
    displacement = (-r2 * Math.exp(r1 * seconds) + r1 * Math.exp(r2 * seconds)) / (r1 - r2);
  }
  const progress = 1 - displacement;
  return preset.clamp ? Math.max(0, Math.min(1, progress)) : progress;
}

/** Sample the physical curve once; WAAPI owns playback, never React per-frame state. */
export function animateSpring(
  element: HTMLElement,
  from: readonly number[],
  to: readonly number[],
  transform: (values: number[]) => string,
  preset: SpringPreset = SPRINGS.drag,
): Animation | null {
  if (reducedMotion() || document.hidden || !element.animate) return null;
  let duration = 1200;
  for (let ms = 80; ms <= 1200; ms += 8) {
    if ([0, 40, 80, 120].every((offset) => Math.abs(1 - springProgress((ms + offset) / 1000, preset)) < 0.0005)) { duration = ms; break; }
  }
  const frames: Keyframe[] = [];
  for (let ms = 0; ms < duration; ms += 8) {
    const progress = springProgress(ms / 1000, preset);
    frames.push({ offset: ms / duration, transform: transform(from.map((value, index) => value + ((to[index] ?? value) - value) * progress)) });
  }
  frames.push({ offset: 1, transform: transform([...to]) });
  return element.animate(frames, { duration, easing: "linear" });
}
