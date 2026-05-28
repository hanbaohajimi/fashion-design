"""
time_utils.py — 统一的项目时间工具

所有“当前时间”默认按 settings.timezone 生成，避免 UTC 与本地时间混用。
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from config import settings


def project_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.timezone or "Asia/Shanghai")
    except Exception:
        return ZoneInfo("UTC")


def local_now() -> datetime:
    """返回项目配置时区下的当前时间（默认 Asia/Shanghai）。"""
    return datetime.now(project_tz())


def local_today_str(fmt: str = "%Y-%m-%d") -> str:
    return local_now().strftime(fmt)
