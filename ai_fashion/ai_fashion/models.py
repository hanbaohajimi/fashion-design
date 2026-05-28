"""
models.py — 所有 Pydantic 数据模型定义
包含：文章、图片、LLM 输入/输出、任务状态、趋势报告等
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator
from time_utils import local_now


# ─────────────────────────────────────────────
# 枚举
# ─────────────────────────────────────────────

class PaginationType(str, Enum):
    NONE = "none"
    NEXT_PAGE = "next_page"
    LOAD_MORE = "load_more"
    INFINITE_SCROLL = "infinite_scroll"
    URL_PARAM = "url_param"


class StorageBackend(str, Enum):
    SQLITE = "sqlite"
    JSON = "json"
    MARKDOWN = "markdown"


class LLMProvider(str, Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    LOCAL = "local"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"


class ImageInputMode(str, Enum):
    URL = "url"
    BASE64 = "base64"
    NONE = "none"


# ─────────────────────────────────────────────
# 站点配置模型
# ─────────────────────────────────────────────

class SiteLoginConfig(BaseModel):
    """登录相关配置"""
    use_login: bool = False
    login_url: str = ""                         # TODO: 填写登录页 URL
    storage_state_path: str = ""                # TODO: 填写 storage_state.json 路径
    username: str = ""                          # TODO: 填写账号（可为空，推荐用 storage_state）
    password: str = ""                          # TODO: 填写密码（可为空，推荐用 storage_state）


class SiteSelectorsConfig(BaseModel):
    """CSS/XPath 选择器配置，全部允许为空占位"""
    article_link_selector: str = ""             # TODO: 文章链接选择器
    title_selector: str = ""                    # TODO: 标题选择器
    content_selector: str = ""                  # TODO: 正文选择器
    published_at_selector: str = ""             # TODO: 发布时间选择器
    author_selector: str = ""                   # TODO: 作者选择器
    tags_selector: str = ""                     # TODO: 标签选择器（多标签逗号或列表）
    category_selector: str = ""                 # TODO: 栏目/分类选择器
    image_selector: str = ""                    # TODO: 图片选择器（img[src]）
    summary_selector: str = ""                  # TODO: 摘要选择器（可选）
    next_page_selector: str = ""                # TODO: 下一页按钮选择器
    load_more_selector: str = ""                # TODO: 加载更多按钮选择器


class SiteConfig(BaseModel):
    """单站点完整配置"""
    site_name: str = ""                         # TODO: 站点名称
    enabled: bool = True
    allowed_domains: list[str] = Field(default_factory=list)  # TODO: 允许的域名列表
    entry_urls: list[str] = Field(default_factory=list)        # TODO: 入口 URL 列表（多栏目）
    detail_url_patterns: list[str] = Field(default_factory=list)  # TODO: 详情页 URL 正则模式

    # 登录配置
    login: SiteLoginConfig = Field(default_factory=SiteLoginConfig)

    # 选择器配置
    selectors: SiteSelectorsConfig = Field(default_factory=SiteSelectorsConfig)

    # 分页
    pagination_type: PaginationType = PaginationType.NONE
    max_pages: int = 5
    max_articles_per_run: int = 50

    # 速率控制（秒）
    request_delay_min: float = 1.5
    request_delay_max: float = 4.0

    # 额外元数据（可选，自由扩展）
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("site_name")
    @classmethod
    def site_name_not_empty_when_enabled(cls, v: str) -> str:
        return v  # 允许空占位，运行时校验

    def is_valid(self) -> tuple[bool, list[str]]:
        """校验站点配置完整性，返回 (ok, errors)"""
        errors: list[str] = []
        if not self.site_name:
            errors.append("site_name 不能为空")
        if not self.entry_urls:
            errors.append("entry_urls 不能为空")
        if not self.selectors.article_link_selector:
            errors.append("article_link_selector 未配置")
        if not self.selectors.title_selector:
            errors.append("title_selector 未配置")
        if not self.selectors.content_selector:
            errors.append("content_selector 未配置")
        return len(errors) == 0, errors


# ─────────────────────────────────────────────
# 抓取数据模型
# ─────────────────────────────────────────────

class ImageItem(BaseModel):
    """单张图片"""
    original_url: str
    local_path: str = ""
    content_hash: str = ""
    downloaded: bool = False
    alt_text: str = ""
    width: Optional[int] = None
    height: Optional[int] = None


class Article(BaseModel):
    """单篇文章（抓取结果）"""
    # 唯一标识
    unique_key: str = ""          # 由 article_url + title hash 生成

    # 来源信息
    site_name: str = ""
    source: str = ""              # 来源网站域名
    category: str = ""
    tags: list[str] = Field(default_factory=list)

    # 内容字段
    title: str = ""
    content: str = ""             # 清洗后纯文本
    raw_content: str = ""         # 原始 HTML 片段（可选）
    summary: str = ""
    author: str = ""
    published_at: Optional[datetime] = None
    article_url: str = ""

    # 图片
    image_urls: list[str] = Field(default_factory=list)
    images: list[ImageItem] = Field(default_factory=list)

    # 元数据
    crawled_at: datetime = Field(default_factory=local_now)
    raw_html_path: str = ""       # 可选：保存原始 HTML

    # 处理标记
    llm_analyzed: bool = False
    analysis_id: str = ""

    @model_validator(mode="after")
    def generate_unique_key(self) -> "Article":
        if not self.unique_key and self.article_url:
            raw = f"{self.article_url}|{self.title}"
            self.unique_key = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self

    def to_llm_input(self, max_content_length: int = 4000) -> "LLMArticleInput":
        """转换为 LLM 输入格式"""
        return LLMArticleInput(
            article_id=self.unique_key,
            site_name=self.site_name,
            title=self.title,
            content=self.content[:max_content_length],
            summary=self.summary,
            tags=self.tags,
            category=self.category,
            published_at=self.published_at,
            article_url=self.article_url,
            images=self.images,
        )


class CrawlSession(BaseModel):
    """单次站点抓取会话结果"""
    site_name: str
    started_at: datetime = Field(default_factory=local_now)
    finished_at: Optional[datetime] = None
    articles_found: int = 0
    articles_new: int = 0
    articles_failed: int = 0
    images_downloaded: int = 0
    errors: list[str] = Field(default_factory=list)
    success: bool = False


# ─────────────────────────────────────────────
# LLM 输入/输出模型
# ─────────────────────────────────────────────

class LLMArticleInput(BaseModel):
    """传递给 LLM 分析的单篇文章结构"""
    article_id: str
    site_name: str
    title: str
    content: str
    summary: str = ""
    tags: list[str] = Field(default_factory=list)
    category: str = ""
    published_at: Optional[datetime] = None
    article_url: str = ""
    images: list[ImageItem] = Field(default_factory=list)


class LLMBatchInput(BaseModel):
    """批量 LLM 分析输入"""
    batch_id: str
    articles: list[LLMArticleInput]
    created_at: datetime = Field(default_factory=local_now)
    image_input_mode: ImageInputMode = ImageInputMode.URL


# ─────────────────────────────────────────────
# 搜索优先工作流模型
# ─────────────────────────────────────────────

class SearchResultCandidate(BaseModel):
    """Qwen 搜索返回并待进一步筛选的候选文章。"""

    query: str = ""
    site_name: str = ""
    title: str = ""
    subtitle: str = ""
    url: str = ""
    domain: str = ""
    source_rank: int = 0
    chosen_for_fetch: bool = False
    selection_reason: str = ""


class ArticleTrendInsight(BaseModel):
    """单篇文章的一阶趋势洞察，用于二阶汇总。"""

    article_id: str
    article_title: str
    article_url: str
    site_name: str
    executive_summary: str = ""
    key_directions: list[str] = Field(default_factory=list)
    colors: list[str] = Field(default_factory=list)
    fabrics: list[str] = Field(default_factory=list)
    silhouettes: list[str] = Field(default_factory=list)
    items: list[str] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=list)
    style_keywords: list[str] = Field(default_factory=list)
    consumer_signals: list[str] = Field(default_factory=list)
    evidence_snippets: list[str] = Field(default_factory=list)
    business_implications: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    representative_images: list[str] = Field(default_factory=list)


# ─────────────────────────────────────────────
# 趋势报告模型
# ─────────────────────────────────────────────

class EvidenceItem(BaseModel):
    """单条趋势证据"""
    site_name: str
    article_title: str
    article_url: str
    snippet: str


class TrendItem(BaseModel):
    """单条关键趋势"""
    name: str
    description: str
    # 趋势归类，便于筛选与展示（如：色彩 / 单品 / 可持续 / 零售策略）
    category: str = ""
    supporting_evidence: list[EvidenceItem] = Field(default_factory=list)
    related_colors: list[str] = Field(default_factory=list)
    related_fabrics: list[str] = Field(default_factory=list)
    related_items: list[str] = Field(default_factory=list)
    related_patterns: list[str] = Field(default_factory=list)
    related_silhouettes: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    # LLM 为该趋势选出的代表图片 URL（从文章图片中挑选，最多3张）
    selected_images: list[str] = Field(default_factory=list)


class StyleDetail(BaseModel):
    """款式/单品/版型/颜色板块的具体分析条目"""
    name: str                                          # 名称，如"宽松西装"、"云舞白"
    description: str = ""                              # 具体分析描述
    trend_direction: str = ""                          # 趋势方向：上升/稳定/新兴
    representative_brands: list[str] = Field(default_factory=list)   # 代表品牌
    style_tips: list[str] = Field(default_factory=list)              # 搭配建议
    selected_images: list[str] = Field(default_factory=list)         # 代表图片
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)


# 与 FashionTrendAnalyzer._empty_report 占位摘要一致；列表/季节汇总/统计应排除此类行
REPORT_FAILURE_PLACEHOLDER_SUMMARY = "分析失败或无数据"


class FashionTrendReport(BaseModel):
    """完整趋势分析报告（LLM 输出 + 元数据）"""
    report_id: str = ""
    report_date: str = ""         # ISO 日期字符串
    time_range: str = ""          # 例："2024-01-01 ~ 2024-01-07"
    summary: str = ""

    # 服装季节分桶（与 season_profile 一致）：便于按年/季筛选与单独展示
    season_code: str = ""         # SS / FW / RESORT / CRUISE / PREFALL / TRANSITION / UNKNOWN
    season_year: int = 0         # 推断的季次年份（如 2025）
    season_label_zh: str = ""    # 例：「2025 春夏」
    season_bucket_id: str = ""   # 例：2025_SS

    # 核心趋势
    key_trends: list[TrendItem] = Field(default_factory=list)

    # 维度分析
    colors: list[str] = Field(default_factory=list)
    fabrics: list[str] = Field(default_factory=list)
    silhouettes: list[str] = Field(default_factory=list)
    items: list[str] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=list)
    style_keywords: list[str] = Field(default_factory=list)
    consumer_signals: list[str] = Field(default_factory=list)

    # 置信度与证据
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    evidence: list[EvidenceItem] = Field(default_factory=list)

    # 四大板块具体分析
    style_details: list[StyleDetail] = Field(default_factory=list)   # 款式板块
    item_details: list[StyleDetail] = Field(default_factory=list)    # 单品板块
    silhouette_details: list[StyleDetail] = Field(default_factory=list)  # 版型板块
    color_details: list[StyleDetail] = Field(default_factory=list)   # 颜色板块

    # 来源追踪
    source_articles: list[str] = Field(default_factory=list)  # article unique_keys
    covered_sites: list[str] = Field(default_factory=list)

    # 报告级代表图（从各趋势/板块去重汇总，便于摘要区与仪表盘展示）
    representative_images: list[str] = Field(default_factory=list)

    # 元数据
    llm_provider: str = ""
    llm_model: str = ""
    token_usage: dict[str, int] = Field(default_factory=dict)
    generated_at: datetime = Field(default_factory=local_now)
    batch_id: str = ""


# ─────────────────────────────────────────────
# 任务运行状态模型
# ─────────────────────────────────────────────

class TaskRun(BaseModel):
    """记录每次全局任务运行状态"""
    run_id: str
    started_at: datetime = Field(default_factory=local_now)
    finished_at: Optional[datetime] = None
    status: TaskStatus = TaskStatus.PENDING
    sites_total: int = 0
    sites_success: int = 0
    sites_failed: int = 0
    articles_crawled: int = 0
    articles_new: int = Field(
        0,
        description="本轮新写入库的文章数（去重后）；参与 LLM 分析的篇数见 articles_analyzed。",
    )
    articles_analyzed: int = Field(
        0,
        description="本轮送入趋势分析（过质量闸后）的文章篇数；analyze_only 时 articles_new 可为 0。",
    )
    reports_generated: int = 0
    error_message: str = ""
    # full | crawl_only | analyze_only | analyze_library — 用于失败重试时复现相同模式
    pipeline_mode: str = ""
    crawl_duration_ms: int = 0
    analyze_duration_ms: int = 0
    # JSON 字符串，与报告 token_usage 结构一致
    llm_token_usage_json: str = "{}"
    stage_code: str = ""
    stage_label: str = ""
    stage_detail: str = ""
    stage_index: int = 0
    stage_total: int = 0
    progress_percent: int = 0
    crawl_sessions: list[CrawlSession] = Field(default_factory=list)
