import { expect, it } from "vitest";
import { resultImageNode } from "./assistant-result-data";
import type { WorkflowGraph } from "./workflow-api";
const image = {
  assetId: "original",
  nodeId: "old-node",
  title: "原结果",
  width: 600,
  height: 800,
};
it("历史结果不打开已被替换成另一份资产的同编号节点", () => {
  const graph = {
    nodes: [
      {
        id: "old-node",
        kind: "asset",
        type: "candidate",
        payload: { assetId: "replacement" },
      },
    ],
  } as unknown as WorkflowGraph;
  expect(resultImageNode(graph, image)).toBeNull();
});
it("同一资产换了摆放或节点时仍按真实资产身份找到对应对象", () => {
  const graph = {
    nodes: [
      {
        id: "old-node",
        kind: "asset",
        type: "candidate",
        payload: { assetId: "replacement" },
      },
      {
        id: "copy",
        kind: "asset",
        type: "candidate",
        payload: { assetId: "original" },
      },
    ],
  } as unknown as WorkflowGraph;
  expect(resultImageNode(graph, image)?.id).toBe("copy");
});
