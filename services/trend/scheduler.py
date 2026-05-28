"""
scheduler.py — APScheduler 任务调度模块
- 24H 严格周期调度
- 防止任务重叠执行
- 任务状态记录
- 失败恢复支持
"""

from __future__ import annotations

import asyncio
import json
import signal
import sys
import time
import uuid
from datetime import datetime
from threading import Event
from typing import Optional, Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from loguru import logger

from config import settings
from models import TaskRun, TaskStatus
from storage import StorageManager
from time_utils import local_now


# ─────────────────────────────────────────────
# 全局锁（防止任务重叠）
# ─────────────────────────────────────────────

_task_running = False
_pause_requested = Event()


def request_pause() -> None:
    """请求暂停（运行中的流水线会在安全检查点挂起）。"""
    _pause_requested.set()


def request_resume() -> None:
    """恢复继续执行。"""
    _pause_requested.clear()


def is_pause_requested() -> bool:
    return _pause_requested.is_set()


def _set_run_stage(
    storage: StorageManager,
    run: TaskRun,
    *,
    code: str,
    label: str,
    detail: str = "",
    index: int = 0,
    total: int = 0,
    percent: int = 0,
) -> None:
    run.stage_code = code
    run.stage_label = label
    run.stage_detail = detail
    run.stage_index = int(index or 0)
    run.stage_total = int(total or 0)
    run.progress_percent = max(0, min(int(percent or 0), 100))
    storage.save_task_run(run)


def _parse_published_at_from_row(row: dict[str, Any]) -> Optional[datetime]:
    raw = row.get("published_at")
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw
    s = str(raw).strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _articles_from_storage_rows(raw_rows: list[dict[str, Any]]) -> list[Any]:
    """将 SQLite 文章行（含 _images）重建为 Article 列表。"""
    from models import Article, ImageItem

    all_articles: list[Any] = []
    for row in raw_rows:
        try:
            tags = json.loads(row.get("tags") or "[]")
            images = [
                ImageItem(
                    original_url=img["original_url"],
                    local_path=img.get("local_path", ""),
                    content_hash=img.get("content_hash", ""),
                    downloaded=bool(img.get("downloaded", 0)),
                    alt_text=img.get("alt_text", ""),
                )
                for img in row.get("_images", [])
            ]
            art = Article(
                unique_key=row["unique_key"],
                site_name=row["site_name"],
                source=row.get("source", ""),
                category=row.get("category", ""),
                tags=tags,
                title=row["title"],
                content=row.get("content", ""),
                summary=row.get("summary", ""),
                author=row.get("author", ""),
                published_at=_parse_published_at_from_row(row),
                article_url=row.get("article_url", ""),
                images=images,
                image_urls=[img.original_url for img in images],
            )
            all_articles.append(art)
        except Exception as exc:
            logger.warning("Failed to reconstruct article from DB: {}", exc)
    return all_articles


async def wait_if_paused(poll_seconds: float = 1.0) -> None:
    """若已请求暂停，则循环等待直到恢复。"""
    while _pause_requested.is_set():
        await asyncio.sleep(poll_seconds)


async def execute_pipeline(
    storage: StorageManager,
    crawl_only: bool = False,
    analyze_only: bool = False,
    analyze_library: bool = False,
) -> TaskRun:
    """
    核心流水线执行入口（被调度器与 CLI 共享调用）。
    - crawl_only=True：只抓取，不分析
    - analyze_only=True：只分析尚未 LLM 分析的文章
    - analyze_library=True：不爬取；从库中加载已入库文章（含曾分析过的，受池上限），按季节分桶生成趋势报告
    """
    global _task_running
    # 每次新任务启动，默认清空暂停标记，避免继承上一轮状态
    request_resume()

    recovered = storage.recover_stale_running_tasks(settings.stale_task_recovery_minutes)
    if recovered:
        logger.info("Recovered {} stale running task(s) before pipeline start", recovered)

    run_id = str(uuid.uuid4())[:12]
    if analyze_library:
        pipeline_mode = "analyze_library"
    elif analyze_only:
        pipeline_mode = "analyze_only"
    elif crawl_only:
        pipeline_mode = "crawl_only"
    else:
        pipeline_mode = "full"
    run = TaskRun(
        run_id=run_id,
        status=TaskStatus.RUNNING,
        pipeline_mode=pipeline_mode,
    )

    # ── 防止重叠执行 ──────────────────────────
    if _task_running:
        logger.warning("Pipeline already running — skipping this trigger")
        run.status = TaskStatus.FAILED
        run.error_message = "Skipped: previous run still in progress"
        run.finished_at = local_now()
        return run

    # 检查数据库中是否有 running 状态的任务（跨进程防护）
    db_running = storage.get_running_task()
    if db_running and not _task_running and settings.stale_task_recovery_minutes > 0:
        recovered = storage.recover_stale_running_tasks(
            settings.stale_task_recovery_minutes
        )
        if recovered:
            logger.warning(
                "Recovered stale DB running task(s) during duplicate-run check"
            )
            db_running = storage.get_running_task()
    if db_running:
        logger.warning(
            "Found running task in DB [{}] — skipping", db_running.get("run_id")
        )
        run.status = TaskStatus.FAILED
        run.error_message = f"Skipped: DB shows running task {db_running.get('run_id')}"
        run.finished_at = local_now()
        return run

    _task_running = True
    storage.save_task_run(run)

    try:
        _set_run_stage(
            storage,
            run,
            code="boot",
            label="初始化任务",
            detail="正在载入站点配置与环境",
            index=1,
            total=6,
            percent=3,
        )
        await wait_if_paused()
        # 延迟导入避免循环依赖
        from site_configs.loader import load_all_site_configs
        from scraper import MultiSiteCrawler
        from processor import deduplicate_articles, select_articles_for_analysis
        from llm_analyzer import FashionTrendAnalyzer

        site_configs = load_all_site_configs()
        active_sites = [c for c in site_configs if c.enabled]
        run.sites_total = len(active_sites)
        storage.save_task_run(run)

        all_articles: list = []
        all_sessions = []
        articles_candidate: list = []

        if not analyze_only and not analyze_library:
            _set_run_stage(
                storage,
                run,
                code="search",
                label="抓取入口页候选文章",
                detail="正在从 Vogue fashion 入口页收集候选文章",
                index=2,
                total=6,
                percent=12,
            )
            await wait_if_paused()
            logger.info("=" * 60)
            logger.info("Pipeline START | run_id={} sites={}", run_id, len(active_sites))

            # ── 抓取阶段 ──────────────────────────
            t_crawl = time.perf_counter()
            if settings.use_search_first_workflow:
                from search_workflow import SearchFirstWorkflow

                logger.info(
                    "Using search-first workflow | provider=Qwen model={} candidates={} selected={}",
                    settings.qwen_model,
                    settings.search_candidate_limit,
                    settings.search_selected_limit,
                )
                workflow = SearchFirstWorkflow(site_configs)
                _set_run_stage(
                    storage,
                    run,
                    code="search_select",
                    label="筛选待深抓文章",
                    detail=(
                        "基于入口页候选文章进行筛选，深抓范围为全部"
                    ),
                    index=3,
                    total=6,
                    percent=24,
                )
                all_articles, all_sessions, _selected_candidates = await workflow.run()
            else:
                crawler = MultiSiteCrawler(site_configs)
                all_articles, all_sessions = await crawler.run_all()
            run.crawl_duration_ms = int((time.perf_counter() - t_crawl) * 1000)
            run.crawl_sessions = all_sessions

            for s in all_sessions:
                if s.success:
                    run.sites_success += 1
                else:
                    run.sites_failed += 1

            # ── 去重 ──────────────────────────────
            _set_run_stage(
                storage,
                run,
                code="crawl",
                label="抓取正文与发布时间",
                detail="正在抓取入选文章正文、图片和发布时间",
                index=4,
                total=6,
                percent=42,
            )
            await wait_if_paused()
            existing_keys = storage.get_existing_keys()
            deduped = deduplicate_articles(all_articles, existing_keys)
            run.articles_crawled = len(all_articles)
            run.articles_new = len(deduped)

            # ── 存储原始数据 ──────────────────────
            if deduped:
                storage.save_articles(deduped, run_id)
            articles_candidate = deduped
            # 抓取阶段结束后立即落库，避免长分析任务期间前端一直显示全 0。
            storage.save_task_run(run)
            logger.info(
                "Crawl done | total={} new={} failed_sites={}",
                run.articles_crawled,
                run.articles_new,
                run.sites_failed,
            )

        elif analyze_library:
            _set_run_stage(
                storage,
                run,
                code="prepare_analysis",
                label="装载文章库",
                detail="正在从文章库装载季节分析候选文章",
                index=4,
                total=6,
                percent=42,
            )
            await wait_if_paused()
            logger.info(
                "analyze-library mode: loading ingested articles for seasonal reports (pool limit={})",
                settings.library_season_article_pool_limit,
            )
            raw_rows = storage.get_articles_for_library_season_analysis()
            if not raw_rows:
                logger.info("No articles in library for seasonal analysis")
                run.status = TaskStatus.SUCCESS
                run.finished_at = local_now()
                storage.save_task_run(run)
                return run
            articles_candidate = _articles_from_storage_rows(raw_rows)
            logger.info(
                "analyze-library | rows={} reconstructed={}",
                len(raw_rows),
                len(articles_candidate),
            )
        else:
            # analyze_only 模式：从存储中加载未分析数据
            _set_run_stage(
                storage,
                run,
                code="prepare_analysis",
                label="装载待分析文章",
                detail="正在加载未分析文章",
                index=4,
                total=6,
                percent=42,
            )
            await wait_if_paused()
            logger.info("analyze-latest mode: loading unanalyzed articles")
            raw_rows = storage.get_unanalyzed_articles()
            if not raw_rows:
                logger.info("No unanalyzed articles found")
                run.status = TaskStatus.SUCCESS
                run.finished_at = local_now()
                storage.save_task_run(run)
                return run

            articles_candidate = _articles_from_storage_rows(raw_rows)

        # ── LLM 分析阶段 ──────────────────────────
        llm_skipped = False
        bucket_fail_msgs: list[str] = []
        articles_for_llm = select_articles_for_analysis(articles_candidate)
        if (
            not crawl_only
            and not analyze_only
            and not analyze_library
            and not articles_for_llm
            and run.articles_new == 0
        ):
            _set_run_stage(
                storage,
                run,
                code="season_bucket",
                label="回退分析文章库",
                detail="本轮抓取均为历史文章，改为对当前文章库执行一次完整季节趋势分析",
                index=5,
                total=6,
                percent=56,
            )
            raw_rows = storage.get_articles_for_library_season_analysis()
            articles_candidate = _articles_from_storage_rows(raw_rows)
            articles_for_llm = select_articles_for_analysis(articles_candidate)
        if not crawl_only and articles_candidate:
            _set_run_stage(
                storage,
                run,
                code="season_bucket",
                label="按季节分组",
                detail=f"准备从 {len(articles_candidate)} 篇候选中筛出分析文章",
                index=5,
                total=6,
                percent=56,
            )
            await wait_if_paused()
            if not articles_for_llm:
                logger.warning(
                    "No articles passed quality gate | candidates={}",
                    len(articles_candidate),
                )
            elif not settings.is_llm_configured():
                logger.warning(
                    "LLM not configured — skipping analysis. "
                    "Set LLM_PROVIDER / LLM_MODEL / API_KEY in .env"
                )
                llm_skipped = True
            else:
                await wait_if_paused()
                t_an = time.perf_counter()
                from season_profile import (
                    group_articles_by_season_bucket,
                    season_bucket_sort_key,
                    season_profile_from_bucket_id,
                )

                async def _analysis_progress(payload: dict[str, Any]) -> None:
                    phase = str(payload.get("phase", "") or "")
                    done = int(payload.get("done", 0) or 0)
                    total_n = int(payload.get("total", 0) or 0)
                    if phase in ("article_insight_start", "article_insight_progress"):
                        base = 62
                        span = 22
                        extra = int((done / total_n) * span) if total_n > 0 else 0
                        _set_run_stage(
                            storage,
                            run,
                            code="article_analysis",
                            label="逐篇趋势分析",
                            detail=str(payload.get("detail", "") or "正在逐篇分析文章"),
                            index=5,
                            total=6,
                            percent=min(base + extra, 84),
                        )
                    elif phase == "article_insight_aggregate":
                        _set_run_stage(
                            storage,
                            run,
                            code="aggregate_report",
                            label="汇总季节趋势报告",
                            detail=str(payload.get("detail", "") or "正在汇总文章洞察"),
                            index=6,
                            total=6,
                            percent=88,
                        )

                analyzer = FashionTrendAnalyzer(progress_callback=_analysis_progress)
                agg_tokens: dict[str, int] = {}
                reports_done = 0
                buckets = group_articles_by_season_bucket(articles_for_llm)
                total_buckets = len(buckets)
                _set_run_stage(
                    storage,
                    run,
                    code="season_bucket",
                    label="按季节分组",
                    detail=f"已分为 {total_buckets} 个季节分桶，开始生成趋势报告",
                    index=5,
                    total=6,
                    percent=60,
                )
                for bucket_id, subset in sorted(
                    buckets.items(),
                    key=lambda kv: season_bucket_sort_key(kv[0]),
                ):
                    if not subset:
                        continue
                    prof = season_profile_from_bucket_id(bucket_id)
                    # 无明确季节词的文章不入库内季节趋势分析 / 不生成「未归类季节」报告
                    if (prof.season_code or "").upper() == "UNKNOWN":
                        logger.info(
                            "Skipping UNKNOWN season bucket | bucket_id={} | n_articles={}",
                            bucket_id,
                            len(subset),
                        )
                        continue
                    _set_run_stage(
                        storage,
                        run,
                        code="article_analysis",
                        label="逐篇趋势分析",
                        detail=f"正在分析 {prof.season_label_zh or bucket_id}，共 {len(subset)} 篇",
                        index=5,
                        total=6,
                        percent=62,
                    )
                    try:
                        report = await analyzer.analyze_batch(
                            subset,
                            batch_id=run_id,
                            season_bucket_id=bucket_id,
                            season_code=prof.season_code,
                            season_year=prof.season_year,
                            season_label_zh=prof.season_label_zh,
                        )
                        # 相邻时间报告主题命名对齐（仅名称，不改证据）
                        try:
                            from report_alignment import align_report_topics_with_previous
                            from models import FashionTrendReport

                            prev_json = storage.get_latest_report_json()
                            prev_report = (
                                FashionTrendReport(**prev_json)
                                if isinstance(prev_json, dict)
                                else None
                            )
                            report = align_report_topics_with_previous(report, prev_report)
                        except Exception as exc:
                            logger.warning("Topic alignment skipped: {}", exc)

                        for k, v in (report.token_usage or {}).items():
                            try:
                                agg_tokens[k] = agg_tokens.get(k, 0) + int(v or 0)
                            except (TypeError, ValueError):
                                pass
                        json_path, md_path = storage.save_report(report)
                        storage.mark_analyzed(
                            [a.unique_key for a in subset],
                            report.report_id,
                        )
                        reports_done += 1
                        run.reports_generated = reports_done
                        run.articles_analyzed += len(subset)
                        run.llm_token_usage_json = json.dumps(
                            agg_tokens, ensure_ascii=False
                        )
                        run.analyze_duration_ms = int(
                            (time.perf_counter() - t_an) * 1000
                        )
                        # 每个季节批次完成后持久化进度，便于前端和 API 正确反映长任务进展。
                        bucket_progress = int((reports_done / max(total_buckets, 1)) * 10)
                        _set_run_stage(
                            storage,
                            run,
                            code="aggregate_report",
                            label="汇总季节趋势报告",
                            detail=(
                                f"已生成 {reports_done}/{total_buckets} 个季节报告"
                            ),
                            index=6,
                            total=6,
                            percent=min(88 + bucket_progress, 98),
                        )
                        storage.save_task_run(run)
                        logger.info(
                            "Seasonal analysis | bucket={} articles={} report_id={} json={}",
                            bucket_id,
                            len(subset),
                            report.report_id,
                            json_path,
                        )
                    except Exception as exc:
                        # 分析失败：不写入报告、不将本桶文章标为已分析（避免脏数据入库）
                        logger.error(
                            "Seasonal analysis failed | run_id={} bucket={} articles={} err={}",
                            run_id,
                            bucket_id,
                            len(subset),
                            exc,
                        )
                        short = str(exc).replace("\n", " ").strip()
                        if len(short) > 200:
                            short = short[:200] + "…"
                        bucket_fail_msgs.append(f"{bucket_id}: {short}")

                run.analyze_duration_ms = int((time.perf_counter() - t_an) * 1000)
                run.llm_token_usage_json = json.dumps(agg_tokens, ensure_ascii=False)
                run.reports_generated = reports_done
                logger.info(
                    "Analysis batches done | reports={} tokens={}",
                    reports_done,
                    agg_tokens,
                )

        if bucket_fail_msgs:
            tail = "；".join(bucket_fail_msgs[:8])
            if len(bucket_fail_msgs) > 8:
                tail += f"…（共{len(bucket_fail_msgs)}个分桶失败）"
            if run.error_message:
                run.error_message = (run.error_message.strip() + " | " + tail).strip()
            else:
                run.error_message = tail

        if run.sites_failed > 0 or bucket_fail_msgs:
            # 已尝试 LLM 分桶但无一成功 → 失败；部分成功 → 部分成功
            if (
                bucket_fail_msgs
                and run.reports_generated == 0
                and not llm_skipped
                and articles_for_llm
            ):
                run.status = TaskStatus.FAILED
            else:
                run.status = TaskStatus.PARTIAL
        elif llm_skipped:
            run.status = TaskStatus.PARTIAL
            run.error_message = "LLM 未配置，已跳过趋势分析"
        else:
            run.status = TaskStatus.SUCCESS
        _set_run_stage(
            storage,
            run,
            code="finalize",
            label="完成",
            detail="工作流已执行完成，正在写入最终状态",
            index=6,
            total=6,
            percent=100,
        )
        logger.info(
            "Pipeline END | run_id={} status={} articles_new={} reports={}",
            run_id,
            run.status.value,
            run.articles_new,
            run.reports_generated,
        )

    except Exception as exc:
        logger.exception("Pipeline fatal error: {}", exc)
        run.status = TaskStatus.FAILED
        run.error_message = str(exc)
        _set_run_stage(
            storage,
            run,
            code="failed",
            label="失败",
            detail=str(exc),
            index=6,
            total=6,
            percent=max(int(getattr(run, "progress_percent", 0) or 0), 1),
        )

    finally:
        _task_running = False
        run.finished_at = local_now()
        storage.save_task_run(run)

    return run


# ─────────────────────────────────────────────
# 调度器
# ─────────────────────────────────────────────

class PipelineScheduler:
    """
    APScheduler 调度器封装。
    - 严格 24H 间隔（IntervalTrigger）
    - 支持立即触发首次运行
    - 优雅关闭处理
    """

    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage
        self.scheduler = AsyncIOScheduler(timezone=settings.timezone)

    def _make_job(self) -> None:
        """向调度器注册任务"""
        self.scheduler.add_job(
            self._run_job,
            trigger=IntervalTrigger(hours=settings.schedule_hours),
            id="fashion_pipeline",
            name="Fashion Trend Pipeline",
            replace_existing=True,
            max_instances=1,  # APScheduler 层面防止重叠
            coalesce=True,    # 错过的任务只补跑一次
        )

    async def _run_job(self) -> None:
        """APScheduler 触发时的回调"""
        logger.info("Scheduled trigger fired")
        await execute_pipeline(self.storage)

    async def start(self, run_immediately: bool = True) -> None:
        """
        启动调度器。
        run_immediately=True 时立即执行一次，再等待下个周期。
        """
        self._make_job()
        self.scheduler.start()
        logger.info(
            "Scheduler started | interval={}h timezone={}",
            settings.schedule_hours,
            settings.timezone,
        )

        # 注册 SIGTERM / SIGINT 优雅退出
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, self._shutdown)
            except NotImplementedError:
                # Windows 不支持 add_signal_handler
                pass

        if run_immediately:
            logger.info("Running pipeline immediately on startup…")
            await execute_pipeline(self.storage)

        # 保持运行
        try:
            while True:
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            pass

    def _shutdown(self) -> None:
        logger.info("Shutdown signal received — stopping scheduler")
        self.scheduler.shutdown(wait=False)
        sys.exit(0)
