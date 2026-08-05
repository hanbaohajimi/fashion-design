import { describe, expect, it } from "vitest";

describe("多选元素参考图片选择逻辑", () => {
  const STYLE_REFERENCE_STRENGTH = 0.72;
  const SILHOUETTE_REFERENCE_STRENGTH = 0.55;
  const FABRIC_REFERENCE_STRENGTH = 0.7;

  interface WeightedReference {
    url: string;
    weight: number;
    priority: number;
  }

  function selectBestReference(compiledPrompt: {
    styleReferences?: Array<{ imageUrl: string; weight?: number }>;
    fabricReferences?: Array<{ imageUrl: string; weight?: number }>;
    silhouetteReferences?: Array<{ edgeImageUrl: string }>;
  }): WeightedReference | null {
    const allReferences: WeightedReference[] = [];

    // Style references (最高优先级)
    for (const ref of compiledPrompt.styleReferences ?? []) {
      allReferences.push({
        url: ref.imageUrl,
        weight: "weight" in ref && ref.weight !== undefined ? ref.weight : STYLE_REFERENCE_STRENGTH,
        priority: 3,
      });
    }

    // Fabric references (中优先级)
    for (const ref of compiledPrompt.fabricReferences ?? []) {
      allReferences.push({
        url: ref.imageUrl,
        weight: "weight" in ref && ref.weight !== undefined ? ref.weight : FABRIC_REFERENCE_STRENGTH,
        priority: 2,
      });
    }

    // Silhouette references (低优先级)
    for (const ref of compiledPrompt.silhouetteReferences ?? []) {
      allReferences.push({
        url: ref.edgeImageUrl,
        weight: SILHOUETTE_REFERENCE_STRENGTH,
        priority: 1,
      });
    }

    if (allReferences.length === 0) return null;

    const selected = allReferences.reduce((best, current) => {
      // 优先比较权重
      if (current.weight > best.weight) return current;
      if (current.weight < best.weight) return best;
      // 权重相同时，比较类型优先级
      if (current.priority > best.priority) return current;
      return best;
    });

    return selected;
  }

  it("选择多个fabric时，使用第一个（权重相同）", () => {
    const result = selectBestReference({
      fabricReferences: [
        { imageUrl: "fabric1.jpg" },
        { imageUrl: "fabric2.jpg" },
        { imageUrl: "fabric3.jpg" },
      ],
    });

    expect(result).toEqual({
      url: "fabric1.jpg",
      weight: 0.7,
      priority: 2,
    });
  });

  it("混合选择时，优先使用权重最高的style", () => {
    const result = selectBestReference({
      fabricReferences: [
        { imageUrl: "fabric1.jpg" },
        { imageUrl: "fabric2.jpg" },
      ],
      styleReferences: [{ imageUrl: "style1.jpg" }],
    });

    expect(result).toEqual({
      url: "style1.jpg",
      weight: 0.72,
      priority: 3,
    });
  });

  it("style有不同权重时，选择权重最高的", () => {
    const result = selectBestReference({
      styleReferences: [
        { imageUrl: "style1.jpg", weight: 0.5 },
        { imageUrl: "style2.jpg", weight: 0.8 },
      ],
      fabricReferences: [{ imageUrl: "fabric1.jpg" }],
    });

    expect(result).toEqual({
      url: "style2.jpg",
      weight: 0.8,
      priority: 3,
    });
  });

  it("fabric自定义高权重时，优先于默认style", () => {
    const result = selectBestReference({
      fabricReferences: [{ imageUrl: "fabric1.jpg", weight: 0.9 }],
      styleReferences: [{ imageUrl: "style1.jpg" }], // 默认0.72
    });

    expect(result).toEqual({
      url: "fabric1.jpg",
      weight: 0.9,
      priority: 2,
    });
  });

  it("所有类型都有时，选择权重最高的", () => {
    const result = selectBestReference({
      styleReferences: [{ imageUrl: "style1.jpg" }], // 0.72
      fabricReferences: [{ imageUrl: "fabric1.jpg" }], // 0.7
      silhouetteReferences: [{ edgeImageUrl: "silhouette1.jpg" }], // 0.55
    });

    expect(result).toEqual({
      url: "style1.jpg",
      weight: 0.72,
      priority: 3,
    });
  });

  it("权重相同时，按类型优先级：style > fabric > silhouette", () => {
    const result = selectBestReference({
      styleReferences: [{ imageUrl: "style1.jpg", weight: 0.6 }],
      fabricReferences: [{ imageUrl: "fabric1.jpg", weight: 0.6 }],
      silhouetteReferences: [{ edgeImageUrl: "silhouette1.jpg" }],
    });

    expect(result).toEqual({
      url: "style1.jpg",
      weight: 0.6,
      priority: 3,
    });
  });

  it("没有参考图片时返回null", () => {
    const result = selectBestReference({});
    expect(result).toBeNull();
  });

  it("只有一个元素时正常工作", () => {
    const result = selectBestReference({
      fabricReferences: [{ imageUrl: "single-fabric.jpg" }],
    });

    expect(result).toEqual({
      url: "single-fabric.jpg",
      weight: 0.7,
      priority: 2,
    });
  });
});
