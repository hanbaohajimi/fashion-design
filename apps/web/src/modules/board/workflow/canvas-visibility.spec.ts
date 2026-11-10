import { describe, expect, it, vi } from "vitest";
import { Box, type Editor, type TLShape } from "tldraw";
import { canvasShapeVisibility, locateCanvasMaterial, visibleCanvasBounds, visibleCanvasShapes } from "./canvas-visibility";

describe("画布显隐", () => {
  it("只有明确隐藏的对象覆盖继承；旧快照和普通对象随父级显示", () => {
    for (const meta of [{}, { canvasHidden: false }, { canvasHidden: "true" }]) {
      expect(canvasShapeVisibility({ meta } as unknown as TLShape)).toBe("inherit");
    }
    expect(canvasShapeVisibility({ meta: { canvasHidden: true } } as unknown as TLShape)).toBe("hidden");
  });

  it("定位优先可见副本，全部隐藏时交给素材详情，不显示或选择隐藏对象", () => {
    const shapes = [{ id: "hidden" }, { id: "visible" }] as unknown as TLShape[];
    const editor = { isShapeHidden: vi.fn((shape: TLShape) => shape.id === "hidden"),
      complete: vi.fn(), select: vi.fn(), zoomToSelection: vi.fn() };
    expect(locateCanvasMaterial(editor as unknown as Editor, shapes)).toBe(true);
    expect(editor.select).toHaveBeenCalledWith("visible");
    editor.select.mockClear(); editor.zoomToSelection.mockClear();
    editor.isShapeHidden.mockReturnValue(true);
    expect(locateCanvasMaterial(editor as unknown as Editor, shapes)).toBe(false);
    expect(editor.select).not.toHaveBeenCalled();
    expect(editor.zoomToSelection).not.toHaveBeenCalled();
  });

  it("导出与全图范围保留可见画框，排除隐藏子级及分组带来的空白", () => {
    const shapes = [
      { id: "group", type: "group" }, { id: "hidden-child", type: "fashion-image" },
      { id: "visible-child", type: "fashion-image" }, { id: "frame", type: "frame" },
    ] as unknown as TLShape[];
    const editor = {
      getCurrentPageShapes: () => shapes,
      isShapeHidden: vi.fn((shape: TLShape) => shape.id === "hidden-child"),
      getShapeMaskedPageBounds: (id: string) => id === "visible-child" ? new Box(100, 80, 200, 300) : new Box(0, 0, 400, 500),
    };
    expect(visibleCanvasShapes(editor as unknown as Editor).map(shape => shape.id)).toEqual(["visible-child", "frame"]);
    expect(visibleCanvasBounds(editor as unknown as Editor)).toEqual(new Box(0, 0, 400, 500));
    editor.isShapeHidden.mockImplementation(shape => shape.id !== "visible-child");
    expect(visibleCanvasBounds(editor as unknown as Editor)).toEqual(new Box(100, 80, 200, 300));
    editor.isShapeHidden.mockReturnValue(true);
    expect(visibleCanvasBounds(editor as unknown as Editor)).toBeUndefined();
  });
});
