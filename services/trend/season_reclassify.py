"""
根据当前 season_profile 规则，用报告关联的 source_articles 重新推断季节标签，
更新 SQLite reports 表及磁盘上的报告 JSON（不重新调用 LLM）。
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from loguru import logger

from season_profile import (
    infer_season_profile,
    season_bucket_sort_key,
    season_profile_from_bucket_id,
)
from scheduler import _articles_from_storage_rows


def reclassify_report_seasons_from_articles(sqlite: Any) -> dict[str, int]:
    """
    遍历 reports：对每份报告的 source_articles 重建 Article，多数票决定 bucket_id，
    写回 season_* 列并同步 report JSON 文件（若存在）。

    返回：{"updated": n, "skipped": n, "json_patched": n}
    """
    stats = {"updated": 0, "skipped": 0, "json_patched": 0}

    with sqlite._conn() as conn:
        rep_rows = conn.execute(
            "SELECT report_id, source_articles, report_json_path FROM reports"
        ).fetchall()

    sql_rows: list[tuple[Any, ...]] = []
    json_jobs: list[tuple[str, Path, Any]] = []

    for row in rep_rows:
        report_id = row["report_id"]
        try:
            keys = json.loads(row["source_articles"] or "[]")
        except Exception:
            logger.debug("reclassify skip [{}]: bad source_articles JSON", report_id)
            stats["skipped"] += 1
            continue
        if not isinstance(keys, list) or not keys:
            stats["skipped"] += 1
            continue

        raw_rows = sqlite.get_article_rows_by_keys([str(k) for k in keys])
        articles = _articles_from_storage_rows(raw_rows)
        if not articles:
            logger.debug("reclassify skip [{}]: no articles loaded from DB", report_id)
            stats["skipped"] += 1
            continue

        profiles = [infer_season_profile(a) for a in articles]
        counts = Counter(p.bucket_id for p in profiles)
        max_c = max(counts.values())
        candidates = [bid for bid, c in counts.items() if c == max_c]
        winner_bid = min(candidates, key=season_bucket_sort_key)
        prof = season_profile_from_bucket_id(winner_bid)

        sql_rows.append(
            (
                prof.season_code,
                int(prof.season_year or 0),
                prof.season_label_zh,
                prof.bucket_id,
                report_id,
            )
        )

        path = sqlite._resolve_report_json_path(row["report_json_path"])
        if path and path.is_file():
            json_jobs.append((report_id, path, prof))

    if sql_rows:
        with sqlite._conn() as conn:
            for args in sql_rows:
                conn.execute(
                    """
                    UPDATE reports
                    SET season_code = ?, season_year = ?, season_label_zh = ?, season_bucket_id = ?
                    WHERE report_id = ?
                    """,
                    args,
                )
        stats["updated"] = len(sql_rows)

    for report_id, path, prof in json_jobs:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data["season_code"] = prof.season_code
                data["season_year"] = int(prof.season_year or 0)
                data["season_label_zh"] = prof.season_label_zh
                data["season_bucket_id"] = prof.bucket_id
                path.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2, default=str),
                    encoding="utf-8",
                )
                stats["json_patched"] += 1
        except Exception as exc:
            logger.warning("reclassify [{}]: JSON patch failed {}: {}", report_id, path, exc)

    logger.info(
        "Season reclassify done | updated={} json_patched={} skipped={}",
        stats["updated"],
        stats["json_patched"],
        stats["skipped"],
    )
    return stats
