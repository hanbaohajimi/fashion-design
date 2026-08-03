import { describe, expect, it, vi } from "vitest";

import {
  createNativeFileContentHandler,
  createNativeFileDropController,
  decodeFabricDragPayload,
  fabricToShapeProps,
} from "./fabric-drag";
import { normalizeHexColor } from "./shapes";

const payload = {
  fabricCategory: "silk",
  fabricId: "fabric-1",
  fabricName: "真丝缎",
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
