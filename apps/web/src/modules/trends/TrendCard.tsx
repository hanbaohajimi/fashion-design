"use client";

import { ColorStrip } from "./ColorStrip";
import type { TrendItem } from "./trend-types";
import styles from "./trends.module.css";

interface TrendCardProps {
  readonly importing: boolean;
  readonly onImport: (trend: TrendItem) => void;
  readonly trend: TrendItem;
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  fashionunited: "FashionUnited",
  pinterest: "Pinterest Trends",
  vogue: "Vogue",
  wwd: "WWD",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}

function publishedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "发布日期未知"
    : new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        month: "long",
        timeZone: "Asia/Shanghai",
        year: "numeric",
      }).format(date);
}

export function TrendCard({ importing, onImport, trend }: TrendCardProps) {
  const platform = platformLabel(trend.platform);
  const keywords = trend.extracted?.keywords.length
    ? trend.extracted.keywords
    : trend.tags;

  return (
    <article className={styles.trendCard}>
      <div className={styles.cardVisual}>
        {trend.coverImageUrl ? (
          // Authenticated same-origin image endpoints may redirect to a private signed URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" loading="lazy" src={trend.coverImageUrl} />
        ) : (
          <div aria-label="暂无代表图" className={styles.visualFallback} role="img">
            <span>NO VISUAL</span><i />
          </div>
        )}
        <span className={styles.platformBadge}>{platform}</span>
      </div>

      <div className={styles.cardBody}>
        <span className={styles.cardCategory}>{trend.category}</span>
        <h3>{trend.title}</h3>

        <div className={styles.sourceProof}>
          <a href={trend.sourceUrl} rel="noreferrer" target="_blank">
            <span aria-hidden="true">▧</span> 查看原文 - {platform}
          </a>
          <time dateTime={trend.publishedAt}>{publishedDate(trend.publishedAt)}</time>
        </div>

        <section aria-label="AI整理摘要" className={styles.aiSummary}>
          <div className={styles.aiBoundary}>
            <span aria-hidden="true">⚠</span>
            <strong>AI整理，建议结合原文判断</strong>
          </div>
          <p>{trend.summary}</p>
          <ColorStrip colors={trend.extracted?.keyColors ?? []} />
          {keywords.length > 0 ? (
            <div aria-label="趋势关键词" className={styles.tagList}>
              {keywords.slice(0, 6).map((keyword) => (
                <span key={keyword}>{keyword}</span>
              ))}
            </div>
          ) : null}
        </section>

        <button
          className={styles.importButton}
          disabled={importing}
          onClick={() => onImport(trend)}
          type="button"
        >
          {importing ? "正在存入…" : "存入白板"}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </article>
  );
}
