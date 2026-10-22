import styles from "./board.module.css";

export function BoardSkeleton() {
  return (
    <main className={styles.boardSkeleton} aria-label="正在加载画布">
      <div className={styles.skeletonTopbar} />
      <div className={styles.skeletonRail} />
      <div className={styles.skeletonCardOne} />
      <div className={styles.skeletonCardTwo} />
      <p role="status">正在加载设计画布…</p>
    </main>
  );
}
