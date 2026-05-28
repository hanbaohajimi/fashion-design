"""
main.py — CLI 入口
支持命令：run-once / schedule / crawl-only / analyze-latest / analyze-library / validate-config / login
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Optional

import click

# Windows GBK 终端编码兼容
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
from loguru import logger

from config import settings
from storage import StorageManager
from utils import setup_logger


# ─────────────────────────────────────────────
# CLI 定义
# ─────────────────────────────────────────────

@click.group()
def cli() -> None:
    """
    AI Fashion 时尚趋势数据流水线

    \b
    常用命令：
      run-once         立即执行一次完整流水线
      schedule         启动 24H 定时调度
      crawl-only       只抓取，不做 LLM 分析
      analyze-latest   只分析尚未 LLM 分析的文章
      analyze-library  用库中已入库全部文章（池上限内）按季节重跑趋势报告
      validate-config  校验配置完整性
      login            首次登录并保存 storage_state
      dedupe-articles  按 URL 清理文章库重复记录
      backfill-report-seasons  补齐报告中空的季节标签（季节趋势页）
      reclassify-report-seasons  按规则用来源文章对报告重新投票季节标签（不跑 LLM）
      normalize-task-statuses   修正历史 task_runs 与当前成功/部分/失败口径一致
    """
    setup_logger()


@cli.command()
def run_once() -> None:
    """立即执行一次：抓取 + 清洗 + 分析 + 存储"""
    logger.info("Command: run-once")
    storage = StorageManager()
    from scheduler import execute_pipeline
    run = asyncio.run(execute_pipeline(storage))
    click.echo(f"\n✓ Pipeline finished | status={run.status.value} "
               f"new={run.articles_new} reports={run.reports_generated}")


@cli.command()
@click.option(
    "--no-immediate",
    is_flag=True,
    default=False,
    help="启动后不立即执行，等到第一个调度周期再运行",
)
def schedule(no_immediate: bool) -> None:
    """启动 24H 定时调度任务（阻塞运行）"""
    logger.info("Command: schedule | interval={}h", settings.schedule_hours)
    storage = StorageManager()
    from scheduler import PipelineScheduler
    sched = PipelineScheduler(storage)
    asyncio.run(sched.start(run_immediately=not no_immediate))


@cli.command()
def crawl_only() -> None:
    """只抓取与清洗，不做 LLM 分析"""
    logger.info("Command: crawl-only")
    storage = StorageManager()
    from scheduler import execute_pipeline
    run = asyncio.run(execute_pipeline(storage, crawl_only=True))
    click.echo(f"\n✓ Crawl finished | new={run.articles_new} failed_sites={run.sites_failed}")


@cli.command()
def analyze_latest() -> None:
    """只分析最近一次已抓取的数据（不重复爬取）"""
    logger.info("Command: analyze-latest")

    if not settings.is_llm_configured():
        click.echo(
            "✗ LLM 未配置，请在 .env 中设置 LLM_PROVIDER / LLM_MODEL / API_KEY",
            err=True,
        )
        sys.exit(1)

    storage = StorageManager()
    from scheduler import execute_pipeline
    run = asyncio.run(execute_pipeline(storage, analyze_only=True))
    click.echo(f"\n✓ Analysis finished | reports={run.reports_generated}")


@cli.command()
def analyze_library() -> None:
    """用库中已读取的文章（含曾分析过的，受配置池上限）按季节分桶生成趋势报告，不爬取。"""
    logger.info("Command: analyze-library")

    if not settings.is_llm_configured():
        click.echo(
            "✗ LLM 未配置，请在 .env 中设置 LLM_PROVIDER / LLM_MODEL / API_KEY",
            err=True,
        )
        sys.exit(1)

    storage = StorageManager()
    from scheduler import execute_pipeline

    run = asyncio.run(execute_pipeline(storage, analyze_library=True))
    click.echo(
        f"\n✓ Library seasonal analysis finished | reports={run.reports_generated} "
        f"analyzed={getattr(run, 'articles_analyzed', 0)}"
    )


@cli.command()
def validate_config() -> None:
    """校验 .env 与站点配置文件是否完整"""
    click.echo("\n=== 配置校验 ===\n")

    # ── 全局配置 ──
    missing = settings.validate_required()
    if missing:
        click.echo(f"✗ 以下全局配置未设置：{missing}", err=True)
    else:
        click.echo(f"✓ 全局配置完整")

    click.echo(f"  LLM Provider : {settings.llm_provider or '(未设置)'}")
    click.echo(f"  LLM Model    : {settings.llm_model or '(未设置)'}")
    click.echo(f"  API Key      : {'***' if settings.api_key else '(未设置)'}")
    click.echo(f"  Schedule     : {settings.schedule_hours}h")
    click.echo(f"  Store Backend: {settings.store_backend}")
    click.echo(f"  Timezone     : {settings.timezone}")
    click.echo(
        f"  Stale task recovery: {settings.stale_task_recovery_minutes} min "
        f"(0=off; API 启动时自动清理僵尸 running 任务)"
    )

    # ── 站点配置 ──
    click.echo("\n--- 站点配置 ---")
    from site_configs.loader import load_all_site_configs
    site_configs = load_all_site_configs()

    if not site_configs:
        click.echo("✗ 未找到任何站点配置。请在 site_configs/ 目录添加 .yaml 或 .json 文件。")
    else:
        for cfg in site_configs:
            ok, errors = cfg.is_valid()
            status = "✓" if ok else "✗"
            enabled = "enabled" if cfg.enabled else "disabled"
            click.echo(f"  {status} [{enabled}] {cfg.site_name or '(unnamed)'}")
            if errors:
                for err in errors:
                    click.echo(f"       → {err}")

    if missing:
        sys.exit(1)
    click.echo("\n✓ 校验完成")


@cli.command("dedupe-articles")
def dedupe_articles_cmd() -> None:
    """清理重复文章：规范化 URL + 同站同标题（保留最早抓取的一条）。"""
    storage = StorageManager()
    r = storage.dedupe_articles_by_url()
    click.echo(
        f"✓ 共删除 {r.get('removed', 0)} 条 "
        f"(规范化URL {r.get('removed_normalized_url', 0)}，同站同标题 {r.get('removed_title_site', 0)})"
    )


@cli.command("backfill-report-seasons")
def backfill_report_seasons_cmd() -> None:
    """从报告 JSON 或 report_date 补齐 SQLite 中空的季节标签（季节趋势页依赖此字段）。"""
    storage = StorageManager()
    if not storage.sqlite:
        click.echo("✗ 未启用 SQLite 存储，无法回填", err=True)
        sys.exit(1)
    n = storage.sqlite.backfill_report_season_metadata()
    click.echo(f"✓ 已更新 {n} 条报告的季节元数据")


@cli.command("reclassify-report-seasons")
def reclassify_report_seasons_cmd() -> None:
    """
    按当前季节推断规则，用每份报告关联的 source_articles 重新投票得到季节标签，
    更新 SQLite 与报告 JSON（不调用 LLM）。修改了 season_profile 后运行本命令即可同步旧报告。
    """
    storage = StorageManager()
    if not storage.sqlite:
        click.echo("✗ 未启用 SQLite 存储", err=True)
        sys.exit(1)
    from season_reclassify import reclassify_report_seasons_from_articles

    st = reclassify_report_seasons_from_articles(storage.sqlite)
    click.echo(
        f"✓ 已重分类 {st.get('updated', 0)} 份报告 "
        f"（同步 JSON {st.get('json_patched', 0)} 份，跳过 {st.get('skipped', 0)} 份）"
    )


@cli.command("normalize-task-statuses")
def normalize_task_statuses_cmd() -> None:
    """扫描 task_runs：将历史上误标为 success 的记录改为 failed 或 partial（与调度器口径一致）。"""
    storage = StorageManager()
    if not storage.sqlite:
        click.echo("✗ 未启用 SQLite 存储", err=True)
        sys.exit(1)
    st = storage.normalize_task_run_statuses()
    click.echo(
        f"✓ 已扫描 {st.get('scanned', 0)} 条 · 改为失败 {st.get('to_failed', 0)} 条 · "
        f"改为部分完成 {st.get('to_partial', 0)} 条"
    )


@cli.command()
@click.option("--site", required=True, help="站点名称（对应 site_configs 中的 site_name）")
def login(site: str) -> None:
    """首次登录并保存 storage_state.json（交互式，需要显示器/GUI）"""
    from site_configs.loader import get_site_config
    from scraper import interactive_login

    cfg = get_site_config(site)
    if not cfg:
        click.echo(f"✗ 未找到站点配置：{site}", err=True)
        sys.exit(1)

    if not cfg.login.use_login:
        click.echo(f"✗ 站点 {site} 的 use_login=false，无需登录", err=True)
        sys.exit(1)

    logger.info("Starting interactive login for site: {}", site)
    asyncio.run(interactive_login(cfg))
    click.echo(f"\n✓ 登录状态已保存 → {cfg.login.storage_state_path}")


# ─────────────────────────────────────────────
# 入口
# ─────────────────────────────────────────────

if __name__ == "__main__":
    cli()
