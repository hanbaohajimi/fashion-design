import { describe, expect, it } from "vitest";
import { imageAnnotationsSvg, imageCommentMarkerSchema, type ImageFeedback } from "@fashion/shared";
import { aiGenerationRequestSchema } from "@fashion/ai";
import { buildImageFeedbackRequest } from "./image-feedback";

const feedback: ImageFeedback = {
  revision: 7,
  annotations: [
    { id: "sleeve", kind: "rectangle", points: [{ x: .1, y: .2 }, { x: .3, y: .5 }], color: "#cc3344", width: 4, text: "" },
    { id: "collar", kind: "text", points: [{ x: .4, y: .1 }], color: "#cc3344", width: 4, text: "<script>&\"'" },
  ],
  comments: [
    { id: "overall", text: "维持面料", point: null, annotationIds: [] },
    { id: "cuff", text: "收窄袖口", point: { x: .25, y: .55 }, annotationIds: ["sleeve"] },
    { id: "edge", text: "右侧加留白", point: { x: 1, y: 0 }, annotationIds: [] },
  ],
};

describe("按选中意见冻结图片标记", () => {
  it("选择顺序和重复 ID 不改变原始编号，只附带明确关联的标注", () => {
    const selection = buildImageFeedbackRequest(feedback, ["edge", "cuff", "cuff"]);
    expect(selection.markers).toEqual([{ number: 2, point: { x: .25, y: .55 } }, { number: 3, point: { x: 1, y: 0 } }]);
    expect(selection.annotations.map(a => a.id)).toEqual(["sleeve"]);
    expect(selection.instructions).toContain("意见 2，标记 2 (0.250,0.550)：收窄袖口");
    expect(selection.instructions).toContain("意见 3，标记 3 (1.000,0.000)：右侧加留白");
    expect(selection.instructions).not.toContain("维持面料");
    const parsed = aiGenerationRequestSchema.parse({ taskType: "i2i", prompt: selection.instructions, width: 1024, height: 1024, referenceImageUrl: "https://example.test/original.png", imageEdit: { intent: "feedback", markers: selection.markers, annotations: selection.annotations } });
    expect(parsed.imageEdit?.markers).toEqual(selection.markers);
  });
  it("整图意见不会自动携带所有标注或生成虚构位置", () => {
    expect(buildImageFeedbackRequest(feedback, ["overall"])).toEqual({ annotations: [], markers: [], instructions: expect.stringContaining("意见 1，整张图片：维持面料") });
  });
  it.each([undefined, [], ["missing"], ["cuff", "missing"], [null]])("拒绝空或失效的选择 %j", ids => {
    expect(() => buildImageFeedbackRequest(feedback, ids)).toThrow();
  });
  it("SVG 保留编号、边缘标记在图内且文字不能注入标签", () => {
    const svg = imageAnnotationsSvg(feedback.annotations, 200, 100, [{ number: 3, point: { x: 1, y: 0 } }]);
    expect(svg).toContain('cx="187" cy="13"');
    expect(svg).toContain('>3</text>');
    expect(svg).toContain("&lt;script&gt;&amp;&quot;&apos;");
    expect(svg).not.toContain("<script>");
    expect(imageAnnotationsSvg([], 200, 100)).not.toContain("<circle");
  });
  it.each([{ number: 0, point: { x: .5, y: .5 } }, { number: 101, point: { x: 0, y: 0 } }, { number: 1, point: { x: -1, y: .5 } }, { number: "<svg>", point: { x: 0, y: 0 } }])("拒绝非法标记 %j", marker => {
    expect(imageCommentMarkerSchema.safeParse(marker).success).toBe(false);
  });
});
