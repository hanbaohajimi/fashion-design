import { describe, expect, it } from "vitest";
import type { Editor, TLShape } from "tldraw";
import type { WorkflowGraph } from "./workflow-api";
import {
  centerCameraForViewport,
  placementNodeId,
  readCanvasCamera,
  selectedMaterialShapes,
} from "./canvas-placements";

describe("explicit canvas placements", () => {
  it("expands nested containers, deduplicates children and tolerates stale selection or a cycle", () => {
    const records = [
      { id: "frame", type: "frame" },
      { id: "group", type: "group" },
      { id: "legacy-frame", type: "fashion-frame" },
      { id: "image", type: "fashion-image" },
      { id: "text", type: "text" },
    ];
    const children: Record<string, string[]> = {
      frame: ["group", "legacy-frame"],
      group: ["image", "frame"],
      "legacy-frame": ["text", "image"],
    };
    const editor = {
      getSelectedShapeIds: () => ["frame", "image", "missing"],
      getShape: (id: string) => records.find((record) => record.id === id),
      getSortedChildIdsForParent: (id: string) => children[id] ?? [],
    } as unknown as Editor;
    expect(selectedMaterialShapes(editor).map((shape) => shape.id)).toEqual([
      "image",
      "text",
    ]);
  });

  it("binds a copied placement only to a real material in this project", () => {
    const graph: WorkflowGraph = {
      projectId: "project",
      revision: 0,
      layoutRevision: 0,
      legacyAvailable: false,
      edges: [],
      nodes: ["asset", "tool"].map((kind) => ({
        id: kind,
        kind: kind as "asset" | "tool",
        type: kind === "asset" ? "reference_image" : "generate_design",
        title: kind,
        payload: {},
        status: "ready",
        x: 0,
        y: 0,
        createdAt: "2026-11-05T00:00:00.000Z",
        updatedAt: "2026-11-05T00:00:00.000Z",
      })),
    };
    const shape = {
      id: "copy",
      meta: { canvasNodeId: "asset" },
    } as unknown as TLShape;
    expect(placementNodeId(shape, new Map(), graph)).toBe("asset");
    expect(
      placementNodeId(shape, new Map([["copy", "tool"]]), graph),
    ).toBeNull();
    expect(
      placementNodeId(
        { ...shape, meta: { canvasNodeId: "other-project" } },
        new Map(),
        graph,
      ),
    ).toBeNull();
  });
});

describe("personal canvas viewport", () => {
  it("keeps the same page center and zoom when the assistant or viewport changes size", () => {
    const before = { w: 1000, h: 800 };
    const after = { w: 390, h: 600 };
    const camera = { x: 120, y: -30, z: 2 };
    const result = centerCameraForViewport(camera, before, after);
    expect(after.w / (2 * result.z) - result.x).toBe(
      before.w / (2 * camera.z) - camera.x,
    );
    expect(after.h / (2 * result.z) - result.y).toBe(
      before.h / (2 * camera.z) - camera.y,
    );
    expect(result.z).toBe(camera.z);
    expect(centerCameraForViewport(result, after, before)).toEqual(camera);
    expect(centerCameraForViewport(camera, before, { w: 1, h: 1 })).toEqual(
      camera,
    );
  });

  it("restores older preferences, adapts saved dimensions, and ignores corrupt camera values", () => {
    expect(readCanvasCamera({ x: 5, y: 10, z: 1 })).toEqual({
      x: 5,
      y: 10,
      z: 1,
    });
    expect(
      readCanvasCamera(
        { x: 5, y: 10, z: 1, w: 1000, h: 800 },
        { w: 400, h: 600 },
      ),
    ).toEqual({ x: -295, y: -90, z: 1 });
    for (const value of [
      null,
      [],
      {},
      { x: 0, y: 0, z: 0 },
      { x: Infinity, y: 0, z: 1 },
      { x: 0, y: NaN, z: 1 },
      { x: 0, y: 0, z: 100 },
      { x: "0", y: 0, z: 1 },
    ])
      expect(readCanvasCamera(value)).toBeNull();
  });
});
