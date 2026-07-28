import type { CSSProperties } from "react";

import type { CollectionConsistency } from "./collection-types";
import styles from "./generation.module.css";

export function ConsistencyOverview({
  consistency,
}: {
  readonly consistency: CollectionConsistency;
}) {
  const scores = new Map<string, number>();
  for (const pair of consistency.similarities) {
    scores.set(pairKey(pair.leftAssetId, pair.rightAssetId), pair.score);
  }

  return (
    <section className={styles.consistencyOverview}>
      <header>
        <div>
          <span>CLIP / PAIRWISE</span>
          <h2>一致性总览</h2>
        </div>
        <strong>{consistency.referenceLabel}</strong>
      </header>
      <p>
        数值来自 CLIP
        视觉特征的两两余弦相似度，仅用于发现重复与偏离，不能替代设计师判断。
      </p>

      {consistency.looks.length < 2 ? (
        <div className={styles.consistencyEmpty}>
          至少生成 1 个扩展 Look 后，才会形成两两参考相似度矩阵。
        </div>
      ) : (
        <div className={styles.heatmapScroll}>
          <table aria-label="系列 Look 参考相似度矩阵">
            <thead>
              <tr>
                <th scope="col">LOOK</th>
                {consistency.looks.map((look) => (
                  <th key={look.assetId} scope="col">
                    L{look.ordinal}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consistency.looks.map((row) => (
                <tr key={row.assetId}>
                  <th scope="row">LOOK {row.ordinal}</th>
                  {consistency.looks.map((column) => {
                    const diagonal = row.assetId === column.assetId;
                    const score = diagonal
                      ? 1
                      : scores.get(pairKey(row.assetId, column.assetId));
                    return (
                      <td
                        data-empty={score === undefined}
                        data-high={score !== undefined && score > 0.95}
                        data-low={score !== undefined && score < 0.5}
                        key={column.assetId}
                        style={
                          score === undefined
                            ? undefined
                            : ({
                                "--similarity-alpha": String(
                                  Math.max(0.08, Math.min(0.82, score)),
                                ),
                              } as CSSProperties)
                        }
                        title={
                          score === undefined
                            ? "参考相似度计算中"
                            : `Look ${row.ordinal} 与 Look ${column.ordinal}：${formatScore(score)}`
                        }
                      >
                        {score === undefined ? "—" : formatScore(score)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer>
        <span>
          <i data-tone="low" /> &lt; 0.50 偏离提示
        </span>
        <span>
          <i data-tone="balanced" /> 0.50–0.95 系列区间
        </span>
        <span>
          <i data-tone="high" /> &gt; 0.95 高度相似
        </span>
      </footer>
    </section>
  );
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join(":");
}

function formatScore(score: number): string {
  return score.toFixed(2);
}
