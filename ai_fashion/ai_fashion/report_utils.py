"""Report HTML export and pairwise report comparison."""

from __future__ import annotations

import html
from typing import Any, Optional


def _esc(s: Any) -> str:
    return html.escape(str(s) if s is not None else "", quote=True)


def render_report_html(report: dict) -> str:
    """Single-page HTML suitable for print-to-PDF in browser."""
    title = _esc(report.get("summary") or report.get("report_id") or "趋势报告")
    rid = _esc(report.get("report_id", ""))
    rdate = _esc(report.get("report_date", ""))
    sites = _esc(", ".join(report.get("covered_sites") or []))
    summary = _esc(report.get("summary") or "")

    def imgs_block(urls: list[str], caption: str) -> str:
        if not urls:
            return ""
        items = "".join(
            f'<figure class="fig"><img src="{_esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"/><figcaption>{_esc(caption)}</figcaption></figure>'
            for u in urls[:12]
        )
        return f'<section class="sec"><h2>{_esc(caption)}</h2><div class="fig-grid">{items}</div></section>'

    rep_imgs = report.get("representative_images") or []
    parts: list[str] = [
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"/>",
        f"<title>{title}</title>",
        """<style>
body{font-family:system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.55;max-width:900px;margin:24px auto;padding:0 16px;color:#222;}
h1{font-size:1.35rem;margin-bottom:8px;}
.meta{color:#666;font-size:13px;margin-bottom:16px;}
.summary{white-space:pre-wrap;margin-bottom:20px;}
.sec{margin-bottom:22px;}
h2{font-size:1.05rem;margin:0 0 10px;border-bottom:1px solid #ddd;padding-bottom:4px;}
.trend{margin-bottom:14px;padding:10px;border:1px solid #eee;border-radius:8px;}
.tname{font-weight:600;}
.fig-grid{display:flex;flex-wrap:wrap;gap:10px;}
figure.fig{margin:0;width:200px;}
figure.fig img{width:100%;height:auto;border-radius:6px;border:1px solid #eee;}
figcaption{font-size:11px;color:#888;margin-top:4px;}
ul.dim{margin:0;padding-left:18px;}
@media print{body{margin:12mm;}}
</style></head><body>""",
        f"<h1>{title}</h1>",
        f'<p class="meta">报告 ID：{rid} · 日期：{rdate} · 站点：{sites}'
        + (
            f" · 季节归类：{_esc(report.get('season_label_zh') or report.get('season_bucket_id') or '')}"
            if (report.get("season_label_zh") or report.get("season_bucket_id"))
            else ""
        )
        + "</p>",
        f'<div class="summary">{summary}</div>',
    ]

    if rep_imgs:
        parts.append(imgs_block(rep_imgs[:5], "代表性图片"))

    for t in report.get("key_trends") or []:
        name = _esc(t.get("name", ""))
        desc = _esc(t.get("description", ""))
        conf = t.get("confidence")
        cf = f"{int(float(conf) * 100)}%" if conf is not None else ""
        simgs = t.get("selected_images") or []
        img_html = ""
        if simgs:
            img_html = '<div class="fig-grid">' + "".join(
                f'<figure class="fig"><img src="{_esc(u)}" alt=""/></figure>' for u in simgs[:3]
            ) + "</div>"
        parts.append(
            f'<div class="trend"><div class="tname">{name}</div>'
            f'<div style="font-size:12px;color:#666;margin:4px 0">{cf}</div>'
            f'<p style="margin:8px 0;font-size:14px">{desc}</p>{img_html}</div>'
        )

    for sec_title, key in [
        ("款式板块", "style_details"),
        ("单品板块", "item_details"),
        ("版型板块", "silhouette_details"),
        ("颜色板块", "color_details"),
    ]:
        items = report.get(key) or []
        if not items:
            continue
        parts.append(f'<section class="sec"><h2>{_esc(sec_title)}</h2>')
        for it in items:
            parts.append(
                f'<div class="trend"><div class="tname">{_esc(it.get("name",""))}</div>'
                f'<p style="margin:8px 0;font-size:14px">{_esc(it.get("description",""))}</p>'
                + (
                    '<div class="fig-grid">'
                    + "".join(
                        f'<figure class="fig"><img src="{_esc(u)}" alt=""/></figure>'
                        for u in (it.get("selected_images") or [])[:2]
                    )
                    + "</div>"
                    if it.get("selected_images")
                    else ""
                )
                + "</div>"
            )
        parts.append("</section>")

    parts.append("</body></html>")
    return "".join(parts)


def _as_set(lst: Any) -> set[str]:
    if not isinstance(lst, list):
        return set()
    return {str(x).strip() for x in lst if str(x).strip()}


def compare_reports(left: dict, right: dict) -> dict[str, Any]:
    """Structured diff: dimension sets and key trend names."""
    dims = ["colors", "fabrics", "items", "silhouettes", "patterns", "style_keywords"]

    dim_diff: dict[str, dict[str, list[str]]] = {}
    for d in dims:
        a, b = _as_set(left.get(d)), _as_set(right.get(d))
        dim_diff[d] = {
            "only_left": sorted(a - b),
            "only_right": sorted(b - a),
            "both": sorted(a & b),
        }

    def trend_names(rep: dict) -> set[str]:
        out: set[str] = set()
        for t in rep.get("key_trends") or []:
            if not isinstance(t, dict):
                continue
            n = (t.get("name") or t.get("trend_name") or "").strip()
            if n:
                out.add(n)
        return out

    tn_l, tn_r = trend_names(left), trend_names(right)

    return {
        "left_report_id": left.get("report_id"),
        "right_report_id": right.get("report_id"),
        "left_date": left.get("report_date"),
        "right_date": right.get("report_date"),
        "left_season_label_zh": (left.get("season_label_zh") or "").strip(),
        "right_season_label_zh": (right.get("season_label_zh") or "").strip(),
        "left_season_bucket_id": (left.get("season_bucket_id") or "").strip(),
        "right_season_bucket_id": (right.get("season_bucket_id") or "").strip(),
        "left_season_year": int(left.get("season_year") or 0),
        "right_season_year": int(right.get("season_year") or 0),
        "left_sites": left.get("covered_sites") or [],
        "right_sites": right.get("covered_sites") or [],
        "dimensions": dim_diff,
        "key_trends": {
            "only_left": sorted(tn_l - tn_r),
            "only_right": sorted(tn_r - tn_l),
            "both": sorted(tn_l & tn_r),
        },
    }


def summarize_tokens(token_usage: Any) -> int:
    """Best-effort total tokens from provider usage dict."""
    if not isinstance(token_usage, dict):
        return 0
    if "total_tokens" in token_usage:
        try:
            return int(token_usage["total_tokens"])
        except (TypeError, ValueError):
            pass
    a = token_usage.get("prompt_tokens") or token_usage.get("input_tokens") or 0
    b = token_usage.get("completion_tokens") or token_usage.get("output_tokens") or 0
    try:
        return int(a) + int(b)
    except (TypeError, ValueError):
        return 0
