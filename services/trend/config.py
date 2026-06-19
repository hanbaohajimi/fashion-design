"""
config.py — 全局配置加载（基于 .env + pydantic-settings）
所有配置项均可通过环境变量覆盖，默认值为安全的空占位
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 项目根目录
BASE_DIR = Path(__file__).parent.resolve()


class Settings(BaseSettings):
    """
    全局配置，对应 .env.example 中的所有键。
    未设置的项保持空字符串，运行时 validate-config 命令会检查必填项。
    """

    # env_file 指向项目根 .env 作为 fallback：
    # - 启动器已通过 _load_dotenv() 将根 .env 注入 os.environ 并优先
    # - env_file 仅用于独立运行 config.py（无启动器）时兜底
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR.parent.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── 目录配置 ──────────────────────────────────
    output_dir: str = str(BASE_DIR / "output")
    log_dir: str = str(BASE_DIR / "logs")
    db_path: str = str(BASE_DIR / "storage" / "fashion_pipeline.db")
    data_dir: str = str(BASE_DIR / "data")

    # ── LLM 配置 ──────────────────────────────────
    llm_provider: str = ""          # TODO: 填写 openai / anthropic / local
    llm_model: str = ""             # TODO: 填写模型名，如 gpt-4o / claude-3-5-sonnet-20241022
    api_key: str = ""               # TODO: 填写 API Key
    llm_base_url: str = ""          # TODO: 本地/代理模型 base_url（可选）
    llm_max_tokens: int = 4096
    llm_temperature: float = 0.2
    # LiteLLM 默认请求超时偏短，长上下文/多模态易误判失败（见 logs 中 timeout=30 vs 实际 90s+）
    llm_request_timeout: int = 180

    # ── 搜索配置（Qwen Web Search）────────────────────────────
    qwen_api_key: str = ""
    qwen_model: str = "qwen3-max"
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_search_strategy: str = "turbo"
    search_freshness_days: int = 365
    search_candidate_limit: int = 0
    search_selected_limit: int = 0
    use_search_first_workflow: bool = False

    # ── 调度配置 ──────────────────────────────────
    schedule_hours: int = 24        # TODO: 调度间隔小时数
    timezone: str = "Asia/Shanghai" # TODO: 时区

    # ── 爬虫配置 ──────────────────────────────────
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
    max_concurrency: int = 3        # TODO: 最大并发数
    request_timeout: int = 30       # TODO: 请求超时（秒）
    retry_times: int = 3            # TODO: 失败重试次数
    retry_min_wait: float = 2.0     # 重试最小等待（秒）
    retry_max_wait: float = 30.0    # 重试最大等待（秒）
    # Playwright 访问外站失败（如 net::ERR_CONNECTION_CLOSED）时，可填本地 HTTP 代理，例如 http://127.0.0.1:7890
    playwright_proxy_server: str = ""

    # ── 存储配置 ──────────────────────────────────
    store_backend: str = "sqlite"   # TODO: sqlite / json / markdown（支持多选逗号分隔）

    # ── 图片配置 ──────────────────────────────────
    max_images_per_article: int = 5  # 每篇文章最多传给 LLM 的图片数
    image_input_mode: str = "url"    # url / base64 / none

    # ── OCR/降级 ──────────────────────────────────
    enable_ocr_fallback: bool = False   # TODO: 若 LLM 不支持视觉，是否启用 OCR 降级
    ocr_engine: str = "tesseract"        # tesseract / easyocr

    # ── 内容处理 ──────────────────────────────────
    max_content_length: int = 4000       # 单篇文章传给 LLM 的最大字符数
    max_articles_per_batch: int = 0      # 0 表示不限制单批文章数

    # ── 趋势分析：文章选取（质量 = 对时尚趋势分析的帮助度）────────
    # 开启后：按「时尚语义相关度」优先、证据丰富度次之排序，只取前 N 篇进入 LLM
    enable_article_quality_gate: bool = True
    min_article_title_chars: int = 4     # 标题过短视为无效
    min_article_body_chars: int = 160    # 正文过短（多为导航/聚合块）不参与趋势分析
    # 时尚相关分低于此值的稿件不参与分析（0=关闭该门槛，仅按排序截断）
    min_fashion_relevance_score: int = 10
    # True：剔除明显不含「时尚趋势」向信息的稿件（显式趋势词 / 大秀季次语境 / 极高时尚语义分）
    strict_fashion_trend_filter: bool = True
    unanalyzed_article_pool_limit: int = 400  # 仅分析模式：从库中拉取未分析文章的候选池上限
    # 全库季节分析：从库中拉取已入库文章（含曾分析过的）用于按季节分桶重跑趋势报告的上限
    library_season_article_pool_limit: int = 0
    # 0 表示不限制本轮参与趋势分析的文章数
    max_articles_per_analysis_run: int = 0

    # ── 站点配置目录 ──────────────────────────────
    site_configs_dir: str = str(BASE_DIR / "site_configs")

    # ── robots.txt ────────────────────────────────
    respect_robots_txt: bool = True      # 是否遵守 robots.txt（强烈建议保持 True）

    # ── 任务恢复 ──────────────────────────────────
    # 将「running」超过该分钟数仍无结束时间的任务标记为失败（进程崩溃后可再次触发流水线）
    # 设为 0 表示禁用自动恢复
    stale_task_recovery_minutes: int = 240

    @field_validator("store_backend")
    @classmethod
    def validate_store_backend(cls, v: str) -> str:
        valid = {"sqlite", "json", "markdown"}
        backends = {b.strip() for b in v.split(",")}
        invalid = backends - valid
        if invalid:
            raise ValueError(f"无效的 store_backend: {invalid}")
        return v

    def get_store_backends(self) -> list[str]:
        return [b.strip() for b in self.store_backend.split(",")]

    def get_images_dir(self, date_str: str) -> Path:
        p = Path(self.data_dir) / "images" / date_str
        p.mkdir(parents=True, exist_ok=True)
        return p

    def get_raw_dir(self) -> Path:
        p = Path(self.data_dir) / "raw"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def get_reports_dir(self) -> Path:
        p = Path(self.data_dir) / "reports"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def get_output_dir(self) -> Path:
        p = Path(self.output_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def get_log_dir(self) -> Path:
        p = Path(self.log_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def get_db_path(self) -> Path:
        p = Path(self.db_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def is_llm_configured(self) -> bool:
        return bool(self.llm_provider and self.llm_model and self.api_key)

    def is_qwen_configured(self) -> bool:
        return bool(self.qwen_api_key and self.qwen_model and self.qwen_base_url)

    def validate_required(self) -> list[str]:
        """返回未配置的必填项列表"""
        missing: list[str] = []
        if not self.llm_provider:
            missing.append("LLM_PROVIDER")
        if not self.llm_model:
            missing.append("LLM_MODEL")
        if not self.api_key:
            missing.append("API_KEY")
        if not self.qwen_api_key:
            missing.append("QWEN_API_KEY")
        return missing


# 全局单例
settings = Settings()
