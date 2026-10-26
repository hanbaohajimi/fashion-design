import { expect, it } from "vitest";
import { containedPictureSize, picturePanBounds } from "./picture-preview";

it("a portrait contained in a wide stage cannot pan into its horizontal letterbox", () => {
  const size = containedPictureSize(800, 600, 600, 1200);
  expect(size).toEqual({ width: 300, height: 600 });
  expect(picturePanBounds(size.width, size.height, 800, 600, 2)).toEqual({ x: 0, y: 300 });
});
it("a landscape contained in a narrow stage clamps to its actual image height", () => {
  const size = containedPictureSize(300, 500, 1600, 900);
  expect(size).toEqual({ width: 300, height: 168.75 });
  expect(picturePanBounds(size.width, size.height, 300, 500, 2)).toEqual({ x: 150, y: 0 });
  expect(picturePanBounds(size.width, size.height, 300, 500, 3)).toEqual({ x: 300, y: 3.125 });
});
