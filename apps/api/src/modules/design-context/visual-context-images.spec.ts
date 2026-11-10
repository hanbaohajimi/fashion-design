import { describe, expect, it } from "vitest";
import { mergeVisualContext, visualContextCoverage } from "./visual-context-images";
import type { VisualContextResult } from "./visual-context.service";

type MutableVisual = { -readonly [Key in keyof VisualContextResult]: VisualContextResult[Key] extends readonly (infer Item)[] ? Item[] : VisualContextResult[Key] };

function batch(ids: string[]): MutableVisual {
  const imageBindings = ids.map((id, imageIndex) => ({ nodeId: id, fileAssetId: `file-${id}`, assetId: null, imageIndex }));
  const index = imageBindings.map(binding => ({ ...binding, status: "ready" as const, summary: null, error: null }));
  return { imageBindings, index, images: ids.map(id => ({ url: `image:${id}`, detail: "high" })), coverage: visualContextCoverage(index, imageBindings, ids.length) };
}

describe("视觉图片与画布对象绑定", () => {
  it("跨补读的同图副本共用图片，满额后仍保留同图绑定", () => {
    const previous = batch(Array.from({ length: 8 }, (_, i) => `image-${i}`));
    const priority = batch(["copy"]);
    priority.imageBindings[0] = { nodeId: "copy", fileAssetId: "file-image-0", assetId: null, imageIndex: 0 };
    const result = mergeVisualContext(priority, previous);
    expect(result.images).toHaveLength(8);
    expect(result.imageBindings).toHaveLength(9);
    expect(result.imageBindings.slice(0, 2).map(binding => binding.imageIndex)).toEqual([0, 0]);
    expect(result.imageBindings.at(-1)).toMatchObject({ nodeId: "image-7", imageIndex: 7 });
    expect(result.coverage).toMatchObject({ total: 9, ready: 9, attachedImageCount: 8, unreadNodeIds: [] });
  });

  it("本次补读不可用时不重新附上该对象的旧图片", () => {
    const previous = batch(["a", "b"]);
    const priority = batch([]);
    priority.index = [{ nodeId: "a", fileAssetId: "file-a", assetId: null, status: "unavailable", summary: null, error: "不可用" }];
    const result = mergeVisualContext(priority, previous);
    expect(result.imageBindings.map(binding => binding.nodeId)).toEqual(["b"]);
    expect(result.coverage).toMatchObject({ total: 2, ready: 1, failed: 1, attachedImageCount: 1, unreadNodeIds: ["a"] });
  });

  it("对象替换了图片时以新的绑定为准，不因同名混淆来源", () => {
    const previous = batch(["a", "b"]);
    const priority = batch(["a"]);
    priority.imageBindings[0] = { nodeId: "a", fileAssetId: "replacement", assetId: null, imageIndex: 0 };
    priority.images[0] = { url: "image:replacement", detail: "high" };
    const result = mergeVisualContext(priority, previous);
    expect(result.imageBindings.map(binding => binding.fileAssetId)).toEqual(["replacement", "file-b"]);
    expect(result.images.map(image => image.url)).toEqual(["image:replacement", "image:b"]);
  });

  it("无实际图片的绑定不能消耗名额或变成已传入记录", () => {
    const priority = batch(["broken"]);
    priority.images = [];
    const result = mergeVisualContext(priority, batch(["valid"]));
    expect(result.coverage).toMatchObject({ attachedNodeIds: ["valid"], unreadNodeIds: ["broken"], attachedImageCount: 1 });
  });

  it("图片最多八张，对象绑定最多六十四项，超出部分仍在未附图范围中", () => {
    const priority = batch(Array.from({ length: 70 }, (_, i) => `copy-${i}`));
    priority.imageBindings = priority.imageBindings.map(binding => ({ ...binding, fileAssetId: "shared", imageIndex: 0 }));
    priority.images = priority.images.slice(0, 1);
    const result = mergeVisualContext(priority, batch([]));
    expect(result.images).toHaveLength(1);
    expect(result.imageBindings).toHaveLength(64);
    expect(result.coverage.unreadNodeIds).toHaveLength(6);
  });
});
