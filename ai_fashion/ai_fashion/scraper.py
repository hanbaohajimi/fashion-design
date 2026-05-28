"""
scraper.py — 多站点 Playwright 异步爬虫
支持：JS 渲染、分页/加载更多/无限滚动、懒加载图片、登录态复用、去重、失败隔离
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse

import aiohttp
from loguru import logger
from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    async_playwright,
)

from config import settings
from models import Article, CrawlSession, ImageItem, PaginationType, SiteConfig
from utils import (
    async_retry,
    clean_html,
    download_image,
    is_allowed_by_robots,
    is_same_domain,
    matches_pattern,
    normalize_url,
    now_str,
    parse_datetime_fuzzy,
    random_delay,
    remove_noise,
    truncate_text,
    url_hash,
)
from time_utils import local_now


class LoginError(Exception):
    """登录态失效或登录失败"""


def _extra_substring_rules(val: object) -> list[str]:
    """将 extra 中的 skip_if_* 配置规范为去重后的非空子串列表。"""
    if val is None:
        return []
    if isinstance(val, str):
        s = val.strip()
        return [s] if s else []
    if isinstance(val, list):
        out: list[str] = []
        for x in val:
            if isinstance(x, str) and x.strip():
                out.append(x.strip())
        return out
    return []


def _chromium_launch_kwargs(*, headless: bool) -> dict:
    """Chromium 启动参数；可选 HTTP 代理（与系统浏览器走代理分开，需单独配置）。"""
    kw: dict = {
        "headless": headless,
        "args": ["--no-sandbox", "--disable-setuid-sandbox"],
    }
    px = (settings.playwright_proxy_server or "").strip()
    if px:
        kw["proxy"] = {"server": px}
        logger.info("Playwright Chromium using proxy from PLAYWRIGHT_PROXY_SERVER")
    return kw


class SiteScraper:
    """
    单站点爬虫。
    每个实例对应一个 SiteConfig，管理该站点的 BrowserContext 与抓取逻辑。
    """

    def __init__(
        self,
        site_config: SiteConfig,
        browser: Browser,
        seen_urls: set[str],
        image_session: aiohttp.ClientSession,
    ) -> None:
        self.cfg = site_config
        self.browser = browser
        self.seen_urls = seen_urls          # 全局去重 URL 集合（跨站点共享）
        self.image_session = image_session
        self.context: Optional[BrowserContext] = None
        self._article_links: list[str] = []

    # ──────────────────────────────────────────
    # 上下文管理
    # ──────────────────────────────────────────

    async def _create_context(self) -> BrowserContext:
        """创建浏览器上下文，若站点需要登录则加载 storage_state"""
        kwargs: dict = {
            "user_agent": settings.user_agent,
            "viewport": {"width": 1280, "height": 800},
            "locale": "zh-CN,en-US",
        }

        cfg = self.cfg.login
        if cfg.use_login and cfg.storage_state_path:
            state_path = Path(cfg.storage_state_path)
            if state_path.exists():
                kwargs["storage_state"] = str(state_path)
                logger.info(
                    "[{}] Loading storage_state from {}",
                    self.cfg.site_name,
                    state_path,
                )
            else:
                logger.warning(
                    "[{}] storage_state not found: {} — running without login",
                    self.cfg.site_name,
                    state_path,
                )

        return await self.browser.new_context(**kwargs)

    async def _goto_with_network_fallback(self, page: Page, url: str) -> None:
        """
        先等 networkidle；失败则降级为 domcontentloaded（长连接/分析脚本多的站点更稳）。
        """
        timeout_ms = settings.request_timeout * 1000
        try:
            await page.goto(url, timeout=timeout_ms, wait_until="networkidle")
        except Exception as exc:
            logger.debug(
                "[{}] goto networkidle failed, fallback domcontentloaded: {}",
                self.cfg.site_name,
                exc,
            )
            await page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
            # 对重度前端渲染页面留出轻量稳定时间，避免标题/正文节点尚未挂载
            await asyncio.sleep(1.5)

    async def _check_login_valid(self, page: Page) -> bool:
        """
        检查登录态是否有效。
        策略：尝试访问第一个入口 URL，检测是否被重定向到登录页。
        """
        if not self.cfg.login.use_login:
            return True
        try:
            url = self.cfg.entry_urls[0]
            login_url = self.cfg.login.login_url
            await page.goto(url, timeout=settings.request_timeout * 1000, wait_until="domcontentloaded")
            current = page.url
            if login_url and login_url in current:
                logger.warning(
                    "[{}] Login state expired — redirected to login page: {}",
                    self.cfg.site_name,
                    current,
                )
                return False
        except Exception as exc:
            logger.warning("[{}] Login check error: {}", self.cfg.site_name, exc)
        return True

    # ──────────────────────────────────────────
    # 主入口
    # ──────────────────────────────────────────

    async def run(self) -> CrawlSession:
        """
        执行该站点的完整抓取流程。
        失败时返回 CrawlSession 并记录错误，不向上抛异常（站点级隔离）。
        """
        session = CrawlSession(site_name=self.cfg.site_name)

        if not self.cfg.enabled:
            logger.info("[{}] Site disabled, skipping.", self.cfg.site_name)
            session.success = True
            session.finished_at = local_now()
            return session

        ok, errors = self.cfg.is_valid()
        if not ok:
            msg = f"Site config invalid: {errors}"
            logger.error("[{}] {}", self.cfg.site_name, msg)
            session.errors.append(msg)
            session.finished_at = local_now()
            return session

        try:
            self.context = await self._create_context()
            page = await self.context.new_page()

            # 检查登录态
            if self.cfg.login.use_login:
                if not await self._check_login_valid(page):
                    raise LoginError(
                        f"[{self.cfg.site_name}] 登录态失效，请运行 "
                        f"`python main.py login --site {self.cfg.site_name}` 重新登录"
                    )

            # 收集文章链接
            await self._collect_article_links(page, session)

            # 逐篇抓取（每篇独立 Page，避免并发 goto 抢同一标签页）
            articles = await self._scrape_articles(session)

            # 下载图片
            await self._download_article_images(articles, session)

            session.success = True
            logger.info(
                "[{}] Done: found={} new={} failed={} images={}",
                self.cfg.site_name,
                session.articles_found,
                session.articles_new,
                session.articles_failed,
                session.images_downloaded,
            )
            return articles, session  # type: ignore[return-value]

        except LoginError as exc:
            msg = str(exc)
            logger.error("{}", msg)
            logger.error(
                "⚠️  请手动运行: python main.py login --site {}",
                self.cfg.site_name,
            )
            session.errors.append(msg)
        except Exception as exc:
            msg = f"Unexpected error in site {self.cfg.site_name}: {exc}"
            logger.exception(msg)
            session.errors.append(msg)
        finally:
            if self.context:
                await self.context.close()
            session.finished_at = local_now()

        return [], session  # type: ignore[return-value]

    # ──────────────────────────────────────────
    # 链接收集（列表页 + 分页）
    # ──────────────────────────────────────────

    async def _collect_article_links(self, page: Page, session: CrawlSession) -> None:
        """从所有入口 URL 收集文章详情页链接"""
        links: set[str] = set()
        run_limit = self.cfg.max_articles_per_run or 0

        for entry_url in self.cfg.entry_urls:
            if not is_allowed_by_robots(entry_url, settings.user_agent):
                logger.warning(
                    "[{}] Entry URL blocked by robots.txt: {}",
                    self.cfg.site_name,
                    entry_url,
                )
                continue

            page_links = await self._collect_from_entry(page, entry_url, run_limit)
            links.update(page_links)

            if run_limit > 0 and len(links) >= run_limit:
                break

        self._article_links = list(links) if run_limit <= 0 else list(links)[:run_limit]
        session.articles_found = len(self._article_links)
        logger.info(
            "[{}] Collected {} article links",
            self.cfg.site_name,
            len(self._article_links),
        )

    async def _collect_from_entry(
        self,
        page: Page,
        entry_url: str,
        run_limit: int = 0,
    ) -> set[str]:
        """从单个入口 URL 收集链接，支持多种分页方式"""
        links: set[str] = set()
        current_url = entry_url
        page_num = 0

        while page_num < self.cfg.max_pages:
            try:
                await async_retry(
                    self._goto_page,
                    page,
                    current_url,
                    max_retries=settings.retry_times,
                    min_wait=settings.retry_min_wait,
                    max_wait=settings.retry_max_wait,
                )
            except Exception as exc:
                logger.error(
                    "[{}] Failed to load {}: {}",
                    self.cfg.site_name,
                    current_url,
                    exc,
                )
                break

            # 提取当前页面的文章链接
            new_links = await self._extract_article_links(page, current_url)
            links.update(new_links)

            if run_limit > 0 and len(links) >= run_limit:
                break

            # 处理分页
            next_url = await self._get_next_page(page, current_url, page_num)
            if not next_url:
                break

            current_url = next_url
            page_num += 1
            await random_delay(
                self.cfg.request_delay_min,
                self.cfg.request_delay_max,
            )

        return links

    async def _goto_page(self, page: Page, url: str) -> None:
        """导航到指定页面并等待内容加载"""
        await self._goto_with_network_fallback(page, url)
        # 触发懒加载图片：模拟滚动
        await self._scroll_page(page)

    async def _scroll_page(self, page: Page, steps: int = 5) -> None:
        """分步滚动页面以触发懒加载"""
        for i in range(steps):
            await page.evaluate(
                f"window.scrollTo(0, document.body.scrollHeight * {(i + 1) / steps})"
            )
            await asyncio.sleep(0.3)

    async def _extract_article_links(
        self, page: Page, base_url: str
    ) -> set[str]:
        """从当前页面提取符合条件的文章链接"""
        selector = self.cfg.selectors.article_link_selector
        if not selector:
            logger.warning(
                "[{}] article_link_selector not configured — skipping link extraction",
                self.cfg.site_name,
            )
            return set()

        links: set[str] = set()
        # 一些站点（如 Pantone）入口页本身即为趋势详情页，先尝试纳入当前页 URL。
        if (
            is_same_domain(base_url, self.cfg.allowed_domains)
            and matches_pattern(base_url, self.cfg.detail_url_patterns)
            and base_url not in self.seen_urls
        ):
            links.add(base_url)
        try:
            elements = await page.query_selector_all(selector)
            for el in elements:
                href = await el.get_attribute("href")
                if not href:
                    continue
                href = href.strip()
                if (
                    href.startswith("#")
                    or href.lower().startswith("javascript:")
                    or href.lower().startswith("mailto:")
                    or href.lower().startswith("tel:")
                ):
                    continue
                abs_url = normalize_url(href, base_url)
                # 统一去掉 fragment，减少同页重复链接
                abs_url = abs_url.split("#", 1)[0]
                if not is_same_domain(abs_url, self.cfg.allowed_domains):
                    continue
                if not matches_pattern(abs_url, self.cfg.detail_url_patterns):
                    continue
                if abs_url in self.seen_urls:
                    continue
                links.add(abs_url)
        except Exception as exc:
            logger.warning(
                "[{}] Error extracting links: {}", self.cfg.site_name, exc
            )

        return links

    async def _get_next_page(
        self, page: Page, current_url: str, current_page: int
    ) -> Optional[str]:
        """根据分页类型获取下一页 URL"""
        ptype = self.cfg.pagination_type

        if ptype == PaginationType.NONE:
            return None

        elif ptype == PaginationType.NEXT_PAGE:
            sel = self.cfg.selectors.next_page_selector
            if not sel:
                return None
            try:
                el = await page.query_selector(sel)
                if not el:
                    return None
                href = await el.get_attribute("href")
                if not href:
                    return None
                return normalize_url(href, current_url)
            except Exception:
                return None

        elif ptype == PaginationType.LOAD_MORE:
            sel = self.cfg.selectors.load_more_selector
            if not sel:
                return None
            try:
                btn = await page.query_selector(sel)
                if not btn or not await btn.is_visible():
                    return None
                await btn.click()
                await page.wait_for_load_state("networkidle", timeout=10_000)
                await self._scroll_page(page)
                return current_url  # 同 URL，内容已追加
            except Exception as exc:
                logger.debug("[{}] Load more failed: {}", self.cfg.site_name, exc)
                return None

        elif ptype == PaginationType.INFINITE_SCROLL:
            prev_height = await page.evaluate("document.body.scrollHeight")
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(2)
            new_height = await page.evaluate("document.body.scrollHeight")
            if new_height > prev_height:
                return current_url
            return None

        elif ptype == PaginationType.URL_PARAM:
            # 例如 ?page=2 参数翻页
            # TODO: 按站点配置决定 page param 名称和步长
            page_num = current_page + 2  # current_page 从 0 开始
            if "?" in current_url:
                base = re.sub(r"[?&]page=\d+", "", current_url)
                sep = "&" if "?" in base else "?"
                return f"{base}{sep}page={page_num}"
            else:
                return f"{current_url}?page={page_num}"

        return None

    async def _should_skip_article_per_extra(
        self,
        page: Page,
        url: str,
        title: str,
        summary: str,
        content: str,
    ) -> tuple[bool, str]:
        """
        按站点 extra 排除不入库的稿件（如付费墙）。
        支持：
        - skip_if_url_contains：URL 子串（字符串或列表）
        - skip_if_title_or_body_contains：标题+摘要+正文合并后子串匹配（不区分大小写）
        - skip_if_page_text_contains：整页 innerText 子串匹配（不区分大小写）
        """
        ex = self.cfg.extra
        if not isinstance(ex, dict) or not ex:
            return False, ""

        for sub in _extra_substring_rules(ex.get("skip_if_url_contains")):
            if sub in url:
                return True, f"url 含 {sub!r}"

        blob = f"{title}\n{summary}\n{content}".lower()
        for sub in _extra_substring_rules(ex.get("skip_if_title_or_body_contains")):
            if sub.lower() in blob:
                return True, f"标题/正文含 {sub!r}"

        page_rules = _extra_substring_rules(ex.get("skip_if_page_text_contains"))
        if page_rules:
            try:
                page_text = await page.evaluate(
                    "() => (document.body && document.body.innerText) || ''"
                )
            except Exception:
                page_text = ""
            pt = (page_text or "").lower()
            for sub in page_rules:
                if sub.lower() in pt:
                    return True, f"页面全文含 {sub!r}"

        return False, ""

    # ──────────────────────────────────────────
    # 文章详情页抓取
    # ──────────────────────────────────────────

    async def _scrape_articles(self, session: CrawlSession) -> list[Article]:
        """逐篇抓取文章，单篇失败不影响其他篇；每篇使用独立 Page，支持并发且不抢同一导航。"""
        if not self.context:
            logger.error("[{}] No browser context — cannot scrape articles", self.cfg.site_name)
            return []

        articles: list[Article] = []
        sem = asyncio.Semaphore(settings.max_concurrency)

        async def scrape_one(url: str) -> Optional[Article]:
            async with sem:
                page = await self.context.new_page()
                try:
                    from scheduler import wait_if_paused

                    await wait_if_paused()
                    article = await async_retry(
                        self._scrape_article_page,
                        page,
                        url,
                        max_retries=settings.retry_times,
                        min_wait=settings.retry_min_wait,
                        max_wait=settings.retry_max_wait,
                    )
                    if article:
                        self.seen_urls.add(url)
                        session.articles_new += 1
                    await random_delay(
                        self.cfg.request_delay_min,
                        self.cfg.request_delay_max,
                    )
                    return article
                except Exception as exc:
                    session.articles_failed += 1
                    session.errors.append(f"Article failed [{url}]: {exc}")
                    logger.error(
                        "[{}] Article scrape failed [{}]: {}",
                        self.cfg.site_name,
                        url,
                        exc,
                    )
                    return None
                finally:
                    await page.close()

        tasks = [scrape_one(url) for url in self._article_links]
        results = await asyncio.gather(*tasks)
        articles = [a for a in results if a is not None]
        return articles

    async def _scrape_article_page(self, page: Page, url: str) -> Optional[Article]:
        """抓取单篇文章详情页并提取字段"""
        if not is_allowed_by_robots(url, settings.user_agent):
            logger.warning("[{}] Article blocked by robots.txt: {}", self.cfg.site_name, url)
            return None

        await self._goto_with_network_fallback(page, url)
        await self._scroll_page(page)

        s = self.cfg.selectors

        # 慢渲染 / SPA：先等待标题选择器进入 DOM，再读 inner_text（避免 domcontentloaded 后仍无 h1）
        if s.title_selector:
            wait_title_ms = min(20_000, max(3_000, int(settings.request_timeout * 500)))
            try:
                await page.wait_for_selector(
                    s.title_selector,
                    state="attached",
                    timeout=wait_title_ms,
                )
            except Exception:
                pass

        async def safe_text(selector: str, default: str = "") -> str:
            if not selector:
                return default
            try:
                el = await page.query_selector(selector)
                if not el:
                    return default
                text = (await el.inner_text()).strip()
                if text:
                    return text
                # 对 <meta> / <time> 等无 inner_text 节点做属性兜底
                for attr in ("content", "datetime", "value"):
                    v = await el.get_attribute(attr)
                    if v and v.strip():
                        return v.strip()
                return default
            except Exception:
                return default

        async def safe_meta(meta_selector: str, attr: str = "content", default: str = "") -> str:
            """读取 meta/time 等属性文本"""
            if not meta_selector:
                return default
            try:
                el = await page.query_selector(meta_selector)
                if not el:
                    return default
                val = await el.get_attribute(attr)
                return val.strip() if val else default
            except Exception:
                return default

        async def infer_published_at() -> Optional[datetime]:
            """
            多级发布时间推断：
            1) 配置选择器
            2) 常见 meta 字段
            3) JSON-LD articlePublished/PublishedTime
            4) URL 中日期（如 /2026/04/25/）
            """
            raw = await safe_text(s.published_at_selector)
            if not raw and s.published_at_selector:
                # 兼容选择器命中的是 meta/time 属性节点
                for attr in ("content", "datetime", "value"):
                    raw = await safe_meta(s.published_at_selector, attr=attr)
                    if raw:
                        break
            if not raw:
                candidates = [
                    "meta[property='article:published_time']",
                    "meta[name='publishdate']",
                    "meta[name='pubdate']",
                    "meta[name='date']",
                    "time[datetime]",
                ]
                for selector in candidates:
                    for attr in ("content", "datetime"):
                        raw = await safe_meta(selector, attr=attr)
                        if raw:
                            break
                    if raw:
                        break
            if raw:
                dt = parse_datetime_fuzzy(raw)
                if dt:
                    return dt

            # JSON-LD 兜底
            try:
                ld_json_texts = await page.eval_on_selector_all(
                    "script[type='application/ld+json']",
                    "els => els.map(e => e.textContent || '')",
                )
                for txt in ld_json_texts or []:
                    if not txt:
                        continue
                    try:
                        data = json.loads(txt)
                    except Exception:
                        continue
                    objects = data if isinstance(data, list) else [data]
                    for obj in objects:
                        if not isinstance(obj, dict):
                            continue
                        for k in ("datePublished", "dateCreated", "uploadDate"):
                            if k in obj and obj[k]:
                                dt = parse_datetime_fuzzy(str(obj[k]))
                                if dt:
                                    return dt
            except Exception:
                pass

            # URL 日期兜底：/YYYY/MM/DD/
            m = re.search(r"/(20\d{2})/(0?[1-9]|1[0-2])/(0?[1-9]|[12]\d|3[01])(?:/|$)", url)
            if m:
                y, mo, d = m.group(1), m.group(2), m.group(3)
                return parse_datetime_fuzzy(f"{y}-{mo}-{d}")
            return None

        async def safe_texts(selector: str) -> list[str]:
            if not selector:
                return []
            try:
                els = await page.query_selector_all(selector)
                return [(await el.inner_text()).strip() for el in els if el]
            except Exception:
                return []

        title = await safe_text(s.title_selector)
        if not title:
            for selector in ("h1", "h2", "[role='heading']"):
                title = await safe_text(selector)
                if title:
                    break
        if not title:
            for meta_sel in (
                "meta[property='og:title']",
                "meta[name='twitter:title']",
                "meta[name='og:title']",
                "meta[name='description']",
            ):
                title = await safe_meta(meta_sel)
                if title:
                    break
        if not title:
            try:
                doc_title = (await page.title()).strip()
                if doc_title and len(doc_title) >= 6:
                    title = doc_title
            except Exception:
                pass
        if not title:
            logger.debug(
                "[{}] No title found at {}, skipping", self.cfg.site_name, url
            )
            return None

        raw_content_html = ""
        content = ""
        content_selectors = [s.content_selector] if s.content_selector else []
        # 通用正文兜底：降低站点结构轻微变化导致的抓空概率
        content_selectors.extend(
            ["article", "main article", "main", "[class*='content']", "[class*='article']"]
        )
        try:
            for selector in content_selectors:
                if not selector:
                    continue
                el = await page.query_selector(selector)
                if not el:
                    continue
                html = await el.inner_html()
                txt = truncate_text(
                    remove_noise(clean_html(html)),
                    settings.max_content_length,
                )
                # 过滤明显过短的“正文”，避免抓到导航/页脚
                if len(txt.strip()) < 60:
                    continue
                raw_content_html = html
                content = txt
                break
        except Exception as exc:
            logger.debug(
                "[{}] Content extraction error at {}: {}",
                self.cfg.site_name,
                url,
                exc,
            )

        author = await safe_text(s.author_selector)
        published_at = await infer_published_at()
        summary = await safe_text(s.summary_selector)
        category = await safe_text(s.category_selector)
        tags = await safe_texts(s.tags_selector)

        # 标题摘要兜底：避免摘要为空时完全缺失上下文
        if not summary and content:
            summary = truncate_text(content, 180)

        # 正文兜底：结构化正文抓空时，回落到 body 纯文本（尽量保可读信息）
        if not content:
            try:
                body_html = await page.content()
                fallback_content = truncate_text(
                    remove_noise(clean_html(body_html)),
                    settings.max_content_length,
                )
                if len(fallback_content.strip()) >= 80:
                    content = fallback_content
            except Exception:
                pass

        skip, skip_reason = await self._should_skip_article_by_extra(
            page, url, title, summary, content
        )
        if skip:
            logger.info(
                "[{}] Skip article (not in library): {} — {}",
                self.cfg.site_name,
                url,
                skip_reason,
            )
            return None

        skip, skip_reason = await self._should_skip_article_per_extra(
            page, url, title, summary or "", content or ""
        )
        if skip:
            logger.info(
                "[{}] 跳过不入库（extra 规则）| {} | {}",
                self.cfg.site_name,
                url,
                skip_reason,
            )
            return None

        # 图片提取（含懒加载 data-src）
        image_urls = await self._extract_images(page, url)

        # 保存原始 HTML（可选）
        raw_html_path = ""
        try:
            html_dir = settings.get_raw_dir() / self.cfg.site_name
            html_dir.mkdir(parents=True, exist_ok=True)
            html_file = html_dir / (url_hash(url) + ".html")
            html_file.write_text(
                await page.content(), encoding="utf-8", errors="replace"
            )
            raw_html_path = str(html_file)
        except Exception as exc:
            logger.debug("[{}] Could not save raw HTML: {}", self.cfg.site_name, exc)

        return Article(
            site_name=self.cfg.site_name,
            source=urlparse(url).netloc,
            category=category,
            tags=tags,
            title=title,
            content=content,
            raw_content=raw_content_html[:5000],
            summary=summary,
            author=author,
            published_at=published_at,
            article_url=url,
            image_urls=image_urls,
            raw_html_path=raw_html_path,
        )

    async def _should_skip_article_by_extra(
        self, page: Page, url: str, title: str, summary: str, content: str
    ) -> tuple[bool, str]:
        """
        站点 yaml 中 extra 可选规则（不入库、不参与分析）：
        - skip_if_url_contains: 子串列表，匹配 article URL（不区分大小写）
        - skip_if_title_or_body_contains: 子串列表，匹配标题+摘要+正文（不区分大小写）
        - skip_if_page_text_contains: 子串列表，匹配 document.body.innerText（不区分大小写）
        """
        ex = self.cfg.extra
        if not isinstance(ex, dict) or not ex:
            return False, ""

        url_l = (url or "").lower()
        for sub in ex.get("skip_if_url_contains") or []:
            if not isinstance(sub, str) or not sub.strip():
                continue
            if sub.strip().lower() in url_l:
                return True, f"url contains {sub.strip()!r}"

        blob = f"{title or ''}\n{summary or ''}\n{content or ''}".lower()
        for sub in ex.get("skip_if_title_or_body_contains") or []:
            if not isinstance(sub, str) or not sub.strip():
                continue
            if sub.strip().lower() in blob:
                return True, f"title/body contains {sub.strip()!r}"

        subs = ex.get("skip_if_page_text_contains") or []
        if subs:
            page_text = ""
            try:
                page_text = (
                    await page.evaluate(
                        "() => (document.body && document.body.innerText) || ''"
                    )
                    or ""
                ).lower()
            except Exception:
                page_text = ""
            for sub in subs:
                if not isinstance(sub, str) or not sub.strip():
                    continue
                if sub.strip().lower() in page_text:
                    return True, f"page text contains {sub.strip()!r}"

        return False, ""

    async def _extract_images(self, page: Page, base_url: str) -> list[str]:
        """提取页面中的图片 URL（支持懒加载 data-src 属性）"""
        sel = self.cfg.selectors.image_selector
        if not sel:
            sel = "img"  # 默认选所有 img

        urls: list[str] = []
        try:
            els = await page.query_selector_all(sel)
            for el in els:
                # 优先 src，其次 data-src（懒加载）、data-lazy-src 等
                for attr in ("src", "data-src", "data-lazy-src", "data-original"):
                    href = await el.get_attribute(attr)
                    if href and href.startswith(("http", "//")):
                        url = normalize_url(href.lstrip("/"), base_url)
                        if url not in urls:
                            urls.append(url)
                        break
        except Exception as exc:
            logger.debug("[{}] Image extraction error: {}", self.cfg.site_name, exc)

        return urls[: settings.max_images_per_article * 2]  # 预留裁剪空间

    # ──────────────────────────────────────────
    # 图片下载
    # ──────────────────────────────────────────

    async def _download_article_images(
        self, articles: list[Article], session: CrawlSession
    ) -> None:
        """批量下载所有文章图片"""
        date_str = now_str()
        save_dir = settings.get_images_dir(date_str)
        sem = asyncio.Semaphore(settings.max_concurrency)

        async def dl(article: Article, url: str) -> Optional[ImageItem]:
            async with sem:
                path = await download_image(url, save_dir, self.image_session)
                if path:
                    session.images_downloaded += 1
                    return ImageItem(
                        original_url=url,
                        local_path=str(path),
                        downloaded=True,
                    )
                return ImageItem(original_url=url, downloaded=False)

        for article in articles:
            # 限制每篇传给 LLM 的图片数
            selected_urls = article.image_urls[: settings.max_images_per_article]
            tasks = [dl(article, url) for url in selected_urls]
            results = await asyncio.gather(*tasks)
            article.images = [r for r in results if r is not None]


# ─────────────────────────────────────────────
# 多站点协调器
# ─────────────────────────────────────────────

class MultiSiteCrawler:
    """
    多站点抓取协调器。
    每个站点独立运行，失败不影响其他站点。
    """

    def __init__(self, site_configs: list[SiteConfig]) -> None:
        self.site_configs = [c for c in site_configs if c.enabled]
        self._seen_urls: set[str] = set()

    async def run_all(self) -> tuple[list[Article], list[CrawlSession]]:
        """
        并行/顺序运行所有站点抓取。
        当前实现：顺序运行（保守策略，减轻目标服务器压力）。
        """
        all_articles: list[Article] = []
        all_sessions: list[CrawlSession] = []

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(**_chromium_launch_kwargs(headless=True))
            async with aiohttp.ClientSession() as http_session:
                for cfg in self.site_configs:
                    # 支持运行中暂停：在站点边界等待恢复
                    from scheduler import wait_if_paused
                    await wait_if_paused()
                    logger.info("=" * 60)
                    logger.info(
                        "Starting site: {} ({} entry URLs)",
                        cfg.site_name,
                        len(cfg.entry_urls),
                    )
                    scraper = SiteScraper(
                        site_config=cfg,
                        browser=browser,
                        seen_urls=self._seen_urls,
                        image_session=http_session,
                    )
                    result = await scraper.run()

                    # run() 返回 (articles, session) 或 ([], session)
                    if isinstance(result, tuple):
                        articles, session = result
                        all_articles.extend(articles)
                        all_sessions.append(session)
                    else:
                        # 兼容只返回 session 的情况
                        all_sessions.append(result)

            await browser.close()

        logger.info(
            "All sites done: total_articles={} total_sessions={}",
            len(all_articles),
            len(all_sessions),
        )
        return all_articles, all_sessions


# ─────────────────────────────────────────────
# 首次登录工具函数（交互式）
# ─────────────────────────────────────────────

async def interactive_login(site_config: SiteConfig) -> None:
    """
    交互式首次登录：打开可见浏览器，等待用户手动登录，
    然后保存 storage_state.json 供后续无人值守任务使用。
    """
    cfg = site_config.login
    if not cfg.login_url:
        logger.error(
            "[{}] login_url not configured in site config",
            site_config.site_name,
        )
        return

    state_path = Path(cfg.storage_state_path or f"storage_states/{site_config.site_name}.json")
    state_path.parent.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**_chromium_launch_kwargs(headless=False))
        context = await browser.new_context(user_agent=settings.user_agent)
        page = await context.new_page()

        logger.info(
            "[{}] Opening login page: {}", site_config.site_name, cfg.login_url
        )
        await page.goto(cfg.login_url)

        print("\n" + "=" * 60)
        print(f"[{site_config.site_name}] 请在浏览器中完成登录操作。")
        print(f"登录完成后，回到此终端按 ENTER 键保存登录状态。")
        print("=" * 60)
        input()

        await context.storage_state(path=str(state_path))
        logger.info(
            "[{}] storage_state saved to: {}", site_config.site_name, state_path
        )
        await browser.close()
