from fastapi import APIRouter

from runtime import *

router = APIRouter()


@router.get("/api/reports/filters")
async def report_filters():
    """报告筛选器元数据：站点列表 + 按年/季节标签的汇总（可选单独分类）。"""
    try:
        st = get_storage()
        sites = st.get_report_filter_sites()
        season_facets = st.get_report_season_facets()
        return {"sites": sites, "season_facets": season_facets}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/reports")
async def get_reports(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    site_name: Optional[str] = Query(None, description="覆盖站点之一"),
    date_from: Optional[str] = Query(None, description="报告日期起 YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="报告日期止 YYYY-MM-DD"),
    dimension_q: Optional[str] = Query(
        None,
        description=(
            "维度关键词：模糊匹配报告摘要与维度 JSON（色彩/面料/单品/廓形/图案/风格词等）。"
            "例：牛仔、针织、云舞白、静奢"
        ),
    ),
    season_bucket_id: Optional[str] = Query(
        None,
        description="服装季节标签（season_bucket_id），如 2025_SS；与 season_year/season_code 二选一优先使用本项",
    ),
    season_year: Optional[int] = Query(None, ge=0, le=2100, description="按季次年份筛选（未传 season_bucket_id 时生效）"),
    season_code: Optional[str] = Query(None, description="季节码：SS/FW/RESORT 等"),
):
    try:
        reports, total = get_storage().get_report_list(
            limit,
            offset,
            site_name=site_name,
            date_from=date_from,
            date_to=date_to,
            dimension_q=dimension_q,
            season_bucket_id=season_bucket_id,
            season_year=season_year,
            season_code=season_code,
        )
        return {"reports": reports, "total": total}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/reports/latest")
async def get_latest_report():
    try:
        report = get_storage().get_latest_report()
        if not report:
            raise HTTPException(404, "No reports found")
        return report
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/reports/{report_id}")
async def get_report(report_id: str):
    try:
        report = get_storage().get_report_by_id(report_id)
        if not report:
            raise HTTPException(404, f"Report {report_id} not found")
        return report
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/reports/{report_id}/export")
async def export_report(
    report_id: str,
    format: str = Query("html", description="html：下载后可浏览器打印为 PDF"),
):
    """导出报告：HTML 单页（推荐打印为 PDF）。不引入额外 PDF 依赖。"""
    from report_utils import render_report_html

    try:
        report = get_storage().get_report_by_id(report_id)
        if not report:
            raise HTTPException(404, f"Report {report_id} not found")
        if format != "html":
            raise HTTPException(
                400,
                "仅支持 format=html；下载后用浏览器「打印 → 另存为 PDF」",
            )
        body = render_report_html(report)
        return Response(
            content=body.encode("utf-8"),
            media_type="text/html; charset=utf-8",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="trend_report_{report_id}.html"'
                ),
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/reports/{left_id}/compare/{right_id}")
async def compare_two_reports(left_id: str, right_id: str):
    """两份报告维度与关键趋势名称差异（用于本周 vs 上周、站点对比等）。"""
    from report_utils import compare_reports

    st = get_storage()
    left = st.get_report_by_id(left_id)
    right = st.get_report_by_id(right_id)
    if not left or not right:
        raise HTTPException(404, "报告不存在或 JSON 已丢失")
    return compare_reports(left, right)


@router.get("/api/trends/hot")
async def trends_hot_keywords(
    limit: int = Query(50, ge=1, le=200),
    category: Optional[str] = Query(None, description="指定维度：colors/fabrics/items/silhouettes/patterns/style_keywords/consumer_signals"),
):
    """从历史报告中聚合高频关键词，可按维度筛选。"""
    try:
        return get_storage().get_hot_keywords(limit=limit, category=category)
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/trends/timeline")
async def trends_keyword_timeline(
    keyword: str = Query(..., description="要追踪的关键词"),
    lookback_days: int = Query(
        730,
        ge=30,
        le=3650,
        description="以库中最新报告日为基准向前回溯的天数，默认约 2 年",
    ),
    max_points: int = Query(
        500,
        ge=50,
        le=3000,
        description="时间线最多包含的报告条数（防止极端大数据拖慢）",
    ),
):
    """追踪某关键词在历史报告维度中随时间的出现次数（默认近 2 年全部报告点，非仅最新若干条）。"""
    if not keyword.strip():
        raise HTTPException(400, "keyword 不能为空")
    try:
        return get_storage().get_keyword_timeline(
            keyword=keyword.strip(),
            lookback_days=lookback_days,
            max_points=max_points,
        )
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/trends/dimension-stats")
async def trends_dimension_stats():
    """各维度词汇汇总统计（用于仪表盘概览）。"""
    try:
        return get_storage().get_dimension_stats()
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/articles")
async def get_articles(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    site_name: Optional[str] = Query(None),
    analyzed: Optional[bool] = Query(None),
    q: Optional[str] = Query(None, description="全文搜索：标题+摘要+正文"),
):
    try:
        if q and q.strip():
            articles, total = get_storage().search_articles_fts(q.strip(), limit=limit, offset=offset)
        else:
            articles, total = get_storage().get_articles_paginated(
                limit, offset, site_name, analyzed
            )
        site_names = get_storage().get_site_names()
        return {"articles": articles, "total": total, "site_names": site_names}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/articles/{unique_key}/raw-html")
async def get_article_raw_html(
    unique_key: str,
    plain: bool = Query(
        False,
        description="为 true 时返回 text/plain 源码，便于阅读复制；默认返回 text/html 供预览",
    ),
):
    """读取抓取时保存的本地 HTML 文件（仅项目 data/raw 下）。"""
    row = get_storage().get_article_by_unique_key(unique_key)
    if not row:
        raise HTTPException(404, "文章不存在")
    path = _safe_raw_html_path(row.get("raw_html_path"))
    if not path:
        raise HTTPException(404, "未保存该文章的抓取 HTML")
    if plain:
        return Response(
            content=path.read_text(encoding="utf-8", errors="replace"),
            media_type="text/plain; charset=utf-8",
        )
    return FileResponse(path, media_type="text/html; charset=utf-8")


@router.post("/api/subscribe")
async def subscribe_reports(req: SubscribeRequest):
    """
    登记订阅邮箱（入库）。实际邮件推送需在服务端配置 SMTP 与定时任务后启用。
    """
    import re

    em = (req.email or "").strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", em):
        raise HTTPException(400, "邮箱格式无效")
    try:
        get_storage().subscribe_email(em)
        return {
            "status": "ok",
            "email": em,
            "note": "已保存偏好；邮件推送需配置 SMTP 后由运维启用",
        }
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/api/articles/dedupe")
async def dedupe_articles():
    """
    清理重复文章：规范化 URL 相同、或同站同标题（均保留最早抓取的一条）。
    因 article_url 有 UNIQUE，仅靠「完全相同 URL」无法在库中出现两条。
    """
    try:
        return get_storage().dedupe_articles_by_url()
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/sites")
async def get_sites():
    try:
        from site_configs.loader import load_all_site_configs
        configs = load_all_site_configs()
        result = []
        for cfg in configs:
            ok, errors = cfg.is_valid()
            sel = cfg.selectors
            selectors_configured = bool(
                sel.article_link_selector
                and sel.title_selector
                and sel.content_selector
            )
            result.append({
                "site_name": cfg.site_name,
                "enabled": cfg.enabled,
                "entry_urls": cfg.entry_urls,
                "allowed_domains": cfg.allowed_domains,
                "detail_url_patterns": cfg.detail_url_patterns,
                "pagination_type": cfg.pagination_type.value,
                "max_pages": cfg.max_pages,
                "max_articles_per_run": cfg.max_articles_per_run,
                "request_delay_min": cfg.request_delay_min,
                "request_delay_max": cfg.request_delay_max,
                "has_login": cfg.login.use_login,
                "login_url": cfg.login.login_url,
                "storage_state_path": cfg.login.storage_state_path,
                "selectors_configured": selectors_configured,
                "is_valid": ok,
                "validation_errors": errors,
            })
        return {"sites": result}
    except Exception as exc:
        raise HTTPException(500, str(exc))

