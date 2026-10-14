"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  fetchWorkflow,
  patchWorkflow,
  type WorkflowOperation,
} from "../board/workflow/workflow-api";
import { useCurrentTrendDigest, useTrends } from "./trend-api";
import { TrendBoardPickerDialog } from "./TrendBoardPickerDialog";
import { TrendCard, trendCategoryLabel } from "./TrendCard";
import type { TrendItem } from "./trend-types";
import { WeeklyDigestCard } from "./WeeklyDigestCard";
import styles from "./trends.module.css";

export function TrendArchive({
  projectId,
}: {
  readonly projectId?: string | undefined;
}) {
  const trends = useTrends();
  const digest = useCurrentTrendDigest();
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);
  const [pendingTrend, setPendingTrend] = useState<TrendItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const categories = useMemo(
    () => [...new Set(trends.items.map((item) => item.category))],
    [trends.items],
  );
  const items = trends.items.filter(
    (item) =>
      (!category || item.category === category) &&
      (!search.trim() ||
        [item.title, item.summary, ...item.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase())),
  );

  const importToProject = async (trend: TrendItem, targetId: string) => {
    setImportingId(trend.id);
    setError(null);
    try {
      const graph = await fetchWorkflow(targetId);
      const existing = graph.nodes.some(
        (node) =>
          node.type === "trend" && node.payload.trendItemId === trend.id,
      );
      if (!existing) {
        const y = graph.nodes.length
          ? Math.max(...graph.nodes.map((node) => node.y)) + 340
          : 100;
        const colors = trend.extracted?.keyColors.slice(0, 6) ?? [];
        const operations: WorkflowOperation[] = [
          {
            type: "add_node",
            node: {
              id: crypto.randomUUID(),
              kind: "asset",
              type: "trend",
              title: trend.title.slice(0, 200),
              x: 80,
              y,
              payload: {
                trendItemId: trend.id,
                text: trend.summary,
                imageUrl: trend.coverImageUrl,
                sourceUrl: trend.sourceUrl,
                platform: trend.platform,
                publishedAt: trend.publishedAt,
                keyColors: colors,
                keywords: trend.extracted?.keywords ?? trend.tags,
              },
            },
          },
          ...colors.map((color, index): WorkflowOperation => ({
            type: "add_node",
            node: {
              id: crypto.randomUUID(),
              kind: "asset",
              type: "swatch",
              title: `趋势配色 ${color}`,
              x: 80 + index * 240,
              y: y + 300,
              payload: {
                color,
                trendItemId: trend.id,
                sourceUrl: trend.sourceUrl,
                text: `来自「${trend.title}」的参考配色`,
              },
            },
          })),
        ];
        await patchWorkflow(targetId, {
          mode: "semantic",
          baseRevision: graph.revision,
          mutationId: crypto.randomUUID(),
          operations,
        });
      }
      setDestination(targetId);
      setNotice(
        existing
          ? "该趋势已在此工作流中，可以继续引用。"
          : "已将趋势摘要、代表图与配色加入工作流，原始来源已保留。 ",
      );
      setPendingTrend(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "趋势加入工作流失败");
    } finally {
      setImportingId(null);
    }
  };

  return (
    <section aria-label="趋势资料库" className={styles.archive}>
      <WeeklyDigestCard
        digest={digest.data}
        error={digest.error}
        loading={digest.isLoading}
        onRetry={digest.refresh}
      />
      <section aria-label="趋势筛选" className={styles.archiveFilters}>
        <div>
          <span className={styles.archiveOverline}>RESEARCH ARCHIVE</span>
          <h2>已采集趋势档案</h2>
          <p>
            {trends.total} 条原始来源 · 当前展示 {items.length} 条
          </p>
        </div>
        <label className={styles.archiveSearch}>
          搜索趋势
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="标题、摘要或关键词"
            type="search"
            value={search}
          />
        </label>
        <nav aria-label="趋势主题" className={styles.categoryTabs}>
          <button
            aria-pressed={!category}
            onClick={() => setCategory("")}
            type="button"
          >
            全部主题
          </button>
          {categories.map((value) => (
            <button
              aria-pressed={category === value}
              key={value}
              onClick={() => setCategory(value)}
              type="button"
            >
              {trendCategoryLabel(value)}
            </button>
          ))}
        </nav>
      </section>
      {error ? (
        <p className={styles.archiveError} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.archiveNotice} role="status">
          {notice}{" "}
          {destination ? (
            <Link href={`/${encodeURIComponent(destination)}`}>
              打开设计工作流 →
            </Link>
          ) : null}
        </p>
      ) : null}
      {trends.isLoading ? (
        <p className={styles.archiveState}>正在读取趋势档案…</p>
      ) : trends.error ? (
        <div className={styles.archiveState}>
          <p role="alert">{trends.error.message}</p>
          <button onClick={trends.refresh} type="button">
            重新加载档案
          </button>
        </div>
      ) : items.length ? (
        <div className={styles.archiveGrid}>
          {items.map((trend) => (
            <TrendCard
              disabled={Boolean(importingId)}
              importLabel="加入工作流"
              importing={importingId === trend.id}
              key={trend.id}
              onImport={(item) => {
                if (projectId) void importToProject(item, projectId);
                else setPendingTrend(item);
              }}
              trend={trend}
            />
          ))}
        </div>
      ) : (
        <p className={styles.archiveState}>
          {trends.items.length
            ? "没有匹配的趋势，可以更换主题或关键词。"
            : "尚无已采集档案，专业来源入口仍可在下方使用。"}
        </p>
      )}
      {trends.hasMore ? (
        <button
          className={styles.loadMore}
          disabled={trends.isLoadingMore}
          onClick={trends.loadMore}
          type="button"
        >
          {trends.isLoadingMore ? "正在读取…" : "加载更多趋势"}
        </button>
      ) : null}
      <TrendBoardPickerDialog
        importing={Boolean(importingId)}
        onClose={() => setPendingTrend(null)}
        onSelect={async (id) => {
          if (pendingTrend) await importToProject(pendingTrend, id);
        }}
        open={Boolean(pendingTrend)}
      />
    </section>
  );
}
