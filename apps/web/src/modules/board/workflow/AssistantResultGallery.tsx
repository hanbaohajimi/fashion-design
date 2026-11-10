"use client";

import { useState } from "react";
import type {
  WorkflowExecutionResult,
  WorkflowResultImage,
} from "@fashion/shared";
import type { WorkflowGraph } from "./workflow-api";
import { resultImageNode } from "./assistant-result-data";
import styles from "./assistant-result-gallery.module.css";

function ResultThumbnail({
  image,
  onOpen,
}: {
  image: WorkflowResultImage;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false),
    [reload, setReload] = useState(0);
  return (
    <div className={styles.thumbnail}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`查看大图：${image.title}`}
      >
        <div className={styles.image}>
          {failed ? (
            <span>缩略图暂不可用</span>
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
        <strong title={image.title}>{image.title}</strong>
        <span className={styles.meta}>
          {image.width && image.height
            ? `${image.width} × ${image.height}`
            : "查看大图"}
        </span>
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
  return (
    <section
      className={styles.root}
      aria-label="本次图片结果"
      data-execution-results={result.executionId}
    >
      <header>
        <strong>{status}</strong>
        <span>{result.images.length} 张图片</span>
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
      <div className={styles.grid} data-single={result.images.length === 1}>
        {result.images.map((image) => (
          <article key={image.assetId} data-result-asset={image.assetId}>
            <ResultThumbnail image={image} onOpen={() => onOpen(image)} />
            {resultImageNode(graph, image) ? (
              <button
                className={styles.continue}
                disabled={disabled}
                type="button"
                onClick={() => onContinue(image)}
                aria-label={`继续修改：${image.title}`}
              >
                继续修改
              </button>
            ) : (
              <span className={styles.detached}>已移出当前画布，仍可查看</span>
            )}
          </article>
        ))}
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
