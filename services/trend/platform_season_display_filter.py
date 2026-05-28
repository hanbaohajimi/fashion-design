"""
季节趋势展示过滤：无明确季节归类（如「未归类季节」）的数据不进入季节趋势相关 JSON 响应。

在 ai_fashion 的 FastAPI `app` 上通过中间件挂载，对 URL 路径含 season/季节/bucket 等关键词的
application/json 响应做递归过滤（不改变其它接口）。
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

_SEASON_PATH_RE = re.compile(
    r"(season|seasonal|季节|ssfw|fw\d|ss\d|bucket|quarter|分桶)",
    re.IGNORECASE,
)

# 字典键：整键视为「弱季节」则丢弃该分支
_WEAK_KEY_EXACT = frozenset(
    {
        "未归类",
        "未归类季节",
        "无季节",
        "暂无季节",
        "未知季节",
        "uncategorized",
        "unknown",
        "none",
        "n/a",
        "na",
        "other",
        "others",
        "null",
        "其它",
        "其他",
    }
)

# 对象字段：仅当字段名为下列之一时，才用弱季节值判断整项是否剔除（避免误伤「label」等泛字段）
_SEASON_VALUE_FIELDS = frozenset(
    {
        "season",
        "season_label",
        "season_name",
        "season_key",
        "bucket",
        "bucket_name",
        "bucket_key",
        "season_bucket",
        "fashion_season",
        "quarter",
        "season_code",
    }
)

# 键或值中包含下列子串则视为弱季节（含「2025-未归类」类组合键）
_WEAK_SUBSTR = ("未归类", "无季节", "暂无季节", "未知季节", "uncategorized", "unknown season")


def _is_weak_season_key(key: str) -> bool:
    t = key.strip()
    if not t:
        return True
    tl = t.lower()
    if t in _WEAK_KEY_EXACT or tl in _WEAK_KEY_EXACT:
        return True
    for s in _WEAK_SUBSTR:
        if s.lower() in tl:
            return True
    return False


def _is_weak_season_value(val: str) -> bool:
    v = val.strip()
    if not v:
        return True
    vl = v.lower()
    if v in _WEAK_KEY_EXACT or vl in _WEAK_KEY_EXACT:
        return True
    for s in _WEAK_SUBSTR:
        if s.lower() in vl:
            return True
    return False


def _keep_dict_item(obj: dict[str, Any]) -> bool:
    for field in _SEASON_VALUE_FIELDS:
        raw = obj.get(field)
        if isinstance(raw, str) and _is_weak_season_value(raw):
            return False
    return True


def filter_season_trend_display_json(data: Any) -> Any:
    """递归过滤：去掉弱季节键及带弱季节字段的记录。"""
    if isinstance(data, dict):
        out: dict[str, Any] = {}
        for k, v in data.items():
            if isinstance(k, str) and _is_weak_season_key(k):
                continue
            out[k] = filter_season_trend_display_json(v)
        return out
    if isinstance(data, list):
        out_list: list[Any] = []
        for item in data:
            if isinstance(item, dict) and not _keep_dict_item(item):
                continue
            out_list.append(filter_season_trend_display_json(item))
        return out_list
    return data


def _should_filter_path(path: str) -> bool:
    return bool(_SEASON_PATH_RE.search(path))


class SeasonTrendDisplayFilterMiddleware(BaseHTTPMiddleware):
    """仅处理疑似季节相关 JSON，其余原样透传。"""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if os.environ.get("FASHION_DISABLE_SEASON_DISPLAY_FILTER", "").strip() in (
            "1",
            "true",
            "yes",
        ):
            return response
        if not _should_filter_path(request.url.path):
            return response
        ct = response.headers.get("content-type", "")
        if "application/json" not in ct:
            return response
        body = b""
        try:
            async for chunk in response.body_iterator:
                body += chunk
        except Exception:
            return response
        try:
            text = body.decode("utf-8")
            parsed = json.loads(text)
        except Exception:
            return Response(
                content=body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )
        try:
            filtered = filter_season_trend_display_json(parsed)
            new_body = json.dumps(filtered, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except Exception:
            return Response(
                content=body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        return Response(
            content=new_body,
            status_code=response.status_code,
            headers=headers,
            media_type="application/json",
        )


def install_season_display_filter(app) -> None:
    """将中间件挂到 FastAPI app（最后添加会最先执行入站，出站顺序相反；此处仅出站改包体）。"""
    app.add_middleware(SeasonTrendDisplayFilterMiddleware)
