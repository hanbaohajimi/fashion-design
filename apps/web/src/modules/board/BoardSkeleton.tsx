import styles from "./board.module.css";

export function BoardSkeleton() {
  return (
    <main className={styles.boardSkeleton} aria-label="正在加载画布">
      <div className={styles.skeletonTopbar} />
      <div className={styles.skeletonRail} />
      <div className={styles.skeletonCardOne} />
      <div className={styles.skeletonCardTwo} />
      <p>正在重建画布与语义元素…</p>
    </main>
  );
}
