"""
utils.py — 通用工具函数
包含：日志初始化、文本清洗、robots.txt 检查、随机延迟、指数退避重试、图片下载、哈希等
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import mimetypes
import random
import re
import sys
import time
import urllib.robotparser
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urljoin, urlparse

import aiohttp
import httpx
from bs4 import BeautifulSoup
from loguru import logger

from config import settings
from time_utils import local_now

# ─────────────────────────────────────────────
# 日志初始化
# ─────────────────────────────────────────────

def setup_logger() -> None:
    """初始化 loguru logger，同时输出到控制台与文件"""
    log_dir = settings.get_log_dir()
    logger.remove()  # 移除默认 handler
    use_enqueue = sys.platform != "win32"

    # 控制台 - INFO+
    logger.add(
        sys.stdout,
        level="INFO",
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{line}</cyan> — <level>{message}</level>"
        ),
        colorize=True,
    )

    # 文件 - DEBUG+，按天轮转，保留 30 天
    logger.add(
        str(log_dir / "pipeline_{time:YYYY-MM-DD}.log"),
        level="DEBUG",
        rotation="00:00",
        retention="30 days",
        encoding="utf-8",
        format=(
            "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | "
            "{name}:{line} — {message}"
        ),
        enqueue=use_enqueue,  # Windows 环境下避免 multiprocessing 队列初始化失败
    )

    # 错误专用文件
    logger.add(
        str(log_dir / "errors_{time:YYYY-MM-DD}.log"),
        level="ERROR",
        rotation="00:00",
        retention="30 days",
        encoding="utf-8",
        enqueue=use_enqueue,
    )

    logger.info("Logger initialized | log_dir={}", log_dir)


# ─────────────────────────────────────────────
# 文本清洗
# ─────────────────────────────────────────────

# 常见广告/噪声关键词（可按需扩展）
_AD_PATTERNS = re.compile(
    r"(广告|Advertisement|Sponsored|Cookie|订阅|Subscribe Now|Newsletter"
    r"|点击这里|Click here|加入我们|Follow us|转载自|来源：)",
    re.IGNORECASE,
)

_WHITESPACE_RE = re.compile(r"\s{2,}")
_SCRIPT_STYLE_RE = re.compile(
    r"<(script|style|noscript|iframe)[^>]*>.*?</\1>",
    re.DOTALL | re.IGNORECASE,
)


def clean_html(raw_html: str) -> str:
    """去 HTML 标签、脚本、样式，保留纯文本"""
    # 先移除 script/style 块
    cleaned = _SCRIPT_STYLE_RE.sub("", raw_html)
    soup = BeautifulSoup(cleaned, "lxml")
    text = soup.get_text(separator="\n")
    return _WHITESPACE_RE.sub(" ", text).strip()


def remove_noise(text: str) -> str:
    """去广告/噪声行"""
    lines = text.splitlines()
    cleaned = [line for line in lines if not _AD_PATTERNS.search(line)]
    return "\n".join(cleaned).strip()


def truncate_text(text: str, max_chars: int) -> str:
    """截断文本到 max_chars，尽量在句子边界截断"""
    if len(text) <= max_chars:
        return text
    # 找最近的句号/换行
    truncated = text[:max_chars]
    for sep in ("。", ".\n", ". ", "\n", " "):
        idx = truncated.rfind(sep)
        if idx > max_chars * 0.8:
            return truncated[: idx + 1] + "…"
    return truncated + "…"


def chunk_text(text: str, chunk_size: int = 3000, overlap: int = 200) -> list[str]:
    """
    将长文本按段落分块，用于分块摘要策略。
    overlap 保证相邻块有上下文重叠。
    """
    if len(text) <= chunk_size:
        return [text]

    chunks: list[str] = []
    paragraphs = text.split("\n")
    current = ""

    for para in paragraphs:
        if len(current) + len(para) + 1 > chunk_size:
            if current:
                chunks.append(current.strip())
                # 保留 overlap 字符作为下一块的前缀
                current = current[-overlap:] + "\n" + para
            else:
                # 单段过长，强制截断
                chunks.append(para[:chunk_size])
                current = para[chunk_size - overlap :]
        else:
            current = current + "\n" + para if current else para

    if current.strip():
        chunks.append(current.strip())

    return chunks


def deduplicate_by_key(items: list[dict], key: str) -> list[dict]:
    """按指定 key 去重列表"""
    seen: set[str] = set()
    result: list[dict] = []
    for item in items:
        val = item.get(key, "")
        if val and val not in seen:
            seen.add(val)
            result.append(item)
    return result


# ─────────────────────────────────────────────
# robots.txt 合规检查
# ─────────────────────────────────────────────

# 成功加载的解析器，或 None 表示拉取 robots.txt 失败（按日志「assuming allowed」整站放行该 origin）
_robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def _get_robots_parser(base_url: str) -> urllib.robotparser.RobotFileParser | None:
    """缓存并返回指定站点的 robots.txt 解析器；拉取失败时返回 None（调用方应视为允许）。"""
    parsed = urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin in _robots_cache:
        return _robots_cache[origin]

    rp = urllib.robotparser.RobotFileParser()
    robots_url = f"{origin}/robots.txt"
    rp.set_url(robots_url)
    try:
        rp.read()
        logger.debug("Loaded robots.txt from {}", robots_url)
        _robots_cache[origin] = rp
        return rp
    except Exception as exc:
        logger.warning("Cannot fetch robots.txt from {} — assuming allowed: {}", robots_url, exc)
        _robots_cache[origin] = None
        return None


def is_allowed_by_robots(url: str, user_agent: str = "*") -> bool:
    """
    检查 URL 是否被 robots.txt 允许。
    若 settings.respect_robots_txt=False 则始终返回 True（不推荐）。
    若无法拉取 robots.txt（网络/SSL 等），与日志一致：视为允许，避免误拦整站。
    """
    if not settings.respect_robots_txt:
        return True
    try:
        rp = _get_robots_parser(url)
        if rp is None:
            return True
        return rp.can_fetch(user_agent, url)
    except Exception as exc:
        logger.warning("robots.txt check failed for {} — defaulting to allowed: {}", url, exc)
        return True


# ─────────────────────────────────────────────
# 随机延迟（礼貌爬虫）
# ─────────────────────────────────────────────

async def random_delay(min_sec: float = 1.5, max_sec: float = 4.0) -> None:
    """在 min_sec ~ max_sec 之间随机异步等待，减轻目标服务器压力"""
    delay = random.uniform(min_sec, max_sec)
    logger.debug("Random delay: {:.2f}s", delay)
    await asyncio.sleep(delay)


# ─────────────────────────────────────────────
# 指数退避重试（同步 / 异步）
# ─────────────────────────────────────────────

async def async_retry(
    coro_fn: Callable,
    *args: Any,
    max_retries: int = 3,
    min_wait: float = 2.0,
    max_wait: float = 30.0,
    exceptions: tuple = (Exception,),
    **kwargs: Any,
) -> Any:
    """
    异步函数的指数退避重试装饰执行器。
    每次失败后等待时间翻倍，加随机 jitter。
    """
    last_exc: Exception | None = None
    wait = min_wait

    for attempt in range(1, max_retries + 1):
        try:
            return await coro_fn(*args, **kwargs)
        except exceptions as exc:
            last_exc = exc
            if attempt == max_retries:
                logger.error(
                    "All {} retries exhausted for {}: {}",
                    max_retries,
                    getattr(coro_fn, "__name__", str(coro_fn)),
                    exc,
                )
                raise
            jitter = random.uniform(0, wait * 0.2)
            actual_wait = min(wait + jitter, max_wait)
            logger.warning(
                "Attempt {}/{} failed: {}. Retrying in {:.1f}s…",
                attempt,
                max_retries,
                exc,
                actual_wait,
            )
            await asyncio.sleep(actual_wait)
            wait = min(wait * 2, max_wait)

    raise last_exc  # type: ignore


# ─────────────────────────────────────────────
# URL 工具
# ─────────────────────────────────────────────

def normalize_url(url: str, base: str) -> str:
    """将相对 URL 转为绝对 URL"""
    if url.startswith(("http://", "https://")):
        return url
    return urljoin(base, url)


def url_hash(url: str) -> str:
    """对 URL 取 SHA256 前 16 位作为唯一标识"""
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def is_same_domain(url: str, allowed_domains: list[str]) -> bool:
    """检查 URL 是否在允许的域名列表内"""
    if not allowed_domains:
        return True
    netloc = urlparse(url).netloc
    return any(netloc.endswith(d) for d in allowed_domains)


def matches_pattern(url: str, patterns: list[str]) -> bool:
    """检查 URL 是否匹配任意正则模式（详情页过滤用）"""
    if not patterns:
        return True
    return any(re.search(p, url) for p in patterns)


# ─────────────────────────────────────────────
# 图片下载
# ─────────────────────────────────────────────

_downloaded_urls: set[str] = set()  # 内存去重（同次运行内）


async def download_image(
    url: str,
    save_dir: Path,
    session: aiohttp.ClientSession,
    timeout: int = 15,
) -> Optional[Path]:
    """
    异步下载图片到 save_dir。
    - URL 去重（内存级，跨篇去重）
    - 文件名由 URL hash 决定
    - 返回本地路径或 None（失败）
    """
    if url in _downloaded_urls:
        # 已下载过，找到本地路径
        filename = url_hash(url)
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"):
            p = save_dir / (filename + ext)
            if p.exists():
                return p
        return None  # 已下载但文件找不到，忽略

    if not is_allowed_by_robots(url, settings.user_agent):
        logger.warning("Image URL blocked by robots.txt: {}", url)
        return None

    try:
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=timeout),
            headers={"User-Agent": settings.user_agent},
            allow_redirects=True,
        ) as resp:
            if resp.status != 200:
                logger.warning("Image download failed [{}]: {}", resp.status, url)
                return None

            content_type = resp.content_type or "image/jpeg"
            ext = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ".jpg"
            if ext == ".jpe":
                ext = ".jpg"

            filename = url_hash(url) + ext
            save_path = save_dir / filename
            if save_path.exists():
                _downloaded_urls.add(url)
                return save_path

            data = await resp.read()
            save_path.write_bytes(data)
            _downloaded_urls.add(url)
            logger.debug("Downloaded image: {} -> {}", url, save_path)
            return save_path

    except asyncio.TimeoutError:
        logger.warning("Image download timeout: {}", url)
    except Exception as exc:
        logger.warning("Image download error [{}]: {}", url, exc)
    return None


def image_to_base64(path: Path) -> str:
    """将本地图片读取为 base64 字符串（用于 LLM base64 输入模式）"""
    mime, _ = mimetypes.guess_type(str(path))
    mime = mime or "image/jpeg"
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode()
    return f"data:{mime};base64,{b64}"


# ─────────────────────────────────────────────
# 时间工具
# ─────────────────────────────────────────────

def now_str(fmt: str = "%Y%m%d") -> str:
    return local_now().strftime(fmt)


def parse_datetime_fuzzy(text: str) -> Optional["datetime"]:
    """宽松日期解析，支持多种格式"""
    from datetime import datetime
    import dateutil.parser

    if not text:
        return None
    try:
        return dateutil.parser.parse(text, fuzzy=True)
    except Exception:
        return None
