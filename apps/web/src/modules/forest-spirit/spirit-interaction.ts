import type { SpiritMotion, SpiritPhase, SpiritPoint } from "./spirit-contract";

export const SPIRIT_GESTURES = { longPressMs: 400, movementSlop: 6, hoverCooldownMs: 1800 } as const;
interface Pointer { id: number; point: SpiritPoint; origin: SpiritPoint; cancelled: boolean; armed: boolean }
interface Callbacks {
  phase(value: SpiritPhase): void;
  play(motion: SpiritMotion): Promise<void>;
  move(point: SpiritPoint): void;
  persist(): void;
  openChat(): void;
}

/** Gesture decisions only. It never owns a conversation, task or canvas object. */
export class SpiritInteraction {
  private pointer: Pointer | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private disposed = false;
  private hoverInside = false;
  private suppressHover = false;
  private hoverPlaying = false;
  private lastHover = -Infinity;
  private hasShown = false;
  private epoch = 0;
  constructor(private callbacks: Callbacks, private reducedMotion = false) {}
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private motion(name: SpiritMotion) {
    const epoch = ++this.epoch;
    return this.callbacks.play(name).then(() => {
      if (!this.disposed && this.enabled && epoch === this.epoch && !this.pointer && name !== "idle") {
        this.callbacks.phase("idle");
        void this.callbacks.play("idle").catch(() => undefined);
      }
    }).catch(() => undefined);
  }
  setVisible(visible: boolean, reducedMotion = this.reducedMotion, pointerInsideOnRestore = false) {
    const changed = this.enabled !== visible;
    this.reducedMotion = reducedMotion;
    if (this.disposed) return;
    if (!changed) return;
    this.cancel();
    this.enabled = visible;
    this.suppressHover = this.hasShown && pointerInsideOnRestore;
    if (visible) this.hasShown = true;
    this.hoverInside = false;
    this.callbacks.phase(visible ? "idle" : "hidden");
  }
  enter() {
    if (!this.enabled || this.disposed || this.hoverInside) return;
    this.hoverInside = true;
    if (this.suppressHover || this.reducedMotion || this.pointer || this.hoverPlaying || Date.now() - this.lastHover < SPIRIT_GESTURES.hoverCooldownMs) return;
    this.lastHover = Date.now();
    this.hoverPlaying = true;
    this.callbacks.phase("hovering");
    void this.motion("hover_greet").finally(() => { this.hoverPlaying = false; });
  }
  leave() { this.hoverInside = false; this.suppressHover = false; }
  down(id: number, point: SpiritPoint, origin: SpiritPoint, primary: boolean, button: number) {
    if (!this.enabled || this.disposed || this.pointer || !primary || button !== 0) return false;
    this.epoch++;
    this.pointer = { id, point, origin, cancelled: false, armed: false };
    this.callbacks.phase("pressing");
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.pointer || this.pointer.cancelled || !this.enabled) return;
      this.pointer.armed = true;
      this.callbacks.phase("dragArmed");
      void this.motion("drag_hold");
    }, SPIRIT_GESTURES.longPressMs);
    return true;
  }
  move(id: number, point: SpiritPoint) {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== id || pointer.cancelled) return;
    const dx = point.x - pointer.point.x, dy = point.y - pointer.point.y;
    if (!pointer.armed && Math.hypot(dx, dy) > SPIRIT_GESTURES.movementSlop) {
      pointer.cancelled = true;
      this.clearTimer();
      this.callbacks.phase("idle");
      return;
    }
    if (pointer.armed) {
      this.callbacks.phase("dragging");
      this.callbacks.move({ x: pointer.origin.x + dx, y: pointer.origin.y + dy });
    }
  }
  up(id: number, point?: SpiritPoint) {
    if (!this.pointer || this.pointer.id !== id) return;
    if (point) this.move(id, point);
    const pointer = this.pointer;
    this.pointer = null;
    this.clearTimer();
    if (pointer.cancelled || !this.enabled) { this.callbacks.phase(this.enabled ? "idle" : "hidden"); return; }
    if (pointer.armed) {
      this.callbacks.persist();
      this.callbacks.phase("settling");
      void this.motion("put_down");
    } else this.open();
  }
  open() {
    if (!this.enabled || this.disposed) return;
    this.cancel();
    this.enabled = false;
    this.callbacks.phase("hidden");
    this.callbacks.openChat();
  }
  cancel() {
    this.clearTimer();
    const wasDragging = this.pointer?.armed;
    if (wasDragging && this.pointer) this.callbacks.move(this.pointer.origin);
    this.pointer = null;
    this.epoch++;
    if (!this.disposed) {
      this.callbacks.phase(this.enabled ? "idle" : "hidden");
      if (wasDragging && this.enabled) void this.callbacks.play("idle").catch(() => undefined);
    }
  }
  dispose() { this.cancel(); this.disposed = true; this.enabled = false; this.callbacks.phase("disposed"); }
}
