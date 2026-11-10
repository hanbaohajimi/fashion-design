import { describe, expect, it } from "vitest";
import {
  changeWorkspaceMode,
  type WorkspaceLayout,
} from "./use-workspace-layout";

describe("工作区布局模式", () => {
  it("初次进入手机展示画布，覆盖侧栏默认关闭", () => {
    const initial: WorkspaceLayout = {
      mode: "docked",
      mobileView: "canvas",
      sidebarOpen: true,
    };
    expect(changeWorkspaceMode(initial, "mobile", true)).toMatchObject({
      mobileView: "canvas",
    });
    expect(changeWorkspaceMode(initial, "overlay", true).sidebarOpen).toBe(
      false,
    );
  });
  it("同模式高度变化保持助手选择与状态", () => {
    const current: WorkspaceLayout = {
      mode: "mobile",
      mobileView: "assistant",
      sidebarOpen: false,
    };
    expect(changeWorkspaceMode(current, "mobile")).toBe(current);
    const overlay = changeWorkspaceMode(current, "overlay");
    expect(overlay.sidebarOpen).toBe(true);
    expect(changeWorkspaceMode(overlay, "mobile").mobileView).toBe("assistant");
  });
  it("手机收起聊天后切回桌面不会恢复旧的展开状态", () => {
    const current: WorkspaceLayout = { mode: "mobile", mobileView: "canvas", sidebarOpen: true };
    expect(changeWorkspaceMode(current, "docked").sidebarOpen).toBe(false);
    expect(changeWorkspaceMode(current, "overlay").sidebarOpen).toBe(false);
  });
  it("桌面收起聊天后转为手机保留画布视图", () => {
    const current: WorkspaceLayout = { mode: "docked", mobileView: "assistant", sidebarOpen: false };
    expect(changeWorkspaceMode(current, "mobile").mobileView).toBe("canvas");
  });
});
