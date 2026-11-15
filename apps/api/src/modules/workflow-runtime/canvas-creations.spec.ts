import { describe, expect, it } from "vitest";
import { canvasCreationDraftSchema, createCanvasCreationSchema, creationInputBindingSchema, stripCanvasTransientDrafts } from "@fashion/shared";

describe("无用途标签的创作输入契约", () => {
  it("共享快照去除本机文本草稿，保留已保存正文、位置和其他对象", () => {
    const row = { id: "shape:text", type: "fashion-creation", x: 12, y: 34, props: { text: "已发布正文", draftText: "尚未提交的私有草稿" } };
    const picture = { id: "shape:image", type: "fashion-image", props: { imageUrl: "/image.png" } };
    const input = { document: { schema: { version: 2 }, store: { text: row, picture } }, store: { text: row }, legacyRecords: [row, picture] };
    const original = structuredClone(input), result = stripCanvasTransientDrafts(input);
    expect(JSON.stringify(result)).not.toContain("尚未提交的私有草稿");
    expect(result.document).toMatchObject({ schema: { version: 2 }, store: { text: { x: 12, y: 34, props: { text: "已发布正文" } }, picture } });
    expect(input).toEqual(original);
  });
  it("允许先创建没有图片和提示词的目标，但必须有稳定身份", () => {
    const parsed = createCanvasCreationSchema.parse({ id: "a124e233-8622-424e-8424-98fa75ea42be", mutationId: "4d20d25e-fd36-46c2-a53e-ed41a6f00cc6" });
    expect(parsed.draft.inputs).toEqual([]);
    expect(parsed.draft.prompt).toBe("");
    expect(parsed.draft.parameters.count).toBe(1);
  });

  it("旧素材角色和权重不能进入新的引用契约", () => {
    expect(creationInputBindingSchema.safeParse({ id: "ref-1", nodeId: "image-1", role: "silhouette_ref" }).success).toBe(false);
    expect(creationInputBindingSchema.safeParse({ id: "ref-1", nodeId: "image-1", weight: 0.7 }).success).toBe(false);
    expect(creationInputBindingSchema.parse({ id: "ref-1", nodeId: "image-1", nodeVersionId: "version-1" })).toEqual({ id: "ref-1", nodeId: "image-1", nodeVersionId: "version-1" });
  });

  it("继续创作必须指向本次实际引用，引用编号不能串图", () => {
    expect(canvasCreationDraftSchema.safeParse({ inputs: [{ id: "ref-1", nodeId: "image-1" }], basedOnInputId: "missing" }).success).toBe(false);
    expect(canvasCreationDraftSchema.safeParse({ inputs: [{ id: "ref-1", nodeId: "image-1" }, { id: "ref-1", nodeId: "image-2" }] }).success).toBe(false);
    const draft = canvasCreationDraftSchema.parse({ prompt: "保留图1版型，使用图2纹理", inputs: [{ id: "ref-1", nodeId: "image-1" }, { id: "ref-2", nodeId: "image-2" }], basedOnInputId: "ref-1" });
    expect(draft.inputs.map((input) => input.nodeId)).toEqual(["image-1", "image-2"]);
  });
});
