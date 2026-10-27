import type { TrendDigest } from "./trend-types";
import styles from "./trends.module.css";
import { userFacingError } from "../../components/user-facing-error";

interface WeeklyDigestCardProps {
  readonly digest: TrendDigest | null;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly onRetry: () => void;
}

export function WeeklyDigestCard({
  digest,
  error,
  loading,
  onRetry,
}: WeeklyDigestCardProps) {
  if (loading) {
    return (
      <section aria-busy="true" className={styles.digestCard}>
        <div><p>正在整理本周已采集来源…</p></div>
      </section>
    );
  }
  if (error || !digest) {
    return (
      <section className={styles.digestCard} data-empty>
        <div>
          <h2>本周综述尚未生成</h2>
          <p>{error ? userFacingError(error, "本周综述暂时无法加载，请重试") : "采集完成后，这里会显示来源综述。"}</p>
          {error ? <button onClick={onRetry} type="button">重新读取周报</button> : null}
        </div>
      </section>
    );
  }

  const week = digest.period.split("-W")[1] ?? "—";
  return (
    <section className={styles.digestCard}>
      <span className={styles.digestIndex}>第 {week} 周</span>
      <div className={styles.digestCopy}>
        <div className={styles.digestMeta}>
          <span>来源综述 {digest.period}</span>
          <span>{digest.itemIds.length} 条来源汇总</span>
        </div>
        <h2>{digest.theme}</h2>
        <p>{digest.overview}</p>
      </div>
      <div className={styles.digestBoundary}>
        <strong>⚠ 机器整理</strong>
        <span>这是对已采集文章的归纳，不替代原文判断。</span>
      </div>
    </section>
  );
}
