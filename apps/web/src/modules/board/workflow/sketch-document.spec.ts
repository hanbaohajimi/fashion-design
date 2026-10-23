import { describe, expect, it } from "vitest";
import {
  readSwatchColors,
  sketchDocumentSchema,
  swatchColorsSchema,
} from "@fashion/shared";
import { splitStrokeByEraser } from "./sketch-eraser";

describe("editable sketch contracts", () => {
  it("keeps pressure and paper dimensions through serialization", () => {
    const doc = {
      version: 1,
      width: 640,
      height: 860,
      strokes: [
        {
          id: "a",
          color: "#45423D",
          width: 1.05,
          opacity: 0.76,
          points: [{ x: 10, y: 20, pressure: 0.8 }],
        },
      ],
    };
    expect(sketchDocumentSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(
      doc,
    );
  });
  it("rejects oversized documents without truncating strokes", () => {
    const doc = {
      version: 1,
      width: 640,
      height: 860,
      strokes: [
        {
          id: "a",
          color: "#45423D",
          width: 1,
          opacity: 1,
          points: Array.from({ length: 20000 }, () => ({
            x: 10,
            y: 20,
            pressure: 0.5,
          })),
        },
      ],
    };
    expect(sketchDocumentSchema.safeParse(doc).success).toBe(false);
  });
  it("cuts only the touched section while retaining both ends", () => {
    const runs = splitStrokeByEraser(
      [
        { x: 0, y: 0, z: 0.4 },
        { x: 100, y: 0, z: 0.8 },
      ],
      { x: 50, y: -10 },
      { x: 50, y: 10 },
      8,
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]?.at(-1)?.x).toBeLessThan(43);
    expect(runs[1]?.[0]?.x).toBeGreaterThan(57);
    expect(runs[0]?.[0]?.z).toBe(0.4);
  });
  it("leaves distant and zero-radius strokes intact", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(
      splitStrokeByEraser(points, { x: 50, y: 50 }, { x: 80, y: 50 }, 8),
    ).toEqual([points]);
    expect(
      splitStrokeByEraser(points, { x: 0, y: 0 }, { x: 100, y: 0 }, 0),
    ).toEqual([points]);
  });
});
describe("multicolor swatches", () => {
  it("reads historical single colors and preserves palette order", () => {
    expect(readSwatchColors({ color: "#123456" }, "旧色卡")).toEqual([
      { hex: "#123456", name: "旧色卡" },
    ]);
    const colors = [
      { hex: "#FFFFFF", name: "白" },
      { hex: "#000000", name: "黑" },
    ];
    expect(readSwatchColors({ colors, color: "#FFFFFF" }, "新色卡")).toEqual(
      colors,
    );
  });
  it("rejects empty palettes, invalid hex and more than twelve colors", () => {
    expect(swatchColorsSchema.safeParse([]).success).toBe(false);
    expect(
      swatchColorsSchema.safeParse([{ hex: "red", name: "红" }]).success,
    ).toBe(false);
    expect(
      swatchColorsSchema.safeParse(
        Array.from({ length: 13 }, () => ({ hex: "#FFFFFF", name: "白" })),
      ).success,
    ).toBe(false);
  });
});
