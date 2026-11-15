import { describe, expect, it } from "vitest";
import { retireCanvasNotes } from "@fashion/shared";

const note = (id: string, meta = {}) => ({ id, typeName: "shape", type: "fashion-note", x: 20, y: 30, props: { w: 280, h: 220, text: "旧便签内容" }, meta });
describe("便签退役", () => {
  it("删除旧便签与其绑定，不改变图片、视野或原快照", () => {
    const snapshot = { document: { store: { note: note("note"), image: { id: "image", typeName: "shape", type: "fashion-image", x: 60 }, link: { id: "link", typeName: "binding", fromId: "image", toId: "note" } } }, session: { camera: { x: 9, y: 10, z: .7 } } };
    const result = retireCanvasNotes(snapshot);
    expect(result.removedShapeIds).toEqual(["note"]);
    expect(result.snapshot).toEqual({ document: { store: { image: snapshot.document.store.image } }, session: snapshot.session });
    expect(snapshot.document.store.note.props.text).toBe("旧便签内容");
  });
  it("业务资料原来借用便签显示时转为纯文本，保留身份和摆放", () => {
    const result = retireCanvasNotes({ store: { brief: note("brief-shape") } }, [{ id: "brief", type: "brief", title: "客户需求", payload: { text: "真实需求" } }], [{ shapeId: "brief-shape", nodeId: "brief" }]);
    expect(result.snapshot).toMatchObject({ store: { brief: { id: "brief-shape", type: "fashion-text", x: 20, y: 30, props: { text: "真实需求", title: "客户需求", w: 280, h: 220 } } } });
    expect(result.removedShapeIds).toEqual([]);
  });
  it("过时缓存里的已退役文字也不会恢复，其他新文本保持可用", () => {
    const text = { id: "new", typeName: "shape", type: "fashion-text", props: { text: "新内容" } };
    const result = retireCanvasNotes({ legacyRecords: [note("old", { canvasNodeId: "deleted" }), text] }, [{ id: "deleted", type: "legacy", title: "已删除便签", payload: { retiredNote: true } }]);
    expect(result.snapshot.legacyRecords).toEqual([text]);
  });
});
