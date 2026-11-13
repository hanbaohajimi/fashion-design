"use client";

import { useState } from "react";
import NumberFlow from "@number-flow/react";
import type {
  WorkflowExecutionResult,
  WorkflowResultImage,
} from "@fashion/shared";
import type { WorkflowGraph } from "./workflow-api";
import { resultImageNode } from "./assistant-result-data";
import styles from "./assistant-result-gallery.module.css";

/**
 * 生成结果画廊 —— v4 重构。
 *
 * 视觉升级：
 * - 缩略图 3:4 比例（服装图标准），object-fit cover（多图）/ contain（单图）
 * - hover 覆盖层：查看/继续修改/比较 三个圆形玻璃按钮
 * - ≥3 张变横向 scroll-snap 胶片条
 * - 触屏（hover:none）操作常显
 *
 * 测试锚点（accessible name 逐字保留）：
 * - "查看大图：{title}"（整张图按钮）
 * - "继续修改：{title}"（仅 resultImageNode 存在时）
 * - "比较本次结果"
 * - "重试缩略图：{title}"
 * - region 名 "本次图片结果"
 * - [data-execution-results] / [data-result-asset] 选择器
 */

function ResultThumbnail({
  image,
  onOpen,
}: {
  image: WorkflowResultImage;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  return (
    <div className={styles.thumbnail}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`查看大图：${image.title}`}
        className={styles.thumbButton}
      >
        <div className={styles.image} data-fail={failed ? "true" : undefined}>
          {failed ? (
            <span className={styles.failText}>缩略图暂不可用</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={reload}
              src={`/api/design-assets/${encodeURIComponent(image.assetId)}/thumbnail`}
              loading="lazy"
              decoding="async"
              alt={image.title}
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </button>
      {failed ? (
        <button
          className={styles.retry}
          type="button"
          onClick={() => {
            setFailed(false);
            setReload((value) => value + 1);
          }}
          aria-label={`重试缩略图：${image.title}`}
        >
          重新加载
        </button>
      ) : null}
    </div>
  );
}

export function AssistantResultGallery({
  result,
  graph,
  disabled,
  onOpen,
  onContinue,
  onCompare,
}: {
  result: WorkflowExecutionResult;
  graph: WorkflowGraph;
  disabled: boolean;
  onOpen: (image: WorkflowResultImage) => void;
  onContinue: (image: WorkflowResultImage) => void;
  onCompare: (images: readonly WorkflowResultImage[]) => void;
}) {
  const status =
    result.status === "completed"
      ? "本次结果"
      : result.status === "partial_failed"
        ? "已完成的部分结果"
        : result.status === "canceled"
          ? "执行已取消"
          : "执行未完成";
  if (!result.images.length) return null;

  const single = result.images.length === 1;
  const filmstrip = result.images.length >= 3;

  return (
    <section
      className={styles.root}
      aria-label="本次图片结果"
      data-execution-results={result.executionId}
    >
      <header className={styles.header}>
        <strong>{status}</strong>
        <span className={styles.count}><NumberFlow value={result.images.length} /> 张图片</span>
      </header>
      {result.attempts.failed || result.attempts.canceled ? (
        <p className={styles.outcome}>
          {result.attempts.failed
            ? `${result.attempts.failed} 项操作未完成`
            : ""}
          {result.attempts.failed && result.attempts.canceled ? "，" : ""}
          {result.attempts.canceled
            ? `${result.attempts.canceled} 项已取消`
            : ""}
        </p>
      ) : null}
      <div
        className={filmstrip ? styles.filmstrip : styles.grid}
        data-single={single ? "true" : undefined}
      >
        {result.images.map((image) => {
          const node = resultImageNode(graph, image);
          return (
            <article
              key={image.assetId}
              className={styles.card}
              data-result-asset={image.assetId}
            >
              <ResultThumbnail image={image} onOpen={() => onOpen(image)} />
              {/* hover 覆盖层操作 */}
              <div className={styles.overlay}>
                {node ? (
                  <button
                    className={styles.overlayBtn}
                    disabled={disabled}
                    type="button"
                    onClick={() => onContinue(image)}
                    aria-label={`继续修改：${image.title}`}
                    title="继续修改"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M2 11.5L8.5 5L10 6.5L3.5 13H2v-1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                      <path d="M9 4.5L10.5 3L12 4.5L10.5 6L9 4.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : (
                  <span className={styles.detached}>已移出当前画布，仍可查看</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {result.images.length > 1 ? (
        <button
          className={styles.compare}
          type="button"
          onClick={() => onCompare(result.images)}
        >
          比较本次结果
        </button>
      ) : null}
    </section>
  );
}
