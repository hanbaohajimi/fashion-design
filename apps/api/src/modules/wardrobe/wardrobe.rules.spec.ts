import { describe, expect, it } from "vitest";
import {
  outfitSaveSchema,
  wardrobePrepareSchema,
  wardrobePresentationSchema,
} from "@fashion/shared";
import {
  assertOutfitItems,
  outfitPrompt,
  preparationPrompt,
  wardrobeCapabilities,
} from "./wardrobe.rules";

describe("衣架输入和能力边界", () => {
  it("托面深度是可选展示参数，只接受有限的 8%–50% 比例", () => {
    const input = {
      requestKey: "shelf-depth-contract",
      expectedVersion: 1,
      revisionId: "confirmed-front",
    };
    expect(wardrobePresentationSchema.parse(input)).not.toHaveProperty(
      "shelfDepthRatio",
    );
    for (const shelfDepthRatio of [0.08, 48 / 140, 0.5]) {
      expect(
        wardrobePresentationSchema.parse({ ...input, shelfDepthRatio })
          .shelfDepthRatio,
      ).toBe(shelfDepthRatio);
    }
    for (const shelfDepthRatio of [0.0799, 0.5001, NaN, Infinity, -Infinity]) {
      expect(
        wardrobePresentationSchema.safeParse({ ...input, shelfDepthRatio })
          .success,
      ).toBe(false);
    }
  });
  it("所有提取补全与侧图保留已知透明材质，不能全图降alpha或发明未知透光部位", () => {
    for (const sourceKind of [
      "sketch",
      "isolated",
      "worn",
      "outfit",
    ] as const) {
      for (const mode of ["extract", "complete"] as const) {
        const input = {
          requestKey: "transparent-material",
          sourceAssetId: "source",
          name: "透明材质",
          category: "accessory" as const,
          sourceKind,
          mode,
        };
        for (const prompt of [
          preparationPrompt(input),
          preparationPrompt(
            {
              ...input,
              presentation: {
                view: "side",
                revisionId: "confirmed",
                orientation: "left",
              },
            },
            "shelf",
          ),
        ]) {
          expect(prompt).toContain("按各区域的真实透射关系输出局部透明alpha");
          expect(prompt).toContain("禁止全图统一降低alpha");
          expect(prompt).toContain("未给出透明材质的部位不要自行变透明");
        }
      }
    }
  });
  it("侧挂候选只从明确的已确认单品生成，保持重力与透明并标明未知结构需核对", () => {
    for (const orientation of ["left", "right"] as const) {
      const prompt = preparationPrompt({
        requestKey: "side-request",
        sourceAssetId: "front",
        name: "羊毛外套",
        category: "outerwear",
        sourceKind: "isolated",
        mode: "complete",
        presentation: { view: "side", revisionId: "confirmed", orientation },
      });
      expect(prompt).toContain(
        `朝${orientation === "left" ? "左" : "右"}转接近90度`,
      );
      expect(prompt).toContain("自然重力悬挂");
      expect(prompt).toContain("薄软区域不能依靠隐形人体");
      expect(prompt).toContain("仅当原图和材料明确有内撑结构");
      expect(prompt).toContain("衣身与袖子分别核对");
      expect(prompt).toContain("不是把正面图片压扁");
      expect(prompt).toContain("不要自编背面款式");
      expect(prompt).toContain("需人工核对的生成推断");
      expect(prompt).toContain("有效alpha");
      expect(prompt).toContain("挂具不能烘焙进图片");
      expect(prompt).toContain("不能替换正面试穿素材");
      expect(prompt).not.toContain("草图");
    }
  });
  it("侧图支撑方式来自服务端确认挂具，四种承重关系不互相替代", () => {
    const input = {
      requestKey: "side-support",
      sourceAssetId: "front",
      name: "单品",
      category: "bottom" as const,
      sourceKind: "isolated" as const,
      mode: "complete" as const,
      presentation: {
        view: "side" as const,
        revisionId: "confirmed",
        orientation: "left" as const,
      },
    };
    expect(preparationPrompt(input, "hanger")).toContain("以双肩为承重点");
    expect(preparationPrompt(input, "clips")).toContain(
      "以腰头或已确认可夹持的上缘为承重点",
    );
    expect(preparationPrompt(input, "clips")).toContain("不得新增肩带");
    expect(preparationPrompt(input, "hook")).toContain(
      "不得凭空添加提手、挂环",
    );
    expect(preparationPrompt(input, "shelf")).toContain(
      "底部承托下的自然立体形态",
    );
    expect(preparationPrompt(input, "shelf")).toContain("轻转约25–35度");
    expect(preparationPrompt(input, "shelf")).not.toContain(
      "正面主体几乎不可见",
    );
    expect(preparationPrompt(input, "hook")).toContain("保留本来的折叠和悬垂");
    const pose = preparationPrompt(
      { ...input, referenceAssetIds: ["pose"] },
      "hanger",
    );
    expect(pose).toContain("第二张仅为侧挂姿态参考");
    expect(pose).toContain(
      "不复制第二张的款式、颜色、图案、材质、挂具、人物或背景",
    );
  });
  it("所有类别可陈列，但多件实时试穿默认未验证", () => {
    expect(wardrobeCapabilities({ AMUX_API_KEY: "configured" })).toMatchObject({
      preparationEnabled: false,
      staticTryOnEnabled: false,
    });
    expect(
      wardrobeCapabilities({
        AMUX_API_KEY: "configured",
        WARDROBE_STATIC_TRYON_ENABLED: "true",
      }).staticTryOnEnabled,
    ).toBe(true);
    expect(wardrobeCapabilities({})).toMatchObject({
      realtimeOutfitEnabled: false,
      realtimeMultiItemVerified: false,
      realtimeCategories: ["top"],
    });
    expect(
      wardrobeCapabilities({
        WARDROBE_REALTIME_CATEGORIES: "shoes,bag,unknown",
      }).realtimeCategories,
    ).toEqual(["shoes", "bag"]);
  });
  it("拒绝越界框选和重复修订", () => {
    expect(
      wardrobePrepareSchema.safeParse({
        requestKey: "test-key-1",
        sourceAssetId: "a",
        name: "鞋",
        category: "shoes",
        sourceKind: "outfit",
        mode: "extract",
        region: { x: 0.8, y: 0, width: 0.4, height: 1 },
      }).success,
    ).toBe(false);
    expect(
      outfitSaveSchema.safeParse({
        requestKey: "test-key-2",
        name: "今日搭配",
        items: [
          { revisionId: "r", layer: 0 },
          { revisionId: "r", layer: 1 },
        ],
      }).success,
    ).toBe(false);
  });
  it("连体与分体占位冲突，鞋包帽允许共存", () => {
    expect(() =>
      assertOutfitItems([
        { itemId: "a", category: "onepiece", layer: 0 },
        { itemId: "b", category: "bottom", layer: 0 },
      ]),
    ).toThrow("连体");
    expect(() =>
      assertOutfitItems([
        { itemId: "a", category: "shoes", layer: 0 },
        { itemId: "b", category: "bag", layer: 0 },
        { itemId: "c", category: "hat", layer: 0 },
      ]),
    ).not.toThrow();
    expect(() =>
      assertOutfitItems(
        [
          { itemId: "a", category: "onepiece", layer: 1 },
          { itemId: "b", category: "top", layer: 0 },
        ],
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertOutfitItems(
        [
          { itemId: "a", category: "top", layer: 1 },
          { itemId: "b", category: "top", layer: 0 },
        ],
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertOutfitItems(
        [
          { itemId: "a", category: "top", layer: 0 },
          { itemId: "b", category: "top", layer: 0 },
        ],
        true,
      ),
    ).toThrow("不同层级");
  });
  it("提取不暗中补造结构，补全是明确的另一模式", () => {
    const input = {
      requestKey: "prepare-key",
      sourceAssetId: "asset",
      name: "外套",
      category: "outerwear" as const,
      sourceKind: "worn" as const,
    };
    expect(preparationPrompt({ ...input, mode: "extract" })).toContain(
      "部分不要臆造",
    );
    expect(preparationPrompt({ ...input, mode: "complete" })).toContain(
      "用户已明确选择生成补全候选",
    );
    expect(
      outfitPrompt([
        { name: "帽子", category: "hat", layer: 1, wearNote: "戴在头上" },
      ]),
    ).toContain("参考 2：帽子");
  });
  it("草图明确补全生成照片级单品，但保留款式和原有文字印花且不烘焙挂具", () => {
    const prompt = preparationPrompt({
      requestKey: "sketch-complete",
      sourceAssetId: "sketch",
      name: "印花短袖",
      category: "top",
      sourceKind: "sketch",
      mode: "complete",
    });
    expect(prompt).toContain("照片级独立服装陈列候选");
    expect(prompt).toContain("真实织物表面、缝线及自然褶皱与垂坠");
    expect(prompt).toContain("材质表现以原图和附加参考为依据");
    expect(prompt).toContain("衣领、衣袖、袖口、门襟与闭合结构、颜色");
    expect(prompt).toContain("原有印花（含文字）的内容、尺度与位置");
    expect(prompt).toContain("不要自编款式、品牌、装饰、背面或不可见结构");
    expect(prompt).toContain("有效透明 alpha 背景");
    expect(prompt).toContain("薄软区域不能依靠隐形人体维持胸、腰、臀体积");
    expect(prompt).toContain("不臆加胸垫、胸杯、骨条或内撑");
    expect(prompt).toContain("按各区域的真实透射关系输出局部透明alpha");
    expect(prompt).toContain("禁止全图统一降低alpha");
    expect(prompt).toContain("不能把镜片空挖成没有材质的洞");
    expect(prompt).toContain(
      "不要人物、人台、衣架、挂钩、夹子、杆子或陈列道具",
    );
    expect(prompt).toContain("必须由设计师对照原始设计及材质参考复核");
    expect(prompt).not.toContain("保持草图表达");
  });
  it("明确侧图修正保持既有视角和局部透射，不重新转侧或写实化", () => {
    const prompt = preparationPrompt(
      {
        requestKey: "side-repair",
        sourceAssetId: "failed-side",
        name: "半透眼镜",
        category: "accessory",
        sourceKind: "isolated",
        mode: "extract",
        referenceAssetIds: [],
        presentation: {
          view: "side",
          revisionId: "front",
          orientation: "left",
          repairPreparationId: "original-side-prep",
        },
        notes: "只修正镜片半透明alpha，镜框保持原样。",
      },
      "shelf",
    );
    expect(prompt).toContain("唯一参考图就是现有侧图");
    expect(prompt).toContain("不重新生成或转动视角");
    expect(prompt).toContain("局部透明alpha");
    expect(prompt).toContain("不能作为新的正面素材发布");
    expect(prompt).toContain("只修正镜片半透明alpha");
    expect(prompt).not.toContain("25–35度");
    expect(prompt).not.toContain("接近90度");
    expect(prompt).not.toContain("照片级独立服装陈列候选");
  });
  it("草图提取继续保持草图表达，不暗中启用写实转换", () => {
    const prompt = preparationPrompt({
      requestKey: "sketch-extract",
      sourceAssetId: "sketch",
      name: "印花短袖",
      category: "top",
      sourceKind: "sketch",
      mode: "extract",
    });
    expect(prompt).toContain("不要自动写实化草图");
    expect(prompt).toContain("保持草图表达，不添加没有依据的材质和厚度");
    expect(prompt).not.toContain("照片级独立服装陈列候选");
  });
  it("非草图补全不启用草图写实转换提示", () => {
    for (const sourceKind of ["isolated", "worn", "outfit"] as const) {
      const prompt = preparationPrompt({
        requestKey: `complete-${sourceKind}`,
        sourceAssetId: "source",
        name: "外套",
        category: "outerwear",
        sourceKind,
        mode: "complete",
      });
      expect(prompt).toContain("用户已明确选择生成补全候选");
      expect(prompt).not.toContain("照片级独立服装陈列候选");
    }
  });
});
