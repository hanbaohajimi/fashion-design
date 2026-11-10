import { describe, expect, it } from "vitest";
import {
  originalOrientation,
  turnImage,
  hasOrientationChange,
  imageOrientationSchema,
} from "./image-orientation";

describe("图片方向交互", () => {
  it("左右旋转互为逆操作，连续四次旋转回到原方向", () => {
    expect(turnImage(turnImage(originalOrientation, 90), -90)).toEqual(
      originalOrientation,
    );
    let result = originalOrientation;
    for (let index = 0; index < 4; index++) result = turnImage(result, 90);
    expect(result).toEqual(originalOrientation);
    expect(hasOrientationChange(result)).toBe(false);
    let fractional = { ...originalOrientation, rotate: 17.3 };
    for (let index = 0; index < 4; index++) fractional = turnImage(fractional, 90);
    expect(fractional.rotate).toBe(17.3);
  });
  it("镜像后旋转仍沿当前画面的指定方向，不反转用户意图", () => {
    expect(
      turnImage({ ...originalOrientation, flipHorizontal: true }, 90).rotate,
    ).toBe(-90);
    expect(
      turnImage({ ...originalOrientation, flipVertical: true }, -90).rotate,
    ).toBe(90);
    expect(
      turnImage(
        { ...originalOrientation, flipHorizontal: true, flipVertical: true },
        90,
      ).rotate,
    ).toBe(90);
  });
  it("恢复的草稿必须具有有效方向参数", () => {
    expect(imageOrientationSchema.safeParse(originalOrientation).success).toBe(
      true,
    );
    expect(imageOrientationSchema.safeParse({ rotate: 500 }).success).toBe(
      false,
    );
    expect(hasOrientationChange({ ...originalOrientation, rotate: 0.1 })).toBe(
      true,
    );
  });
});
