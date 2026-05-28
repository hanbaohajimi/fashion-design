"""
storage.py — 数据持久化模块
支持：SQLite（主存储）+ JSON（原始数据）+ Markdown（人可读报告）
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterator, Optional
from urllib.parse import urlparse

from loguru import logger

from config import settings
from models import (
    Article,
    CrawlSession,
    FashionTrendReport,
    ImageItem,
    REPORT_FAILURE_PLACEHOLDER_SUMMARY,
    TaskRun,
    TaskStatus,
)
from time_utils import local_now


def _success_row_status_override(row: sqlite3.Row) -> Optional[str]:
    """
    task_runs 行为 success 时，若与当前调度器口径不一致则返回应写入的 status（failed/partial），否则 None。
    """
    analysis_modes = {"full", "analyze_only", "analyze_library"}
    st = (row["status"] or "").strip().lower()
    if st != "success":
        return None
    mode = (row["pipeline_mode"] or "").strip()
    aa = int(row["articles_analyzed"] or 0)
    rg = int(row["reports_generated"] or 0)
    em = (row["error_message"] or "").strip()
    sf = int(row["sites_failed"] or 0)
    adm = int(row["analyze_duration_ms"] or 0)
    if mode in analysis_modes and aa > 0 and rg == 0 and adm > 0:
        return TaskStatus.FAILED.value
    if sf > 0 or em:
        return TaskStatus.PARTIAL.value
    return None


# ─────────────────────────────────────────────
# SQLite 存储
# ─────────────────────────────────────────────

class SQLiteStorage:
    """
    SQLite 持久化层。
    负责：文章、图片映射、任务运行记录、分析结果索引的存储与查询。
    """

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = Path(db_path or settings.db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        """获取数据库连接（带 WAL 模式，提升并发写入性能）"""
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_schema(self) -> None:
        """初始化数据库表结构"""
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS articles (
                    unique_key      TEXT PRIMARY KEY,
                    site_name       TEXT NOT NULL,
                    source          TEXT,
                    category        TEXT,
                    tags            TEXT,           -- JSON 数组字符串
                    title           TEXT NOT NULL,
                    content         TEXT,
                    summary         TEXT,
                    author          TEXT,
                    published_at    TEXT,
                    article_url     TEXT UNIQUE,
                    raw_html_path   TEXT,
                    crawled_at      TEXT NOT NULL,
                    llm_analyzed    INTEGER DEFAULT 0,
                    analysis_id     TEXT DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS images (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    article_key     TEXT NOT NULL REFERENCES articles(unique_key),
                    original_url    TEXT NOT NULL,
                    local_path      TEXT,
                    content_hash    TEXT,
                    downloaded      INTEGER DEFAULT 0,
                    alt_text        TEXT,
                    UNIQUE(article_key, original_url)
                );

                CREATE TABLE IF NOT EXISTS task_runs (
                    run_id          TEXT PRIMARY KEY,
                    started_at      TEXT NOT NULL,
                    finished_at     TEXT,
                    status          TEXT NOT NULL DEFAULT 'pending',
                    sites_total     INTEGER DEFAULT 0,
                    sites_success   INTEGER DEFAULT 0,
                    sites_failed    INTEGER DEFAULT 0,
                    articles_crawled INTEGER DEFAULT 0,
                    articles_new    INTEGER DEFAULT 0,
                    articles_analyzed INTEGER DEFAULT 0,
                    reports_generated INTEGER DEFAULT 0,
                    error_message   TEXT DEFAULT '',
                    pipeline_mode   TEXT DEFAULT '',
                    crawl_duration_ms INTEGER DEFAULT 0,
                    analyze_duration_ms INTEGER DEFAULT 0,
                    llm_token_usage_json TEXT DEFAULT '{}',
                    stage_code      TEXT DEFAULT '',
                    stage_label     TEXT DEFAULT '',
                    stage_detail    TEXT DEFAULT '',
                    stage_index     INTEGER DEFAULT 0,
                    stage_total     INTEGER DEFAULT 0,
                    progress_percent INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS reports (
                    report_id       TEXT PRIMARY KEY,
                    batch_id        TEXT,
                    report_date     TEXT NOT NULL,
                    time_range      TEXT,
                    summary         TEXT,
                    covered_sites   TEXT,           -- JSON 数组
                    source_articles TEXT,           -- JSON 数组
                    llm_model       TEXT,
                    token_usage     TEXT,           -- JSON 对象
                    generated_at    TEXT NOT NULL,
                    report_json_path TEXT,
                    report_md_path   TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_articles_site ON articles(site_name);
                CREATE INDEX IF NOT EXISTS idx_articles_crawled ON articles(crawled_at);
                CREATE INDEX IF NOT EXISTS idx_articles_analyzed ON articles(llm_analyzed);

                CREATE TABLE IF NOT EXISTS subscriptions (
                    email       TEXT PRIMARY KEY,
                    created_at  TEXT NOT NULL,
                    active      INTEGER DEFAULT 1
                );
            """)
        self._migrate_schema()
        logger.debug("SQLite schema initialized at {}", self.db_path)

    def _migrate_schema(self) -> None:
        """增量添加列（兼容已有数据库文件）。"""
        with self._conn() as conn:
            def cols(table: str) -> set[str]:
                return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}

            tr = cols("task_runs")
            if "pipeline_mode" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN pipeline_mode TEXT DEFAULT ''"
                )
            if "crawl_duration_ms" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN crawl_duration_ms INTEGER DEFAULT 0"
                )
            if "analyze_duration_ms" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN analyze_duration_ms INTEGER DEFAULT 0"
                )
            if "llm_token_usage_json" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN llm_token_usage_json TEXT DEFAULT '{}'"
                )
            if "articles_analyzed" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN articles_analyzed INTEGER DEFAULT 0"
                )
            if "stage_code" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN stage_code TEXT DEFAULT ''"
                )
            if "stage_label" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN stage_label TEXT DEFAULT ''"
                )
            if "stage_detail" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN stage_detail TEXT DEFAULT ''"
                )
            if "stage_index" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN stage_index INTEGER DEFAULT 0"
                )
            if "stage_total" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN stage_total INTEGER DEFAULT 0"
                )
            if "progress_percent" not in tr:
                conn.execute(
                    "ALTER TABLE task_runs ADD COLUMN progress_percent INTEGER DEFAULT 0"
                )

            rp = cols("reports")
            if "dimensions_json" not in rp:
                conn.execute(
                    "ALTER TABLE reports ADD COLUMN dimensions_json TEXT DEFAULT NULL"
                )
            if "season_code" not in rp:
                conn.execute("ALTER TABLE reports ADD COLUMN season_code TEXT DEFAULT ''")
            if "season_year" not in rp:
                conn.execute("ALTER TABLE reports ADD COLUMN season_year INTEGER DEFAULT 0")
            if "season_label_zh" not in rp:
                conn.execute("ALTER TABLE reports ADD COLUMN season_label_zh TEXT DEFAULT ''")
            if "season_bucket_id" not in rp:
                conn.execute("ALTER TABLE reports ADD COLUMN season_bucket_id TEXT DEFAULT ''")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_reports_season_bucket "
                "ON reports(season_bucket_id)"
            )

    # ── 文章 ──────────────────────────────────

    def get_existing_keys(self) -> set[str]:
        """获取数据库中所有已存在的文章 unique_key（用于去重）"""
        with self._conn() as conn:
            rows = conn.execute("SELECT unique_key FROM articles").fetchall()
        return {row["unique_key"] for row in rows}

    def save_articles(self, articles: list[Article]) -> int:
        """
        批量保存文章（幂等：unique_key 冲突时忽略，不覆盖已有数据）。
        返回实际插入数量。
        """
        inserted = 0
        with self._conn() as conn:
            for art in articles:
                try:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO articles
                        (unique_key, site_name, source, category, tags, title,
                         content, summary, author, published_at, article_url,
                         raw_html_path, crawled_at, llm_analyzed, analysis_id)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            art.unique_key,
                            art.site_name,
                            art.source,
                            art.category,
                            json.dumps(art.tags, ensure_ascii=False),
                            art.title,
                            art.content,
                            art.summary,
                            art.author,
                            art.published_at.isoformat() if art.published_at else None,
                            art.article_url,
                            art.raw_html_path,
                            art.crawled_at.isoformat(),
                            int(art.llm_analyzed),
                            art.analysis_id,
                        ),
                    )
                    if conn.execute(
                        "SELECT changes()"
                    ).fetchone()[0] > 0:
                        inserted += 1

                    # 仅当文章行真实存在时再写图片，避免 URL 唯一冲突下的外键错误
                    article_exists = conn.execute(
                        "SELECT 1 FROM articles WHERE unique_key=? LIMIT 1",
                        (art.unique_key,),
                    ).fetchone()
                    if not article_exists:
                        continue

                    # 保存图片映射
                    for img in art.images:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO images
                            (article_key, original_url, local_path, content_hash, downloaded, alt_text)
                            VALUES (?,?,?,?,?,?)
                            """,
                            (
                                art.unique_key,
                                img.original_url,
                                img.local_path,
                                img.content_hash,
                                int(img.downloaded),
                                img.alt_text,
                            ),
                        )
                except Exception as exc:
                    logger.error(
                        "Failed to save article [{}]: {}", art.unique_key, exc
                    )
        logger.info("Articles saved: {}/{} inserted", inserted, len(articles))
        return inserted

    def mark_articles_analyzed(self, keys: list[str], analysis_id: str) -> None:
        """标记文章已完成 LLM 分析"""
        with self._conn() as conn:
            conn.executemany(
                "UPDATE articles SET llm_analyzed=1, analysis_id=? WHERE unique_key=?",
                [(analysis_id, k) for k in keys],
            )

    def get_unanalyzed_articles(self, limit: Optional[int] = None) -> list[dict]:
        """获取尚未 LLM 分析的文章，包含关联图片（用于 analyze-latest；大池便于质量排序后择优）。"""
        lim = limit if limit is not None else settings.unanalyzed_article_pool_limit
        with self._conn() as conn:
            if lim and lim > 0:
                rows = conn.execute(
                    """
                    SELECT * FROM articles
                    WHERE llm_analyzed = 0
                    ORDER BY crawled_at DESC
                    LIMIT ?
                    """,
                    (lim,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM articles
                    WHERE llm_analyzed = 0
                    ORDER BY crawled_at DESC
                    """
                ).fetchall()
            result = []
            for row in rows:
                d = dict(row)
                img_rows = conn.execute(
                    "SELECT original_url, local_path, content_hash, downloaded, alt_text "
                    "FROM images WHERE article_key=?",
                    (d["unique_key"],),
                ).fetchall()
                d["_images"] = [dict(r) for r in img_rows]
                result.append(d)
        return result

    def get_articles_for_library_season_analysis(self, limit: Optional[int] = None) -> list[dict]:
        """
        获取已入库文章（不区分是否曾分析），用于「全库季节趋势」模式：
        按季节分桶 + 质量闸后重新生成各桶趋势报告。
        """
        lim = limit if limit is not None else settings.library_season_article_pool_limit
        with self._conn() as conn:
            if lim and lim > 0:
                rows = conn.execute(
                    """
                    SELECT * FROM articles
                    ORDER BY crawled_at DESC
                    LIMIT ?
                    """,
                    (lim,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM articles
                    ORDER BY crawled_at DESC
                    """
                ).fetchall()
            result = []
            for row in rows:
                d = dict(row)
                img_rows = conn.execute(
                    "SELECT original_url, local_path, content_hash, downloaded, alt_text "
                    "FROM images WHERE article_key=?",
                    (d["unique_key"],),
                ).fetchall()
                d["_images"] = [dict(r) for r in img_rows]
                result.append(d)
        return result

    def get_latest_articles(self, limit: int = 100) -> list[dict]:
        """获取最近抓取的文章"""
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM articles
                ORDER BY crawled_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_article_rows_by_keys(self, keys: list[str]) -> list[dict]:
        """按 unique_key 批量加载文章行（含 images 子查询），供季节重分类等使用。"""
        if not keys:
            return []
        uniq = list(dict.fromkeys(k for k in keys if k))
        if not uniq:
            return []
        out: list[dict] = []
        chunk_size = 300
        with self._conn() as conn:
            for i in range(0, len(uniq), chunk_size):
                chunk = uniq[i : i + chunk_size]
                placeholders = ",".join("?" * len(chunk))
                rows = conn.execute(
                    f"SELECT * FROM articles WHERE unique_key IN ({placeholders})",
                    chunk,
                ).fetchall()
                for row in rows:
                    d = dict(row)
                    img_rows = conn.execute(
                        "SELECT original_url, local_path, content_hash, downloaded, alt_text "
                        "FROM images WHERE article_key=?",
                        (d["unique_key"],),
                    ).fetchall()
                    d["_images"] = [dict(r) for r in img_rows]
                    out.append(d)
        return out

    def _resolve_report_json_path(self, stored: Optional[str]) -> Optional[Path]:
        """解析报告 JSON 路径（支持绝对路径失效时按文件名在 data/reports 下查找）。"""
        if not stored or not str(stored).strip():
            return None
        path = Path(stored)
        if path.is_file():
            return path
        name = path.name
        if name:
            alt = Path(settings.data_dir) / "reports" / name
            if alt.is_file():
                return alt
        return None

    def backfill_report_season_metadata(self) -> int:
        """
        将 reports 表中空的 season_* 从磁盘 JSON 或 report_date 补齐。
        解决旧索引、跨机器路径等导致「趋势报告有数据但季节趋势页空白」的问题。
        """
        from season_profile import season_profile_from_bucket_id

        def infer_from_report_date(report_date: str) -> Optional[tuple[str, int, str, str]]:
            rd = (report_date or "").strip()
            if len(rd) < 4 or not rd[:4].isdigit():
                return None
            y = int(rd[:4])
            if not (1990 <= y <= 2100):
                return None
            bid = f"{y}_UNKNOWN"
            prof = season_profile_from_bucket_id(bid)
            return prof.season_code, prof.season_year, prof.season_label_zh, prof.bucket_id

        updated = 0
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT report_id, report_json_path, report_date
                FROM reports
                WHERE IFNULL(season_bucket_id, '') = ''
                """
            ).fetchall()
            for row in rows:
                rid = row["report_id"]
                code, year, label, bucket = "", 0, "", ""
                json_path = self._resolve_report_json_path(row["report_json_path"])
                if json_path:
                    try:
                        data = json.loads(json_path.read_text(encoding="utf-8"))
                    except Exception as exc:
                        logger.debug("backfill season: unreadable JSON {}: {}", json_path, exc)
                        data = None
                    if isinstance(data, dict):
                        bucket = (data.get("season_bucket_id") or "").strip()
                        if bucket:
                            code = (data.get("season_code") or "").strip()
                            try:
                                year = int(data.get("season_year") or 0)
                            except (TypeError, ValueError):
                                year = 0
                            label = (data.get("season_label_zh") or "").strip()
                            prof = season_profile_from_bucket_id(bucket)
                            if not code:
                                code = prof.season_code
                            if not year:
                                year = prof.season_year
                            if not label:
                                label = prof.season_label_zh
                if not bucket:
                    inferred = infer_from_report_date(row["report_date"] or "")
                    if inferred:
                        code, year, label, bucket = inferred
                if not bucket:
                    continue
                conn.execute(
                    """
                    UPDATE reports
                    SET season_code = ?, season_year = ?, season_label_zh = ?, season_bucket_id = ?
                    WHERE report_id = ?
                    """,
                    (code, int(year or 0), label, bucket, rid),
                )
                updated += 1
        if updated:
            logger.info("Backfilled season metadata for {} report row(s)", updated)
        return updated

    def get_latest_report_json(self) -> Optional[dict]:
        """
        获取最近一份报告的完整 JSON（若报告文件存在）。
        用于主题命名对齐等“相邻报告一致性”策略。
        """
        with self._conn() as conn:
            row = conn.execute(
                "SELECT report_json_path FROM reports WHERE TRIM(COALESCE(summary, '')) != ? "
                "ORDER BY generated_at DESC LIMIT 1",
                (REPORT_FAILURE_PLACEHOLDER_SUMMARY,),
            ).fetchone()
        if not row:
            return None
        path = self._resolve_report_json_path(row["report_json_path"])
        if not path:
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to load latest report JSON {}: {}", path, exc)
            return None

    @staticmethod
    def _normalize_url_key(url: str) -> str:
        """
        用于合并「同一页面」的不同写法：去掉 query/fragment，统一 scheme/host/path。
        表上 article_url 有 UNIQUE，完全相同字符串不会重复；
        重复多来自 ?utm=、http/https、尾斜杠等差异。
        """
        u = (url or "").strip()
        if not u:
            return ""
        if not u.startswith(("http://", "https://")):
            return u.lower()
        try:
            p = urlparse(u)
            if not p.netloc:
                return u.lower()
            path = (p.path or "").rstrip("/") or ""
            return f"{p.scheme.lower()}://{p.netloc.lower()}{path}".rstrip("/")
        except Exception:
            return u.lower()

    def _delete_article_keys(self, conn: sqlite3.Connection, keys: list[str]) -> int:
        n = 0
        for uk in keys:
            conn.execute("DELETE FROM images WHERE article_key=?", (uk,))
            cur = conn.execute("DELETE FROM articles WHERE unique_key=?", (uk,))
            if cur.rowcount:
                n += 1
        return n

    def dedupe_articles_by_url(self) -> dict[str, int]:
        """
        清理重复文章（两段逻辑，均保留 crawled_at 最早的一条）：

        1. 规范化 URL 相同视为同一篇（忽略查询参数、fragment 等）
        2. 同一站点 + 标题相同（忽略大小写与首尾空格）

        注意：article_url 字段本身 UNIQUE，仅「完全一致」的 URL 不会在库中出现两次，
        故必须用规范化 URL 或标题维度才能发现重复。
        """
        removed_norm = 0
        removed_title = 0
        with self._conn() as conn:
            # ── 1) 规范化 URL 去重 ─────────────────
            rows = conn.execute(
                """
                SELECT unique_key, article_url, crawled_at FROM articles
                WHERE IFNULL(TRIM(article_url), '') != ''
                """
            ).fetchall()
            buckets: dict[str, list[tuple[str, str]]] = {}
            for row in rows:
                uk, raw_u, crawled = row["unique_key"], row["article_url"], row["crawled_at"]
                key = self._normalize_url_key(raw_u)
                if not key:
                    continue
                buckets.setdefault(key, []).append((uk, crawled))

            for _k, lst in buckets.items():
                if len(lst) <= 1:
                    continue
                lst.sort(key=lambda x: (x[1] or "", x[0]))
                to_drop = [x[0] for x in lst[1:]]
                removed_norm += self._delete_article_keys(conn, to_drop)

            # ── 2) 同站 + 同标题去重 ─────────────────
            rows2 = conn.execute(
                """
                SELECT unique_key, site_name, title, crawled_at FROM articles
                """
            ).fetchall()
            tbuckets: dict[tuple[str, str], list[tuple[str, str]]] = {}
            for row in rows2:
                uk = row["unique_key"]
                site = (row["site_name"] or "").strip()
                title_key = (row["title"] or "").strip().lower()
                if not title_key:
                    continue
                tbuckets.setdefault((site, title_key), []).append(
                    (uk, row["crawled_at"])
                )

            for _k, lst in tbuckets.items():
                if len(lst) <= 1:
                    continue
                lst.sort(key=lambda x: (x[1] or "", x[0]))
                to_drop = [x[0] for x in lst[1:]]
                removed_title += self._delete_article_keys(conn, to_drop)

        total = removed_norm + removed_title
        if total:
            logger.info(
                "Article dedupe: removed {} total (url_norm={}, title_site={})",
                total,
                removed_norm,
                removed_title,
            )
        return {
            "removed": total,
            "removed_normalized_url": removed_norm,
            "removed_title_site": removed_title,
        }

    # ── 任务运行记录 ──────────────────────────

    def save_task_run(self, run: TaskRun) -> None:
        """保存或更新任务运行记录"""
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO task_runs
                (run_id, started_at, finished_at, status, sites_total,
                 sites_success, sites_failed, articles_crawled,
                 articles_new, articles_analyzed, reports_generated, error_message,
                 pipeline_mode, crawl_duration_ms, analyze_duration_ms,
                 llm_token_usage_json, stage_code, stage_label, stage_detail,
                 stage_index, stage_total, progress_percent)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    run.run_id,
                    run.started_at.isoformat(),
                    run.finished_at.isoformat() if run.finished_at else None,
                    run.status.value,
                    run.sites_total,
                    run.sites_success,
                    run.sites_failed,
                    run.articles_crawled,
                    run.articles_new,
                    int(getattr(run, "articles_analyzed", 0) or 0),
                    run.reports_generated,
                    run.error_message,
                    getattr(run, "pipeline_mode", "") or "",
                    int(getattr(run, "crawl_duration_ms", 0) or 0),
                    int(getattr(run, "analyze_duration_ms", 0) or 0),
                    getattr(run, "llm_token_usage_json", "") or "{}",
                    getattr(run, "stage_code", "") or "",
                    getattr(run, "stage_label", "") or "",
                    getattr(run, "stage_detail", "") or "",
                    int(getattr(run, "stage_index", 0) or 0),
                    int(getattr(run, "stage_total", 0) or 0),
                    int(getattr(run, "progress_percent", 0) or 0),
                ),
            )

    def get_running_task(self) -> Optional[dict]:
        """获取当前正在运行的任务（防止重叠执行）"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM task_runs WHERE status='running' LIMIT 1"
            ).fetchone()
        return dict(row) if row else None

    def recover_all_running_tasks(self, reason: str) -> int:
        """
        将所有 running 任务立即标记为失败。
        用于服务/进程重启后确认内存中已无真实后台任务，但数据库仍残留 running 状态的场景。
        """
        reason = (reason or "").strip() or "已自动恢复：服务重启导致运行中任务中断"
        now = local_now().isoformat()
        with self._conn() as conn:
            cur = conn.execute(
                """
                UPDATE task_runs
                SET status=?, finished_at=?, error_message=?
                WHERE status='running'
                """,
                (TaskStatus.FAILED.value, now, reason),
            )
            n = cur.rowcount
        if n:
            logger.warning("Recovered {} orphan running task(s)", n)
        return n

    def recover_stale_running_tasks(self, max_age_minutes: int) -> int:
        """
        将长时间停留在 running 的任务标记为失败（例如进程被 kill -9 或宿主机断电）。
        返回被更新的行数。max_age_minutes <= 0 时不做任何操作。
        """
        if max_age_minutes <= 0:
            return 0
        from datetime import timedelta

        cutoff = (local_now() - timedelta(minutes=max_age_minutes)).isoformat()
        now = local_now().isoformat()
        msg = "已自动恢复：任务长期处于运行中（进程可能异常退出）"
        with self._conn() as conn:
            cur = conn.execute(
                """
                UPDATE task_runs
                SET status=?, finished_at=?, error_message=?
                WHERE status='running' AND started_at < ?
                """,
                (TaskStatus.FAILED.value, now, msg, cutoff),
            )
            n = cur.rowcount
        if n:
            logger.warning(
                "Recovered {} stale running task(s) (older than {} min)",
                n,
                max_age_minutes,
            )
        return n

    def normalize_task_run_statuses(self) -> dict[str, int]:
        """
        修正历史 task_runs：与当前调度器对「成功 / 部分成功 / 失败」的口径对齐。
        - 曾计入 articles_analyzed、有分析耗时，但 reports_generated==0 → failed
        - success 且（有 error_message 或 sites_failed>0）→ partial
        """
        stats = {"scanned": 0, "to_failed": 0, "to_partial": 0}
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT run_id, status, pipeline_mode, articles_analyzed, reports_generated,
                       error_message, sites_failed, analyze_duration_ms
                FROM task_runs
                """
            ).fetchall()
        updates: list[tuple[str, str]] = []
        for row in rows:
            stats["scanned"] += 1
            rid = row["run_id"]
            new_st = _success_row_status_override(row)
            if new_st:
                updates.append((new_st, rid))

        if updates:
            with self._conn() as conn:
                for new_st, rid in updates:
                    conn.execute(
                        "UPDATE task_runs SET status=? WHERE run_id=?",
                        (new_st, rid),
                    )
                    if new_st == TaskStatus.FAILED.value:
                        stats["to_failed"] += 1
                    else:
                        stats["to_partial"] += 1
            logger.info(
                "Normalized task_run statuses | scanned={} to_failed={} to_partial={}",
                stats["scanned"],
                stats["to_failed"],
                stats["to_partial"],
            )
        return stats

    def normalize_single_task_run_status(self, run_id: str) -> Optional[str]:
        """
        对单条 task_runs 应用与 normalize_task_run_statuses 相同的规则。
        返回规范化后的 status；run_id 不存在则 None。
        """
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT run_id, status, pipeline_mode, articles_analyzed, reports_generated,
                       error_message, sites_failed, analyze_duration_ms
                FROM task_runs WHERE run_id=?
                """,
                (run_id,),
            ).fetchone()
        if not row:
            return None
        st = (row["status"] or "").strip().lower()
        new_st = _success_row_status_override(row)
        if new_st:
            with self._conn() as conn:
                conn.execute(
                    "UPDATE task_runs SET status=? WHERE run_id=?",
                    (new_st, run_id),
                )
            return new_st
        return st

    # ── 报告索引 ──────────────────────────────

    def save_report_index(
        self,
        report: FashionTrendReport,
        json_path: str = "",
        md_path: str = "",
    ) -> None:
        """将报告元数据保存到 SQLite 索引"""
        dim_blob = json.dumps(
            {
                "colors": report.colors,
                "fabrics": report.fabrics,
                "items": report.items,
                "silhouettes": report.silhouettes,
                "patterns": report.patterns,
                "style_keywords": report.style_keywords,
                "consumer_signals": report.consumer_signals,
            },
            ensure_ascii=False,
        )
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO reports
                (report_id, batch_id, report_date, time_range, summary,
                 covered_sites, source_articles, llm_model, token_usage,
                 generated_at, report_json_path, report_md_path, dimensions_json,
                 season_code, season_year, season_label_zh, season_bucket_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    report.report_id,
                    report.batch_id,
                    report.report_date,
                    report.time_range,
                    report.summary,
                    json.dumps(report.covered_sites, ensure_ascii=False),
                    json.dumps(report.source_articles, ensure_ascii=False),
                    report.llm_model,
                    json.dumps(report.token_usage),
                    report.generated_at.isoformat(),
                    json_path,
                    md_path,
                    dim_blob,
                    getattr(report, "season_code", "") or "",
                    int(getattr(report, "season_year", 0) or 0),
                    getattr(report, "season_label_zh", "") or "",
                    getattr(report, "season_bucket_id", "") or "",
                ),
            )

    # ── 趋势分析辅助 ──────────────────────────

    _DIM_KEYS = [
        "colors", "fabrics", "items", "silhouettes",
        "patterns", "style_keywords", "consumer_signals",
    ]
    _DIM_LABELS = {
        "colors": "色彩", "fabrics": "面料", "items": "单品",
        "silhouettes": "廓形", "patterns": "图案",
        "style_keywords": "风格词", "consumer_signals": "消费信号",
    }

    def get_hot_keywords(
        self, limit: int = 50, category: Optional[str] = None
    ) -> list[dict]:
        """从所有报告的 dimensions_json 中统计各维度高频关键词。
        category 若为 None 则聚合全部维度；否则仅返回指定维度。
        """
        from collections import Counter

        keys = [category] if (category and category in self._DIM_KEYS) else self._DIM_KEYS
        counters: dict[str, Counter] = {k: Counter() for k in keys}

        with self._conn() as conn:
            rows = conn.execute(
                "SELECT dimensions_json FROM reports WHERE dimensions_json IS NOT NULL"
            ).fetchall()

        for row in rows:
            try:
                dims = json.loads(row["dimensions_json"] or "{}")
            except Exception:
                continue
            for key in keys:
                for kw in (dims.get(key) or []):
                    kw = kw.strip()
                    if kw and len(kw) <= 60:
                        counters[key][kw] += 1

        results: list[dict] = []
        for key in keys:
            for kw, count in counters[key].most_common(limit):
                results.append({
                    "keyword": kw,
                    "count": count,
                    "category": key,
                    "category_label": self._DIM_LABELS[key],
                })

        results.sort(key=lambda x: -x["count"])
        return results[:limit]

    def get_keyword_timeline(
        self,
        keyword: str,
        *,
        lookback_days: int = 730,
        max_points: int = 500,
    ) -> list[dict]:
        """
        追踪关键词在历史报告维度中的出现次数（按 report_date 升序）。

        默认覆盖「以库中最新报告日为基准、向前约 2 年」内的所有报告点，
        不再只截取时间线末尾少量点，也不再误用「最旧 200 条」子集。
        """
        kw_lower = keyword.lower().strip()
        lookback_days = max(30, min(int(lookback_days), 3650))
        max_points = max(50, min(int(max_points), 3000))

        with self._conn() as conn:
            ref_row = conn.execute(
                """SELECT MAX(report_date) AS mx FROM reports
                   WHERE report_date IS NOT NULL AND TRIM(report_date) != ''"""
            ).fetchone()
        ref_s = (ref_row and ref_row["mx"]) if ref_row else None
        ref_s = (str(ref_s).strip()[:10] if ref_s else "") or local_now().strftime("%Y-%m-%d")
        try:
            ref_date = datetime.strptime(ref_s[:10], "%Y-%m-%d").date()
        except ValueError:
            ref_date = local_now().date()
        cutoff = ref_date - timedelta(days=lookback_days)
        cutoff_s = cutoff.isoformat()

        with self._conn() as conn:
            rows = conn.execute(
                """SELECT report_date, dimensions_json FROM reports
                   WHERE dimensions_json IS NOT NULL
                     AND report_date IS NOT NULL AND TRIM(report_date) != ''
                     AND report_date >= ?
                   ORDER BY report_date ASC, report_id ASC
                   LIMIT ?""",
                (cutoff_s, max_points),
            ).fetchall()

        results: list[dict] = []
        for row in rows:
            try:
                dims = json.loads(row["dimensions_json"] or "{}")
            except Exception:
                continue
            all_kws: list[str] = []
            for key in self._DIM_KEYS:
                all_kws.extend(dims.get(key) or [])
            count = sum(1 for k in all_kws if kw_lower in k.lower())
            results.append({
                "date": row["report_date"],
                "count": count,
                "present": count > 0,
            })

        return results

    def search_articles_fts(
        self, q: str, limit: int = 20, offset: int = 0
    ) -> tuple[list[dict], int]:
        """在标题、摘要、正文中模糊搜索文章。"""
        pattern = f"%{q}%"
        with self._conn() as conn:
            total_row = conn.execute(
                "SELECT COUNT(*) FROM articles WHERE title LIKE ? OR summary LIKE ? OR content LIKE ?",
                (pattern, pattern, pattern),
            ).fetchone()
            total = int(total_row[0])
            rows = conn.execute(
                """SELECT unique_key, site_name, title, summary, article_url,
                          published_at, crawled_at, llm_analyzed, image_urls
                   FROM articles
                   WHERE title LIKE ? OR summary LIKE ? OR content LIKE ?
                   ORDER BY crawled_at DESC
                   LIMIT ? OFFSET ?""",
                (pattern, pattern, pattern, limit, offset),
            ).fetchall()
        return [dict(r) for r in rows], total

    def get_dimension_stats(self) -> dict:
        """返回各维度词汇的汇总统计（词数、报告覆盖数），用于仪表盘总览。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT dimensions_json FROM reports WHERE dimensions_json IS NOT NULL"
            ).fetchall()

        from collections import Counter
        global_counter: Counter = Counter()
        dim_counts: dict[str, int] = {k: 0 for k in self._DIM_KEYS}
        report_count = len(rows)

        for row in rows:
            try:
                dims = json.loads(row["dimensions_json"] or "{}")
            except Exception:
                continue
            for key in self._DIM_KEYS:
                lst = dims.get(key) or []
                dim_counts[key] += len(lst)
                for kw in lst:
                    kw = kw.strip()
                    if kw:
                        global_counter[kw] += 1

        return {
            "report_count": report_count,
            "total_keywords": len(global_counter),
            "by_dimension": {
                key: {"total": dim_counts[key], "label": self._DIM_LABELS[key]}
                for key in self._DIM_KEYS
            },
            "top_overall": [
                {"keyword": kw, "count": cnt}
                for kw, cnt in global_counter.most_common(20)
            ],
        }


# ─────────────────────────────────────────────
# JSON 存储
# ─────────────────────────────────────────────

class JSONStorage:
    """将原始抓取结果和分析报告保存为 JSON 文件"""

    def __init__(self) -> None:
        self.raw_dir = settings.get_raw_dir()
        self.reports_dir = settings.get_reports_dir()

    def save_articles(self, articles: list[Article], run_id: str) -> Path:
        """保存抓取结果 JSON"""
        filename = f"crawl_{run_id}_{local_now().strftime('%Y%m%d_%H%M%S')}.json"
        path = self.raw_dir / filename
        data = [art.model_dump(mode="json") for art in articles]
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        logger.info("Raw articles saved: {}", path)
        return path

    def save_report(self, report: FashionTrendReport) -> Path:
        """保存趋势报告 JSON"""
        filename = f"report_{report.report_date}_{report.report_id}.json"
        path = self.reports_dir / filename
        path.write_text(
            json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        logger.info("Report JSON saved: {}", path)
        return path

    def load_latest_articles(self) -> list[dict]:
        """加载最新一次抓取的 JSON 文件"""
        files = sorted(self.raw_dir.glob("crawl_*.json"), key=lambda p: p.stat().st_mtime)
        if not files:
            return []
        latest = files[-1]
        logger.info("Loading latest raw data: {}", latest)
        return json.loads(latest.read_text(encoding="utf-8"))


# ─────────────────────────────────────────────
# Markdown 报告
# ─────────────────────────────────────────────

class MarkdownStorage:
    """生成人类可读的 Markdown 趋势报告"""

    def __init__(self) -> None:
        self.output_dir = settings.get_output_dir()

    def save_report(self, report: FashionTrendReport) -> Path:
        """渲染并保存 Markdown 报告"""
        filename = f"trend_report_{report.report_date}_{report.report_id}.md"
        path = self.output_dir / filename
        md = self._render(report)
        path.write_text(md, encoding="utf-8")
        logger.info("Markdown report saved: {}", path)
        return path

    def _render(self, r: FashionTrendReport) -> str:
        lines: list[str] = []
        lines.append(f"# 时尚趋势分析报告")
        lines.append(f"\n**报告日期：** {r.report_date}")
        if getattr(r, "season_label_zh", "") or getattr(r, "season_bucket_id", ""):
            lines.append(
                f"**服装季节归类：** {getattr(r, 'season_label_zh', '') or '—'} "
                f"（{getattr(r, 'season_bucket_id', '') or '—'}）"
            )
        lines.append(f"**数据范围：** {r.time_range}")
        lines.append(f"**覆盖站点：** {', '.join(r.covered_sites) or '无'}")
        lines.append(f"**分析模型：** {r.llm_provider} / {r.llm_model}")
        lines.append(f"**置信度：** {r.confidence:.0%}")
        if r.token_usage:
            lines.append(f"**Token 用量：** {r.token_usage}")
        lines.append(f"\n## 综合摘要\n\n{r.summary}")

        if r.representative_images:
            lines.append("\n## 代表性图片\n")
            for u in r.representative_images[:5]:
                lines.append(f"![]({u})\n")

        # 维度汇总
        dim_map = [
            ("色彩趋势", r.colors),
            ("面料趋势", r.fabrics),
            ("廓形趋势", r.silhouettes),
            ("单品趋势", r.items),
            ("图案趋势", r.patterns),
            ("风格关键词", r.style_keywords),
            ("消费者信号", r.consumer_signals),
        ]
        lines.append("\n## 维度概览\n")
        for dim_name, dim_list in dim_map:
            if dim_list:
                lines.append(f"**{dim_name}：** {' | '.join(dim_list)}")

        # 关键趋势详情
        if r.key_trends:
            lines.append("\n## 关键趋势详情\n")
            for i, trend in enumerate(r.key_trends, 1):
                lines.append(f"### {i}. {trend.name}")
                if getattr(trend, "category", ""):
                    lines.append(f"\n**类目：** {trend.category}")
                lines.append(f"\n{trend.description}")
                lines.append(f"\n**置信度：** {trend.confidence:.0%}")
                for dim, vals in [
                    ("相关色彩", trend.related_colors),
                    ("相关面料", trend.related_fabrics),
                    ("相关单品", trend.related_items),
                    ("相关图案", trend.related_patterns),
                    ("相关廓形", trend.related_silhouettes),
                ]:
                    if vals:
                        lines.append(f"**{dim}：** {' | '.join(vals)}")

                # 插入 LLM 挑选的代表图片
                if trend.selected_images:
                    lines.append("\n**趋势图片：**\n")
                    for img_url in trend.selected_images:
                        lines.append(f"![{trend.name}]({img_url})\n")

                if trend.supporting_evidence:
                    lines.append("\n**支撑证据：**")
                    for ev in trend.supporting_evidence[:3]:
                        lines.append(
                            f"- [{ev.article_title}]({ev.article_url}) "
                            f"({ev.site_name}) — {ev.snippet[:100]}"
                        )
                lines.append("")

        # 全局证据
        if r.evidence:
            lines.append("## 数据来源\n")
            for ev in r.evidence[:20]:
                lines.append(
                    f"- **{ev.site_name}** | [{ev.article_title}]({ev.article_url})"
                )

        # 四大板块详细分析
        detail_sections = [
            ("款式板块", r.style_details),
            ("单品板块", r.item_details),
            ("版型板块", r.silhouette_details),
            ("颜色板块", r.color_details),
        ]
        for section_name, details in detail_sections:
            if not details:
                continue
            lines.append(f"\n## {section_name}\n")
            for detail in details:
                lines.append(f"### {detail.name}")
                if detail.trend_direction:
                    lines.append(f"\n> 趋势方向：**{detail.trend_direction}** | 置信度：{detail.confidence:.0%}")
                if detail.description:
                    lines.append(f"\n{detail.description}")
                if detail.representative_brands:
                    lines.append(f"\n**代表品牌：** {' | '.join(detail.representative_brands)}")
                if detail.style_tips:
                    lines.append("\n**搭配建议：**")
                    for tip in detail.style_tips:
                        lines.append(f"- {tip}")
                if detail.selected_images:
                    lines.append("\n**参考图片：**\n")
                    for img_url in detail.selected_images:
                        lines.append(f"![{detail.name}]({img_url})\n")
                lines.append("")

        lines.append(f"\n---\n*Generated by ai_fashion pipeline at {r.generated_at}*")
        return "\n".join(lines)


# ─────────────────────────────────────────────
# 统一存储门面
# ─────────────────────────────────────────────

class StorageManager:
    """
    统一存储入口，根据 settings.store_backend 路由到对应存储实现。
    支持同时写入多种格式（逗号分隔配置）。
    """

    def __init__(self) -> None:
        backends = settings.get_store_backends()
        self.sqlite: Optional[SQLiteStorage] = None
        self.json_store: Optional[JSONStorage] = None
        self.md_store: Optional[MarkdownStorage] = None

        if "sqlite" in backends:
            self.sqlite = SQLiteStorage()
        if "json" in backends:
            self.json_store = JSONStorage()
        if "markdown" in backends:
            self.md_store = MarkdownStorage()

        logger.info("StorageManager initialized | backends={}", backends)

    def get_existing_keys(self) -> set[str]:
        if self.sqlite:
            return self.sqlite.get_existing_keys()
        return set()

    def save_articles(self, articles: list[Article], run_id: str) -> None:
        if self.sqlite:
            self.sqlite.save_articles(articles)
        if self.json_store:
            self.json_store.save_articles(articles, run_id)

    def save_report(self, report: FashionTrendReport) -> tuple[str, str]:
        """保存报告，返回 (json_path, md_path)"""
        json_path = md_path = ""
        if self.json_store:
            p = self.json_store.save_report(report)
            json_path = str(p)
        if self.md_store:
            p = self.md_store.save_report(report)
            md_path = str(p)
        if self.sqlite:
            self.sqlite.save_report_index(report, json_path, md_path)
        return json_path, md_path

    def save_task_run(self, run: TaskRun) -> None:
        if self.sqlite:
            self.sqlite.save_task_run(run)

    def get_running_task(self) -> Optional[dict]:
        if self.sqlite:
            return self.sqlite.get_running_task()
        return None

    def recover_stale_running_tasks(self, max_age_minutes: int) -> int:
        if self.sqlite:
            return self.sqlite.recover_stale_running_tasks(max_age_minutes)
        return 0

    def recover_all_running_tasks(self, reason: str) -> int:
        if self.sqlite:
            return self.sqlite.recover_all_running_tasks(reason)
        return 0

    def mark_analyzed(self, keys: list[str], analysis_id: str) -> None:
        if self.sqlite:
            self.sqlite.mark_articles_analyzed(keys, analysis_id)

    def get_unanalyzed_articles(self, limit: Optional[int] = None) -> list[dict]:
        if self.sqlite:
            return self.sqlite.get_unanalyzed_articles(limit)
        if self.json_store:
            return self.json_store.load_latest_articles()
        return []

    def get_articles_for_library_season_analysis(self, limit: Optional[int] = None) -> list[dict]:
        if self.sqlite:
            return self.sqlite.get_articles_for_library_season_analysis(limit)
        if self.json_store:
            return self.json_store.load_latest_articles()
        return []

    def get_latest_report_json(self) -> Optional[dict]:
        if self.sqlite:
            return self.sqlite.get_latest_report_json()
        return None

    def dedupe_articles_by_url(self) -> dict[str, int]:
        if self.sqlite:
            return self.sqlite.dedupe_articles_by_url()
        return {"removed": 0, "removed_normalized_url": 0, "removed_title_site": 0}

    def normalize_task_run_statuses(self) -> dict[str, int]:
        if self.sqlite:
            return self.sqlite.normalize_task_run_statuses()
        return {"scanned": 0, "to_failed": 0, "to_partial": 0}

    def normalize_single_task_run_status(self, run_id: str) -> Optional[str]:
        if self.sqlite:
            return self.sqlite.normalize_single_task_run_status(run_id)
        return None
