"use client";

import { ColorStrip } from "./ColorStrip";
import type { TrendItem } from "./trend-types";
import styles from "./trends.module.css";

interface TrendCardProps {
  readonly disabled?: boolean;
  readonly importing: boolean;
  readonly onImport: (trend: TrendItem) => void;
  readonly trend: TrendItem;
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  "businessoffashion.com": "The Business of Fashion",
  fashionunited: "FashionUnited",
  "fashionunited.com": "FashionUnited",
  "highsnobiety.com": "Highsnobiety",
  "hypebeast.com": "Hypebeast",
  pinterest: "Pinterest Trends",
  "pinterest.com": "Pinterest Trends",
  "ssense.com": "SSENSE",
  vogue: "Vogue",
  "vogue.com": "Vogue",
  wwd: "WWD",
  "wwd.com": "WWD",
};

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  accessories: "配饰",
  color: "色彩",
  culture: "文化",
  fabric: "面料",
  material: "材质",
  men: "男装",
  silhouette: "廓形",
  styling: "造型",
  sustainability: "可持续",
  women: "女装",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}

export function trendCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category.toLowerCase()] ?? category;
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

export function TrendCard({
  disabled = false,
  importing,
  onImport,
  trend,
}: TrendCardProps) {
  const platform = platformLabel(trend.platform);
  const keywords = trend.extracted?.keywords.length
    ? trend.extracted.keywords
    : trend.tags;

  return (
    <article
      className={styles.trendCard}
      data-has-cover={trend.coverImageUrl ? "true" : "false"}
    >
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
        <span className={styles.cardCategory}>
          {trendCategoryLabel(trend.category)}
        </span>
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
              {keywords.slice(0, 4).map((keyword) => (
                <span key={keyword}>{keyword}</span>
              ))}
              {keywords.length > 4 ? (
                <span aria-label={`另有 ${keywords.length - 4} 个关键词`}>
                  +{keywords.length - 4}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        <button
          className={styles.importButton}
          disabled={disabled || importing}
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
