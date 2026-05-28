"""
report_alignment.py
对相邻报告做主题命名对齐，降低同主题在不同批次中“改名”的抖动。
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from models import FashionTrendReport, StyleDetail, TrendItem


def _tokens(text: str) -> set[str]:
    return {
        t
        for t in re.findall(r"[\w\u4e00-\u9fff]+", (text or "").lower())
        if len(t) >= 2
    }


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    if union == 0:
        return 0.0
    return inter / union


def _trend_signature(t: TrendItem) -> set[str]:
    parts: list[str] = [
        t.name,
        t.description,
        " ".join(t.related_colors),
        " ".join(t.related_fabrics),
        " ".join(t.related_items),
        " ".join(t.related_patterns),
        " ".join(t.related_silhouettes),
    ]
    return _tokens(" ".join(parts))


def _detail_signature(d: StyleDetail) -> set[str]:
    parts: list[str] = [
        d.name,
        d.description,
        " ".join(d.representative_brands),
        " ".join(d.style_tips),
        d.trend_direction,
    ]
    return _tokens(" ".join(parts))


def _align_names_by_similarity(
    current_items: list[Any],
    previous_items: list[Any],
    signature_fn,
    threshold: float,
) -> None:
    if not current_items or not previous_items:
        return

    prev_pool = [(p, signature_fn(p)) for p in previous_items]
    used_prev_names: set[str] = set()

    for cur in current_items:
        cur_sig = signature_fn(cur)
        if not cur_sig:
            continue

        best_name = ""
        best_score = 0.0
        for prev_obj, prev_sig in prev_pool:
            score = _jaccard(cur_sig, prev_sig)
            prev_name = (getattr(prev_obj, "name", "") or "").strip()
            if score > best_score and prev_name and prev_name not in used_prev_names:
                best_score = score
                best_name = prev_name

        if best_name and best_score >= threshold:
            setattr(cur, "name", best_name)
            used_prev_names.add(best_name)


def align_report_topics_with_previous(
    current: FashionTrendReport,
    previous: FashionTrendReport | None,
) -> FashionTrendReport:
    """
    用上一期报告对齐主题命名（仅改 name，不改内容/证据/图片）。
    """
    if not previous:
        return current

    _align_names_by_similarity(
        current.key_trends,
        previous.key_trends,
        signature_fn=_trend_signature,
        threshold=0.46,
    )

    for cur_list, prev_list in (
        (current.style_details, previous.style_details),
        (current.item_details, previous.item_details),
        (current.silhouette_details, previous.silhouette_details),
        (current.color_details, previous.color_details),
    ):
        _align_names_by_similarity(
            cur_list,
            prev_list,
            signature_fn=_detail_signature,
            threshold=0.42,
        )

    return current

