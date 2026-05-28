"""
search_workflow.py — 搜索优先的新工作流

流程：
1. 用 Qwen 原生 Web Search 直接读取页面标题/副标题/URL；
2. 用 DeepSeek 基于候选元信息挑选值得深抓的子文章；
3. 仅对入选 URL 做定向详情页抓取，复用现有 SiteScraper 的正文/图片提取逻辑。
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse, urlunparse

import aiohttp
import httpx
from loguru import logger
from playwright.async_api import async_playwright

from config import settings
from llm_analyzer import _call_llm, _extract_json_from_text
from models import Article, CrawlSession, SearchResultCandidate, SiteConfig
from scraper import LoginError, SiteScraper, _chromium_launch_kwargs
from utils import is_same_domain, matches_pattern


def _qwen_native_generation_url() -> str:
    """将当前 Qwen base_url 映射到 DashScope 原生 generation 接口。"""
    base = (settings.qwen_base_url or "").strip()
    if base.endswith("/api/v1/services/aigc/text-generation/generation"):
        return base
    parsed = urlparse(base) if base else None
    if parsed and parsed.scheme and parsed.netloc:
        return (
            f"{parsed.scheme}://{parsed.netloc}"
            "/api/v1/services/aigc/text-generation/generation"
        )
    return "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"


def _normalize_http_url(url: str) -> str:
    """轻量 URL 规范化，便于跨搜索结果去重。"""
    u = (url or "").strip()
    if not u:
        return ""
    if u.startswith("//"):
        u = "https:" + u
    if not u.startswith(("http://", "https://")):
        return u
    p = urlparse(u)
    path = p.path.rstrip("/") or "/"
    return urlunparse(
        (p.scheme.lower(), p.netloc.lower(), path, p.params, p.query, "")
    )


def _candidate_keyword_score(candidate: SearchResultCandidate) -> int:
    """在 LLM 选择失败时，用标题/副标题做兜底打分。"""
    blob = f"{candidate.title}\n{candidate.subtitle}\n{candidate.url}".lower()
    score = 0
    keywords = (
        "趋势", "流行", "秀场", "时装周", "春夏", "秋冬", "早秋", "度假",
        "色彩", "颜色", "面料", "廓形", "单品", "穿搭", "街拍", "look",
        "trend", "trends", "runway", "fashion week", "collection", "street style",
        "color", "palette", "fabric", "silhouette", "item", "editorial",
    )
    for kw in keywords:
        if kw in blob:
            score += 8 if kw in candidate.title.lower() else 4
    if any(x in blob for x in ("news_", "/article/info", "/trend/article/info")):
        score += 10
    if "pinterest" in blob:
        score -= 8
    if "登录" in blob or "会员" in blob or "付费" in blob:
        score -= 12
    return score


def _matches_entry_scope(url: str, cfg: SiteConfig) -> bool:
    """
    限制候选 URL 必须落在配置入口 URL 的路径范围内。
    例如 entry=/fashion/vogue/ 时，不允许 /shows/ 或 /tag/ 混入。
    """
    try:
        pu = urlparse(url)
        for entry in cfg.entry_urls:
            pe = urlparse(entry)
            if pu.netloc.lower() != pe.netloc.lower():
                continue
            entry_path = (pe.path or "/").rstrip("/") + "/"
            url_path = (pu.path or "/").rstrip("/") + "/"
            if url_path.startswith(entry_path):
                return True
    except Exception:
        return False
    return False


def _matches_vogue_vogue_scope(url: str) -> bool:
    """VogueCN 专用：仅允许 /fashion/vogue/ 栏目下的页面。"""
    try:
        pu = urlparse(url)
        if pu.netloc.lower() != "www.vogue.com.cn":
            return False
        path = (pu.path or "/").rstrip("/") + "/"
        return path.startswith("/fashion/")
    except Exception:
        return False


class QwenSearchClient:
    """Qwen 原生 Web Search 客户端。"""

    def __init__(self) -> None:
        self.endpoint = _qwen_native_generation_url()

    async def search(
        self,
        query: str,
        *,
        assigned_sites: list[str],
        max_results: int,
    ) -> list[SearchResultCandidate]:
        prompt = (
            f"请联网搜索与“{query}”最相关的时尚文章页面，且必须仅限 Vogue 中国的 /fashion/ 栏目下页面，优先详情页而非栏目页。"
            f"请整理不超过 {max_results} 条结果，并只输出 JSON：\n"
            "{\n"
            '  "results": [\n'
            '    {"title": "网页主标题", "subtitle": "一句话副标题/摘要", "url": "网页URL", "site_name": "站点名"}\n'
            "  ]\n"
            "}\n"
            "要求：副标题必须是对该页面主题的简短概括；若信息不足可留空字符串。"
        )
        payload = {
            "model": settings.qwen_model,
            "input": {
                "messages": [
                    {"role": "system", "content": "你是时尚资讯搜索助手。"},
                    {"role": "user", "content": prompt},
                ]
            },
            "parameters": {
                "result_format": "message",
                "enable_search": True,
                "search_options": {
                    "enable_source": True,
                    "search_strategy": settings.qwen_search_strategy,
                    "freshness": settings.search_freshness_days,
                    "assigned_site_list": assigned_sites,
                },
            },
        }
        headers = {
            "Authorization": f"Bearer {settings.qwen_api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(self.endpoint, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

        content = (
            data.get("output", {})
            .get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        search_results = (
            data.get("output", {})
            .get("search_info", {})
            .get("search_results", [])
        )
        logger.info(
            "Qwen search done | query={} results={} plugins={}",
            query,
            len(search_results),
            data.get("usage", {}).get("plugins", {}),
        )

        parsed = _extract_json_from_text(content) or {}
        parsed_items = parsed.get("results") if isinstance(parsed, dict) else []
        by_url: dict[str, SearchResultCandidate] = {}

        for item in search_results:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url", "")).strip()
            if not url:
                continue
            norm = _normalize_http_url(url)
            title = str(item.get("title", "")).strip()
            subtitle = ""
            for key in ("subtitle", "snippet", "summary", "desc", "description", "text"):
                val = item.get(key)
                if isinstance(val, str) and val.strip():
                    subtitle = val.strip()
                    break
            cand = SearchResultCandidate(
                query=query,
                site_name=str(item.get("site_name", "")).strip(),
                title=title,
                subtitle=subtitle,
                url=url,
                domain=urlparse(url).netloc.lower(),
                source_rank=int(item.get("index", 0) or 0),
            )
            by_url[norm] = cand

        if isinstance(parsed_items, list):
            for idx, item in enumerate(parsed_items, 1):
                if not isinstance(item, dict):
                    continue
                url = str(item.get("url", "")).strip()
                if not url:
                    continue
                norm = _normalize_http_url(url)
                current = by_url.get(norm)
                subtitle = str(item.get("subtitle", "")).strip()
                if current:
                    if subtitle and not current.subtitle:
                        current.subtitle = subtitle
                    if not current.title and item.get("title"):
                        current.title = str(item.get("title", "")).strip()
                    if not current.site_name and item.get("site_name"):
                        current.site_name = str(item.get("site_name", "")).strip()
                else:
                    by_url[norm] = SearchResultCandidate(
                        query=query,
                        site_name=str(item.get("site_name", "")).strip(),
                        title=str(item.get("title", "")).strip(),
                        subtitle=subtitle,
                        url=url,
                        domain=urlparse(url).netloc.lower(),
                        source_rank=idx,
                    )

        out = [c for c in by_url.values() if _matches_vogue_vogue_scope(c.url)]
        for cand in out:
            if not cand.subtitle:
                cand.subtitle = f"来自 {cand.site_name or cand.domain} 的时尚趋势相关文章"
        return out[:max_results]


class SearchResultSelector:
    """用分析模型从候选元信息中选择值得进一步抓取的文章。"""

    async def select(
        self,
        candidates: list[SearchResultCandidate],
        *,
        selected_limit: int,
    ) -> list[SearchResultCandidate]:
        effective_limit = len(candidates) if selected_limit <= 0 else selected_limit
        if selected_limit <= 0:
            selected_limit = effective_limit
        if len(candidates) <= selected_limit:
            for c in candidates:
                c.chosen_for_fetch = True
                c.selection_reason = "候选数未超过阈值，直接进入抓取"
            return candidates

        lines = []
        for idx, c in enumerate(candidates, 1):
            lines.append(
                f"[{idx}] 站点={c.site_name or c.domain} | 标题={c.title} | "
                f"副标题={c.subtitle or '无'} | URL={c.url}"
            )
        prompt = (
            "你是一名时尚情报主编。下面是一批候选网页的标题、副标题和 URL，"
            "请仅依据这些元信息挑选最值得进一步深抓并做趋势分析的页面。"
            f"请挑选不超过 {selected_limit} 条，优先：\n"
            "1. 直接涉及时尚趋势、秀场、系列、色彩、面料、廓形、单品、街拍趋势；\n"
            "2. 尽量覆盖不同主题或来源，避免重复；\n"
            "3. 详情页优先，避免栏目页、泛资讯页、纯商业公告；\n"
            "4. 若明显可能是付费墙、登录页或信息量很低，应降低优先级。\n\n"
            "只输出 JSON：\n"
            "{\n"
            '  "selected": [\n'
            '    {"url": "候选URL", "reason": "入选原因", "score": 0-100}\n'
            "  ]\n"
            "}\n\n"
            "候选列表：\n"
            + "\n".join(lines)
        )

        try:
            raw_text, _ = await _call_llm([{"role": "user", "content": prompt}])
            data = _extract_json_from_text(raw_text) or {}
            picks = data.get("selected") if isinstance(data, dict) else []
            by_url = {_normalize_http_url(c.url): c for c in candidates}
            selected: list[SearchResultCandidate] = []
            if isinstance(picks, list):
                for item in picks:
                    if not isinstance(item, dict):
                        continue
                    url = str(item.get("url", "")).strip()
                    norm = _normalize_http_url(url)
                    cand = by_url.get(norm)
                    if not cand or cand in selected:
                        continue
                    cand.chosen_for_fetch = True
                    cand.selection_reason = str(item.get("reason", "")).strip()
                    selected.append(cand)
                    if len(selected) >= selected_limit:
                        break
            if selected:
                return selected
        except Exception as exc:
            logger.warning("Search result LLM selection failed, fallback to heuristic: {}", exc)

        ranked = sorted(
            candidates,
            key=lambda c: (-_candidate_keyword_score(c), c.source_rank or 9999, c.url),
        )
        selected = ranked[:selected_limit]
        for cand in selected:
            cand.chosen_for_fetch = True
            cand.selection_reason = "LLM 选择失败，使用标题/URL 关键词启发式入选"
        return selected


class TargetedArticleFetcher:
    """仅抓取已选详情页 URL，复用现有 SiteScraper 提取逻辑。"""

    def __init__(self, site_configs: list[SiteConfig]) -> None:
        self.site_configs = [c for c in site_configs if c.enabled]
        self._seen_urls: set[str] = set()

    def _match_site_config(self, url: str) -> Optional[SiteConfig]:
        domain_matches = [
            cfg for cfg in self.site_configs if is_same_domain(url, cfg.allowed_domains)
        ]
        for cfg in domain_matches:
            if matches_pattern(url, cfg.detail_url_patterns) and _matches_entry_scope(url, cfg):
                return cfg
        if len(domain_matches) == 1:
            cfg = domain_matches[0]
            if _matches_entry_scope(url, cfg):
                return cfg
        return None

    async def fetch(
        self,
        candidates: list[SearchResultCandidate],
    ) -> tuple[list[Article], list[CrawlSession]]:
        grouped: dict[str, list[str]] = defaultdict(list)
        site_map: dict[str, SiteConfig] = {}
        sessions: list[CrawlSession] = []
        unmatched: list[str] = []

        for cand in candidates:
            cfg = self._match_site_config(cand.url)
            if not cfg:
                unmatched.append(cand.url)
                continue
            if cand.url not in grouped[cfg.site_name]:
                grouped[cfg.site_name].append(cand.url)
                site_map[cfg.site_name] = cfg

        if unmatched:
            logger.warning(
                "Some selected URLs could not match site config and were skipped: {}",
                unmatched[:8],
            )

        if not grouped:
            return [], sessions

        all_articles: list[Article] = []
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(**_chromium_launch_kwargs(headless=True))
            async with aiohttp.ClientSession() as http_session:
                for site_name, urls in grouped.items():
                    cfg = site_map[site_name]
                    session = CrawlSession(
                        site_name=cfg.site_name,
                        started_at=datetime.utcnow(),
                        articles_found=len(urls),
                    )
                    scraper = SiteScraper(
                        site_config=cfg,
                        browser=browser,
                        seen_urls=self._seen_urls,
                        image_session=http_session,
                    )
                    articles: list[Article] = []
                    try:
                        scraper.context = await scraper._create_context()
                        page = await scraper.context.new_page()
                        try:
                            if cfg.login.use_login and not await scraper._check_login_valid(page):
                                raise LoginError(
                                    f"[{cfg.site_name}] 登录态失效，请重新执行登录"
                                )
                        finally:
                            await page.close()

                        scraper._article_links = (
                            urls[: cfg.max_articles_per_run]
                            if (cfg.max_articles_per_run or 0) > 0
                            else list(urls)
                        )
                        articles = await scraper._scrape_articles(session)
                        await scraper._download_article_images(articles, session)
                        session.success = True
                        logger.info(
                            "Targeted fetch done | site={} selected={} fetched={} failed={}",
                            cfg.site_name,
                            len(urls),
                            len(articles),
                            session.articles_failed,
                        )
                    except Exception as exc:
                        session.errors.append(str(exc))
                        logger.error(
                            "Targeted fetch failed | site={} err={}",
                            cfg.site_name,
                            exc,
                        )
                    finally:
                        if scraper.context:
                            await scraper.context.close()
                        session.finished_at = datetime.utcnow()

                    all_articles.extend(articles)
                    sessions.append(session)
            await browser.close()

        return all_articles, sessions


class SearchFirstWorkflow:
    """对外编排：搜索候选 -> 元信息筛选 -> 定向抓取。"""

    def __init__(self, site_configs: list[SiteConfig]) -> None:
        self.site_configs = [c for c in site_configs if c.enabled]
        self.search_client = QwenSearchClient()
        self.selector = SearchResultSelector()
        self.fetcher = TargetedArticleFetcher(self.site_configs)

    def _assigned_sites(self) -> list[str]:
        sites: list[str] = []
        for cfg in self.site_configs:
            for domain in cfg.allowed_domains:
                d = str(domain or "").strip()
                if d and d not in sites:
                    sites.append(d)
        return sites

    def _build_queries(self) -> list[str]:
        years = [datetime.utcnow().year - 1, datetime.utcnow().year]
        year_blob = "/".join(str(y) for y in years)
        return [
            f"{year_blob} 时尚趋势 秀场 色彩 流行单品",
            f"{year_blob} 时装周 廓形 面料 趋势解析",
            f"{year_blob} fashion trends runway color palette key items",
        ]

    async def run(self) -> tuple[list[Article], list[CrawlSession], list[SearchResultCandidate]]:
        assigned_sites = self._assigned_sites()
        if not assigned_sites:
            logger.warning("Search-first workflow found no assigned sites")
            return [], [], []

        deduped: dict[str, SearchResultCandidate] = {}
        per_query_limit = max(30, settings.search_candidate_limit or 0)
        for query in self._build_queries():
            try:
                results = await self.search_client.search(
                    query,
                    assigned_sites=assigned_sites,
                    max_results=per_query_limit,
                )
            except Exception as exc:
                logger.error("Qwen search failed | query={} err={}", query, exc)
                continue
            for cand in results:
                norm = _normalize_http_url(cand.url)
                if not norm:
                    continue
                existing = deduped.get(norm)
                if existing is None:
                    deduped[norm] = cand
                elif cand.subtitle and not existing.subtitle:
                    deduped[norm].subtitle = cand.subtitle

        candidates = list(deduped.values())
        logger.info("Search-first candidates ready | count={}", len(candidates))
        if not candidates:
            return [], [], []

        selected = await self.selector.select(
            candidates,
            selected_limit=settings.search_selected_limit,
        )
        logger.info(
            "Search-first selection done | selected={} total={}",
            len(selected),
            len(candidates),
        )
        articles, sessions = await self.fetcher.fetch(selected)
        return articles, sessions, selected
