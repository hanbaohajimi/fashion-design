// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  constrainAssistantBounds,
  initialAssistantBounds,
  resizeAssistantBounds,
} from "./assistant-window-geometry";
import {
  readWorkspacePreference,
  saveWorkspacePreference,
} from "./workspace-preferences";

afterEach(() => localStorage.clear());
describe("助手窗口边界与偏好", () => {
  it("助手偏好扩展不改变其他分栏的默认宽度", () => {
    saveWorkspacePreference("other-workspace", { open: true });
    expect(readWorkspacePreference("other-workspace").width).toBe(384);
    saveWorkspacePreference("assistant", { open: true }, 400);
    expect(readWorkspacePreference("assistant").width).toBe(400);
  });
  it("首次浮窗在右下留16像素，短屏优先保持整个窗口可见", () => {
    expect(initialAssistantBounds({ width: 1440, height: 900 })).toEqual({
      x: 1024,
      y: 244,
      width: 400,
      height: 640,
    });
    expect(initialAssistantBounds({ width: 320, height: 400 })).toEqual({
      x: 16,
      y: 16,
      width: 288,
      height: 368,
    });
  });
  it("缩小左上角保持右下角锚定并遵守最小尺寸", () => {
    const start = { x: 700, y: 100, width: 500, height: 700 };
    const next = resizeAssistantBounds(start, "nw", 800, 800, {
      width: 1440,
      height: 900,
    });
    expect(next).toEqual({ x: 840, y: 360, width: 360, height: 440 });
    expect(next.x + next.width).toBe(start.x + start.width);
    expect(next.y + next.height).toBe(start.y + start.height);
  });
  it("视口缩小时约束位置与尺寸，拖动不能使标题离开画布", () => {
    expect(
      constrainAssistantBounds(
        { x: 900, y: -100, width: 800, height: 700 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 184, y: 16, width: 600, height: 568 });
  });
  it("更新展开和停靠宽度保留浮窗形态、位置与另一项目偏好", () => {
    const floatingBounds = initialAssistantBounds({ width: 1440, height: 900 });
    saveWorkspacePreference("a", {
      width: 580,
      presentation: "floating",
      floatingBounds,
    });
    saveWorkspacePreference("b", { width: 390, presentation: "docked" });
    saveWorkspacePreference("a", { open: false });
    expect(readWorkspacePreference("a", { maxWidth: 600 })).toEqual({
      width: 580,
      open: false,
      presentation: "floating",
      floatingBounds,
    });
    expect(readWorkspacePreference("b").presentation).toBe("docked");
  });
  it("兼容旧偏好并拒绝损坏矩形", () => {
    localStorage.setItem("old", JSON.stringify({ open: true, width: 384 }));
    expect(readWorkspacePreference("old")).toEqual({ open: true, width: 384 });
    localStorage.setItem(
      "bad",
      JSON.stringify({
        presentation: "unknown",
        floatingBounds: { x: "0", y: 2, width: -3, height: 4 },
      }),
    );
    expect(readWorkspacePreference("bad", { defaultWidth: 400 })).toEqual({
      width: 400,
    });
  });
});
