"""
api.py — FastAPI 后端服务
提供 REST API + WebSocket，桥接前端与现有 storage/scheduler 模块
启动：uvicorn api:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional, Any

from fastapi import (
    BackgroundTasks,
    FastAPI,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pydantic import BaseModel

# ── 项目内部模块 ────────────────────────────────────────────
from config import BASE_DIR, settings

APP_VERSION = "1.0.0"
from models import REPORT_FAILURE_PLACEHOLDER_SUMMARY, TaskStatus
from scheduler import is_pause_requested, request_pause, request_resume
from storage import SQLiteStorage
from utils import setup_logger
from time_utils import local_now

# 初始化日志
setup_logger()


def _safe_raw_html_path(stored: Optional[str]) -> Optional[Path]:
    """仅允许读取项目目录内的抓取 HTML，防止路径穿越。"""
    if not stored or not isinstance(stored, str):
        return None
    p = Path(stored)
    if not p.is_file():
        return None
    try:
        rp = p.resolve()
        rp.relative_to(BASE_DIR.resolve())
        return rp
    except ValueError:
        return None


# ─────────────────────────────────────────────
# ExtendedStorage：在不修改 storage.py 的前提下增加查询方法
# ─────────────────────────────────────────────

class ExtendedStorage(SQLiteStorage):
    """继承 SQLiteStorage，增加前端所需的额外查询方法"""

    def get_all_task_runs(self, limit: int = 50) -> list[dict]:
        """获取任务历史（最新在前）"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM task_runs ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_report_list(
        self,
        limit: int = 20,
        offset: int = 0,
        site_name: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        dimension_q: Optional[str] = None,
        season_bucket_id: Optional[str] = None,
        season_year: Optional[int] = None,
        season_code: Optional[str] = None,
    ) -> tuple[list[dict], int]:
        """获取报告元数据列表（不含 key_trends 等大字段），支持站点/日期/维度/季节标签筛选。"""
        where: list[str] = ["TRIM(COALESCE(summary, '')) != ?"]
        params: list[Any] = [REPORT_FAILURE_PLACEHOLDER_SUMMARY]

        if site_name:
            where.append(
                "EXISTS (SELECT 1 FROM json_each(covered_sites) "
                "WHERE json_each.value = ?)"
            )
            params.append(site_name)
        if date_from:
            where.append("report_date >= ?")
            params.append(date_from)
        if date_to:
            where.append("report_date <= ?")
            params.append(date_to)
        if dimension_q and dimension_q.strip():
            q = f"%{dimension_q.strip()}%"
            where.append("(summary LIKE ? OR IFNULL(dimensions_json,'') LIKE ?)")
            params.extend([q, q])
        if season_bucket_id and str(season_bucket_id).strip():
            where.append("season_bucket_id = ?")
            params.append(str(season_bucket_id).strip())
        else:
            if season_year is not None and int(season_year) > 0:
                where.append("season_year = ?")
                params.append(int(season_year))
            if season_code and str(season_code).strip():
                where.append("season_code = ?")
                params.append(str(season_code).strip())

        wh = ("WHERE " + " AND ".join(where)) if where else ""

        with self._conn() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM reports {wh}", params
            ).fetchone()[0]
            rows = conn.execute(
                f"""SELECT report_id, batch_id, report_date, time_range,
                          summary, covered_sites, llm_model, generated_at,
                          report_json_path, report_md_path, dimensions_json,
                          season_code, season_year, season_label_zh, season_bucket_id
                   FROM reports
                   {wh}
                   ORDER BY generated_at DESC
                   LIMIT ? OFFSET ?""",
                params + [limit, offset],
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["covered_sites"] = json.loads(d.get("covered_sites") or "[]")
            if d.get("dimensions_json"):
                try:
                    d["dimensions_preview"] = json.loads(d["dimensions_json"])
                except Exception:
                    d["dimensions_preview"] = {}
            result.append(d)
        return result, total

    def get_report_filter_sites(self) -> list[str]:
        """历史报告中出现过的站点名（用于筛选下拉）。"""
        sites: set[str] = set()
        with self._conn() as conn:
            rows = conn.execute("SELECT covered_sites FROM reports").fetchall()
        for row in rows:
            try:
                for s in json.loads(row["covered_sites"] or "[]"):
                    if s:
                        sites.add(s)
            except Exception:
                continue
        return sorted(sites)

    def get_report_season_facets(self) -> dict[str, Any]:
        """按季节标签汇总历史报告数量，供前端下拉筛选。"""
        # 先补齐旧行中空的 season_bucket_id，否则「季节趋势」页与筛选项会空白
        self.backfill_report_season_metadata()
        buckets: list[dict[str, Any]] = []
        with self._conn() as conn:
            try:
                rows = conn.execute(
                    """
                    SELECT season_bucket_id AS season_bucket_id,
                           MAX(season_label_zh) AS season_label_zh,
                           MAX(season_year) AS season_year,
                           MAX(season_code) AS season_code,
                           COUNT(*) AS n
                    FROM reports
                    WHERE IFNULL(season_bucket_id,'') != ''
                      AND UPPER(IFNULL(TRIM(season_code),'')) != 'UNKNOWN'
                      AND UPPER(IFNULL(season_bucket_id,'')) NOT GLOB '*_UNKNOWN'
                      AND TRIM(COALESCE(summary, '')) != ?
                    GROUP BY season_bucket_id
                    ORDER BY season_year DESC, season_code ASC
                    """,
                    (REPORT_FAILURE_PLACEHOLDER_SUMMARY,),
                ).fetchall()
                buckets = [dict(r) for r in rows]
            except Exception as exc:
                logger.warning("get_report_season_facets SQL failed, returning empty facets: {}", exc)
                buckets = []
        years = sorted(
            {int(b["season_year"]) for b in buckets if b.get("season_year")},
            reverse=True,
        )
        codes = sorted({str(b["season_code"]) for b in buckets if b.get("season_code")})
        return {"buckets": buckets, "years": years, "season_codes": codes}

    def get_task_by_id(self, run_id: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM task_runs WHERE run_id=?", (run_id,)
            ).fetchone()
        return dict(row) if row else None

    def subscribe_email(self, email: str) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO subscriptions (email, created_at, active)
                VALUES (?,?,1)
                """,
                (email, local_now().isoformat()),
            )

    @staticmethod
    def _hydrate_dimensions_from_sqlite(d: dict) -> None:
        """用 SQLite 行里的 dimensions_json 补全 colors/fabrics/…，便于 JSON 丢失或 LLM 失败时仍有维度概览。"""
        raw = d.get("dimensions_json")
        if raw is None:
            return
        if isinstance(raw, dict):
            dim = raw
        else:
            try:
                dim = json.loads(str(raw) or "{}")
            except Exception:
                return
        if not isinstance(dim, dict):
            return
        for k in (
            "colors",
            "fabrics",
            "items",
            "silhouettes",
            "patterns",
            "style_keywords",
            "consumer_signals",
        ):
            cur = d.get(k)
            if cur:
                continue
            vals = dim.get(k) or []
            if isinstance(vals, list) and vals:
                d[k] = list(vals)

    def get_report_by_id(self, report_id: str) -> Optional[dict]:
        """
        获取完整报告：优先读 JSON 文件，文件不存在则返回 SQLite 元数据 + partial=True
        """
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM reports WHERE report_id=?", (report_id,)
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["covered_sites"] = json.loads(d.get("covered_sites") or "[]")
        d["source_articles"] = json.loads(d.get("source_articles") or "[]")
        d["token_usage"] = json.loads(d.get("token_usage") or "{}")

        json_path = d.get("report_json_path", "")
        if json_path and Path(json_path).exists():
            try:
                full = json.loads(Path(json_path).read_text(encoding="utf-8"))
                d.update(full)
                d["partial"] = False
            except Exception as exc:
                logger.warning("Failed to read report JSON {}: {}", json_path, exc)
                d["partial"] = True
        else:
            d["partial"] = True

        self._hydrate_dimensions_from_sqlite(d)
        if not (d.get("key_trends") or []):
            d["body_notice_zh"] = (
                "当前报告没有「关键趋势」结构化正文，常见原因："
                "① LLM 调用失败或超时（摘要中多为「分析失败」类提示），请检查 .env 里 API Key、"
                "LLM_BASE_URL 与本机网络/代理；"
                "② 报告 JSON 文件缺失或损坏（页面标记为「部分数据」时），可查看 logs 与 data/reports 下对应文件。"
                "成功生成后，此处会出现关键趋势与各板块详情。"
            )

        keys = d.get("source_articles") or []
        if keys and isinstance(keys, list):
            str_keys = [k for k in keys if isinstance(k, str)]
            if str_keys:
                d["source_article_details"] = self.get_articles_by_keys(str_keys)
        return d

    def get_article_by_unique_key(self, unique_key: str) -> Optional[dict]:
        """单篇文章元数据（含是否可读取本地抓取 HTML）。"""
        with self._conn() as conn:
            row = conn.execute(
                """SELECT unique_key, site_name, title, article_url, raw_html_path
                   FROM articles WHERE unique_key=?""",
                (unique_key,),
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["has_raw_html"] = bool(_safe_raw_html_path(d.get("raw_html_path")))
        return d

    def get_articles_by_keys(self, keys: list[str]) -> list[dict]:
        """按报告中的 source_articles 顺序返回详情（用于前端展示）。"""
        keys = [k for k in keys if k and isinstance(k, str)]
        if not keys:
            return []
        placeholders = ",".join("?" * len(keys))
        with self._conn() as conn:
            rows = conn.execute(
                f"""SELECT unique_key, site_name, title, article_url, raw_html_path
                    FROM articles WHERE unique_key IN ({placeholders})""",
                keys,
            ).fetchall()
        by_key = {dict(r)["unique_key"]: dict(r) for r in rows}
        out: list[dict] = []
        for k in keys:
            if k not in by_key:
                continue
            d = by_key[k]
            d["has_raw_html"] = bool(_safe_raw_html_path(d.get("raw_html_path")))
            out.append(d)
        return out

    def get_latest_report(self) -> Optional[dict]:
        """获取最新报告"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT report_id FROM reports WHERE TRIM(COALESCE(summary, '')) != ? "
                "ORDER BY generated_at DESC LIMIT 1",
                (REPORT_FAILURE_PLACEHOLDER_SUMMARY,),
            ).fetchone()
        if not row:
            return None
        return self.get_report_by_id(row["report_id"])

    def get_articles_paginated(
        self,
        limit: int = 20,
        offset: int = 0,
        site_name: Optional[str] = None,
        analyzed: Optional[bool] = None,
    ) -> tuple[list[dict], int]:
        """文章分页查询"""
        conditions: list[str] = []
        params: list[Any] = []

        if site_name:
            conditions.append("a.site_name=?")
            params.append(site_name)
        if analyzed is not None:
            conditions.append("a.llm_analyzed=?")
            params.append(int(analyzed))

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        with self._conn() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM articles a {where}", params
            ).fetchone()[0]
            rows = conn.execute(
                f"""SELECT a.unique_key, a.site_name, a.category, a.tags, a.title,
                           a.summary, a.author, a.published_at, a.article_url,
                           a.crawled_at, a.llm_analyzed,
                           (SELECT i.original_url FROM images i
                            WHERE i.article_key = a.unique_key ORDER BY i.id LIMIT 1) AS _thumb_url
                    FROM articles a
                    {where}
                    ORDER BY a.crawled_at DESC
                    LIMIT ? OFFSET ?""",
                params + [limit, offset],
            ).fetchall()

        results: list[dict] = []
        for r in rows:
            d = dict(r)
            d["tags"] = json.loads(d.get("tags") or "[]")
            thumb = d.pop("_thumb_url", None)
            d["image_urls"] = [thumb] if thumb else []
            results.append(d)

        return results, total

    def get_site_names(self) -> list[str]:
        """获取所有出现过的站点名称（用于过滤下拉）"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT DISTINCT site_name FROM articles ORDER BY site_name"
            ).fetchall()
        return [r["site_name"] for r in rows if r["site_name"]]

    def get_stats(self) -> dict:
        """全局统计汇总"""
        self.backfill_report_season_metadata()
        with self._conn() as conn:
            total_articles = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
            analyzed = conn.execute(
                "SELECT COUNT(*) FROM articles WHERE llm_analyzed=1"
            ).fetchone()[0]
            total_sites = conn.execute(
                "SELECT COUNT(DISTINCT site_name) FROM articles"
            ).fetchone()[0]
            total_reports = conn.execute(
                "SELECT COUNT(*) FROM reports WHERE TRIM(COALESCE(summary, '')) != ?",
                (REPORT_FAILURE_PLACEHOLDER_SUMMARY,),
            ).fetchone()[0]
            running = conn.execute(
                "SELECT COUNT(*) FROM task_runs WHERE status='running'"
            ).fetchone()[0]
            latest_run_row = conn.execute(
                """SELECT run_id, status, started_at, articles_new, pipeline_mode,
                          articles_analyzed, reports_generated, error_message, sites_failed,
                          analyze_duration_ms
                   FROM task_runs ORDER BY started_at DESC LIMIT 1"""
            ).fetchone()
        return {
            "total_articles": total_articles,
            "analyzed_articles": analyzed,
            "total_sites": total_sites,
            "total_reports": total_reports,
            "is_running": running > 0,
            "latest_run": dict(latest_run_row) if latest_run_row else None,
        }

    def get_current_task(self) -> Optional[dict]:
        """获取 running 任务，若无则取最新任务"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM task_runs WHERE status='running' LIMIT 1"
            ).fetchone()
            if not row:
                row = conn.execute(
                    "SELECT * FROM task_runs ORDER BY started_at DESC LIMIT 1"
                ).fetchone()
        return dict(row) if row else None

    # ── 趋势分析 (委托给 SQLiteStorage) ──────────────────────────

    def get_hot_keywords(self, limit: int = 50, category: Optional[str] = None) -> list[dict]:
        return super().get_hot_keywords(limit=limit, category=category)

    def get_keyword_timeline(
        self,
        keyword: str,
        *,
        lookback_days: int = 730,
        max_points: int = 500,
    ) -> list[dict]:
        return super().get_keyword_timeline(
            keyword=keyword,
            lookback_days=lookback_days,
            max_points=max_points,
        )

    def search_articles_fts(self, q: str, limit: int = 20, offset: int = 0) -> tuple[list[dict], int]:
        return super().search_articles_fts(q=q, limit=limit, offset=offset)

    def get_dimension_stats(self) -> dict:
        return super().get_dimension_stats()

    def get_articles_paginated_with_search(
        self,
        limit: int = 20,
        offset: int = 0,
        site_name: Optional[str] = None,
        analyzed: Optional[bool] = None,
        q: Optional[str] = None,
    ) -> tuple[list[dict], int]:
        """文章分页查询（支持全文搜索）"""
        if q and q.strip():
            rows, total = self.search_articles_fts(q.strip(), limit=limit, offset=offset)
            # apply site_name / analyzed filter post-query for simplicity
            if site_name:
                rows = [r for r in rows if r.get("site_name") == site_name]
            if analyzed is not None:
                rows = [r for r in rows if bool(r.get("llm_analyzed")) == analyzed]
            return rows, total
        return self.get_articles_paginated(limit, offset, site_name, analyzed)


# ─────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────

_storage: Optional[ExtendedStorage] = None


def get_storage() -> ExtendedStorage:
    global _storage
    if _storage is None:
        _storage = ExtendedStorage()
    return _storage


# ─────────────────────────────────────────────
# WebSocket 连接管理
# ─────────────────────────────────────────────

class ConnectionManager:
    def __init__(self) -> None:
        self._active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._active.append(ws)
        logger.info("WS connected, total={}", len(self._active))

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._active:
            self._active.remove(ws)
        logger.info("WS disconnected, total={}", len(self._active))

    async def broadcast(self, message: dict) -> None:
        data = json.dumps(message, default=str, ensure_ascii=False)
        dead: list[WebSocket] = []
        for ws in list(self._active):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


ws_manager = ConnectionManager()

# ─────────────────────────────────────────────
# Pipeline 触发后台任务
# ─────────────────────────────────────────────

_pipeline_task: Optional[asyncio.Task] = None


def _recover_orphan_running_tasks_if_needed() -> int:
    """
    若当前 API 进程内没有真实后台流水线任务，但数据库仍残留 running，
    说明上一次运行已因服务重启/中断而终止，应立即恢复为 failed。
    """
    active = _pipeline_task is not None and not _pipeline_task.done()
    if active:
        return 0
    running = get_storage().get_running_task()
    if not running:
        return 0
    return get_storage().recover_all_running_tasks(
        "已自动恢复：服务重启或后台任务中断，运行状态已失效"
    )


def _run_pipeline_in_thread(mode: str) -> None:
    """在独立线程中运行流水线（解决 Windows Playwright 不兼容 SelectorEventLoop 问题）"""
    import sys
    # Windows 需要 ProactorEventLoop 才能支持 Playwright subprocess transport
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        from storage import StorageManager
        from scheduler import execute_pipeline
        storage_mgr = StorageManager()
        kwargs = dict(
            crawl_only=(mode == "crawl_only"),
            analyze_only=(mode == "analyze_only"),
            analyze_library=(mode == "analyze_library"),
        )
        loop.run_until_complete(execute_pipeline(storage_mgr, **kwargs))
    finally:
        loop.close()


async def _run_pipeline_background(mode: str) -> None:
    """后台运行流水线，轮询 DB 状态并通过 WebSocket 广播进度"""
    import concurrent.futures

    await ws_manager.broadcast({
        "type": "started",
        "data": {"mode": mode, "timestamp": local_now().isoformat()},
    })

    # 在独立线程中运行流水线（Windows Playwright 兼容性）
    loop = asyncio.get_event_loop()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    pipeline_future = loop.run_in_executor(executor, _run_pipeline_in_thread, mode)
    pipeline_task = asyncio.ensure_future(pipeline_future)

    # 轮询进度并广播
    while not pipeline_task.done():
        await asyncio.sleep(3)
        try:
            current = get_storage().get_current_task()
            if current:
                await ws_manager.broadcast(
                    {
                        "type": "progress",
                        "data": {
                            **current,
                            "pause_requested": is_pause_requested(),
                        },
                    }
                )
        except Exception as exc:
            logger.warning("WS broadcast error: {}", exc)

    try:
        pipeline_task.result()  # propagate exceptions if any
    except Exception as exc:
        await ws_manager.broadcast({
            "type": "error",
            "data": {"message": str(exc)},
        })

    # 从 DB 读取最终结果
    try:
        current = get_storage().get_current_task()
        await ws_manager.broadcast({
            "type": "completed",
            "data": current or {"status": "unknown"},
        })
    except Exception as exc:
        logger.warning("Failed to broadcast completion: {}", exc)

    global _pipeline_task
    _pipeline_task = None


# ─────────────────────────────────────────────
# FastAPI 应用
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("API server starting up")
    storage = get_storage()
    n = storage.recover_stale_running_tasks(settings.stale_task_recovery_minutes)
    if n:
        logger.warning("Startup: recovered {} stale running task(s)", n)
    n2 = _recover_orphan_running_tasks_if_needed()
    if n2:
        logger.warning("Startup: recovered {} orphan running task(s)", n2)
    yield
    logger.info("API server shutting down")


app = FastAPI(
    title="AI Fashion Pipeline API",
    version=APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # 生产环境请限制为具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# REST 端点
# ─────────────────────────────────────────────


def _health_payload() -> dict:
    """数据库可读即视为健康（用于负载均衡与监控）"""
    get_storage().get_stats()
    return {
        "status": "ok",
        "version": APP_VERSION,
        "database": "ok",
    }


@app.get("/health")
@app.get("/api/health")
async def health():
    try:
        return _health_payload()
    except Exception as exc:
        logger.exception("Health check failed: {}", exc)
        raise HTTPException(
            503,
            detail={"status": "error", "message": str(exc)},
        )


@app.get("/api/meta")
async def api_meta():
    """前端可读的公开配置（不含密钥）"""
    from site_configs.loader import load_all_site_configs

    try:
        site_cfgs = load_all_site_configs()
        enabled_sites = sum(1 for c in site_cfgs if c.enabled)
    except Exception:
        enabled_sites = 0

    return {
        "version": APP_VERSION,
        "llm_configured": settings.is_llm_configured(),
        "timezone": settings.timezone,
        "schedule_hours": settings.schedule_hours,
        "store_backend": settings.store_backend,
        "stale_task_recovery_minutes": settings.stale_task_recovery_minutes,
        "enabled_site_count": enabled_sites,
    }


@app.get("/api/stats")
async def get_stats():
    try:
        return get_storage().get_stats()
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/reports/filters")
async def report_filters():
    """报告筛选器元数据：站点列表 + 按年/季节标签的汇总（可选单独分类）。"""
    try:
        st = get_storage()
        sites = st.get_report_filter_sites()
        season_facets = st.get_report_season_facets()
        return {"sites": sites, "season_facets": season_facets}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/reports")
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


@app.get("/api/reports/latest")
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


@app.get("/api/reports/{report_id}")
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


@app.get("/api/reports/{report_id}/export")
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


@app.get("/api/reports/{left_id}/compare/{right_id}")
async def compare_two_reports(left_id: str, right_id: str):
    """两份报告维度与关键趋势名称差异（用于本周 vs 上周、站点对比等）。"""
    from report_utils import compare_reports

    st = get_storage()
    left = st.get_report_by_id(left_id)
    right = st.get_report_by_id(right_id)
    if not left or not right:
        raise HTTPException(404, "报告不存在或 JSON 已丢失")
    return compare_reports(left, right)


@app.get("/api/trends/hot")
async def trends_hot_keywords(
    limit: int = Query(50, ge=1, le=200),
    category: Optional[str] = Query(None, description="指定维度：colors/fabrics/items/silhouettes/patterns/style_keywords/consumer_signals"),
):
    """从历史报告中聚合高频关键词，可按维度筛选。"""
    try:
        return get_storage().get_hot_keywords(limit=limit, category=category)
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/trends/timeline")
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


@app.get("/api/trends/dimension-stats")
async def trends_dimension_stats():
    """各维度词汇汇总统计（用于仪表盘概览）。"""
    try:
        return get_storage().get_dimension_stats()
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/articles")
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


@app.get("/api/articles/{unique_key}/raw-html")
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


@app.get("/api/tasks")
async def get_tasks(limit: int = Query(30, ge=1, le=200)):
    from report_utils import summarize_tokens

    try:
        runs = get_storage().get_all_task_runs(limit)
        for r in runs:
            try:
                r["llm_token_usage"] = json.loads(r.get("llm_token_usage_json") or "{}")
            except Exception:
                r["llm_token_usage"] = {}
            r["llm_tokens_total_est"] = summarize_tokens(r.get("llm_token_usage"))
        return {"tasks": runs}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/tasks/{run_id}")
async def get_task_detail(run_id: str):
    """单条任务详情（可观测性钻取）。"""
    try:
        t = get_storage().get_task_by_id(run_id)
        if not t:
            raise HTTPException(404, "任务不存在")
        try:
            t["llm_token_usage"] = json.loads(t.get("llm_token_usage_json") or "{}")
        except Exception:
            t["llm_token_usage"] = {}
        from report_utils import summarize_tokens

        t["llm_tokens_total_est"] = summarize_tokens(t.get("llm_token_usage"))
        return t
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/tasks/current")
async def get_current_task():
    try:
        _recover_orphan_running_tasks_if_needed()
        task = get_storage().get_current_task()
        return task or {}
    except Exception as exc:
        raise HTTPException(500, str(exc))


class TriggerRequest(BaseModel):
    mode: str = "full"


@app.post("/api/pipeline/trigger")
async def trigger_pipeline(req: TriggerRequest):
    global _pipeline_task

    if req.mode != "full":
        raise HTTPException(400, "仅支持完整工作流分析（mode=full）")

    _recover_orphan_running_tasks_if_needed()

    # 检查是否已有 running 任务
    running = get_storage().get_running_task()
    if running:
        raise HTTPException(409, f"Pipeline already running: {running.get('run_id')}")

    if _pipeline_task and not _pipeline_task.done():
        raise HTTPException(409, "Pipeline task already scheduled")

    _pipeline_task = asyncio.create_task(
        _run_pipeline_background(req.mode)
    )

    return {"status": "triggered", "mode": req.mode}


@app.get("/api/pipeline/state")
async def pipeline_state():
    """返回当前流水线运行/暂停状态。"""
    _recover_orphan_running_tasks_if_needed()
    running = get_storage().get_running_task()
    return {
        "is_running": bool(running),
        "pause_requested": is_pause_requested(),
        "current_task": running or {},
    }


@app.post("/api/pipeline/pause")
async def pause_pipeline():
    """
    请求暂停运行中的流水线。
    注意：暂停会在安全检查点生效（站点边界、文章抓取并发入口、阶段切换点）。
    """
    _recover_orphan_running_tasks_if_needed()
    running = get_storage().get_running_task()
    if not running:
        raise HTTPException(409, "No running pipeline to pause")
    request_pause()
    await ws_manager.broadcast(
        {
            "type": "paused",
            "data": {"run_id": running.get("run_id"), "pause_requested": True},
        }
    )
    return {"status": "pause_requested", "run_id": running.get("run_id")}


@app.post("/api/pipeline/resume")
async def resume_pipeline():
    """恢复被暂停的流水线。"""
    _recover_orphan_running_tasks_if_needed()
    running = get_storage().get_running_task()
    if not running:
        raise HTTPException(409, "No running pipeline to resume")
    request_resume()
    await ws_manager.broadcast(
        {
            "type": "resumed",
            "data": {"run_id": running.get("run_id"), "pause_requested": False},
        }
    )
    return {"status": "resumed", "run_id": running.get("run_id")}


@app.post("/api/pipeline/retry/{run_id}")
async def retry_failed_pipeline(run_id: str):
    """对失败或部分成功的任务按记录的 pipeline_mode 重试（需当前无运行中任务）。"""
    global _pipeline_task

    # 与历史「误标 success」口径对齐后再判断（与 normalize-task-statuses 一致）
    get_storage().normalize_single_task_run_status(run_id)
    task = get_storage().get_task_by_id(run_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    st = task.get("status")
    if st not in ("failed", "partial"):
        raise HTTPException(
            400,
            f"仅 failed / partial 任务可重试，当前状态: {st}",
        )
    mode = (task.get("pipeline_mode") or "").strip() or "full"
    if mode not in ("full", "crawl_only", "analyze_only", "analyze_library"):
        mode = "full"

    running = get_storage().get_running_task()
    if running:
        raise HTTPException(409, f"Pipeline already running: {running.get('run_id')}")
    if _pipeline_task and not _pipeline_task.done():
        raise HTTPException(409, "Pipeline task already scheduled")

    _pipeline_task = asyncio.create_task(_run_pipeline_background(mode))
    return {"status": "triggered", "mode": mode, "retried_run_id": run_id}


class SubscribeRequest(BaseModel):
    email: str


@app.post("/api/subscribe")
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


@app.post("/api/articles/dedupe")
async def dedupe_articles():
    """
    清理重复文章：规范化 URL 相同、或同站同标题（均保留最早抓取的一条）。
    因 article_url 有 UNIQUE，仅靠「完全相同 URL」无法在库中出现两条。
    """
    try:
        return get_storage().dedupe_articles_by_url()
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/sites")
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


# ─────────────────────────────────────────────
# WebSocket
# ─────────────────────────────────────────────

@app.websocket("/ws/pipeline")
async def ws_pipeline(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # 立即推送当前状态
        current = get_storage().get_current_task()
        await websocket.send_json(
            json.loads(
                json.dumps(
                    {
                        "type": "connected",
                        "data": {**(current or {}), "pause_requested": is_pause_requested()},
                    },
                    default=str,
                )
            )
        )

        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                data = json.loads(msg)
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # 心跳
                await websocket.send_json({"type": "ping"})
            except Exception:
                break

    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(websocket)


# ─────────────────────────────────────────────
# 静态文件 & 前端入口
# ─────────────────────────────────────────────

frontend_dir = Path(__file__).parent / "frontend"
if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

    @app.get("/")
    async def serve_index():
        index_path = frontend_dir / "index.html"
        if index_path.exists():
            # 避免浏览器长期缓存入口 HTML，导致仍加载旧版 ?v= 的静态资源引用
            return FileResponse(
                str(index_path),
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                },
            )
        return JSONResponse({"error": "frontend/index.html not found"}, status_code=404)
else:
    @app.get("/")
    async def no_frontend():
        return {"message": "AI Fashion API is running. Place frontend/ directory for UI."}


# ─────────────────────────────────────────────
# 直接运行入口
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
