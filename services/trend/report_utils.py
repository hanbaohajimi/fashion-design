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

    def safe_urls(value: Any, limit: int = 12) -> list[str]:
        if not isinstance(value, list):
            return []
        out: list[str] = []
        for item in value:
            u = str(item or "").strip()
            if u.startswith(("http://", "https://")) and u not in out:
                out.append(u)
            if len(out) >= limit:
                break
        return out

    def imgs_block(urls: list[str], caption: str, cls: str = "fig-grid") -> str:
        if not urls:
            return ""
        items = "".join(
            f'<figure class="fig"><img src="{_esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"/><figcaption>{_esc(caption)}</figcaption></figure>'
            for u in urls[:12]
        )
        return f'<section class="sec"><h2>{_esc(caption)}</h2><div class="{cls}">{items}</div></section>'

    def tag_list(values: Any, cls: str = "") -> str:
        if not isinstance(values, list) or not values:
            return ""
        return "".join(
            f'<span class="tag {cls}">{_esc(v)}</span>'
            for v in values[:12]
            if str(v).strip()
        )

    def evidence_block(items: Any) -> str:
        if not isinstance(items, list) or not items:
            return ""
        rows = []
        for ev in items[:3]:
            if not isinstance(ev, dict):
                continue
            url = _esc(ev.get("article_url") or "")
            title_text = _esc(ev.get("article_title") or "")
            link = f'<a href="{url}">{title_text}</a>' if url else title_text
            rows.append(
                f'<li><strong>{_esc(ev.get("site_name") or "")}</strong> · {link}'
                f'<div class="snippet">{_esc(ev.get("snippet") or "")}</div></li>'
            )
        if not rows:
            return ""
        return f'<details class="evidence"><summary>证据来源 ({len(items)})</summary><ul>{"".join(rows)}</ul></details>'

    def trend_card(t: dict) -> str:
        name = _esc(t.get("name") or t.get("trend_name") or "未命名趋势")
        desc = _esc(t.get("description") or t.get("desc") or "")
        cat = _esc(t.get("category") or "")
        conf = t.get("confidence")
        cf = f"{int(float(conf) * 100)}%" if conf is not None else ""
        imgs = safe_urls(t.get("selected_images"), 3)
        rel = []
        for label, key in [
            ("关联色彩", "related_colors"),
            ("关联面料", "related_fabrics"),
            ("关联单品", "related_items"),
            ("关联廓形", "related_silhouettes"),
        ]:
            tags = tag_list(t.get(key))
            if tags:
                rel.append(f'<div class="rel"><span>{_esc(label)}</span>{tags}</div>')
        img_html = (
            '<div class="card-images">'
            + "".join(f'<img src="{_esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>' for u in imgs)
            + "</div>"
            if imgs
            else ""
        )
        return (
            '<article class="trend card">'
            f'<div class="card-head"><h3>{name}</h3><div class="meta-inline">{cat} {cf}</div></div>'
            f'{img_html}<p>{desc}</p>{"".join(rel)}'
            f'{evidence_block(t.get("supporting_evidence") or t.get("evidence"))}'
            '</article>'
        )

    def detail_card(item: dict, is_color: bool = False) -> str:
        name = _esc(item.get("name") or "")
        desc = _esc(item.get("description") or "")
        direction = _esc(item.get("trend_direction") or "")
        conf = item.get("confidence")
        cf = f"{int(float(conf) * 100)}%" if conf is not None else ""
        imgs = safe_urls(item.get("selected_images"), 2)
        img_html = (
            '<div class="card-images detail-imgs">'
            + "".join(f'<img src="{_esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>' for u in imgs)
            + "</div>"
            if imgs
            else ""
        )
        brands = tag_list(item.get("representative_brands"), "brand")
        tips = item.get("style_tips") or []
        tips_html = (
            "<ul class=\"tips\">" + "".join(f"<li>{_esc(tip)}</li>" for tip in tips[:4]) + "</ul>"
            if isinstance(tips, list) and tips
            else ""
        )
        swatch = '<span class="swatch"></span>' if is_color else ""
        return (
            '<article class="detail card">'
            f'<div class="card-head"><h3>{swatch}{name}</h3><div class="meta-inline">{direction} {cf}</div></div>'
            f'{img_html}<p>{desc}</p>{brands}{tips_html}'
            '</article>'
        )

    rep_imgs = safe_urls(report.get("representative_images"), 8)
    parts: list[str] = [
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"/>",
        f"<title>{title}</title>",
        """<style>
body{font-family:system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.62;max-width:1080px;margin:28px auto;padding:0 18px;color:#1c1916;background:#f7f3ed;}
h1{font-size:1.55rem;margin:0 0 10px;line-height:1.35;}
.meta{color:#666;font-size:13px;margin-bottom:16px;}
.summary{white-space:pre-wrap;margin:16px 0 24px;font-size:15px;color:#3f3a34;}
.sec{margin:26px 0;}
h2{font-size:.82rem;margin:0 0 14px;border-bottom:1px solid #ded7cc;padding-bottom:6px;letter-spacing:.12em;text-transform:uppercase;color:#6c6359;}
.moodboard{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}
.moodboard figure:first-child{grid-column:span 2;grid-row:span 2;}
.fig-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;}
figure.fig{margin:0;background:#fff;border:1px solid #e7dfd4;border-radius:8px;overflow:hidden;}
figure.fig img{width:100%;height:170px;object-fit:cover;display:block;}
.moodboard figure:first-child img{height:348px;}
figcaption{font-size:11px;color:#887d71;padding:6px 8px;}
.palette{display:flex;height:54px;border-radius:8px;overflow:hidden;border:1px solid #ded7cc;background:#fff;}
.palette span{flex:1;min-width:42px;display:flex;align-items:flex-end;justify-content:center;padding:5px;font-size:10px;color:#1c1916;background:#eee;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;}
.card{background:#fffdf9;border:1px solid #e3dbd1;border-radius:8px;padding:14px;break-inside:avoid;}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;}
h3{font-size:1rem;margin:0;line-height:1.35;}
.meta-inline{font-size:12px;color:#7b7167;white-space:nowrap;}
.card-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:8px;margin:10px 0;}
.card-images img{width:100%;height:132px;object-fit:cover;border-radius:6px;border:1px solid #eee;}
.detail-imgs img{height:118px;}
.tag{display:inline-block;margin:3px 4px 3px 0;padding:3px 7px;border-radius:999px;background:#f0ebe3;border:1px solid #e0d8cd;font-size:11px;color:#5b534b;}
.brand{background:#f8eeee;color:#7c2d3a;}
.rel{font-size:12px;margin-top:8px;color:#6d645b;}
.rel>span{font-weight:700;margin-right:6px;}
.evidence{margin-top:10px;font-size:12px;color:#5f574f;}
.evidence ul,.tips{padding-left:18px;}
.snippet{color:#8a8075;margin-top:3px;}
.swatch{display:inline-block;width:12px;height:12px;border-radius:50%;background:#ddd;border:1px solid #cfc7bd;margin-right:6px;vertical-align:-1px;}
@media print{body{margin:12mm;background:#fff;}.card{box-shadow:none;}}
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
        parts.append(imgs_block(rep_imgs, "趋势视觉板 · Moodboard", "moodboard"))

    colors = report.get("colors") or []
    if colors:
        parts.append(
            '<section class="sec"><h2>色彩板</h2><div class="palette">'
            + "".join(f"<span>{_esc(c)}</span>" for c in colors[:12])
            + "</div></section>"
        )

    trends = [t for t in (report.get("key_trends") or []) if isinstance(t, dict)]
    if trends:
        parts.append(
            '<section class="sec"><h2>关键趋势</h2><div class="grid">'
            + "".join(trend_card(t) for t in trends)
            + "</div></section>"
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
        is_color = key == "color_details"
        parts.append(
            f'<section class="sec"><h2>{_esc(sec_title)}</h2><div class="grid">'
            + "".join(detail_card(it, is_color) for it in items if isinstance(it, dict))
            + "</div></section>"
        )

    source_rows = report.get("source_article_details") or []
    if source_rows:
        rows = []
        for row in source_rows[:20]:
            if not isinstance(row, dict):
                continue
            url = _esc(row.get("article_url") or "")
            text = _esc(row.get("title") or row.get("unique_key") or "")
            link = f'<a href="{url}">{text}</a>' if url else text
            rows.append(f'<li><strong>{_esc(row.get("site_name") or "")}</strong> · {link}</li>')
        if rows:
            parts.append(f'<section class="sec"><h2>来源文章</h2><ul>{"".join(rows)}</ul></section>')

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
