"""
从文章标题推断「春 / 夏 / 秋 / 冬」季节标签与年份。

原则：
1. 优先使用标题中的明确时间关键词（春夏秋冬、SS/FW、Spring/Summer 等）；
2. 不再使用发布时间月份兜底；
3. 避免正文里偶发的季节词把整篇文章误分桶。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from models import Article
from time_utils import local_now

_SS_FW_NEAR = re.compile(
    r"\b(ss|fw|aw)\s*['']?\s*(20\d{2}|\d{2})\b",
    re.I,
)
_YEAR_DASH_SEASON = re.compile(
    r"\b(20\d{2})\s*[-/]\s*(ss|fw|aw)\b",
    re.I,
)
_YEAR_NEAR_SEASON_ZH = re.compile(
    r"(20\d{2})\s*(年)?\s*(春夏|秋冬|春季|夏季|秋季|冬季|早春|早秋|初秋|度假|邮轮)",
    re.I,
)
_YEAR_NEAR_SEASON_EN = re.compile(
    r"\b(20\d{2})\s*(spring|summer|fall|autumn|winter|resort|cruise|pre-?fall)\b",
    re.I,
)


@dataclass(frozen=True)
class SeasonProfile:
    """单篇文章推断出的季节与年份（用于分桶与展示）。"""

    season_code: str
    season_year: int
    season_label_zh: str
    bucket_id: str


_LABEL_ZH: dict[str, str] = {
    "SS": "春夏",
    "FW": "秋冬",
    "SPRING": "春季",
    "SUMMER": "夏季",
    "AUTUMN": "秋季",
    "WINTER": "冬季",
    "RESORT": "早春度假",
    "CRUISE": "早秋巡航",
    "PREFALL": "早秋",
    "UNKNOWN": "未归类季节",
}

_SEASON_ORDER: dict[str, int] = {
    "SS": 0,
    "SPRING": 1,
    "SUMMER": 2,
    "RESORT": 3,
    "FW": 4,
    "AUTUMN": 5,
    "WINTER": 6,
    "CRUISE": 7,
    "PREFALL": 8,
    "UNKNOWN": 9,
}

# Priority: combined seasons first, then special seasons, then individual
_TITLE_COMBINED_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("SS", ("春夏", "ss", "spring/summer", "spring summer", "spring-summer")),
    ("FW", ("秋冬", "fw", "aw", "fall/winter", "autumn/winter", "fall winter", "autumn winter", "fall-winter")),
)

_TITLE_SPECIAL_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("RESORT", ("度假", "resort", "cruise collection", "早春系列")),
    ("CRUISE", ("邮轮", "cruise", "巡航")),
    ("PREFALL", ("pre-fall", "prefall", "pre fall", "早秋系列")),
)

_TITLE_SEASON_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("SPRING", ("春季", "春装", "春日", "春款", "早春", "spring")),
    ("SUMMER", ("夏季", "夏装", "夏日", "夏款", "盛夏", "summer")),
    ("AUTUMN", ("秋季", "秋装", "秋日", "秋款", "初秋", "早秋", "autumn", "fall")),
    ("WINTER", ("冬季", "冬装", "冬日", "冬款", "隆冬", "深冬", "winter")),
)


def _two_digit_year(yy: int) -> int:
    return 2000 + yy if yy < 70 else 1900 + yy


def _year_from_title(title: str) -> int | None:
    lo = title.lower()
    m = _SS_FW_NEAR.search(lo)
    if m:
        raw = m.group(2)
        return int(raw) if len(raw) == 4 else _two_digit_year(int(raw))
    m2 = _YEAR_DASH_SEASON.search(lo)
    if m2:
        return int(m2.group(1))
    m3 = _YEAR_NEAR_SEASON_ZH.search(title)
    if m3:
        return int(m3.group(1))
    m4 = _YEAR_NEAR_SEASON_EN.search(lo)
    if m4:
        return int(m4.group(1))
    return None


def _season_from_title(title: str) -> str | None:
    lo = title.lower()

    # 1. Combined seasons (SS/FW) take highest priority
    for season_code, needles in _TITLE_COMBINED_RULES:
        if any(needle in lo or needle in title for needle in needles):
            return season_code

    # 2. Special seasons (Resort/Cruise/Pre-Fall)
    for season_code, needles in _TITLE_SPECIAL_RULES:
        if any(needle in lo or needle in title for needle in needles):
            return season_code

    # 3. Individual seasons
    hits: list[str] = []
    for season_code, needles in _TITLE_SEASON_RULES:
        if any(needle in lo or needle in title for needle in needles):
            hits.append(season_code)

    if not hits:
        return None
    if "SPRING" in hits and "SUMMER" in hits:
        return "SS"
    if "AUTUMN" in hits and "WINTER" in hits:
        return "FW"
    return hits[0]


def infer_season_profile(article: Article) -> SeasonProfile:
    """
    优先按标题中的明确季节词归类；
    没有标题季节词则归为 UNKNOWN；
    年份优先取标题中显式年份，否则取发布时间年份。
    """
    title = (article.title or "").strip()

    season_code = _season_from_title(title)
    if not season_code:
        season_code = "UNKNOWN"

    year = (
        _year_from_title(title)
        or (article.published_at.year if article.published_at else None)
        or local_now().year
    )

    label_tail = _LABEL_ZH.get(season_code, _LABEL_ZH["UNKNOWN"])
    bucket_id = f"{year}_{season_code}"
    return SeasonProfile(
        season_code=season_code,
        season_year=year,
        season_label_zh=f"{year} {label_tail}",
        bucket_id=bucket_id,
    )


def group_articles_by_season_bucket(articles: list[Article]) -> dict[str, list[Article]]:
    """按 bucket_id（年份_季节码）分组。"""
    out: dict[str, list[Article]] = {}
    for art in articles:
        p = infer_season_profile(art)
        out.setdefault(p.bucket_id, []).append(art)
    return out


def season_bucket_sort_key(bucket_id: str) -> tuple:
    """排序：年份降序，同年内春→夏→秋→冬→未知。"""
    parts = bucket_id.split("_", 1)
    if len(parts) != 2:
        return (0, 99, bucket_id)
    y_s, code = parts[0], parts[1]
    yi = int(y_s) if y_s.isdigit() else 0
    return (-yi, _SEASON_ORDER.get(code, 99), bucket_id)


def season_profile_from_bucket_id(bucket_id: str) -> SeasonProfile:
    """由 bucket_id 反推展示用 SeasonProfile。"""
    parts = bucket_id.split("_", 1)
    if len(parts) != 2:
        y = local_now().year
        return SeasonProfile("UNKNOWN", y, f"{y} {_LABEL_ZH['UNKNOWN']}", f"{y}_UNKNOWN")
    y_s, code = parts[0], parts[1]
    yi = int(y_s) if y_s.isdigit() else local_now().year
    tail = _LABEL_ZH.get(code, _LABEL_ZH["UNKNOWN"])
    return SeasonProfile(
        season_code=code,
        season_year=yi,
        season_label_zh=f"{yi} {tail}",
        bucket_id=bucket_id,
    )
