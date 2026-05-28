"""
processor.py — 图文预处理模块
- 文章文本清洗、去重、分块
- 趋势分析文章选取：「质量」= 对时尚趋势分析是否有帮助（语义相关度优先，证据丰富度次之）
- 图片选择策略（代表图筛选）
- 构建 LLM 输入批次（处理上下文超限）
- OCR 降级支持
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger

from config import settings
from models import (
    Article,
    ImageInputMode,
    ImageItem,
    LLMArticleInput,
    LLMBatchInput,
)
from utils import chunk_text, image_to_base64, now_str, url_hash


# ─────────────────────────────────────────────
# 文章去重
# ─────────────────────────────────────────────

def deduplicate_articles(articles: list[Article], existing_keys: set[str]) -> list[Article]:
    """
    去重策略：
    1. 同批次内按 unique_key（url+title hash）去重
    2. 与数据库中已存在的 unique_key 去重
    3. 同批次内按标题去重（防止同一文章通过不同 URL 重复抓取）
    """
    seen_keys: set[str] = set(existing_keys)
    seen_titles: set[str] = set()
    result: list[Article] = []

    for art in articles:
        if not art.unique_key:
            art.generate_unique_key()  # type: ignore[attr-defined]
        if art.unique_key in seen_keys:
            logger.debug("Duplicate article skipped (key): {} [{}]", art.title, art.unique_key)
            continue
        # 标题级去重：同一批次内相同标题只保留第一条
        title_key = art.title.strip().lower()
        if title_key and title_key in seen_titles:
            logger.debug("Duplicate article skipped (title): {}", art.title)
            continue
        seen_keys.add(art.unique_key)
        if title_key:
            seen_titles.add(title_key)
        result.append(art)

    removed = len(articles) - len(result)
    if removed:
        logger.info("Deduplication: removed {} duplicates, kept {}", removed, len(result))
    return result


# ─────────────────────────────────────────────
# 趋势分析：按「对时尚分析的帮助度」选取
# ─────────────────────────────────────────────

# 标题命中即视为非正文（法律页、订阅、错误页等），不参与趋势分析
_TITLE_BLOCKLIST_SUBSTRINGS: tuple[str, ...] = (
    "404", "403", "not found", "page not found", "access denied",
    "cookie policy", "privacy policy", "terms of use", "terms of service",
    "subscribe", "newsletter", "sign up", "log in", "login",
    "privacy", "legal notice",
    "隐私", "服务条款", "使用条款", "订阅", "邮件列表",
    "页面不存在", "无法访问", "验证码",
)

# 与时尚趋势分析相关的词与短语（中英）：命中越多，越可能提供可归纳的趋势证据
_TREND_LEXEMES_EN: frozenset[str] = frozenset({
    "fashion", "runway", "catwalk", "couture",
    "ready-to-wear", "ready to wear", "lookbook", "collection", "seasonal",
    "designer", "designers", "vogue", "elle", "bazaar", "wardrobe", "garment", "apparel",
    "silhouette", "silhouettes", "tailoring", "tailored", "outerwear", "knitwear", "denim",
    "footwear", "sneaker", "sneakers", "handbag", "textile", "fabric", "material",
    "print", "pattern", "motif", "palette", "colorway",
    "streetwear", "street style", "menswear", "womenswear", "unisex",
    "luxury", "luxe", "premium", "haute", "merchandising", "buyer", "buying",
    "trend", "trending", "forecast", "style", "aesthetic",
    "sustainable", "upcycle", "capsule", "collab", "collaboration",
    "campaign", "editorial", "showroom", "presentation", "debut", "launch",
    "retail", "flagship", "pop-up", "stylist",
    "spring summer", "fall winter", "autumn winter", "resort", "cruise", "pre-fall",
    "fashion week", "met gala",
})

_TREND_LEXEMES_ZH: frozenset[str] = frozenset({
    "时尚", "趋势", "流行", "秀场", "走秀", "大秀", "时装周", "成衣", "高定", "高级定制",
    "穿搭", "造型", "设计师", "联名", "限定", "系列", "新一季", "春夏", "秋冬", "早春", "度假",
    "面料", "廓形", "剪裁", "色彩", "色调", "配色", "印花", "纹样", "纹理",
    "单品", "鞋履", "手袋", "包袋", "针织", "牛仔", "外套", "西装",
    "买手", "零售", "陈列", "波段", "奢侈品", "潮牌", "街头", "运动休闲",
    "可持续", "环保时尚", "发布会", "大片", "型录", "编辑", "时装编辑",
})

# 季节 / 时装周 / 系列代号等强信号（对趋势分析帮助大）
_FASHION_CONTEXT_PATTERNS: tuple[tuple[re.Pattern[str], int], ...] = (
    (re.compile(r"\b(ss|fw|aw|resort)\s*['']?\s*20\d{2}\b", re.I), 10),
    (re.compile(r"\b20\d{2}\s*[-/]\s*(ss|fw|aw)\b", re.I), 10),
    (re.compile(r"\b(milan|paris|london|new\s*york|shanghai|copenhagen)\s+fashion\s+week\b", re.I), 12),
    (re.compile(r"\bfashion\s+week\b", re.I), 8),
    (re.compile(r"\b(spring|summer|fall|autumn|winter)\s+20\d{2}\s+(collection|show)\b", re.I), 8),
)

# 显式「趋势」向中文短语（比泛时尚词更贴近趋势归纳任务）
_ZH_FASHION_TREND_PHRASES: tuple[str, ...] = (
    "时尚趋势", "流行趋势", "潮流趋势", "趋势解读", "趋势预测", "趋势分析", "趋势报告",
    "本季趋势", "色彩趋势", "面料趋势", "廓形趋势", "单品趋势", "穿搭趋势", "秀场趋势",
    "设计趋势", "风格趋势", "消费趋势", "零售趋势", "宏观趋势", "下一季",
)

# 英文趋势向短语（小写比对）
_EN_FASHION_TREND_PHRASES: tuple[str, ...] = (
    " fashion trend", " fashion trends", " key trends", " key trend", " major trends",
    " trend forecast", " trend forecasting", " trend report", " trend analysis",
    " trend direction", " trends for ", " trends in ", " trends to ",
    "macro trend", " megatrend", " microtrend",
)

_TREND_EN_WORD = re.compile(r"\b(trend|trends|trending)\b", re.I)

# 季节词汇 / 季次写法：季节向稿件通常对应波段与方向，视为含趋势可用信号
_SEASON_MARKERS_ZH: tuple[str, ...] = (
    "春夏", "秋冬", "早春", "初秋", "盛夏", "深冬", "隆冬", "暮春", "入夏", "入秋", "入冬",
    "春装", "夏装", "秋装", "冬装", "春款", "夏款", "秋款", "冬款",
    "春季", "夏季", "秋季", "冬季",
    "换季", "当季", "本季", "新一季", "季初", "季末", "跨季", "季中",
)
_SEASON_MARKERS_EN_PHRASES: tuple[str, ...] = (
    "spring/summer", "fall/winter", "autumn/winter", "spring summer", "fall winter",
    "autumn winter", "pre-fall", "prefall", "resort collection", "cruise collection",
)
_SEASON_EN_YEAR = re.compile(
    r"\b(spring|summer|fall|autumn|winter)\s+20\d{2}\b",
    re.I,
)
_SEASON_CODES = re.compile(r"\b(ss|fw|aw|resort)\s*['']?\s*\d{2,4}\b", re.I)


def _text_contains_season_vocabulary(zh: str, lo: str) -> bool:
    """标题+正文是否出现季节向中文词、英文季次短语或 SS/FW 等代号。"""
    for m in _SEASON_MARKERS_ZH:
        if m in zh:
            return True
    for m in _SEASON_MARKERS_EN_PHRASES:
        if m in lo:
            return True
    if _SEASON_EN_YEAR.search(lo):
        return True
    if _SEASON_CODES.search(lo):
        return True
    return False


def _naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _published_days_ago(published_at: Optional[datetime]) -> Optional[int]:
    if published_at is None:
        return None
    delta = datetime.utcnow() - _naive_utc(published_at)
    return max(0, delta.days)


def _title_blocked(title: str) -> bool:
    t = title.strip().lower()
    if not t:
        return True
    return any(s in t for s in _TITLE_BLOCKLIST_SUBSTRINGS)


def _phrase_hit_title_body(title: str, body_s: str, phrase: str) -> tuple[bool, bool]:
    """返回 (标题是否命中, 正文片段是否命中)。中文短语按原文匹配，英文按小写子串。"""
    if any("\u4e00" <= c <= "\u9fff" for c in phrase):
        return (phrase in title), (phrase in body_s)
    pl = phrase.lower()
    return (pl in title.lower()), (pl in body_s.lower())


def _lexeme_fashion_relevance_raw(title: str, body_s: str) -> int:
    """词表命中分（上限约 48）：标题命中权重大于正文，鼓励「一眼时尚」的题源。"""
    score = 0
    for phrase in _TREND_LEXEMES_EN:
        in_t, in_b = _phrase_hit_title_body(title, body_s, phrase)
        if in_t and in_b:
            score += 10
        elif in_t:
            score += 8
        elif in_b:
            score += 5
    for phrase in _TREND_LEXEMES_ZH:
        in_t, in_b = _phrase_hit_title_body(title, body_s, phrase)
        if in_t and in_b:
            score += 11
        elif in_t:
            score += 9
        elif in_b:
            score += 5
    return min(48, score)


def _pattern_fashion_context_bonus(blob: str) -> int:
    """时装周 / 季次 / 城市大秀等强语境（约 0~18）。"""
    raw = 0
    for pat, pts in _FASHION_CONTEXT_PATTERNS:
        if pat.search(blob):
            raw += pts
    return min(18, raw)


def fashion_semantic_relevance_score(article: Article) -> int:
    """
    时尚语义相关度（约 0~60）：越高表示越像「可写进趋势报告证据」的时尚行业内容，
    而非泛资讯或站内导航。用于门槛与主排序键。
    """
    title = (article.title or "").strip()
    body = (article.content or "").strip()
    body_s = body[:14000]
    lex = _lexeme_fashion_relevance_raw(title, body_s)
    blob = f"{title}\n{body_s}"
    return min(60, lex + _pattern_fashion_context_bonus(blob))


def article_contains_fashion_trend_signal(article: Article, *, fashion_rel: int) -> bool:
    """
    是否包含「时尚趋势」向可用信息（用于剔除纯单品导购、纯品牌稿等难以做趋势归纳的素材）。

    满足其一即视为包含：
    - 标题/正文出现趋势向中英文短语，或英文 trend/trends/trending，或单字「趋势」；
    - 带季节词汇（中英季次、春夏/秋冬、SS/FW 代号等）；
    - 时装周 / 季次 / 大秀等语境加分 ≥8（通常论述当季方向）；
    - 时尚语义分已很高（≥30），视为强时尚编辑内容，默认可作趋势证据。
    """
    title = (article.title or "").strip()
    body_s = (article.content or "").strip()[:14000]
    zh = f"{title}\n{body_s}"
    lo = zh.lower()

    if _text_contains_season_vocabulary(zh, lo):
        return True

    for p in _ZH_FASHION_TREND_PHRASES:
        if p in zh:
            return True
    for p in _EN_FASHION_TREND_PHRASES:
        if p in lo:
            return True
    if "趋势" in zh:
        return True
    if _TREND_EN_WORD.search(lo):
        return True

    blob = f"{title}\n{body_s}"
    if _pattern_fashion_context_bonus(blob) >= 8:
        return True

    if fashion_rel >= 30:
        return True
    return False


def trend_evidence_richness_score(article: Article) -> int:
    """
    趋势证据丰富度（辅排序）：正文体量、摘要/标签、配图、时效——
    在语义已相关的前提下，材料越足对多模态/交叉验证越有帮助。
    """
    body = (article.content or "").strip()
    title = (article.title or "").strip()
    score = 0
    score += min(len(body) // 280, 10)
    sm = (article.summary or "").strip()
    if len(sm) >= 40:
        score += 8
    elif len(sm) >= 12:
        score += 4
    score += min(len(article.tags), 6) * 2
    if (article.category or "").strip():
        score += 5
    usable_imgs = sum(
        1
        for im in article.images
        if im.original_url and im.original_url.startswith(("http://", "https://"))
    )
    score += min(usable_imgs, 6) * 3
    days = _published_days_ago(article.published_at)
    if days is None:
        score += 3
    elif days <= 14:
        score += 12
    elif days <= 45:
        score += 9
    elif days <= 120:
        score += 6
    elif days <= 365:
        score += 3
    if len(title) >= 24:
        score += 4
    elif len(title) >= 12:
        score += 2
    return min(55, score)


def select_articles_for_analysis(articles: list[Article]) -> list[Article]:
    """
    为趋势 LLM 选取「对时尚分析最有帮助」的稿件子集。

    原则：
    1. 硬性剔除：标题过短、正文过短、标题命中站务/错误类关键词。
    2. 时尚语义门槛：相关分低于 min_fashion_relevance_score 的剔除（0=关闭）。
    3. 趋势向过滤（strict_fashion_trend_filter）：剔除不含时尚趋势信号的稿件。
    4. 排序：先按时尚语义相关度，再按趋势证据丰富度，再按发布时间、正文长度。
    5. 数量上限：max_articles_per_analysis_run（0 表示不限制）。

    关闭 ENABLE_ARTICLE_QUALITY_GATE 时原样返回全部候选。
    """
    if not articles:
        return []

    if not settings.enable_article_quality_gate:
        return list(articles)

    min_title = max(1, settings.min_article_title_chars)
    min_body = max(1, settings.min_article_body_chars)
    min_rel = max(0, settings.min_fashion_relevance_score)
    cap = settings.max_articles_per_analysis_run or 0

    eligible: list[tuple[int, int, Article]] = []
    dropped_short = 0
    dropped_title = 0
    dropped_block = 0
    dropped_low_rel = 0
    dropped_no_fashion_trend = 0

    def _pub_ts(art: Article) -> float:
        if not art.published_at:
            return 0.0
        try:
            return _naive_utc(art.published_at).timestamp()
        except OSError:
            return 0.0

    for art in articles:
        title = (art.title or "").strip()
        body = (art.content or "").strip()
        if len(title) < min_title:
            dropped_title += 1
            continue
        if _title_blocked(title):
            dropped_block += 1
            continue
        if len(body) < min_body:
            dropped_short += 1
            continue
        rel = fashion_semantic_relevance_score(art)
        if min_rel > 0 and rel < min_rel:
            dropped_low_rel += 1
            continue
        if settings.strict_fashion_trend_filter and not article_contains_fashion_trend_signal(
            art, fashion_rel=rel
        ):
            dropped_no_fashion_trend += 1
            continue
        ev = trend_evidence_richness_score(art)
        eligible.append((rel, ev, art))

    eligible.sort(
        key=lambda it: (
            -it[0],
            -it[1],
            -_pub_ts(it[2]),
            -len((it[2].content or "").strip()),
        )
    )

    selected = [t[2] for t in eligible[:cap]] if cap > 0 else [t[2] for t in eligible]

    logger.info(
        "Fashion-analysis article gate | pool={} selected={} cap={} "
        "dropped_title_short={} dropped_body_short={} dropped_title_blocklist={} "
        "dropped_low_fashion_relevance={} (min_rel={}) dropped_no_fashion_trend={} (strict_trend={})",
        len(articles),
        len(selected),
        cap or 0,
        dropped_title,
        dropped_short,
        dropped_block,
        dropped_low_rel,
        min_rel,
        dropped_no_fashion_trend,
        settings.strict_fashion_trend_filter,
    )
    return selected


# ─────────────────────────────────────────────
# 图片选择策略
# ─────────────────────────────────────────────

def select_representative_images(
    article: Article, max_images: int = None
) -> list[ImageItem]:
    """
    筛选代表性图片：
    - 优先选首图（通常是封面/主图）
    - 过滤掉明显是图标、追踪像素的小图（URL 包含 icon/logo/pixel/tracking 等关键词）
    - 最多保留 max_images 张

    设计说明：图片过多时传入 LLM 会消耗大量 token 且可能超限，
    因此优先保留与内容最相关的图片（首图 + 正文重要图）。
    """
    max_images = max_images or settings.max_images_per_article
    noise_keywords = (
        "icon", "logo", "pixel", "tracking", "1x1", "beacon",
        "avatar", "emoji", "sprite", "loading", "placeholder",
    )

    filtered: list[ImageItem] = []
    seen_img_urls: set[str] = set()
    for img in article.images:
        url_lower = img.original_url.lower()
        if not img.original_url or img.original_url in seen_img_urls:
            continue
        if any(kw in url_lower for kw in noise_keywords):
            continue
        # 过滤无效 URL
        if not img.original_url.startswith(("http://", "https://")):
            continue
        # 过滤低价值图片类型
        if url_lower.startswith("data:") or url_lower.endswith(".svg"):
            continue
        seen_img_urls.add(img.original_url)
        filtered.append(img)

    # 按「更像主图/编辑图」排序，同分保留原文顺序（靠前的优先）
    scored: list[tuple[int, int, ImageItem]] = []
    for order, img in enumerate(filtered):
        u = img.original_url.lower()
        score = 100
        if any(k in u for k in ("thumb", "thumbnail", "w=32", "w=48", "w=64", "h=48")):
            score -= 45
        if any(k in u for k in ("hero", "feature", "lookbook", "gallery", "editorial", "cover")):
            score += 18
        scored.append((score, order, img))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [t[2] for t in scored[:max_images]]


# ─────────────────────────────────────────────
# OCR 降级
# ─────────────────────────────────────────────

def ocr_image(image_path: Path) -> str:
    """
    对本地图片做 OCR 文字识别，作为多模态降级方案。
    支持：tesseract（默认）/ easyocr。
    若两者均不可用，返回空字符串并记录警告。
    """
    engine = settings.ocr_engine.lower()

    if engine == "tesseract":
        try:
            import pytesseract
            from PIL import Image

            img = Image.open(image_path)
            return pytesseract.image_to_string(img, lang="chi_sim+eng").strip()
        except ImportError:
            logger.warning("pytesseract/Pillow not installed — OCR skipped")
        except Exception as exc:
            logger.warning("Tesseract OCR failed for {}: {}", image_path, exc)

    elif engine == "easyocr":
        try:
            import easyocr

            reader = easyocr.Reader(["ch_sim", "en"], gpu=False)
            result = reader.readtext(str(image_path), detail=0)
            return " ".join(result).strip()
        except ImportError:
            logger.warning("easyocr not installed — OCR skipped")
        except Exception as exc:
            logger.warning("EasyOCR failed for {}: {}", image_path, exc)

    return ""


def build_image_description(img: ImageItem, use_ocr: bool = False) -> str:
    """
    为图片构建文本描述（用于纯文本模型降级）。
    若启用 OCR 且图片已下载，则尝试 OCR；否则返回 metadata 描述。
    """
    parts = [f"[图片] URL: {img.original_url}"]
    if img.alt_text:
        parts.append(f"alt: {img.alt_text}")
    if img.local_path and use_ocr:
        p = Path(img.local_path)
        if p.exists():
            ocr_text = ocr_image(p)
            if ocr_text:
                parts.append(f"OCR文字: {ocr_text[:300]}")
    return " | ".join(parts)


# ─────────────────────────────────────────────
# LLM 输入构建
# ─────────────────────────────────────────────

def build_llm_article_input(
    article: Article,
    image_input_mode: ImageInputMode,
    use_ocr_fallback: bool = False,
) -> LLMArticleInput:
    """
    将 Article 转为 LLM 输入，根据 image_input_mode 处理图片：
    - URL 模式：直接传图片 URL
    - BASE64 模式：将本地图片转 base64
    - NONE 模式：不传图片，改为文字描述（降级）
    """
    selected_images = select_representative_images(article)

    # 根据模式处理图片
    if image_input_mode == ImageInputMode.BASE64:
        processed_images: list[ImageItem] = []
        for img in selected_images:
            if img.local_path and Path(img.local_path).exists():
                try:
                    b64 = image_to_base64(Path(img.local_path))
                    img_copy = img.model_copy(update={"content_hash": b64})
                    processed_images.append(img_copy)
                except Exception as exc:
                    logger.warning(
                        "Failed to encode image to base64 [{}]: {}", img.local_path, exc
                    )
                    processed_images.append(img)
            else:
                processed_images.append(img)
        images_for_llm = processed_images
    elif image_input_mode == ImageInputMode.NONE:
        # 纯文本降级：将图片信息转为文字追加到 content
        images_for_llm = []
        if selected_images:
            img_descs = [
                build_image_description(img, use_ocr=use_ocr_fallback)
                for img in selected_images
            ]
            article = article.model_copy(
                update={
                    "content": article.content
                    + "\n\n【相关图片信息】\n"
                    + "\n".join(img_descs)
                }
            )
    else:
        # URL 模式：直接使用已下载或原始 URL
        images_for_llm = selected_images

    return LLMArticleInput(
        article_id=article.unique_key,
        site_name=article.site_name,
        title=article.title,
        content=article.content[: settings.max_content_length],
        summary=article.summary,
        tags=article.tags,
        category=article.category,
        published_at=article.published_at,
        article_url=article.article_url,
        images=images_for_llm,
    )


def build_llm_batch(
    articles: list[Article],
    image_input_mode: ImageInputMode = ImageInputMode.URL,
) -> LLMBatchInput:
    """
    将多篇文章构建为单批 LLM 输入。
    超限处理（在 llm_analyzer.py 中实现）：
    - 先逐篇摘要，再汇总分析
    """
    import uuid

    use_ocr = settings.enable_ocr_fallback

    inputs = [
        build_llm_article_input(art, image_input_mode, use_ocr)
        for art in articles
    ]

    return LLMBatchInput(
        batch_id=str(uuid.uuid4())[:8],
        articles=inputs,
        image_input_mode=image_input_mode,
    )


# ─────────────────────────────────────────────
# 文章分块策略
# ─────────────────────────────────────────────

def split_long_article(article: Article, chunk_size: int = 3000) -> list[LLMArticleInput]:
    """
    单篇文章过长时，按段落分块，返回多个 LLMArticleInput。
    每块独立送 LLM 做摘要，之后在 llm_analyzer 中汇总。

    设计说明：
    分块摘要避免单次 LLM 调用超出上下文限制，且相比截断保留了更多语义信息。
    """
    if len(article.content) <= chunk_size:
        return [
            build_llm_article_input(
                article,
                ImageInputMode(settings.image_input_mode),
                settings.enable_ocr_fallback,
            )
        ]

    chunks = chunk_text(article.content, chunk_size)
    result: list[LLMArticleInput] = []
    for i, chunk in enumerate(chunks):
        chunk_article = article.model_copy(
            update={
                "title": f"{article.title} [Part {i + 1}/{len(chunks)}]",
                "content": chunk,
                "images": article.images if i == 0 else [],  # 只有第一块带图片
            }
        )
        result.append(
            build_llm_article_input(
                chunk_article,
                ImageInputMode(settings.image_input_mode),
                settings.enable_ocr_fallback,
            )
        )
    return result
