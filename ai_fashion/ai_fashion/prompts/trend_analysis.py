"""
prompts/trend_analysis.py — LLM Prompt 模板
多模态版（图文混合）+ 纯文本降级版
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from models import ImageInputMode, LLMArticleInput


# ─────────────────────────────────────────────
# 系统 Prompt
# ─────────────────────────────────────────────

MULTIMODAL_SYSTEM_PROMPT = """
你是一名资深时尚趋势分析师，擅长从多源素材中提取可落地的趋势情报，服务买手、产品与内容团队。

你将收到来自多个时尚情报源的近期文章（含配图）。请基于**可核验的原文与图片**进行综合归纳；禁止凭常识编造材料中未出现的事实。

【方法论】
1. **交叉验证**：多篇来源指向同一方向时，可提高结论置信度；若仅单篇提及，须在描述中点明「单源观察」并适度降低 confidence。
2. **证据优先**：每条 key_trends 的 supporting_evidence 须能回溯到具体文章标题与原文片段（snippet）。
3. **推断边界**：区分「材料直接陈述」与「合理行业推断」；后者在文字中简要标明（如「据图文推断」）。
4. **商业与设计启示**：每条关键趋势的 description 中，在充分依据前提下用 1 句点明对 **零售/陈列/波段/品类侧重** 的启示；依据不足则省略，勿空话。
5. **材料局限**：若样本量少、站点单一或日期跨度大，在 summary 末句用一句话说明**分析局限**。
6. **具体化表达**：禁止只写“更年轻化 / 更实穿 / 更松弛 / 更高级”这类抽象判断；必须交代这种变化具体体现在哪些颜色、面料、单品、廓形、搭配或品牌表述上。
7. **变化关系**：优先描述“正在变多的东西、正在变少的东西、正在被替代的东西、重新回潮的东西”，不要只罗列名词。
8. **场景化**：当证据足够时，说明趋势更适合的穿着场景、人群心态或消费语境，例如通勤、度假、节日、礼服、日常轻奢、收藏展示等。

【分析维度要求】
请明确区分并分析以下维度：
1. 色彩趋势（colors）：流行色、色调组合、色彩故事
2. 面料趋势（fabrics）：材质工艺、质感方向、可持续材料
3. 单品趋势（items）：流行单品类型与款式方向
4. 廓形趋势（silhouettes）：版型、比例、结构特征
5. 图案趋势（patterns）：印花、纹样、装饰手法
6. 风格关键词（style_keywords）：整体风格标签
7. 消费者信号（consumer_signals）：购买行为、情绪诉求、社媒热点

【四大核心板块详细分析（重点）】
除上述维度外，必须输出以下四大板块的深度分析：
- style_details（款式板块）：当季最受关注的整体款式风格，每个款式单独描述
- item_details（单品板块）：具体流行单品，每个单品单独描述
- silhouette_details（版型板块）：流行版型/廓形，每个版型单独描述
- color_details（颜色板块）：流行色彩，每个颜色单独描述，含色彩哲学与搭配建议

【详细程度下限】
1. summary 必须写成 4~6 句，至少覆盖：样本来源、核心风格方向、正在强化的设计语言、商业含义、局限说明。
2. key_trends 至少输出 6 条；若材料足够，不设上限。每条 description 至少写 3 句，优先按以下顺序组织：
   - 第 1 句：这是什么趋势，以及它在本批文章中的具体表现。
   - 第 2 句：哪些颜色/面料/单品/廓形/图案共同支撑了它。
   - 第 3 句：它对应的消费情绪、穿着场景或商业机会。
3. style_details / item_details / silhouette_details / color_details 每个条目的 description 至少 3 句，不能只写概述，要说明“视觉特征 + 搭配关系 + 适用场景/商业含义”。
4. 若原文出现品牌名、系列名、秀场主题、工艺名称、官方色名、年代风格指向，请优先保留，不要泛化。
5. 不要把不同层级混写：例如把“黄油白”写成款式，或把“宽肩收腰”写成颜色。

【输出要求】
- 必须且只能输出 JSON，不要输出任何 markdown 或说明文字
- 必须基于提供的文章内容进行归纳
- 每条趋势必须有对应的证据支撑（site_name + article_title + snippet）
- 置信度（confidence）0.0~1.0：多源一致、证据具体则高；单源、推断为主或材料含糊则低
- JSON 结构必须严格符合以下 Schema
"""

TEXT_ONLY_SYSTEM_PROMPT = """
你是一名资深时尚趋势分析师，擅长从多源文本中提取可落地的趋势情报，服务买手、产品与内容团队。

你将收到来自多个时尚情报源的近期文章（纯文本，部分含图片 URL 元数据），请基于**可核验的原文**归纳；禁止编造材料中未出现的信息。

【方法论】
1. **交叉验证**：多篇文章指向同一方向时提高置信度；仅单篇提及时注明「单源」并降低 confidence。
2. **证据优先**：supporting_evidence 须能对应到具体文章与片段。
3. **推断边界**：区分直接陈述与合理推断；推断须简短标注。
4. **商业启示**：在关键趋势 description 中有依据时，用 1 句点明零售/品类启示；无依据则省略。
5. **材料局限**：样本不足时在 summary 末句说明局限。
6. **具体化表达**：避免空泛评价，必须落到具体颜色、材质、单品、比例、装饰、品牌话术或场景。
7. **变化方向**：尽量说明哪些元素正在增强、回归、延伸或被替代，而不是只做静态罗列。

【分析维度要求】
1. 色彩趋势（colors）2. 面料（fabrics）3. 单品（items）4. 廓形（silhouettes）
5. 图案（patterns）6. 风格关键词（style_keywords）7. 消费者信号（consumer_signals）

【四大核心板块】
- style_details / item_details / silhouette_details / color_details（要求同多模态版，每板块 2~4 条）

【详细程度下限】
1. summary 必须写成 4~6 句，至少说明来源范围、核心风格主线、最明确的趋势强化点、消费/商业启示、局限。
2. key_trends 至少输出 6 条；若证据足够，不设上限。每条 description 至少 3 句，写清楚“趋势定义 + 证据组合 + 场景或商业含义”。
3. 四大核心板块中每条 description 至少 3 句，并优先保留品牌、系列、工艺、配色关系等具体名词。
4. evidence 和 supporting_evidence 优先覆盖不同文章，不要反复引用同一条片段。

【输出要求】
- 必须且只能输出 JSON，不要输出 markdown 或说明文字
- 每条趋势须有证据（site_name + article_title + snippet）
- 置信度（confidence）0.0~1.0，与证据强度一致
"""

# JSON Schema（提示模型参考用，实际约束在 Pydantic 侧）
JSON_SCHEMA_HINT = """
输出 JSON 格式如下（请严格遵守）：
{
  "report_date": "YYYY-MM-DD",
  "time_range": "YYYY-MM-DD ~ YYYY-MM-DD",
  "summary": "整体趋势摘要（4-6句，需包含来源范围、核心风格方向、强化中的设计语言、商业启示、局限说明）",
  "key_trends": [
    {
      "name": "趋势名称",
      "category": "趋势类目（如：色彩 / 面料 / 单品 / 廓形 / 图案 / 风格叙事 / 零售与营销）",
      "description": "详细描述（至少3句：先定义趋势及其具体表现，再说明证据中的颜色/面料/单品/廓形组合，最后补充场景、人群心态或商业/设计启示；单源时注明）",
      "supporting_evidence": [
        {
          "site_name": "站点名",
          "article_title": "文章标题",
          "article_url": "文章URL",
          "snippet": "支撑片段（原文引用，≤150字）"
        }
      ],
      "related_colors": ["色彩1", "色彩2"],
      "related_fabrics": ["面料1"],
      "related_items": ["单品1"],
      "related_patterns": ["图案1"],
      "related_silhouettes": ["廓形1"],
      "confidence": 0.85,
      "selected_images": ["从该趋势相关文章的可用图片URL列表中直接复制1~3个URL"]
    }
  ],
  "colors": ["整体色彩趋势列表"],
  "fabrics": ["整体面料趋势列表"],
  "silhouettes": ["整体廓形趋势列表"],
  "items": ["整体单品趋势列表"],
  "patterns": ["整体图案趋势列表"],
  "style_keywords": ["风格关键词列表"],
  "consumer_signals": ["消费者信号列表"],
  "confidence": 0.8,
  "evidence": [
    {
      "site_name": "站点名",
      "article_title": "文章标题",
      "article_url": "URL",
      "snippet": "关键片段"
    }
  ],
  "style_details": [
    {
      "name": "款式名称（如：慵懒西装风）",
      "description": "该款式的详细分析，至少3句，包括视觉特征、关键搭配关系、适用场合/受众群体/商业含义",
      "trend_direction": "上升/稳定/新兴 三选一",
      "representative_brands": ["品牌1", "品牌2"],
      "style_tips": ["搭配建议1", "搭配建议2"],
      "selected_images": ["从文章图片URL列表直接复制1~2个最能体现该款式的URL"],
      "confidence": 0.85
    }
  ],
  "item_details": [
    {
      "name": "单品名称（如：乐福鞋）",
      "description": "该单品的流行原因、设计特征、材质工艺、穿搭方式，至少3句，尽量保留具体材质/细节/搭配对象",
      "trend_direction": "上升/稳定/新兴 三选一",
      "representative_brands": ["品牌1"],
      "style_tips": ["穿搭建议1", "穿搭建议2"],
      "selected_images": ["从文章图片URL列表直接复制1~2个URL"],
      "confidence": 0.88
    }
  ],
  "silhouette_details": [
    {
      "name": "版型名称（如：宽松直筒廓形）",
      "description": "该版型的结构特征、比例关系、视觉效果、适合体型，至少3句，并说明它与哪些单品或风格最常一起出现",
      "trend_direction": "上升/稳定/新兴 三选一",
      "representative_brands": [],
      "style_tips": ["版型搭配建议1"],
      "selected_images": ["从文章图片URL列表直接复制1~2个URL"],
      "confidence": 0.82
    }
  ],
  "color_details": [
    {
      "name": "颜色名称（如：云舞白）",
      "description": "该颜色的色彩哲学、情感联想、流行背景、与其他颜色的搭配，至少3句，并尽量说明它更常出现在哪些单品/面料上",
      "trend_direction": "上升/稳定/新兴 三选一",
      "representative_brands": [],
      "style_tips": ["配色建议1", "配色建议2"],
      "selected_images": ["从文章图片URL列表直接复制1~2个URL"],
      "confidence": 0.90
    }
  ]
}

【selected_images 填写规则】
- 必须从文章的【可用图片URL列表】中直接复制URL，不得伪造或修改URL
- 每个条目挑选1~2张，优先选择：商品特写图、穿搭图、色彩/面料细节图
- 若无合适图片，则填写空数组 []
- style_details/item_details/silhouette_details/color_details 各板块至少输出2~4个条目

【description 中的配图标记（可选）】
- 当你认为某段 description 需要配图辅助说明时，可在描述文字的末尾插入：
  {{IMAGE: <英文搜索关键词> | <图片用途说明> | 段后}}
- 关键词需精准描述图片内容，优先使用英文以提升搜索质量
- 示例：{{IMAGE: minimalist beige fashion editorial 2025 | 展示本段极简主义色调趋势 | 段后}}
- 每篇报告中此标记总数控制在 3-6 个，仅在最有表现力的段落使用，避免堆砌
- 这些标记会被前端替换为实际图片，不会直接展示给用户
"""


def build_batch_context_block(
    articles: list[LLMArticleInput],
    *,
    season_scope_zh: str = "",
) -> str:
    """
    将批次级元信息注入模型，便于对齐 time_range、summary 叙事与置信度自检。
    season_scope_zh：本批系统归类的服装季节（如「2025 春夏」），模型应围绕该波段归纳。
    """
    dates = [a.published_at for a in articles if a.published_at]
    if dates:
        mn, mx = min(dates), max(dates)
        span = f"{mn.strftime('%Y-%m-%d')} ~ {mx.strftime('%Y-%m-%d')}"
        single_day = mn.date() == mx.date()
    else:
        span = "（多篇缺失发布日期，请据正文推断或采用分析当日）"
        single_day = False
    sites = sorted({a.site_name for a in articles if getattr(a, "site_name", "")})
    site_line = "、".join(sites) if sites else "—"
    n = len(articles)
    hint = ""
    if single_day:
        hint = "- 提示：素材集中在同一自然日，time_range 可写该日。\n"
    season_block = ""
    if season_scope_zh.strip():
        season_block = (
            f"- **本批服装季节归类**：{season_scope_zh.strip()}\n"
            "- 请围绕该季节/年份波段归纳趋势；若材料中出现明显反季大秀，仅在原文明确提及时简要涉及，避免喧宾夺主。\n"
        )
    return (
        "\n【本批次素材上下文】\n"
        f"- 文章篇数：{n}\n"
        f"- 来源站点：{site_line}\n"
        f"- 发布时间跨度：{span}\n"
        f"{season_block}"
        f"{hint}"
        "请将 time_range 与上述跨度对齐；summary 首句可概括来源与时间范围。\n"
    )


# ─────────────────────────────────────────────
# 构建文章文本块
# ─────────────────────────────────────────────

def _format_article_text(art: LLMArticleInput, idx: int) -> str:
    """格式化单篇文章为结构化文本，供 prompt 使用"""
    tags_str = ", ".join(art.tags) if art.tags else "无"
    pub_str = art.published_at.strftime("%Y-%m-%d") if art.published_at else "未知"

    # 收集该文章的可用图片 URL
    img_urls = [img.original_url for img in art.images if img.original_url]
    if img_urls:
        img_lines = "\n".join(f"  [{i+1}] {url}" for i, url in enumerate(img_urls))
        img_block = f"可用图片URL列表（共{len(img_urls)}张，可在 selected_images 中引用）：\n{img_lines}\n"
    else:
        img_block = "可用图片URL列表：（无）\n"

    return (
        f"【文章 {idx}】\n"
        f"来源站点：{art.site_name}\n"
        f"标题：{art.title}\n"
        f"分类：{art.category or '未知'}\n"
        f"标签：{tags_str}\n"
        f"发布日期：{pub_str}\n"
        f"URL：{art.article_url}\n"
        f"{img_block}"
        f"内容摘要：\n{art.content}\n"
    )


# ─────────────────────────────────────────────
# 多模态 Messages 构建
# ─────────────────────────────────────────────

def build_multimodal_messages(
    articles: list[LLMArticleInput],
    batch_context: str = "",
) -> list[dict]:
    """
    构建多模态 LLM messages（支持 OpenAI / Anthropic 格式）。
    文字内容与图片交替排列，每篇文章附带其代表图片。
    前若干张图使用较高 detail，便于色彩/面料细节判读（兼容 API 时由网关忽略未知字段）。
    """
    content_parts: list[dict[str, Any]] = []

    # 系统指令 + Schema 说明
    content_parts.append({
        "type": "text",
        "text": MULTIMODAL_SYSTEM_PROMPT + "\n" + JSON_SCHEMA_HINT,
    })

    content_parts.append({
        "type": "text",
        "text": f"\n以下是来自 {len(articles)} 篇时尚趋势文章的内容与图片，请综合分析：\n",
    })

    global_img_i = 0
    for i, art in enumerate(articles, 1):
        # 文章文本
        content_parts.append({
            "type": "text",
            "text": _format_article_text(art, i),
        })

        # 文章图片（批次内前 3 张略提高 detail，利于趋势判读）
        for img in art.images:
            if not img.original_url and not img.local_path:
                continue
            try:
                vis_detail = "high" if global_img_i < 3 else "low"
                global_img_i += 1
                # Base64 模式
                if img.content_hash and img.content_hash.startswith("data:"):
                    content_parts.append({
                        "type": "image_url",
                        "image_url": {"url": img.content_hash, "detail": vis_detail},
                    })
                # URL 模式
                elif img.original_url:
                    content_parts.append({
                        "type": "image_url",
                        "image_url": {"url": img.original_url, "detail": vis_detail},
                    })
            except Exception:
                pass

    closing = (batch_context or "") + (
        "\n请基于以上所有文章内容与图片，严格按照 JSON Schema 输出趋势分析报告，只输出 JSON："
    )
    content_parts.append({
        "type": "text",
        "text": closing,
    })

    return [
        {"role": "system", "content": MULTIMODAL_SYSTEM_PROMPT},
        {"role": "user", "content": content_parts},
    ]


# ─────────────────────────────────────────────
# 纯文本 Messages 构建（降级版）
# ─────────────────────────────────────────────

def build_text_only_messages(
    articles: list[LLMArticleInput],
    batch_context: str = "",
) -> list[dict]:
    """
    纯文本模式 messages（当模型不支持视觉时使用）。
    图片信息以文字描述形式包含在内容中。
    """
    article_texts = "\n\n" + "=" * 40 + "\n\n".join(
        _format_article_text(art, i) for i, art in enumerate(articles, 1)
    )

    user_content = (
        f"以下是来自 {len(articles)} 篇时尚趋势文章的内容，请综合分析：\n\n"
        + (batch_context or "")
        + article_texts
        + "\n\n"
        + JSON_SCHEMA_HINT
        + "\n请严格按照上述 JSON Schema 输出，只输出 JSON，不要有任何额外说明："
    )

    return [
        {"role": "system", "content": TEXT_ONLY_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


# ─────────────────────────────────────────────
# 分块摘要 Prompt
# ─────────────────────────────────────────────

def build_summary_prompt(
    title: str,
    chunk: str,
    chunk_idx: int,
    total_chunks: int,
) -> str:
    """
    单篇文章分块摘要 prompt。
    用于文章过长时，先分块摘要，再聚合分析。
    """
    return (
        f"以下是文章《{title}》的第 {chunk_idx}/{total_chunks} 部分内容，"
        f"请提炼其中与时尚趋势相关的关键信息（色彩、面料、单品、廓形、图案、风格、零售信号），"
        f"保留可检索的实体名（品牌、官方色名、系列名、面料名），"
        f"优先保留原文里的具体细节、对比关系、限定词与数据，"
        f"尤其是“什么元素正在增强/回归/变化、出现在哪些单品或造型里、对应哪些场景或人群”。"
        f"输出 250~500 字摘要，不要空泛结论，不要遗漏可直接支撑趋势判断的原句片段：\n\n"
        f"{chunk}"
    )
