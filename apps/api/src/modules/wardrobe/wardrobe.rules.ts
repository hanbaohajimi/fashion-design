import { BadRequestException } from "@nestjs/common";
import {
  WARDROBE_CATEGORIES,
  type OutfitSnapshotItem,
  type WardrobeCapabilities,
  type WardrobePrepareInput,
  type WardrobeDisplay,
} from "@fashion/shared";

export function wardrobeCapabilities(
  env: Record<string, string | undefined> = process.env,
): WardrobeCapabilities {
  const configured = Boolean(env.AMUX_API_KEY?.trim());
  return {
    enabled: env.WARDROBE_ENABLED !== "false",
    preparationEnabled:
      configured && env.WARDROBE_PREPARATION_ENABLED === "true",
    staticTryOnEnabled:
      configured && env.WARDROBE_STATIC_TRYON_ENABLED === "true",
    ...(!configured
      ? {
          generationUnavailableReason:
            "图片生成服务尚未配置；已有透明单品仍可整理和搭配",
        }
      : {}),
    realtimeOutfitEnabled: env.WARDROBE_REALTIME_OUTFIT_ENABLED === "true",
    realtimeMultiItemVerified:
      env.WARDROBE_REALTIME_MULTI_ITEM_VERIFIED === "true",
    realtimeCategories: WARDROBE_CATEGORIES.filter((category) =>
      (env.WARDROBE_REALTIME_CATEGORIES ?? "top")
        .split(",")
        .map((value) => value.trim())
        .includes(category),
    ),
  };
}

export function assertOutfitItems(
  items: Pick<OutfitSnapshotItem, "itemId" | "category" | "layer">[],
  layeringConfirmed = false,
): void {
  if (new Set(items.map((item) => item.itemId)).size !== items.length)
    throw new BadRequestException("同一单品只能选择一个修订");
  const singleton = [
    "top",
    "outerwear",
    "bottom",
    "onepiece",
    "shoes",
    "bag",
    "hat",
    "scarf",
    "belt",
  ];
  for (const category of singleton) {
    const group = items.filter((item) => item.category === category);
    if (
      group.length > 1 &&
      (!layeringConfirmed ||
        new Set(group.map((item) => item.layer)).size !== group.length)
    )
      throw new BadRequestException(
        "同一穿着位置需要明确确认叠穿并设置不同层级，或替换原选择",
      );
  }
  if (
    items.some((item) => item.category === "onepiece") &&
    items.some((item) => item.category === "top" || item.category === "bottom")
  ) {
    const onepieces = items.filter((item) => item.category === "onepiece");
    if (
      !layeringConfirmed ||
      items.some(
        (item) =>
          ["top", "bottom"].includes(item.category) &&
          onepieces.some((onepiece) => onepiece.layer === item.layer),
      )
    )
      throw new BadRequestException(
        "连体单品与分体组合需要明确确认叠穿并设置不同层级",
      );
  }
}

const TRANSPARENT_MATERIAL_POLICY =
  "若原设计明确存在透明镜片、薄网纱或透孔蕾丝，必须按各区域的真实透射关系输出局部透明alpha：透明镜片保留淡色透射、厚度边缘和必要反光，网纱保留细纱线而网眼可透出任意底色；不能用烘焙白色、黑色或实心色块模拟透明。缝线、织纹、镜框、实体内衬和不透光区域保持原有不透明度；禁止全图统一降低alpha，也不能把镜片空挖成没有材质的洞。未给出透明材质的部位不要自行变透明。";

const GRAVITY_SUPPORT_POLICY =
  "服装必须遵循所给材质和实际承重点的重力形态；薄软区域不能依靠隐形人体维持胸、腰、臀体积。仅当原图和材料明确有内撑结构时保留对应硬挺形态，不臆加胸垫、胸杯、骨条或内撑；无内撑的软料自然塌垂，不能生成幽灵人台。";

export function preparationPrompt(
  input: WardrobePrepareInput,
  display?: WardrobeDisplay,
): string {
  if (
    input.presentation?.view === "side" &&
    input.presentation.repairPreparationId
  ) {
    return [
      `仅按本次明确说明修正已有的 ${input.category}「${input.name}」侧视陈列候选。唯一参考图就是现有侧图，不是正面，不重新生成或转动视角。`,
      "修正说明明确指出的错误优先于保留要求：若要求纠正无支撑的人体撑形，必须改变该处错误轮廓和褶皱；若要求纠正多余缝线，必须移除该处错误结构。除此指定区域外，保留现有画布、位置、尺寸、朝向、透视、轮廓、结构、颜色、图案和已成立的材质细节；不补造未知结构，不将整件重新设计或重新写实化。",
      TRANSPARENT_MATERIAL_POLICY,
      "输出真实透明背景PNG，背景透明不等于把整个单品降低不透明度。实体部位保持完整，必要细边、反光和纱线仍有材质，不烘焙底色或棋盘格。不得新增人物、人台、衣架、挂钩、夹子、杆子或其他展示道具。",
      "该结果仍属于原侧视候选的生成修正，继承已验证的正面绑定；需独立复核后才能替换侧视展示，不能作为新的正面素材发布。",
      input.notes ?? "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (input.presentation?.view === "side") {
    const orientation = input.presentation.orientation === "left" ? "左" : "右";
    const view =
      display === "shelf"
        ? `相对参考朝${orientation}轻转约25–35度，采用真实三分之四视角，保留鞋、帽或配饰的完整底部承托与自然体积；不是肩挂，也不强行变成极窄侧面。`
        : display === "hook"
          ? `按原有提手、挂环或折弯受力关系朝${orientation}作自然轻微侧转，保留本来的折叠和悬垂；不强制压成近90度薄片，不新增承重部件。`
          : `相对正面朝${orientation}转接近90度，采用近乎纯侧面的窄轮廓，正面主体几乎不可见，不要三分之四视角。原设计如有袖筒，两袖沿衣身前后重叠自然下垂，而不是左右摊开。`;
    return [
      `根据已确认的正面单品参考生成同一件 ${input.category}「${input.name}」的真实摄影侧视陈列候选。${view}相机水平、无夸张透视，不把图像简单压窄。`,
      input.referenceAssetIds?.length
        ? "第一张已确认正面图是颜色、材质、结构与图案的唯一设计依据。第二张仅为侧挂姿态参考，后续参考亦仅提供陈列视角与受力姿态；仅采用与已确认挂具承重方式相符的姿态，不能违反本任务指定视角。不复制第二张的款式、颜色、图案、材质、挂具、人物或背景，后续参考亦同。不要把参考图拼贴进结果。"
        : "",
      display === "shelf"
        ? "单品保持底部自然承托的立体形态，不悬空，不是把正面图片压扁或透视变形；呈现有依据的开口、边缘厚度和材质细节。"
        : "服装保持自然重力悬挂的立体形态，不是平铺，也不是把正面图片压扁或透视变形；呈现有依据的袖筒、开口厚度、织物折叠与自然垂坠。",
      display
        ? {
            hanger:
              "以双肩为承重点呈现自然悬挂，领肩完整、袖筒下垂；只表现承重后的形态，衣架本身不可见。",
            clips:
              "以腰头或已确认可夹持的上缘为承重点，裤腿或裙褶受重力向下；不得新增肩带迁就肩架，夹子本身不可见。若原图为双腿等长的长裤，两条裤腿都从腰部自然垂到相近的脚口高度，只允许合理的小幅透视差；不能把一条腿截到膝部、折挂成半长或套用上衣长袖与短衣身的比例。",
            hook: "按单品本身真实存在的提手、挂环或可承重部位自然垂挂，保留原有部件；不得凭空添加提手、挂环，挂钩本身不可见。",
            shelf:
              "保持单品底部承托下的自然立体形态，鞋底、包底等实际接触部位落在同一支撑平面；托架与地面本身不可见，不画投地阴影。",
          }[display]
        : "",
      "严格保留参考中已知的材质、颜色、轮廓、领袖门襟、缝线和图案内容与位置，不另行设计，不增加装饰或品牌。不要自编背面款式或声称未知结构已被还原；视角新增的不可见区域属于需人工核对的生成推断。",
      "对正面有依据的绗缝、分片或重复装饰，逐部位保留其数量与相对位置；衣身与袖子分别核对，转向不会增加一段填充或一道横缝。不能把无依据的背部细节当作已知结构。",
      GRAVITY_SUPPORT_POLICY,
      "保持正面参考中微观纹理的尺度、频率和对比度；细羊毛短绒、细密针织或平滑缎面不能扩大成迷宫、曲折线、粗花纹或新增印花，不以夸张表面图案冒充材质细节。",
      TRANSPARENT_MATERIAL_POLICY,
      "输出透明背景PNG及有效alpha，无人物、人台、手、衣架、挂钩、杆子、夹子、地面或其他陈列道具；挂具不能烘焙进图片。完整保留可见主体，无新增文字、水印或假透明棋盘格。",
      "这是独立侧视陈列候选，必须与已确认正面逐项核对后才可采用；不能替换正面试穿素材。",
      input.notes ?? "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const renderSketch =
    input.sourceKind === "sketch" && input.mode === "complete";
  return [
    `整理参考图中的一件 ${input.category} 单品：${input.name}。输出透明背景 PNG，只保留这一件单品，不要人物、衣架、${renderSketch ? "新增说明文字" : "文字"}或拼贴。`,
    "保留原设计可见的廓形、颜色、纹理、图案位置、领口、袖口、闭合方式与比例，不改款。",
    input.mode === "complete"
      ? "用户已明确选择生成补全候选。缺失区域以附加参考为优先依据，输出仍需设计师复核，不能声称还原了未知结构。"
      : "只提取有图像依据的可见结构；被遮挡、缺失或图外的部分不要臆造，不要自动写实化草图。",
    input.sourceKind === "sketch" && input.mode !== "complete"
      ? "保持草图表达，不添加没有依据的材质和厚度。"
      : "",
    renderSketch
      ? "将已给草图转换为照片级独立服装陈列候选，表现真实织物表面、缝线及自然褶皱与垂坠，不保留线稿或插画表达。材质表现以原图和附加参考为依据；不要自行指定未提供的纤维、特殊织法、反光效果或工艺。"
      : "",
    renderSketch
      ? "只转换呈现方式，严格保留已给廓形与比例、衣领、衣袖、袖口、门襟与闭合结构、颜色，以及原有印花（含文字）的内容、尺度与位置。不要自编款式、品牌、装饰、背面或不可见结构；只呈现参考有依据的视角，不能声称还原未知部分。"
      : "",
    renderSketch
      ? GRAVITY_SUPPORT_POLICY
      : "",
    TRANSPARENT_MATERIAL_POLICY,
    renderSketch
      ? "输出有效透明 alpha 背景、干净完整的可见服装轮廓，不要背景色块、假透明棋盘格或投地阴影。不要人物、人台、衣架、挂钩、夹子、杆子或陈列道具，不能把挂具烘焙进服装图片。结果属于生成转换候选，必须由设计师对照原始设计及材质参考复核后使用。"
      : "",
    input.notes ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function outfitPrompt(
  items: Pick<OutfitSnapshotItem, "name" | "category" | "layer" | "wearNote">[],
): string {
  return [
    "模特试穿：第一张参考是原始模特，后续参考按下列顺序分别为独立单品。保留模特身份、姿势、镜头、身体比例、背景和未指定改变的穿着。",
    "把以下全部单品穿戴在同一位模特身上；使用所给单品，不另行设计、不添加替代款，不绘制参考拼图或文字。保留颜色、图案位置、结构、材质视觉特征。层级数值越大越靠外。",
    ...items.map(
      (item, index) =>
        `参考 ${index + 2}：${item.name}；类别 ${item.category}；层级 ${item.layer}；${item.wearNote}`,
    ),
  ].join("\n");
}
