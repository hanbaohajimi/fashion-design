// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readCreativeVisit, rememberCreativeVisit } from "./creative-memory";
afterEach(() => localStorage.clear());
describe("账号内的本机创作记忆", () => {
  it("保存明确的项目与功能位置，不与另一账号混用", () => {
    rememberCreativeVisit("alice", "project-1", "/project-1/studio?tab=styles");
    expect(readCreativeVisit("alice")?.path).toBe("/project-1/studio?tab=styles");
    expect(readCreativeVisit("bob")).toBeNull();
  });
  it("拒绝损坏记录和站外跳转", () => {
    localStorage.setItem("fashion:creative-visit:alice", "invalid");
    expect(readCreativeVisit("alice")).toBeNull();
    localStorage.setItem("fashion:creative-visit:alice", JSON.stringify({ projectId: "project-1", path: "https://example.com", visitedAt: new Date().toISOString() }));
    expect(readCreativeVisit("alice")).toBeNull();
  });
});
