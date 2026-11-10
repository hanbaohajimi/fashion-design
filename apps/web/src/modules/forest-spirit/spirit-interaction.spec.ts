import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpiritInteraction } from "./spirit-interaction";
import type { SpiritMotion } from "./spirit-contract";

function setup(play = vi.fn< (name: SpiritMotion) => Promise<void> >().mockResolvedValue(undefined)) {
  const callbacks = { phase: vi.fn(), play, move: vi.fn(), persist: vi.fn(), openChat: vi.fn() };
  const control = new SpiritInteraction(callbacks);
  control.setVisible(true);
  return { control, ...callbacks };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
afterEach(() => vi.useRealTimers());

describe("forest spirit gesture decisions (no model renderer)", () => {
  it("greets once on entry, never queues while a greeting is running, then enforces cooldown", async () => {
    let finish: (() => void) | undefined;
    const play = vi.fn((name: SpiritMotion) => name === "hover_greet" ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve());
    const { control } = setup(play);
    control.enter(); control.enter();
    expect(play.mock.calls.filter(([name]) => name === "hover_greet")).toHaveLength(1);
    control.leave(); await vi.advanceTimersByTimeAsync(2000); control.enter();
    expect(play.mock.calls.filter(([name]) => name === "hover_greet")).toHaveLength(1);
    finish?.(); await vi.advanceTimersByTimeAsync(0);
    expect(play.mock.calls.filter(([name]) => name === "hover_greet")).toHaveLength(1);
    control.leave(); control.enter();
    expect(play.mock.calls.filter(([name]) => name === "hover_greet")).toHaveLength(2);
    finish?.(); await vi.advanceTimersByTimeAsync(0);
    control.leave(); control.enter();
    expect(play.mock.calls.filter(([name]) => name === "hover_greet")).toHaveLength(2);
  });
  it("opens existing chat immediately for a primary short click, once only", () => {
    const { control, openChat } = setup();
    expect(control.down(3, { x: 10, y: 10 }, { x: 90, y: 90 }, true, 0)).toBe(true);
    control.up(3, { x: 14, y: 10 }); control.up(3); control.open();
    expect(openChat).toHaveBeenCalledTimes(1);
  });
  it("ignores secondary buttons and non-primary pointers", () => {
    const { control, openChat } = setup();
    expect(control.down(1, { x: 0, y: 0 }, { x: 0, y: 0 }, true, 2)).toBe(false);
    expect(control.down(2, { x: 0, y: 0 }, { x: 0, y: 0 }, false, 0)).toBe(false);
    control.up(1); control.up(2);
    expect(openChat).not.toHaveBeenCalled();
  });
  it("consumes long press even without movement", async () => {
    const { control, persist, openChat, play } = setup();
    control.down(1, { x: 10, y: 10 }, { x: 100, y: 100 }, true, 0);
    await vi.advanceTimersByTimeAsync(400);
    control.up(1);
    expect(persist).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledWith("drag_hold");
    expect(play).toHaveBeenCalledWith("put_down");
    expect(openChat).not.toHaveBeenCalled();
  });
  it("cancels both click and long press when moving more than 6px before arming", async () => {
    const { control, move, persist, openChat } = setup();
    control.down(1, { x: 10, y: 10 }, { x: 100, y: 100 }, true, 0);
    control.move(1, { x: 17, y: 10 });
    await vi.advanceTimersByTimeAsync(800);
    control.move(1, { x: 80, y: 10 }); control.up(1);
    expect(move).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled(); expect(openChat).not.toHaveBeenCalled();
  });
  it("also checks release displacement when no pointermove was delivered", () => {
    const { control, openChat } = setup();
    control.down(1, { x: 10, y: 10 }, { x: 100, y: 100 }, true, 0);
    control.up(1, { x: 40, y: 10 });
    expect(openChat).not.toHaveBeenCalled();
  });
  it("moves in CSS space after long press, persists on release and never clicks", async () => {
    const { control, move, persist, openChat } = setup();
    control.down(1, { x: 10, y: 10 }, { x: 100, y: 100 }, true, 0);
    await vi.advanceTimersByTimeAsync(400);
    control.move(1, { x: 25, y: 40 }); control.up(1);
    expect(move).toHaveBeenLastCalledWith({ x: 115, y: 130 });
    expect(persist).toHaveBeenCalledOnce(); expect(openChat).not.toHaveBeenCalled();
  });
  it("cancellation restores the drag start, clears timer and does not persist", async () => {
    const { control, move, persist, openChat, play } = setup();
    control.down(1, { x: 10, y: 10 }, { x: 100, y: 100 }, true, 0);
    await vi.advanceTimersByTimeAsync(400);
    control.move(1, { x: 25, y: 40 }); control.cancel(); control.up(1);
    expect(move).toHaveBeenLastCalledWith({ x: 100, y: 100 });
    expect(play).toHaveBeenLastCalledWith("idle");
    expect(persist).not.toHaveBeenCalled(); expect(openChat).not.toHaveBeenCalled();
    control.down(2, { x: 0, y: 0 }, { x: 0, y: 0 }, true, 0); control.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("restoring under the pointer requires leaving before a new hover, keyboard remains usable", () => {
    const { control, play, openChat } = setup();
    control.setVisible(false); control.setVisible(true, false, true); control.enter();
    expect(play).not.toHaveBeenCalled();
    control.leave(); control.enter(); expect(play).toHaveBeenCalledWith("hover_greet");
    control.open(); expect(openChat).toHaveBeenCalledOnce();
  });
  it("restoring while the pointer is outside allows the first new entry once", () => {
    const { control, play } = setup();
    control.setVisible(false); control.setVisible(true, false, false);
    control.enter(); control.enter();
    expect(play.mock.calls.filter(([name]) => name === "hover_greet")).toHaveLength(1);
  });
  it("reduced motion skips greeting and disposal rejects late work", async () => {
    const { control, play, openChat } = setup();
    control.setVisible(true, true); control.enter(); expect(play).not.toHaveBeenCalled();
    control.down(1, { x: 0, y: 0 }, { x: 0, y: 0 }, true, 0);
    control.dispose(); await vi.advanceTimersByTimeAsync(500); control.open();
    expect(vi.getTimerCount()).toBe(0); expect(openChat).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
  });
});
