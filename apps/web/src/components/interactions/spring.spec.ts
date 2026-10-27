import { describe, expect, it } from "vitest";
import { SPRINGS, springProgress } from "./spring";
describe("物理弹簧", () => {
  it("never overshoots the drag destination and converges monotonically", () => {
    let previous = 0;
    for (let ms = 0; ms < 1500; ms++) { const next = springProgress(ms / 1000, SPRINGS.drag); expect(next).toBeGreaterThanOrEqual(previous); expect(next).toBeLessThanOrEqual(1); previous = next; }
    expect(previous).toBeCloseTo(1, 5);
  });
  it("gives a small button-scale overshoot while settling", () => {
    const values = Array.from({ length: 1000 }, (_, ms) => .97 + .03 * springProgress(ms / 1000, SPRINGS.button));
    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(Math.max(...values)).toBeLessThan(1.01);
    expect(values.at(-1)).toBeCloseTo(1, 4);
  });
});
