import { describe, expect, it } from "vitest";
import { createImageFeedbackHandoff } from "./image-feedback-handoff";

describe("image feedback handoff", () => {
  it("keeps anchored comments and turns them into a review-first draft", () => {
    const result = createImageFeedbackHandoff({
      title: "藏蓝通勤外套",
      revision: 4,
      annotations: [
        {
          id: "collar",
          kind: "rectangle",
          points: [{ x: 0.2, y: 0.1 }, { x: 0.4, y: 0.2 }],
          color: "#2b6553",
          width: 2,
          text: "",
        },
      ],
      comments: [
        {
          id: "comment-1",
          text: "领口略微收小，保留双排扣与面料纹理",
          point: { x: 0.35, y: 0.18 },
          annotationIds: ["collar"],
        },
      ],
    });

    expect(result.commentIds).toEqual(["comment-1"]);
    expect(result.prompt).toContain("图片意见版本 r4");
    expect(result.prompt).toContain("原图横向 35%，纵向 18%");
    expect(result.prompt).toContain("关联 画面标注 1");
    expect(result.prompt).toContain("领口略微收小，保留双排扣与面料纹理");
    expect(result.prompt).toContain("不要生成图片、提交任务或修改画布");
  });

  it("requires a selected comment and rejects an oversized handoff", () => {
    expect(() => createImageFeedbackHandoff({
      title: "方案",
      revision: 1,
      annotations: [],
      comments: [],
    })).toThrow("请先选择至少一条图片意见");

    expect(() => createImageFeedbackHandoff({
      title: "方案",
      revision: 1,
      annotations: [],
      comments: [{
        id: "long",
        text: "很长的意见".repeat(700),
        point: null,
        annotationIds: [],
      }],
    })).toThrow("文字较长");
  });
});
