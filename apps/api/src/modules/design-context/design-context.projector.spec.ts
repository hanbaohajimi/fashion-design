import { expect, it } from "vitest";
import { projectNode } from "./design-context.projector";

const node = {
  id: "palette",
  kind: "asset",
  type: "swatch",
  title: "系列配色",
  status: "ready",
  payload: {
    color: "#205b43",
    colors: [
      { hex: "#205b43", name: "深绿" },
      { hex: "#b09a78", name: "亚麻" },
      { hex: "#55647a", name: "靛蓝" },
    ],
  },
};
it("当前多色色卡保留全部色值、名称和顺序", () => {
  expect(projectNode(node, true)).toMatchObject({
    color: node.payload.color,
    colors: node.payload.colors,
  });
});
it("旧文字色板仍可读取，畸形条目不产生虚构颜色", () => {
  expect(
    projectNode(
      {
        ...node,
        payload: {
          colors: [
            "藏蓝",
            null,
            { hex: "bad", name: "坏颜色" },
            { hex: "#ABCDEF", name: " 浅蓝 " },
            "米白",
          ],
        },
      },
      true,
    ),
  ).toMatchObject({
    colors: ["藏蓝", { hex: "#ABCDEF", name: "浅蓝" }, "米白"],
  });
  expect(
    projectNode({ ...node, payload: { color: "#205b43" } }, true),
  ).toMatchObject({ color: "#205b43", colors: [] });
});
it("预算省略详情时不伪造色卡内容", () => {
  expect(projectNode(node, false)).not.toHaveProperty("colors");
});
