import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { importCanvasMaterials } from "./import-canvas-materials";
import { runCanvasCommand } from "./canvas-api";
vi.mock("./canvas-api", () => ({ runCanvasCommand: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("replays the entire batch with the same operation id after a lost response and never submits graph edges", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const input = {
    mode: "semantic" as const,
    mutationId: "brand-import",
    baseRevision: 12,
    operations: ["a", "b"].map((id) => ({
      type: "add_node" as const,
      node: {
        id,
        kind: "asset" as const,
        type: "reference_text" as const,
        title: id,
        payload: { text: id },
        x: 20,
        y: 40,
      },
    })),
  };
  vi.mocked(runCanvasCommand).mockRejectedValueOnce(new Error("响应丢失"));
  await expect(importCanvasMaterials("project", input)).rejects.toThrow(
    "响应丢失",
  );
  await importCanvasMaterials("project", input);
  const calls = vi.mocked(runCanvasCommand).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[0]?.[1]).toMatchObject({
    type: "import_materials",
    materials: [
      {
        clientMaterialId: "a",
        shapeId: "shape:import-a",
        materialType: "reference_text",
      },
      {
        clientMaterialId: "b",
        shapeId: "shape:import-b",
        materialType: "reference_text",
      },
    ],
  });
  expect(calls[0]?.[1]).not.toHaveProperty("operations");
});
it("rejects a non-material operation before making any request", async () => {
  await expect(
    importCanvasMaterials("project", {
      mode: "semantic",
      mutationId: "invalid",
      baseRevision: 1,
      operations: [{ type: "remove_node", nodeId: "asset" }],
    }),
  ).rejects.toThrow("不能修改流程关系");
  expect(runCanvasCommand).not.toHaveBeenCalled();
});
