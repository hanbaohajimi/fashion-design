// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { readWorkspacePreference, saveWorkspacePreference, workspacePreferenceKey } from "./workspace-preferences";

beforeEach(() => localStorage.clear());
it("开合偏好按账号和项目隔离，保留用户已调整的宽度", () => {
  const key = workspacePreferenceKey("account-a", "project-a");
  expect(readWorkspacePreference(key)).toEqual({ width: 384 });
  saveWorkspacePreference(key, { width: 450, open: true });
  saveWorkspacePreference(key, { open: false });
  expect(readWorkspacePreference(key)).toEqual({ width: 450, open: false });
  expect(readWorkspacePreference(workspacePreferenceKey("account-b", "project-a"))).toEqual({ width: 384 });
  expect(readWorkspacePreference(workspacePreferenceKey("account-a", "project-b"))).toEqual({ width: 384 });
});
it("兼容已有偏好并约束宽度，损坏的记录回到默认值", () => {
  localStorage.setItem("test", JSON.stringify({ width: 999, open: true }));
  expect(readWorkspacePreference("test")).toEqual({ width: 480, open: true });
  localStorage.setItem("test", "broken");
  expect(readWorkspacePreference("test")).toEqual({ width: 384 });
});
