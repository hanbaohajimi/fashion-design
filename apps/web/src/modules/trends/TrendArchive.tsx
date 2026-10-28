"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCoutureMotion } from "../../components/motion/use-couture-motion";

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
import { Button, Skeleton, SkeletonGroup } from "../../components/ui";
import { motionEase, motionTime, observeMotionCancellation } from "../../components/interactions/motion-policy";
import { userFacingError } from "../../components/user-facing-error";

export function TrendArchive({
  projectId,
}: {
  readonly projectId?: string | undefined;
}) {
  const trends = useTrends();
  const grid = useRef<HTMLDivElement>(null);
  const firstLoad = useRef({ waiting: false, revealed: false });
  useLayoutEffect(() => {
    if (trends.isLoading && !trends.items.length) firstLoad.current.waiting = true;
    if (trends.isLoading || !trends.items.length || firstLoad.current.revealed) return;
    firstLoad.current.revealed = true;
    if (!firstLoad.current.waiting) return;
    const duration = motionTime("--motion-content-enter", 400);
    const animations: Animation[] = [];
    if (duration && !document.hidden) [...(grid.current?.children ?? [])].slice(0, 6).forEach((item, index) => {
      if (item instanceof HTMLElement && item.getBoundingClientRect().top < innerHeight && item.animate) animations.push(item.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration, delay: index * 60, easing: motionEase(), fill: "backwards" }));
    });
    const cancel = () => animations.forEach(animation => animation.cancel());
    const stop = observeMotionCancellation(cancel);
    return () => { cancel(); stop(); };
  }, [trends.isLoading, trends.items.length]);
  const motionRoot = useRef<HTMLElement>(null);
  const play = useCoutureMotion();
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
        const anchor = [...(motionRoot.current?.querySelectorAll<HTMLElement>("[data-trend-id]") ?? [])].find((card) => card.dataset.trendId === trend.id);
        play("stitch", { anchor: anchor ?? null, eventKey: `trend:${targetId}:${trend.id}`, colors });
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
    <section
      ref={motionRoot}
      aria-label="趋势资料库"
      className={styles.archive}
      data-guide-page="trends"
      data-guide-ready={!trends.isLoading && !trends.error ? "true" : "false"}
    >
      <section aria-label="趋势筛选" className={styles.archiveFilters} data-guide="trends-filters">
        <div>
          <p>
            {trends.total} 条来源 当前展示 {items.length} 条
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
          {userFacingError(error, "趋势加入工作流失败，请重试")}
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
      {trends.error && trends.items.length ? <div className={styles.archiveState}><p role="alert">{userFacingError(trends.error, "更新未完成，仍显示已加载的趋势")}</p><Button loading={trends.isRefreshing} onClick={trends.refresh}>重试更新档案</Button></div> : null}
      {trends.isLoading && !trends.items.length ? (
        <div role="status" aria-label="正在读取趋势档案"><SkeletonGroup className={styles.archiveGrid ?? ""}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} label="正在加载趋势" className={styles.archiveSkeleton} />)}</SkeletonGroup></div>
      ) : trends.error && !trends.items.length ? (
        <div className={styles.archiveState}>
          <p role="alert">{userFacingError(trends.error, "趋势暂时无法加载，请重试")}</p>
          <Button loading={trends.isRefreshing} onClick={trends.refresh}>
            重新加载档案
          </Button>
        </div>
      ) : items.length ? (
        <div ref={grid} className={styles.archiveGrid}>
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
      <details className={styles.externalSources}>
        <summary>本周趋势综述</summary>
        <WeeklyDigestCard digest={digest.data} error={digest.error} loading={digest.isLoading} onRetry={digest.refresh} />
      </details>
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
