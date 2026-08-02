import type { TrendDigest } from "./trend-types";
import styles from "./trends.module.css";

interface WeeklyDigestCardProps {
  readonly digest: TrendDigest | null;
  readonly error: Error | null;
  readonly loading: boolean;
}

export function WeeklyDigestCard({
  digest,
  error,
  loading,
}: WeeklyDigestCardProps) {
  if (loading) {
    return (
      <section aria-busy="true" className={styles.digestCard}>
        <span className={styles.digestIndex}>W—</span>
        <div><span>WEEKLY SOURCE BRIEF</span><p>正在整理本周已采集来源…</p></div>
      </section>
    );
  }
  if (error || !digest) {
    return (
      <section className={styles.digestCard} data-empty>
        <span className={styles.digestIndex}>W—</span>
        <div>
          <span>WEEKLY SOURCE BRIEF</span>
          <h2>本周综述尚未生成</h2>
          <p>{error?.message ?? "定期采集完成后，这里会显示基于来源条目的 AI 整理。"}</p>
        </div>
      </section>
    );
  }

  const week = digest.period.split("-W")[1] ?? "—";
  return (
    <section className={styles.digestCard}>
      <span className={styles.digestIndex}>W{week}</span>
      <div className={styles.digestCopy}>
        <div className={styles.digestMeta}>
          <span>WEEKLY SOURCE BRIEF · {digest.period}</span>
          <span>{digest.itemIds.length} 条来源汇总</span>
        </div>
        <h2>{digest.theme}</h2>
        <p>{digest.overview}</p>
      </div>
      <div className={styles.digestBoundary}>
        <strong>⚠ AI整理</strong>
        <span>这是对已采集文章的归纳，不替代原文判断。</span>
      </div>
    </section>
  );
}
