import { describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";
import { buildCanvasObjectTree, filterCanvasObjects, orderCanvasObjects, readCanvasObjects, type CanvasObject } from "./canvas-objects";

const object = (id: string, options: Partial<CanvasObject> = {}): CanvasObject => ({
  id: `shape:${id}` as CanvasObject["id"], parentId: "page:one", index: "a1", type: "fashion-image", name: id, isLocked: false, isHidden: false, ...options,
});

describe("画布对象目录", () => {
  it("前景先列出，子对象保留容器层级并继承父级锁定", () => {
    const rows = buildCanvasObjectTree([
      object("behind", { index: "a0" }),
      object("group", { type: "group", index: "a2", isLocked: true }),
      object("child", { parentId: "shape:group", index: "a9" }),
      object("frame", { type: "frame", parentId: "shape:group" }),
      object("nested", { parentId: "shape:frame" }),
    ]);
    expect(rows.map(row => [row.id, row.depth, row.ancestorLocked])).toEqual([
      ["shape:group", 0, false], ["shape:child", 1, true], ["shape:frame", 1, true], ["shape:nested", 2, true], ["shape:behind", 0, false],
    ]);
  });

  it("搜索展开匹配子对象的祖先；匹配容器时显示整个容器", () => {
    const rows = buildCanvasObjectTree([
      object("group", { type: "group", name: "秋冬系列" }),
      object("coat", { parentId: "shape:group", name: "ＣＯＡＴ 外套" }),
      object("note", { parentId: "shape:group", type: "fashion-note", name: "面料说明" }),
      object("other"),
    ]);
    expect(filterCanvasObjects(rows, "coat", new Set(["shape:group"])).map(row => row.id)).toEqual(["shape:group", "shape:coat"]);
    expect(filterCanvasObjects(rows, "秋冬", new Set(["shape:group"]))).toHaveLength(3);
    expect(filterCanvasObjects(rows, "便签", new Set()).map(row => row.id)).toEqual(["shape:group", "shape:note"]);
    expect(filterCanvasObjects(rows, "不存在", new Set())).toEqual([]);
    expect(filterCanvasObjects(rows, "", new Set(["shape:group"]))).toHaveLength(2);
  });

  it("同名对象调换层级后编号不变，空名使用真实类型", () => {
    const original = [object("a", { name: "通勤 外套", index: "a1" }), object("b", { name: "通勤\n外套", index: "a2" }), object("c", { name: " ", type: "draw" })];
    const labels = (values: CanvasObject[]) => Object.fromEntries(buildCanvasObjectTree(values).map(row => [row.id, row.label]));
    expect(labels(original)).toEqual({ "shape:a": "通勤 外套", "shape:b": "通勤 外套（2）", "shape:c": "手绘" });
    expect(labels(original.map(item => ({ ...item, index: item.id === "shape:a" ? "a9" : item.index })))).toEqual(labels(original));
  });

  it("旧导入的缺失父级和循环父级不会让对象消失或搜索死循环", () => {
    const rows = buildCanvasObjectTree([object("a", { parentId: "shape:b" }), object("b", { parentId: "shape:a" }), object("orphan", { parentId: "shape:missing" })]);
    expect(new Set(rows.map(row => row.id)).size).toBe(3);
    expect(filterCanvasObjects(rows, "a", new Set()).length).toBeGreaterThan(0);
  });

  it("坐标、缩放和尺寸更新不改变目录投影，标题和锁定仍更新", () => {
    const shape = { ...object("image"), x: 10, y: 20, props: { title: "外套", w: 200, h: 300 }, meta: { canvasHidden: false } };
    const editor = { getCurrentPageShapes: () => [shape] } as unknown as Editor;
    const first = JSON.stringify(readCanvasObjects(editor));
    shape.x = 100; shape.props.w = 400;
    expect(JSON.stringify(readCanvasObjects(editor))).toBe(first);
    shape.props.title = "改版外套"; shape.isLocked = true;
    expect(readCanvasObjects(editor)[0]).toMatchObject({ label: "改版外套", isLocked: true });
    shape.meta.canvasHidden = true;
    expect(readCanvasObjects(editor)[0]).toMatchObject({ isHidden: true });
  });

  it("父级隐藏只影响呈现，不覆盖子级自身选择；搜索仍能找到隐藏子级", () => {
    const objects = [object("group", { type: "group", isHidden: true }),
      object("child", { parentId: "shape:group" }),
      object("hidden", { parentId: "shape:group", isHidden: true })];
    const rows = buildCanvasObjectTree(objects);
    expect(rows.find(row => row.id === "shape:child")).toMatchObject({ isHidden: false, ancestorHidden: true });
    expect(filterCanvasObjects(rows, "child", new Set(["shape:group"])).map(row => row.id)).toEqual(["shape:group", "shape:child"]);
    const restored = buildCanvasObjectTree(objects.map(item => item.id === "shape:group" ? { ...item, isHidden: false } : item));
    expect(restored.find(row => row.id === "shape:child")).toMatchObject({ isHidden: false, ancestorHidden: false });
    expect(restored.find(row => row.id === "shape:hidden")).toMatchObject({ isHidden: true, ancestorHidden: false });
  });
  it("图片历史使用真实资产身份，版本更换更新投影而视野不影响", () => {
    const shapes = [{ ...object("image"), props: { assetId: "version-a", title: "外套" }, meta: {} }, { ...object("note", { type: "fashion-note" }), props: { assetId: "not-an-image", text: "说明" }, meta: {} }];
    const editor = { getCurrentPageShapes: () => shapes } as unknown as Editor;
    expect(readCanvasObjects(editor).find(row => row.id === "shape:image")?.assetId).toBe("version-a");
    expect(readCanvasObjects(editor).find(row => row.id === "shape:note")?.assetId).toBeUndefined();
    const image = shapes[0]; if (!image) throw new Error("缺少测试图片");
    image.props.assetId = "version-b";
    expect(readCanvasObjects(editor).find(row => row.id === "shape:image")?.assetId).toBe("version-b");
  });
});

describe("对象层级写入边界", () => {
  function setup() {
    return { getSelectedShapeIds: vi.fn(() => ["shape:a"]), getIsReadonly: vi.fn(() => false), isShapeOrAncestorLocked: vi.fn(() => false), isShapeHidden: vi.fn(() => false), markHistoryStoppingPoint: vi.fn(), bringToFront: vi.fn(), sendToBack: vi.fn(), bringForward: vi.fn(), sendBackward: vi.fn() };
  }
  it("点按时重新检查只读、空选择及祖先锁定", () => {
    for (const kind of ["readonly", "empty", "locked", "hidden"]) {
      const editor = setup();
      if (kind === "readonly") editor.getIsReadonly.mockReturnValue(true);
      if (kind === "empty") editor.getSelectedShapeIds.mockReturnValue([]);
      if (kind === "locked") editor.isShapeOrAncestorLocked.mockReturnValue(true);
      if (kind === "hidden") editor.isShapeHidden.mockReturnValue(true);
      orderCanvasObjects(editor as unknown as Editor, "front");
      expect(editor.markHistoryStoppingPoint).not.toHaveBeenCalled();
      expect(editor.bringToFront).not.toHaveBeenCalled();
    }
  });
  it("前后一层包括不相交的对象，四种调整均可独立撤销", () => {
    const editor = setup();
    for (const order of ["front", "forward", "backward", "back"] as const) orderCanvasObjects(editor as unknown as Editor, order);
    expect(editor.bringToFront).toHaveBeenCalledWith(["shape:a"]);
    expect(editor.sendToBack).toHaveBeenCalledWith(["shape:a"]);
    expect(editor.bringForward).toHaveBeenCalledWith(["shape:a"], { considerAllShapes: true });
    expect(editor.sendBackward).toHaveBeenCalledWith(["shape:a"], { considerAllShapes: true });
    expect(editor.markHistoryStoppingPoint).toHaveBeenCalledTimes(4);
  });
});
