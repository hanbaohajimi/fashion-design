import { describe, expect, it } from "vitest";
import { imageOutpaintSchema } from "@fashion/shared";
import {
  emptyOutpaintDraft,
  initialOutpaintFrame,
  moveOutpaintFrame,
  outpaintProblem,
  readOutpaintDraft,
  resizeOutpaintFrame,
} from "./image-outpaint";

describe("扩图尺寸与草稿", () => {
  it.each([
    [600, 800],
    [256, 256],
    [100, 2000],
    [2048, 256],
    [1024, 1024],
    [1, 1],
  ])("%i×%i 原图的初始边框包含原图且可直接扩图", (width, height) => {
    const source = { width, height };
    const frame = initialOutpaintFrame(source);
    expect(imageOutpaintSchema.safeParse(frame).success).toBe(true);
    expect(outpaintProblem(frame, source)).toBeNull();
    expect(frame.left + width).toBeLessThanOrEqual(frame.width);
    expect(frame.top + height).toBeLessThanOrEqual(frame.height);
    expect(frame.width * frame.height).toBeGreaterThan(width * height);
  });
  it("不会缩小超限原图来伪装成合法扩图", () => {
    const source = { width: 4096, height: 2048 };
    expect(initialOutpaintFrame(source)).toMatchObject(source);
    expect(outpaintProblem(initialOutpaintFrame(source), source)).toContain(
      "请先缩放尺寸",
    );
    expect(
      outpaintProblem(
        { width: 2048, height: 2048, left: 0, top: 0 },
        { width: 2048, height: 2048 },
      ),
    ).toContain("尺寸上限");
  });
  it("没有扩展、像素太少或过长在提交前有具体说明", () => {
    expect(
      outpaintProblem(
        { width: 1024, height: 1024, left: 0, top: 0 },
        { width: 1024, height: 1024 },
      ),
    ).toContain("还没有扩展区域");
    expect(
      outpaintProblem(
        { width: 512, height: 512, left: 0, top: 0 },
        { width: 256, height: 256 },
      ),
    ).toContain("画布太小");
    expect(
      outpaintProblem(
        { width: 2048, height: 400, left: 0, top: 0 },
        { width: 256, height: 256 },
      ),
    ).toContain("长宽比");
  });
  it("移动与缩放受原图边界限制，尺寸按16像素对齐", () => {
    const frame = { width: 1024, height: 1024, left: 128, top: 96 };
    const source = { width: 600, height: 800 };
    expect(moveOutpaintFrame(frame, source, -5, 500)).toEqual({
      ...frame,
      left: 0,
      top: 224,
    });
    expect(resizeOutpaintFrame(frame, source, 50, 800)).toEqual({
      ...frame,
      width: 736,
      height: 896,
    });
    expect(resizeOutpaintFrame(frame, source, 5000, 5000)).toEqual({
      ...frame,
      width: 2048,
      height: 2048,
    });
  });
  it("保留尚未合法的草稿范围，但拒绝损坏或不可显示的草稿", () => {
    expect(readOutpaintDraft(emptyOutpaintDraft)).toEqual(emptyOutpaintDraft);
    const draft = {
      kind: "outpaint",
      frame: { width: 512, height: 512, left: 0, top: 0 },
      prompt: "延伸背景",
    };
    expect(readOutpaintDraft(draft)).toEqual(draft);
    expect(
      readOutpaintDraft({
        ...draft,
        frame: { ...draft.frame, width: Infinity },
      }),
    ).toBeNull();
    expect(readOutpaintDraft({ ...draft, prompt: {} })).toBeNull();
    expect(readOutpaintDraft({})).toBeNull();
  });
});
