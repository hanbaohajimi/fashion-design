"""
llm_analyzer.py — LLM 趋势分析模块
- 使用 LiteLLM 统一适配 OpenAI / Anthropic / Local
- 支持多模态图片输入（URL 和 base64）
- 处理上下文超限（分块摘要 -> 全局汇总）
- 严格 JSON 输出约束
- 429 限流 / 超时 / 非法 JSON 处理
- Token 用量记录
"""

from __future__ import annotations

import json
import re
import time
import uuid
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse

from loguru import logger

from config import settings
from models import (
    Article,
    ArticleTrendInsight,
    EvidenceItem,
    FashionTrendReport,
    ImageInputMode,
    LLMArticleInput,
    LLMBatchInput,
    REPORT_FAILURE_PLACEHOLDER_SUMMARY,
    StyleDetail,
    TrendItem,
)
from processor import build_llm_batch, split_long_article
from prompts.trend_analysis import (
    JSON_SCHEMA_HINT,
    TEXT_ONLY_SYSTEM_PROMPT,
    build_batch_context_block,
    build_multimodal_messages,
    build_summary_prompt,
    build_text_only_messages,
)
from time_utils import local_now


# ─────────────────────────────────────────────
# 趋势报告图片：URL 对齐 + 回填
# ─────────────────────────────────────────────

def _normalize_image_url(url: str) -> str:
    """用于比对：统一 scheme、host、path、去掉 fragment。"""
    u = (url or "").strip()
    if not u:
        return ""
    try:
        p = urlparse(u)
        path = p.path.rstrip("/") or "/"
        return urlunparse(
            (p.scheme.lower(), p.netloc.lower(), path, p.params, p.query, "")
        )
    except Exception:
        return u.rstrip("/")


def _build_image_url_indexes(articles: list[Article]) -> tuple[set[str], dict[str, str], dict[tuple[str, str], str]]:
    """
    exact 原始 URL 集合；
    normalized_full -> canonical（规范化后映射到抓取侧原始 URL）；
    (host, path) -> canonical（忽略 query 差异时的兜底）。
    """
    exact: set[str] = set()
    by_norm: dict[str, str] = {}
    by_host_path: dict[tuple[str, str], str] = {}
    for art in articles:
        for img in art.images:
            ou = (img.original_url or "").strip()
            if not ou.startswith(("http://", "https://")):
                continue
            exact.add(ou)
            n = _normalize_image_url(ou)
            if n and n not in by_norm:
                by_norm[n] = ou
            try:
                p = urlparse(ou)
                host = p.netloc.lower()
                path = p.path.rstrip("/") or "/"
                key = (host, path)
                if key not in by_host_path:
                    by_host_path[key] = ou
            except Exception:
                pass
    return exact, by_norm, by_host_path


def _resolve_image_url(
    raw: str,
    exact: set[str],
    by_norm: dict[str, str],
    by_host_path: dict[tuple[str, str], str],
) -> Optional[str]:
    """将模型输出的图片 URL 对齐到抓取侧的真实 URL。"""
    u = (raw or "").strip()
    if not u.startswith(("http://", "https://")):
        return None
    if u in exact:
        return u
    n = _normalize_image_url(u)
    if n in by_norm:
        return by_norm[n]
    try:
        p = urlparse(u)
        host = p.netloc.lower()
        path = p.path.rstrip("/") or "/"
        key = (host, path)
        if key in by_host_path:
            return by_host_path[key]
    except Exception:
        pass
    return None


def _dedupe_preserve(urls: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _resolve_selected_list(
    raw_list: list[Any],
    exact: set[str],
    by_norm: dict[str, str],
    by_host_path: dict[tuple[str, str], str],
    max_n: int,
) -> list[str]:
    out: list[str] = []
    for item in raw_list:
        if len(out) >= max_n:
            break
        if not isinstance(item, str):
            continue
        canon = _resolve_image_url(item, exact, by_norm, by_host_path)
        if canon and canon not in out:
            out.append(canon)
    return out


def _collect_representative_images(report: FashionTrendReport, max_n: int = 5) -> list[str]:
    """从关键趋势与各板块条目中汇总去重代表图（默认最多 5 张）。"""
    ordered: list[str] = []
    for t in report.key_trends:
        for u in t.selected_images:
            ordered.append(u)
    for section in (
        report.style_details,
        report.item_details,
        report.silhouette_details,
        report.color_details,
    ):
        for d in section:
            for u in d.selected_images:
                ordered.append(u)
    return _dedupe_preserve(ordered)[:max_n]


def _build_article_image_lookup(articles: list[Article]) -> tuple[dict[str, list[str]], list[str]]:
    """按文章 URL/标题建立图片索引，并返回全局去重图片池。"""
    lookup: dict[str, list[str]] = {}
    all_images: list[str] = []

    def add_key(key: str, urls: list[str]) -> None:
        k = (key or "").strip().lower()
        if not k:
            return
        existing = lookup.setdefault(k, [])
        for url in urls:
            if url not in existing:
                existing.append(url)

    for art in articles:
        urls = _dedupe_preserve([
            img.original_url.strip()
            for img in art.images
            if (img.original_url or "").strip().startswith(("http://", "https://"))
        ])
        if not urls:
            continue
        all_images.extend(urls)
        add_key(art.article_url, urls)
        add_key(_normalize_image_url(art.article_url), urls)
        add_key(art.title, urls)
        add_key(art.unique_key, urls)

    return lookup, _dedupe_preserve(all_images)


def _fallback_images_for_evidence(
    evidence_items: list[EvidenceItem],
    article_image_lookup: dict[str, list[str]],
    all_images: list[str],
    max_n: int,
) -> list[str]:
    """优先从证据文章取图，缺失时从全局图片池取图，保证卡片有可追溯视觉材料。"""
    out: list[str] = []
    for ev in evidence_items:
        for key in (ev.article_url, _normalize_image_url(ev.article_url), ev.article_title):
            for url in article_image_lookup.get((key or "").strip().lower(), []):
                if url not in out:
                    out.append(url)
                if len(out) >= max_n:
                    return out
    for url in all_images:
        if url not in out:
            out.append(url)
        if len(out) >= max_n:
            return out
    return out


# ─────────────────────────────────────────────
# LiteLLM 初始化
# ─────────────────────────────────────────────

def _get_litellm():
    """延迟导入 litellm，避免未安装时导入失败"""
    try:
        import litellm
        return litellm
    except ImportError:
        raise ImportError(
            "litellm 未安装，请运行: pip install litellm"
        )


def _build_model_id() -> str:
    """构建 LiteLLM 格式的 model id"""
    provider = settings.llm_provider.lower()
    model = settings.llm_model

    if provider == "openai":
        # 若模型名不带 provider 前缀，加上 openai/ 强制走 OpenAI/兼容接口路由
        # 防止 LiteLLM 按模型名自动路由到 Vertex AI（如 gemini-*）
        if "/" not in model:
            return f"openai/{model}"
        return model
    elif provider == "anthropic":
        return f"anthropic/{model}"
    elif provider == "local":
        return f"ollama/{model}"  # 默认用 ollama，可按需修改
    else:
        return model  # 直接传，litellm 自动识别


def _supports_vision() -> bool:
    """粗判断当前模型是否支持视觉输入"""
    model = settings.llm_model.lower()
    vision_models = (
        "gpt-4o", "gpt-4-vision", "gpt-4-turbo", "gpt-4.1", "o4",
        "claude-3", "claude-sonnet", "claude-opus", "claude-haiku",
        "gemini", "llava", "minicpm-v",
        "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qvq", "internvl", "glm-4v",
        "deepseek-vl", "yi-vl", "step-1v",
    )
    return any(kw in model for kw in vision_models)


# ─────────────────────────────────────────────
# 核心 LLM 调用（带重试 + 限流处理）
# ─────────────────────────────────────────────

async def _call_llm(
    messages: list[dict],
    response_format: Optional[dict] = None,
    max_retries: int = 3,
) -> tuple[str, dict[str, int]]:
    """
    调用 LLM，返回 (response_text, token_usage)。
    处理：429 限流、超时、网络异常。
    """
    import asyncio
    litellm = _get_litellm()
    model_id = _build_model_id()

    kwargs: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "max_tokens": settings.llm_max_tokens,
        "temperature": settings.llm_temperature,
        "api_key": settings.api_key,
        "timeout": float(settings.llm_request_timeout),
    }
    if settings.llm_base_url:
        kwargs["api_base"] = settings.llm_base_url

    # 若模型支持 JSON 结构化输出，强制开启
    if response_format:
        kwargs["response_format"] = response_format

    wait = 5.0
    for attempt in range(1, max_retries + 1):
        try:
            t0 = time.time()
            response = await litellm.acompletion(**kwargs)
            elapsed = time.time() - t0

            content = response.choices[0].message.content or ""
            usage: dict[str, int] = {}
            if hasattr(response, "usage") and response.usage:
                usage = {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                }
            logger.info(
                "LLM call success | model={} elapsed={:.1f}s usage={}",
                model_id,
                elapsed,
                usage,
            )
            return content, usage

        except Exception as exc:
            exc_str = str(exc)
            if "429" in exc_str or "rate_limit" in exc_str.lower():
                logger.warning(
                    "LLM rate limited (attempt {}/{}), waiting {:.0f}s…",
                    attempt,
                    max_retries,
                    wait,
                )
                await asyncio.sleep(wait)
                wait = min(wait * 2, 120)
            elif attempt == max_retries:
                logger.error("LLM call failed after {} attempts: {}", max_retries, exc)
                raise
            else:
                logger.warning(
                    "LLM call attempt {}/{} failed: {}", attempt, max_retries, exc
                )
                await asyncio.sleep(wait)
                wait = min(wait * 2, 60)

    return "", {}


# ─────────────────────────────────────────────
# JSON 解析（容错）
# ─────────────────────────────────────────────

def _extract_json_from_text(text: str) -> Optional[dict]:
    """
    从 LLM 输出中提取 JSON。
    策略：
    1. 直接 parse（理想情况）
    2. 提取 ```json ... ``` 代码块
    3. 提取第一个 { ... } 块
    4. 截断修复：JSON 被 max_tokens 截断时，尝试补全末尾括号
    """
    text = text.strip()

    # 策略 1：直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 策略 2：代码块
    m = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text, re.IGNORECASE)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # 策略 3：第一个 JSON 对象
    m2 = re.search(r"\{[\s\S]+\}", text)
    if m2:
        try:
            return json.loads(m2.group(0))
        except json.JSONDecodeError:
            pass

    # 策略 4：截断修复 — 逐步从末尾回退，补全括号后尝试解析
    # 找到第一个 { 开始的位置
    start = text.find("{")
    if start != -1:
        truncated = text[start:]
        # 最多尝试回退 500 个字符
        for trim in range(0, min(500, len(truncated))):
            candidate = truncated[: len(truncated) - trim].rstrip().rstrip(",")
            # 统计未闭合的 { [ 数量
            open_braces = candidate.count("{") - candidate.count("}")
            open_brackets = candidate.count("[") - candidate.count("]")
            if open_braces >= 0 and open_brackets >= 0:
                repaired = candidate + "]" * open_brackets + "}" * open_braces
                try:
                    result = json.loads(repaired)
                    logger.warning(
                        "JSON repaired by truncation fix (trimmed={} braces={} brackets={})",
                        trim, open_braces, open_brackets,
                    )
                    return result
                except json.JSONDecodeError:
                    continue

    logger.error("Failed to extract JSON from LLM response. Raw text:\n{}", text[:500])
    return None


# ─────────────────────────────────────────────
# 分块摘要策略
# ─────────────────────────────────────────────

async def _summarize_chunks(
    chunks: list[str],
    article_title: str,
) -> str:
    """
    对单篇长文章的多个分块逐一摘要，最后合并。
    设计：避免长文章一次性超出 LLM 上下文窗口。
    """
    summaries: list[str] = []
    for i, chunk in enumerate(chunks):
        prompt = build_summary_prompt(article_title, chunk, i + 1, len(chunks))
        messages = [{"role": "user", "content": prompt}]
        try:
            text, _ = await _call_llm(messages)
            summaries.append(text.strip())
        except Exception as exc:
            logger.warning("Chunk {} summary failed: {}", i + 1, exc)
            summaries.append(f"[摘要失败: {exc}]")

    return "\n\n---\n\n".join(summaries)


async def _summarize_article(article: LLMArticleInput) -> str:
    """
    对单篇文章生成摘要（用于多篇聚合前的预处理）。
    若文章内容较短，直接返回内容本身。
    """
    if len(article.content) < 500:
        return article.content

    from utils import chunk_text
    chunks = chunk_text(article.content, chunk_size=3000)
    if len(chunks) == 1:
        prompt = build_summary_prompt(article.title, article.content, 1, 1)
        messages = [{"role": "user", "content": prompt}]
        try:
            text, _ = await _call_llm(messages)
            return text.strip()
        except Exception as exc:
            logger.warning("Article summary failed [{}]: {}", article.title, exc)
            return article.content[:1000]
    else:
        return await _summarize_chunks(chunks, article.title)


def _safe_json_list(value: Any) -> list[str]:
    """将模型输出规范为去空、去重后的字符串列表。"""
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        s = str(item or "").strip()
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


# ─────────────────────────────────────────────
# 主分析逻辑
# ─────────────────────────────────────────────

class FashionTrendAnalyzer:
    """
    时尚趋势 LLM 分析器。
    支持多模态与纯文本两种模式，自动选择。
    """

    def __init__(self, progress_callback=None) -> None:
        self.vision_mode = _supports_vision() and settings.image_input_mode != "none"
        self.progress_callback = progress_callback
        logger.info(
            "Analyzer initialized | provider={} model={} vision={}",
            settings.llm_provider,
            settings.llm_model,
            self.vision_mode,
        )

    async def _emit_progress(self, payload: dict[str, Any]) -> None:
        cb = self.progress_callback
        if not cb:
            return
        res = cb(payload)
        if hasattr(res, "__await__"):
            await res

    async def analyze_batch(
        self,
        articles: list[Article],
        batch_id: Optional[str] = None,
        *,
        season_bucket_id: str = "",
        season_code: str = "",
        season_year: int = 0,
        season_label_zh: str = "",
    ) -> FashionTrendReport:
        """
        分析一批文章，返回趋势报告。

        上下文超限处理策略（按需分级）：
        1. 文章数量较多：先逐篇提炼摘要，再全局综合
        2. 单篇过长：已在 processor 中分块处理
        3. 图片过多：在 processor 中已筛选代表图

        季节参数：由上游按「年份_季节码」分桶传入，用于提示词约束与报告元数据。
        """
        if not articles:
            logger.warning("No articles to analyze")
            return self._empty_report(
                batch_id,
                season_bucket_id=season_bucket_id,
                season_code=season_code,
                season_year=season_year,
                season_label_zh=season_label_zh,
            )

        if not settings.is_llm_configured():
            logger.error("LLM not configured — skipping analysis")
            return self._empty_report(
                batch_id,
                season_bucket_id=season_bucket_id,
                season_code=season_code,
                season_year=season_year,
                season_label_zh=season_label_zh,
            )

        _season_bucket_id = season_bucket_id or ""
        _season_code = season_code or ""
        _season_year = int(season_year or 0)
        _season_label_zh = season_label_zh or ""

        batch_id = batch_id or str(uuid.uuid4())[:8]
        if settings.use_search_first_workflow:
            return await self._analyze_batch_via_article_insights(
                articles,
                batch_id=batch_id,
                season_bucket_id=_season_bucket_id,
                season_code=_season_code,
                season_year=_season_year,
                season_label_zh=_season_label_zh,
            )

        image_mode = ImageInputMode(settings.image_input_mode)
        batch = build_llm_batch(articles, image_mode)

        total_tokens: dict[str, int] = {}

        # ── 步骤 1：若文章过多，并行摘要后再聚合 ──
        inputs_for_analysis: list[LLMArticleInput] = batch.articles
        if len(batch.articles) > settings.max_articles_per_batch:
            logger.info(
                "Too many articles ({}) — summarizing in parallel (concurrency={})",
                len(batch.articles),
                settings.max_concurrency,
            )
            import asyncio

            semaphore = asyncio.Semaphore(settings.max_concurrency)

            async def _summarize_one(art: LLMArticleInput) -> LLMArticleInput:
                async with semaphore:
                    summary_text = await _summarize_article(art)
                    return art.model_copy(update={"content": summary_text, "images": []})

            summaries = await asyncio.gather(
                *[_summarize_one(art) for art in batch.articles]
            )
            inputs_for_analysis = list(summaries)

        # ── 步骤 2：全局趋势分析 ──
        try:
            batch_ctx = build_batch_context_block(
                inputs_for_analysis,
                season_scope_zh=_season_label_zh,
            )
            if self.vision_mode:
                messages = build_multimodal_messages(
                    inputs_for_analysis, batch_context=batch_ctx
                )
            else:
                messages = build_text_only_messages(
                    inputs_for_analysis, batch_context=batch_ctx
                )

            raw_text, usage = await _call_llm(messages)
            self._accumulate_tokens(total_tokens, usage)

        except Exception as exc:
            logger.error("LLM analysis failed: {}", exc)
            raise RuntimeError(f"LLM analysis failed: {exc}") from exc

        # ── 步骤 3：解析 JSON 输出 ──
        data = _extract_json_from_text(raw_text)
        if not data:
            logger.error("Could not parse LLM JSON output")
            raise ValueError("Could not parse LLM JSON output")

        # ── 步骤 4：构建 Pydantic 报告 ──
        try:
            report = self._build_report(
                data,
                articles,
                batch_id,
                total_tokens,
                season_bucket_id=_season_bucket_id,
                season_code=_season_code,
                season_year=_season_year,
                season_label_zh=_season_label_zh,
            )
            logger.info(
                "Analysis done | trends={} confidence={:.2f} tokens={} season={}",
                len(report.key_trends),
                report.confidence,
                total_tokens,
                _season_label_zh or _season_bucket_id or "—",
            )
            return report
        except Exception as exc:
            logger.error("Report construction failed: {}", exc)
            raise RuntimeError(f"Report construction failed: {exc}") from exc

    async def _analyze_batch_via_article_insights(
        self,
        articles: list[Article],
        *,
        batch_id: str,
        season_bucket_id: str = "",
        season_code: str = "",
        season_year: int = 0,
        season_label_zh: str = "",
    ) -> FashionTrendReport:
        """两阶段流程：先逐篇洞察，再聚合成最终趋势报告。"""
        await self._emit_progress(
            {
                "phase": "article_insight_start",
                "detail": f"开始逐篇分析，共 {len(articles)} 篇文章",
                "done": 0,
                "total": len(articles),
            }
        )
        insights, token_usage = await self._analyze_articles_individually(articles)
        if not insights:
            raise RuntimeError("No article insights generated")

        try:
            await self._emit_progress(
                {
                    "phase": "article_insight_aggregate",
                    "detail": f"正在汇总 {len(insights)} 篇文章洞察",
                    "done": len(insights),
                    "total": len(articles),
                }
            )
            batch_ctx = build_batch_context_block(
                [a.to_llm_input(settings.max_content_length) for a in articles],
                season_scope_zh=season_label_zh,
            )
            prompt = self._build_insight_aggregation_prompt(
                articles,
                insights,
                batch_context=batch_ctx,
            )
            raw_text, usage = await _call_llm(
                [{"role": "user", "content": prompt}]
            )
            self._accumulate_tokens(token_usage, usage)
        except Exception as exc:
            logger.error("Insight aggregation failed: {}", exc)
            raise RuntimeError(f"Insight aggregation failed: {exc}") from exc

        data = _extract_json_from_text(raw_text)
        if not data:
            raise ValueError("Could not parse aggregated trend JSON output")

        try:
            report = self._build_report(
                data,
                articles,
                batch_id,
                token_usage,
                season_bucket_id=season_bucket_id,
                season_code=season_code,
                season_year=season_year,
                season_label_zh=season_label_zh,
            )
            logger.info(
                "Two-stage analysis done | articles={} insights={} trends={} tokens={}",
                len(articles),
                len(insights),
                len(report.key_trends),
                token_usage,
            )
            return report
        except Exception as exc:
            logger.error("Aggregated report construction failed: {}", exc)
            raise RuntimeError(
                f"Aggregated report construction failed: {exc}"
            ) from exc

    async def _analyze_articles_individually(
        self,
        articles: list[Article],
    ) -> tuple[list[ArticleTrendInsight], dict[str, int]]:
        """逐篇分析文章，生成可聚合的趋势洞察卡。"""
        import asyncio

        token_usage: dict[str, int] = {}
        sem = asyncio.Semaphore(max(1, min(settings.max_concurrency, 3)))
        insights: list[ArticleTrendInsight] = []
        completed = 0

        async def run_one(article: Article) -> Optional[ArticleTrendInsight]:
            nonlocal completed
            async with sem:
                try:
                    insight, usage = await self._analyze_single_article(article)
                    self._accumulate_tokens(token_usage, usage)
                    completed += 1
                    await self._emit_progress(
                        {
                            "phase": "article_insight_progress",
                            "detail": f"已完成单篇分析 {completed}/{len(articles)}",
                            "done": completed,
                            "total": len(articles),
                            "article_title": article.title,
                        }
                    )
                    return insight
                except Exception as exc:
                    completed += 1
                    await self._emit_progress(
                        {
                            "phase": "article_insight_progress",
                            "detail": f"单篇分析完成 {completed}/{len(articles)}（含失败）",
                            "done": completed,
                            "total": len(articles),
                            "article_title": article.title,
                            "error": str(exc),
                        }
                    )
                    logger.warning(
                        "Single-article insight failed [{}]: {}",
                        article.title,
                        exc,
                    )
                    return None

        results = await asyncio.gather(*(run_one(a) for a in articles))
        for item in results:
            if item is not None:
                insights.append(item)
        return insights, token_usage

    async def _analyze_single_article(
        self,
        article: Article,
    ) -> tuple[ArticleTrendInsight, dict[str, int]]:
        """对单篇文章提炼结构化趋势洞察。"""
        llm_article = article.to_llm_input(settings.max_content_length)
        available_images = [
            img.original_url
            for img in llm_article.images
            if img.original_url.startswith(("http://", "https://"))
        ]
        prompt = (
            "你是一名资深时尚趋势分析师。请只根据给定的单篇文章，提炼该文对时尚趋势判断有价值的信号。"
            "不要生成最终全局报告，不要编造材料中没有的信息。\n\n"
            "输出必须是 JSON 对象，字段如下：\n"
            "{\n"
            '  "executive_summary": "4-6句摘要，必须说明这篇文章的具体趋势点、证据组合、场景/人群/商业含义",\n'
            '  "key_directions": ["趋势方向1", "趋势方向2"],\n'
            '  "colors": ["色彩"],\n'
            '  "fabrics": ["面料"],\n'
            '  "silhouettes": ["廓形"],\n'
            '  "items": ["单品"],\n'
            '  "patterns": ["图案"],\n'
            '  "style_keywords": ["风格词"],\n'
            '  "consumer_signals": ["消费信号"],\n'
            '  "evidence_snippets": ["能支撑判断的原文片段，最多5条"],\n'
            '  "business_implications": ["对买手/产品/内容团队的启示，最多3条"],\n'
            '  "confidence": 0.78,\n'
            '  "representative_images": ["从给定图片URL中直接复制0-3个URL"]\n'
            "}\n\n"
            "规则：\n"
            "1. evidence_snippets 必须来自原文。\n"
            "2. representative_images 只能从给定图片URL中挑选，不能伪造。\n"
            "3. 不要只写抽象判断，必须点明颜色、面料、单品、廓形、图案或品牌话术中的具体证据。\n"
            "4. 若文章偏资讯但趋势价值有限，也要如实说明并降低 confidence。\n"
            "5. 优先写“趋势如何变化”，即正在增强、回潮、替代或扩散到哪些场景。\n\n"
            f"站点：{llm_article.site_name}\n"
            f"标题：{llm_article.title}\n"
            f"分类：{llm_article.category or '未知'}\n"
            f"标签：{', '.join(llm_article.tags) if llm_article.tags else '无'}\n"
            f"发布日期：{llm_article.published_at.strftime('%Y-%m-%d') if llm_article.published_at else '未知'}\n"
            f"URL：{llm_article.article_url}\n"
            f"摘要：{llm_article.summary or '无'}\n"
            f"可用图片URL：{json.dumps(available_images, ensure_ascii=False)}\n\n"
            "正文：\n"
            f"{llm_article.content}\n"
        )
        raw_text, usage = await _call_llm(
            [{"role": "user", "content": prompt}]
        )
        data = _extract_json_from_text(raw_text)
        if not data:
            raise ValueError("Could not parse single-article insight JSON output")

        insight = ArticleTrendInsight(
            article_id=article.unique_key,
            article_title=article.title,
            article_url=article.article_url,
            site_name=article.site_name,
            executive_summary=str(data.get("executive_summary", "")).strip(),
            key_directions=_safe_json_list(data.get("key_directions")),
            colors=_safe_json_list(data.get("colors")),
            fabrics=_safe_json_list(data.get("fabrics")),
            silhouettes=_safe_json_list(data.get("silhouettes")),
            items=_safe_json_list(data.get("items")),
            patterns=_safe_json_list(data.get("patterns")),
            style_keywords=_safe_json_list(data.get("style_keywords")),
            consumer_signals=_safe_json_list(data.get("consumer_signals")),
            evidence_snippets=_safe_json_list(data.get("evidence_snippets")),
            business_implications=_safe_json_list(data.get("business_implications")),
            confidence=self._safe_float(data.get("confidence"), default=0.45),
            representative_images=self._resolve_representative_images(
                data.get("representative_images"),
                article,
            ),
        )
        return insight, usage

    def _build_insight_aggregation_prompt(
        self,
        articles: list[Article],
        insights: list[ArticleTrendInsight],
        *,
        batch_context: str = "",
    ) -> str:
        """将逐篇洞察组织为最终趋势汇总提示词。"""
        article_map = {a.unique_key: a for a in articles}
        blocks: list[str] = []
        for idx, insight in enumerate(insights, 1):
            article = article_map.get(insight.article_id)
            image_urls = []
            if article:
                image_urls = [
                    img.original_url
                    for img in article.images
                    if img.original_url.startswith(("http://", "https://"))
                ]
            blocks.append(
                f"【洞察 {idx}】\n"
                f"站点：{insight.site_name}\n"
                f"标题：{insight.article_title}\n"
                f"URL：{insight.article_url}\n"
                f"逐篇摘要：{insight.executive_summary}\n"
                f"关键方向：{json.dumps(insight.key_directions, ensure_ascii=False)}\n"
                f"色彩：{json.dumps(insight.colors, ensure_ascii=False)}\n"
                f"面料：{json.dumps(insight.fabrics, ensure_ascii=False)}\n"
                f"廓形：{json.dumps(insight.silhouettes, ensure_ascii=False)}\n"
                f"单品：{json.dumps(insight.items, ensure_ascii=False)}\n"
                f"图案：{json.dumps(insight.patterns, ensure_ascii=False)}\n"
                f"风格关键词：{json.dumps(insight.style_keywords, ensure_ascii=False)}\n"
                f"消费者信号：{json.dumps(insight.consumer_signals, ensure_ascii=False)}\n"
                f"商业启示：{json.dumps(insight.business_implications, ensure_ascii=False)}\n"
                f"证据片段：{json.dumps(insight.evidence_snippets, ensure_ascii=False)}\n"
                f"可用图片URL：{json.dumps(image_urls, ensure_ascii=False)}\n"
                f"逐篇信心：{insight.confidence:.2f}\n"
            )

        return (
            f"{TEXT_ONLY_SYSTEM_PROMPT.strip()}\n\n"
            "你当前接收到的不是原始文章全文，而是多篇文章的一阶结构化洞察卡。"
            "请基于这些洞察卡做二阶综合，输出最终时尚趋势报告。"
            "必须保留可追溯证据链，不得虚构没有出现在洞察卡中的来源。"
            "如果洞察卡里出现多篇文章共同指向同一趋势，请在描述中明确点出“跨文档一致性”与具体支撑项；"
            "如果只是一篇文章特有的信号，也要明确标注单源。\n\n"
            f"{JSON_SCHEMA_HINT.strip()}\n"
            f"{batch_context}\n"
            "以下是一阶洞察卡：\n\n"
            + "\n\n".join(blocks)
        )

    @staticmethod
    def _safe_float(v: Any, default: float = 0.5) -> float:
        try:
            return min(max(float(v), 0.0), 1.0)
        except (TypeError, ValueError):
            return default

    def _resolve_representative_images(
        self,
        raw_images: Any,
        article: Article,
        max_n: int = 3,
    ) -> list[str]:
        exact, by_norm, by_host_path = _build_image_url_indexes([article])
        return _resolve_selected_list(
            raw_images if isinstance(raw_images, list) else [],
            exact,
            by_norm,
            by_host_path,
            max_n=max_n,
        )

    # ──────────────────────────────────────────
    # 辅助方法
    # ──────────────────────────────────────────

    def _build_report(
        self,
        data: dict,
        articles: list[Article],
        batch_id: str,
        token_usage: dict[str, int],
        *,
        season_bucket_id: str = "",
        season_code: str = "",
        season_year: int = 0,
        season_label_zh: str = "",
    ) -> FashionTrendReport:
        """将 LLM JSON dict 转换为 FashionTrendReport Pydantic 模型"""

        def safe_list(v: Any) -> list:
            if isinstance(v, list):
                return v
            return []

        exact, by_norm, by_host_path = _build_image_url_indexes(articles)
        article_image_lookup, all_article_images = _build_article_image_lookup(articles)

        # 解析 key_trends
        key_trends: list[TrendItem] = []
        for t in safe_list(data.get("key_trends")):
            if not isinstance(t, dict):
                continue
            evidence_list: list[EvidenceItem] = []
            for ev in safe_list(t.get("supporting_evidence")):
                if isinstance(ev, dict):
                    evidence_list.append(
                        EvidenceItem(
                            site_name=ev.get("site_name", ""),
                            article_title=ev.get("article_title", ""),
                            article_url=ev.get("article_url", ""),
                            snippet=ev.get("snippet", ""),
                        )
                    )

            raw_selected = safe_list(t.get("selected_images"))
            selected_images = _resolve_selected_list(
                raw_selected, exact, by_norm, by_host_path, max_n=3
            )
            if not selected_images:
                selected_images = _fallback_images_for_evidence(
                    evidence_list,
                    article_image_lookup,
                    all_article_images,
                    max_n=3,
                )

            key_trends.append(
                TrendItem(
                    name=t.get("name", "") or t.get("trend_name", ""),
                    description=t.get("description", ""),
                    category=str(t.get("category", "") or "")[:120],
                    supporting_evidence=evidence_list,
                    related_colors=safe_list(t.get("related_colors")),
                    related_fabrics=safe_list(t.get("related_fabrics")),
                    related_items=safe_list(t.get("related_items")),
                    related_patterns=safe_list(t.get("related_patterns")),
                    related_silhouettes=safe_list(t.get("related_silhouettes")),
                    confidence=self._safe_float(t.get("confidence")),
                    selected_images=selected_images,
                )
            )

        # 解析全局 evidence
        global_evidence: list[EvidenceItem] = []
        for ev in safe_list(data.get("evidence")):
            if isinstance(ev, dict):
                global_evidence.append(
                    EvidenceItem(
                        site_name=ev.get("site_name", ""),
                        article_title=ev.get("article_title", ""),
                        article_url=ev.get("article_url", ""),
                        snippet=ev.get("snippet", ""),
                    )
                )

        today = local_now()
        covered_sites = list({art.site_name for art in articles if art.site_name})

        # 解析四大板块（款式/单品/版型/颜色）
        def parse_detail_list(key: str) -> list[StyleDetail]:
            result = []
            for d in safe_list(data.get(key)):
                if not isinstance(d, dict):
                    continue
                raw_imgs = safe_list(d.get("selected_images"))
                imgs = _resolve_selected_list(
                    raw_imgs, exact, by_norm, by_host_path, max_n=2
                )
                if not imgs:
                    imgs = _fallback_images_for_evidence(
                        [],
                        article_image_lookup,
                        all_article_images,
                        max_n=2,
                    )
                result.append(StyleDetail(
                    name=d.get("name", ""),
                    description=d.get("description", ""),
                    trend_direction=d.get("trend_direction", ""),
                    representative_brands=safe_list(d.get("representative_brands")),
                    style_tips=safe_list(d.get("style_tips")),
                    selected_images=imgs,
                    confidence=self._safe_float(d.get("confidence")),
                ))
            return result

        style_details = parse_detail_list("style_details")
        item_details = parse_detail_list("item_details")
        silhouette_details = parse_detail_list("silhouette_details")
        color_details = parse_detail_list("color_details")

        draft = FashionTrendReport(
            report_id=str(uuid.uuid4())[:12],
            report_date=today.strftime("%Y-%m-%d"),
            time_range=data.get("time_range", today.strftime("%Y-%m-%d")),
            summary=data.get("summary", ""),
            season_code=season_code or "",
            season_year=int(season_year or 0),
            season_label_zh=season_label_zh or "",
            season_bucket_id=season_bucket_id or "",
            key_trends=key_trends,
            colors=safe_list(data.get("colors")),
            fabrics=safe_list(data.get("fabrics")),
            silhouettes=safe_list(data.get("silhouettes")),
            items=safe_list(data.get("items")),
            patterns=safe_list(data.get("patterns")),
            style_keywords=safe_list(data.get("style_keywords")),
            consumer_signals=safe_list(data.get("consumer_signals")),
            confidence=self._safe_float(data.get("confidence")),
            evidence=global_evidence,
            source_articles=[art.unique_key for art in articles],
            covered_sites=covered_sites,
            llm_provider=settings.llm_provider,
            llm_model=settings.llm_model,
            token_usage=token_usage,
            batch_id=batch_id,
            style_details=style_details,
            item_details=item_details,
            silhouette_details=silhouette_details,
            color_details=color_details,
        )
        rep_imgs = _collect_representative_images(draft)
        return draft.model_copy(update={"representative_images": rep_imgs})

    def _empty_report(
        self,
        batch_id: Optional[str] = None,
        *,
        season_bucket_id: str = "",
        season_code: str = "",
        season_year: int = 0,
        season_label_zh: str = "",
    ) -> FashionTrendReport:
        """失败占位报告；摘要固定为 models.REPORT_FAILURE_PLACEHOLDER_SUMMARY，API 已从季节汇总与列表中排除。"""
        today = local_now()
        return FashionTrendReport(
            report_id=str(uuid.uuid4())[:12],
            report_date=today.strftime("%Y-%m-%d"),
            time_range=today.strftime("%Y-%m-%d"),
            summary=REPORT_FAILURE_PLACEHOLDER_SUMMARY,
            batch_id=batch_id or "",
            season_bucket_id=season_bucket_id or "",
            season_code=season_code or "",
            season_year=int(season_year or 0),
            season_label_zh=season_label_zh or "",
        )

    @staticmethod
    def _accumulate_tokens(
        total: dict[str, int], usage: dict[str, int]
    ) -> None:
        for k, v in usage.items():
            total[k] = total.get(k, 0) + v
