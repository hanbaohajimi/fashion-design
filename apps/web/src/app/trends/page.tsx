"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { notifyBoardRemoteRefresh } from "../../modules/board/board-context";
import {
  clearActiveBoardId,
  readActiveBoardId,
  writeActiveBoardId,
} from "../../modules/trends/active-board";
import {
  importTrendToBoard,
  TrendApiError,
  useCurrentTrendDigest,
  useTrends,
} from "../../modules/trends/trend-api";
import type { TrendItem } from "../../modules/trends/trend-types";
import { TrendBoardPickerDialog } from "../../modules/trends/TrendBoardPickerDialog";
import {
  TrendCard,
  platformLabel,
  trendCategoryLabel,
} from "../../modules/trends/TrendCard";
import styles from "../../modules/trends/trends.module.css";
import { WeeklyDigestCard } from "../../modules/trends/WeeklyDigestCard";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "存入白板失败，请稍后重试";
}

export default function TrendsPage() {
  const router = useRouter();
  const trends = useTrends();
  const digest = useCurrentTrendDigest();
  const [category, setCategory] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [tag, setTag] = useState("all");
  const [pendingTrend, setPendingTrend] = useState<TrendItem | null>(null);
  const [importingTrendId, setImportingTrendId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (navigationTimer.current) clearTimeout(navigationTimer.current);
    },
    [],
  );

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trend of trends.items) {
      for (const value of trend.tags) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
      .slice(0, 8)
      .map(([value]) => value);
  }, [trends.items]);

  const availableCategories = useMemo(
    () => [
      "all",
      ...new Set(
        trends.items
          .map((trend) => trend.category.trim())
          .filter((value) => value.length > 0),
      ),
    ],
    [trends.items],
  );
  const availablePlatforms = useMemo(
    () => [
      "all",
      ...new Set(
        trends.items
          .map((trend) => trend.platform.trim().toLowerCase())
          .filter((value) => value.length > 0),
      ),
    ],
    [trends.items],
  );

  const filtered = useMemo(
    () =>
      trends.items.filter(
        (trend) =>
          (category === "all" || trend.category === category) &&
          (platform === "all" || trend.platform === platform) &&
          (tag === "all" || trend.tags.includes(tag)),
      ),
    [category, platform, tag, trends.items],
  );

  const runImport = async (boardId: string, trend: TrendItem): Promise<void> => {
    setImportingTrendId(trend.id);
    setToast(null);
    try {
      const result = await importTrendToBoard(boardId, trend.id);
      writeActiveBoardId(boardId);
      notifyBoardRemoteRefresh(boardId);
      const count = result.elements.length || 3;
      setToast({ kind: "success", message: `已存入白板（${count}个元素）` });
      setPendingTrend(null);
      navigationTimer.current = setTimeout(() => router.push(`/${boardId}`), 850);
    } catch (error) {
      setToast({ kind: "error", message: errorMessage(error) });
      if (
        error instanceof TrendApiError &&
        (error.code === "PROJECT_FORBIDDEN" || error.code === "PROJECT_NOT_FOUND")
      ) {
        clearActiveBoardId();
      }
    } finally {
      setImportingTrendId(null);
    }
  };

  const requestImport = (trend: TrendItem): void => {
    if (importingTrendId) return;
    const activeBoardId = readActiveBoardId();
    if (!activeBoardId) {
      setPendingTrend(trend);
      return;
    }
    void runImport(activeBoardId, trend);
  };

  return (
    <main className={styles.trendsPage}>
      <header className={styles.pageHeader}>
        <div><Link href="/">← 项目库</Link><span>TREND EVIDENCE / 8.5</span></div>
        <p><i /> 每周一更新 · 所有条目保留原文来源</p>
      </header>

      <section className={styles.hero}>
        <div><span>TRACEABLE FASHION SIGNALS</span><h1>趋势可以被整理，<br />判断必须留给你。</h1></div>
        <p>这里展示的是对公开来源的分析整理。每一条摘要都与平台、发布日期和原文入口并列呈现。</p>
      </section>

      <WeeklyDigestCard
        digest={digest.data}
        error={digest.error}
        loading={digest.isLoading}
        onRetry={digest.refresh}
      />

      <section aria-label="趋势筛选" className={styles.filterBar}>
        <FilterGroup
          label="主题"
          onChange={setCategory}
          options={availableCategories}
          value={category}
          labels={Object.fromEntries(
            availableCategories.map((value) => [
              value,
              value === "all" ? "全部" : trendCategoryLabel(value),
            ]),
          )}
        />
        <FilterGroup
          label="平台"
          onChange={setPlatform}
          options={availablePlatforms}
          value={platform}
          labels={Object.fromEntries(availablePlatforms.map((value) => [value, value === "all" ? "全部" : platformLabel(value)]))}
        />
        <FilterGroup label="标签" onChange={setTag} options={["all", ...availableTags]} value={tag} labels={{ all: "全部" }} />
        <button className={styles.resetFilters} onClick={() => { setCategory("all"); setPlatform("all"); setTag("all"); }} type="button">重置筛选</button>
      </section>

      <section aria-label="趋势条目" className={styles.trendArchive}>
        <div className={styles.resultMeta}>
          <p><strong>{filtered.length.toString().padStart(2, "0")}</strong> 条可溯源趋势</p>
          <span>{trends.total} 条记录 · 筛选仅改变视图</span>
        </div>

        {trends.isLoading ? (
          <div className={styles.pageState}><span>READING SOURCES</span><h2>正在读取趋势档案…</h2></div>
        ) : trends.error ? (
          <div className={styles.pageState} data-error><span>SOURCE FEED OFFLINE</span><h2>趋势数据暂不可用</h2><p>{trends.error.message}</p><button onClick={trends.refresh} type="button">重新加载</button></div>
        ) : filtered.length === 0 ? (
          <div className={styles.pageState}><span>NO MATCH</span><h2>当前筛选没有匹配条目</h2><p>尝试重置品类、标签或平台。</p></div>
        ) : (
          <div className={styles.trendGrid}>
            {filtered.map((trend) => (
              <TrendCard
                disabled={Boolean(importingTrendId) && importingTrendId !== trend.id}
                importing={importingTrendId === trend.id}
                key={trend.id}
                onImport={requestImport}
                trend={trend}
              />
            ))}
          </div>
        )}
        {trends.hasMore ? (
          <button
            disabled={trends.isLoadingMore}
            onClick={trends.loadMore}
            type="button"
          >
            {trends.isLoadingMore ? "正在加载更多…" : "加载更多趋势"}
          </button>
        ) : null}
      </section>

      <TrendBoardPickerDialog
        importing={Boolean(importingTrendId)}
        onClose={() => setPendingTrend(null)}
        onSelect={async (boardId) => {
          if (pendingTrend) await runImport(boardId, pendingTrend);
        }}
        open={Boolean(pendingTrend)}
      />
      {toast ? <div aria-live="polite" className={styles.toast} data-kind={toast.kind} role="status">{toast.message}</div> : null}
    </main>
  );
}

function FilterGroup({
  label,
  labels,
  onChange,
  options,
  value,
}: {
  readonly label: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly onChange: (value: string) => void;
  readonly options: readonly string[];
  readonly value: string;
}) {
  return (
    <fieldset className={styles.filterGroup}>
      <legend>{label}</legend>
      <div>{options.map((option) => <button aria-pressed={option === value} key={option} onClick={() => onChange(option)} type="button">{labels[option] ?? option}</button>)}</div>
    </fieldset>
  );
}
