import { beforeEach, expect, it, vi } from "vitest";
import { addFabricToProject } from "./add-fabric-to-project";
import { fetchWorkflow, patchWorkflow } from "../board/workflow/workflow-api";
import type { Fabric } from "./fabric-types";

vi.mock("../board/workflow/workflow-api", () => ({
  fetchWorkflow: vi.fn(),
  patchWorkflow: vi.fn(),
}));
const fabric: Fabric = {
  id: "fabric-1",
  mainFileId: "file-1",
  mainImageUrl: "/fabric.png",
  tags: ["棉", "通勤"],
  scope: "preset",
  canManage: false,
  createdAt: "2026-10-26",
  updatedAt: "2026-10-26",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchWorkflow).mockResolvedValue({
    revision: 7,
    nodes: [],
  } as unknown as Awaited<ReturnType<typeof fetchWorkflow>>);
});

it("使用当前图版本写入面料，保留节点身份", async () => {
  await expect(
    addFabricToProject("project-1", fabric, "stable-node"),
  ).resolves.toBe("stable-node");
  expect(patchWorkflow).toHaveBeenCalledWith(
    "project-1",
    expect.objectContaining({
      baseRevision: 7,
      mode: "semantic",
      operations: [
        expect.objectContaining({
          type: "add_node",
          node: expect.objectContaining({
            id: "stable-node",
            type: "fabric",
            payload: expect.objectContaining({ fabricId: fabric.id }),
          }),
        }),
      ],
    }),
  );
});

it("响应丢失后重试发现已有面料时不重复写入", async () => {
  vi.mocked(fetchWorkflow).mockResolvedValue({
    revision: 8,
    nodes: [
      { id: "existing", type: "fabric", payload: { fabricId: fabric.id } },
    ],
  } as unknown as Awaited<ReturnType<typeof fetchWorkflow>>);
  await expect(
    addFabricToProject("project-1", fabric, "stable-node"),
  ).resolves.toBe("existing");
  expect(patchWorkflow).not.toHaveBeenCalled();
});

it("版本冲突与写入失败保留失败结果，下一次重新读取图版本", async () => {
  vi.mocked(patchWorkflow).mockRejectedValueOnce(new Error("版本冲突"));
  await expect(
    addFabricToProject("project-1", fabric, "stable-node"),
  ).rejects.toThrow("版本冲突");
  vi.mocked(fetchWorkflow).mockResolvedValue({
    revision: 9,
    nodes: [],
  } as unknown as Awaited<ReturnType<typeof fetchWorkflow>>);
  await addFabricToProject("project-1", fabric, "stable-node");
  expect(patchWorkflow).toHaveBeenLastCalledWith(
    "project-1",
    expect.objectContaining({ baseRevision: 9 }),
  );
});
