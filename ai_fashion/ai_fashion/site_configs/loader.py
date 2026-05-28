"""
site_configs/loader.py — 站点配置加载器
从 YAML/JSON 文件加载多站点配置，返回 SiteConfig 列表
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from loguru import logger

from config import settings
from models import PaginationType, SiteConfig, SiteLoginConfig, SiteSelectorsConfig

try:
    import yaml
    _HAS_YAML = True
except ImportError:
    _HAS_YAML = False


def _parse_site_dict(d: dict[str, Any]) -> SiteConfig:
    """将字典解析为 SiteConfig，支持嵌套与扁平两种格式"""
    # 登录配置（支持嵌套 login: {...} 或扁平 login_url/use_login 等）
    if "login" in d and isinstance(d["login"], dict):
        login = SiteLoginConfig(**d["login"])
    else:
        login = SiteLoginConfig(
            use_login=d.get("use_login", False),
            login_url=d.get("login_url", ""),
            storage_state_path=d.get("storage_state_path", ""),
            username=d.get("username", ""),
            password=d.get("password", ""),
        )

    # 选择器配置
    if "selectors" in d and isinstance(d["selectors"], dict):
        selectors = SiteSelectorsConfig(**d["selectors"])
    else:
        selectors = SiteSelectorsConfig(
            article_link_selector=d.get("article_link_selector", ""),
            title_selector=d.get("title_selector", ""),
            content_selector=d.get("content_selector", ""),
            published_at_selector=d.get("published_at_selector", ""),
            author_selector=d.get("author_selector", ""),
            tags_selector=d.get("tags_selector", ""),
            category_selector=d.get("category_selector", ""),
            image_selector=d.get("image_selector", ""),
            summary_selector=d.get("summary_selector", ""),
            next_page_selector=d.get("next_page_selector", ""),
            load_more_selector=d.get("load_more_selector", ""),
        )

    # 分页类型
    pagination_str = d.get("pagination_type", "none")
    try:
        pagination_type = PaginationType(pagination_str)
    except ValueError:
        logger.warning("Unknown pagination_type '{}', defaulting to 'none'", pagination_str)
        pagination_type = PaginationType.NONE

    return SiteConfig(
        site_name=d.get("site_name", ""),
        enabled=d.get("enabled", True),
        allowed_domains=d.get("allowed_domains", []),
        entry_urls=d.get("entry_urls", []),
        detail_url_patterns=d.get("detail_url_patterns", []),
        login=login,
        selectors=selectors,
        pagination_type=pagination_type,
        max_pages=d.get("max_pages", 5),
        max_articles_per_run=d.get("max_articles_per_run", 50),
        request_delay_min=d.get("request_delay_min", 1.5),
        request_delay_max=d.get("request_delay_max", 4.0),
        extra=d.get("extra", {}),
    )


def load_all_site_configs(config_dir: str = None) -> list[SiteConfig]:
    """
    从 site_configs/ 目录加载所有站点配置文件（.yaml / .json）。
    每个文件可包含单个站点或多个站点列表。
    """
    dir_path = Path(config_dir or settings.site_configs_dir)
    configs: list[SiteConfig] = []

    # 遍历所有配置文件（按文件名排序，保证加载顺序稳定）
    patterns = ["*.yaml", "*.yml", "*.json"]
    files: list[Path] = []
    for pat in patterns:
        files.extend(sorted(dir_path.glob(pat)))

    # 排除 loader.py 自身和 __init__ 等
    files = [f for f in files if f.name not in ("loader.json",)]

    if not files:
        logger.warning(
            "No site config files found in {}. "
            "Create .yaml or .json files to configure sites.",
            dir_path,
        )
        return configs

    for file_path in files:
        try:
            if file_path.suffix in (".yaml", ".yml"):
                if not _HAS_YAML:
                    logger.error("PyYAML not installed. Cannot load {}", file_path)
                    continue
                with open(file_path, encoding="utf-8") as f:
                    data = yaml.safe_load(f)
            else:
                with open(file_path, encoding="utf-8") as f:
                    data = json.load(f)

            # 支持单站点（dict）或多站点（list）
            if isinstance(data, dict):
                data = [data]
            if not isinstance(data, list):
                logger.warning("Unexpected config format in {}", file_path)
                continue

            for item in data:
                if not isinstance(item, dict):
                    continue
                cfg = _parse_site_dict(item)
                if cfg.site_name:
                    configs.append(cfg)
                    logger.debug("Loaded site config: {}", cfg.site_name)

        except Exception as exc:
            logger.error("Failed to load site config {}: {}", file_path, exc)

    enabled = sum(1 for c in configs if c.enabled)
    logger.info(
        "Loaded {} site configs ({} enabled) from {}",
        len(configs),
        enabled,
        dir_path,
    )
    return configs


def get_site_config(site_name: str) -> SiteConfig | None:
    """按名称获取单个站点配置"""
    all_configs = load_all_site_configs()
    for cfg in all_configs:
        if cfg.site_name == site_name:
            return cfg
    return None
