import styles from "./projects.module.css";

interface EmptyStateProps {
  readonly archived: boolean;
  readonly onClearSearch: () => void;
  readonly onCreate: () => void;
  readonly searching: boolean;
}

export function EmptyState({
  archived,
  onClearSearch,
  onCreate,
  searching,
}: EmptyStateProps) {
  if (searching) {
    return (
      <section className={styles.emptyState}>
        <span className={styles.emptyIndex}>00</span>
        <h2>没有找到相符的项目</h2>
        <p>换一个关键词，或者清空搜索后查看完整项目库。</p>
        <button
          className={styles.secondaryButton}
          onClick={onClearSearch}
          type="button"
        >
          清空搜索
        </button>
      </section>
    );
  }

  if (archived) {
    return (
      <section className={styles.emptyState}>
        <span className={styles.emptyIndex}>00</span>
        <p className={styles.emptyKicker}>ARCHIVE / CLEAR</p>
        <h2>这里还没有归档项目。</h2>
        <p>归档后的项目会保留在这里，并且可以随时恢复。</p>
      </section>
    );
  }

  return (
    <section className={styles.emptyState}>
      <span className={styles.emptyIndex}>01</span>
      <p className={styles.emptyKicker}>NEW COLLECTION / READY</p>
      <h2>从第一个系列开始</h2>
      <p>创建一个项目，把灵感、面料、草图与生成方案整理在同一张设计白板上。</p>
      <button
        className={styles.secondaryButton}
        onClick={onCreate}
        type="button"
      >
        创建第一个项目
      </button>
    </section>
  );
}
