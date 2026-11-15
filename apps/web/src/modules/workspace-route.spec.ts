import { describe, expect, it } from "vitest";
import { workspaceRoute } from "./workspace-route";
import { guideSurfaceForPath } from "../components/feature-guide/guide-model";
import {
  projectDestinationHref,
  WORKSPACE_TOOL_GROUPS,
  homeShortcut,
  canvasShortcutHref,
} from "./projects/workspace-tools";
import { STUDIO_TABS } from "./studio/studio-navigation";

describe("工作区路由与功能入口", () => {
  it.each([null, "", "tech", "删除项目", "javascript:alert(1)", "../studio"])("忽略无效的首页快捷功能 %s", value => {
    expect(homeShortcut(value)).toBeNull();
  });
  it("首页快捷入口进入画布，左侧衣橱继续使用独立资料页", () => {
    expect(canvasShortcutHref("project-a", "wardrobe")).toBe("/project-a?openTool=wardrobe");
    expect(projectDestinationHref("project-a", "wardrobe")).toBe("/wardrobe?projectId=project-a");
    expect(homeShortcut("experiments")?.canvasEntry).toBe("color");
  });
  it.each([
    "/",
    "/projects",
    "/assets",
    "/wardrobe",
    "/fabrics",
    "/trends",
    "/review/token",
    "/auth/confirm",
    "/prototypes/demo",
  ])("%s 不建立项目草稿范围", (path) => {
    expect(workspaceRoute(path).projectId).toBeNull();
    expect(workspaceRoute(path).canvas).toBe(false);
  });
  it("仅项目画布启用独立外框，工作室保持文档布局", () => {
    expect(workspaceRoute("/project-1")).toMatchObject({
      projectId: "project-1",
      canvas: true,
      document: false,
    });
    expect(workspaceRoute("/project-1/studio")).toMatchObject({
      projectId: "project-1",
      canvas: false,
      studio: true,
      document: true,
    });
    expect(guideSurfaceForPath("/assets")).toBe("assets");
    expect(guideSurfaceForPath("/review/token")).toBeNull();
  });
  it("导航覆盖全部既有工作室功能，商品展示模式保持深链", () => {
    const destinations = WORKSPACE_TOOL_GROUPS.flatMap((group) =>
      group.items.map((item) => item.value),
    );
    expect(destinations).toEqual([
      "canvas",
      ...STUDIO_TABS.map((tab) => tab.value),
    ]);
    expect(projectDestinationHref("project-a", "wardrobe")).toBe(
      "/wardrobe?projectId=project-a",
    );
    expect(projectDestinationHref("project-a", "realtime")).toBe(
      "/project-a/studio?tab=presentation&mode=realtime",
    );
    expect(projectDestinationHref("project-a", "tech")).toBe(
      "/project-a/studio?tab=tech",
    );
  });
});
