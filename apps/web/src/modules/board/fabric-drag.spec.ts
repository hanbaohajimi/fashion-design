import { describe, expect, it, vi } from "vitest";
import { createShapeId, type TLFrameShape } from "tldraw";

import {
  createNativeFileContentHandler,
  createNativeFileDropController,
  decodeFabricDragPayload,
  fabricToShapeProps,
} from "./fabric-drag";
import {
  createFinalizedSketchImageRecord,
  isPlatformGeneratedImage,
  normalizeHexColor,
  normalizeImageRole,
} from "./shapes";
import { getSketchPencilPreset, splitStrokeByEraser } from "./tools/MountTool";

const payload = {
  fabricId: "fabric-1",
  fabricTags: ["真丝", "垂坠"],
  thumbnailUrl: "/api/fabrics/fabric-1/image",
};

describe("fabric drag payload", () => {
  it("解析有效载荷并自动生成 fabric_ref 角色", () => {
    expect(decodeFabricDragPayload(JSON.stringify(payload))).toEqual(payload);
    expect(fabricToShapeProps(payload)).toMatchObject({
      fabricId: "fabric-1",
      role: "fabric_ref",
    });
  });

  it("拒绝残缺或非 JSON 载荷", () => {
    expect(decodeFabricDragPayload("not-json")).toBeNull();
    expect(
      decodeFabricDragPayload(JSON.stringify({ fabricId: "fabric-1" })),
    ).toBeNull();
  });
});

describe("image role scope", () => {
  it("将用户上传图片上的历史成衣标签归一为参考衣", () => {
    expect(normalizeImageRole("garment_ref", { fileId: "file-1" })).toBe(
      "reference_garment",
    );
    expect(isPlatformGeneratedImage({ fileId: "file-1" })).toBe(false);
  });

  it("平台生成图片保留成衣标签", () => {
    expect(
      normalizeImageRole("garment_ref", {
        assetId: "asset-1",
        generationTaskId: "task-1",
      }),
    ).toBe("garment_ref");
    expect(
      isPlatformGeneratedImage({
        assetId: "asset-1",
        generationTaskId: "task-1",
      }),
    ).toBe(true);
  });
});

describe("native file drop lifecycle", () => {
  it("将 tldraw 文件内容按落点转交给统一上传入口", () => {
    const file = { name: "reference.png" } as File;
    const onFiles = vi.fn();
    const handler = createNativeFileContentHandler({
      getFallbackPoint: () => ({ x: 10, y: 20 }),
      onFiles,
    });

    handler({ files: [file], point: { x: 120, y: 80 } });

    expect(onFiles).toHaveBeenCalledWith([file], { x: 120, y: 80 });
  });

  it("粘贴文件没有落点时使用画布中心", () => {
    const file = { name: "reference.png" } as File;
    const onFiles = vi.fn();
    const handler = createNativeFileContentHandler({
      getFallbackPoint: () => ({ x: 320, y: 240 }),
      onFiles,
    });

    handler({ files: [file] });

    expect(onFiles).toHaveBeenCalledWith([file], { x: 320, y: 240 });
  });

  it("在 drop 时复位遮罩并将文件交给 tldraw 外部内容处理器", () => {
    const draggingStates: boolean[] = [];
    const controller = createNativeFileDropController({
      onDraggingChange: (dragging) => draggingStates.push(dragging),
    });
    const file = { name: "reference.png" } as File;
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    controller.onDragEnter({
      dataTransfer: { types: ["Files"] },
      preventDefault,
    } as unknown as DragEvent);
    controller.onDrop({
      clientX: 120,
      clientY: 80,
      dataTransfer: { files: [file] },
      preventDefault,
      stopPropagation,
    } as unknown as DragEvent);

    expect(draggingStates).toEqual([true, false]);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it("dragleave 丢失 dataTransfer.types 时仍能关闭遮罩", () => {
    const draggingStates: boolean[] = [];
    const controller = createNativeFileDropController({
      onDraggingChange: (dragging) => draggingStates.push(dragging),
    });

    controller.onDragEnter({
      dataTransfer: { types: ["Files"] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent);
    controller.onDragLeave({
      dataTransfer: { types: [] },
    } as unknown as DragEvent);

    expect(draggingStates).toEqual([true, false]);
  });

  it("面料库接管文件时不显示画布投放遮罩", () => {
    const onDraggingChange = vi.fn();
    const preventDefault = vi.fn();
    const controller = createNativeFileDropController({
      onDraggingChange,
      shouldIgnore: () => true,
    });

    controller.onDragEnter({
      dataTransfer: { types: ["Files"] },
      preventDefault,
    } as unknown as DragEvent);

    expect(onDraggingChange).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("swatch color", () => {
  it("规范化六位 HEX 颜色", () => {
    expect(normalizeHexColor("d8c8b6")).toBe("#D8C8B6");
    expect(normalizeHexColor(" #a52c1f ")).toBe("#A52C1F");
  });

  it("拒绝不完整或非法的 HEX 颜色", () => {
    expect(normalizeHexColor("#fff")).toBeNull();
    expect(normalizeHexColor("#12345g")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
  });
});

describe("sketch eraser geometry", () => {
  it("只移除擦除轨迹覆盖的中段并保留两侧笔画", () => {
    const stroke = [
      { x: 0, y: 0, z: 0.5 },
      { x: 100, y: 0, z: 0.5 },
    ];

    const remaining = splitStrokeByEraser(
      stroke,
      { x: 50, y: -12 },
      { x: 50, y: 12 },
      8,
    );

    expect(remaining).toHaveLength(2);
    expect(remaining[0]?.at(-1)?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(
      43,
    );
    expect(remaining[1]?.[0]?.x ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(
      57,
    );
  });

  it("擦除轨迹未命中时保持原始笔画数据不变", () => {
    const stroke = [
      { x: 0, y: 0, z: 0.5 },
      { x: 40, y: 0, z: 0.5 },
    ];

    expect(
      splitStrokeByEraser(stroke, { x: 20, y: 30 }, { x: 30, y: 30 }, 6),
    ).toEqual([stroke]);
  });

  it("橡皮完全覆盖短笔画时不留下碎点", () => {
    expect(
      splitStrokeByEraser(
        [
          { x: 8, y: 8, z: 0.5 },
          { x: 12, y: 8, z: 0.5 },
        ],
        { x: 10, y: 8 },
        { x: 10, y: 8 },
        8,
      ),
    ).toEqual([]);
  });
});

describe("finalized fashion sketch", () => {
  it("把可编辑草图纸转换成单张手动廓形图片记录", () => {
    const frame = {
      id: "shape:sketch-paper",
      index: "a1",
      isLocked: false,
      meta: {
        fashionSketch: true,
        sketchDirty: true,
        sketchTitle: "廓形草图 04",
      },
      opacity: 1,
      parentId: "page:page",
      props: { h: 860, name: "廓形草图 04", w: 640 },
      rotation: 0,
      type: "frame",
      typeName: "shape",
      x: 120,
      y: 240,
    } as unknown as TLFrameShape;

    const image = createFinalizedSketchImageRecord(frame, {
      fileId: "file-sketch",
      fingerprint: "a".repeat(64),
      imageId: createShapeId("sketch-image"),
      previewUrl: "/api/files/file-sketch/thumbnail/1024",
      updatedAt: "2026-08-11T12:00:00.000Z",
    });

    expect(image).toMatchObject({
      id: "shape:sketch-image",
      meta: {
        fashionSketchImage: true,
        sketchSourceFrameId: "shape:sketch-paper",
        sketchStatus: "ready",
      },
      props: {
        fileId: "file-sketch",
        role: "silhouette_ref",
        roleInferenceState: "ready",
        roleLabel: "fashion_sketch",
        roleSource: "manual",
        url: "/api/files/file-sketch/thumbnail/1024",
      },
      type: "fashion-image",
    });
    expect(image.props).not.toHaveProperty("name");
  });
});

describe("fashion sketch pencil", () => {
  it("细中粗三档使用明确递增且适合草图的线宽", () => {
    const fine = getSketchPencilPreset("s", "black");
    const medium = getSketchPencilPreset("m", "black");
    const bold = getSketchPencilPreset("l", "black");

    expect(fine.strokeWidth).toBeLessThan(medium.strokeWidth);
    expect(medium.strokeWidth).toBeLessThan(bold.strokeWidth);
    expect(bold.strokeWidth).toBeLessThanOrEqual(2.2);
  });

  it("使用半透明石墨色而不是纯黑马克笔材质", () => {
    expect(getSketchPencilPreset("m", "black")).toEqual({
      opacity: 0.76,
      strokeColor: "#45423D",
      strokeWidth: 1.05,
    });
    expect(getSketchPencilPreset("m", "grey").strokeColor).toBe("#706B63");
  });
});
