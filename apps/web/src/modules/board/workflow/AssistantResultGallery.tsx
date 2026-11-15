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
import { AssistantIconButton } from "./AssistantIconButton";
import { Button, Menu } from "../../../components/ui";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { imageDisplayTitle } from "./assistant-transcript";

/**
 * 生成结果画廊，共用准确的资产与执行身份。
 *
 * 视觉升级：
 * - 缩略图保持原始比例、完整contain，并限制预览大小
 * - 任务消息以查看画布为主，旧确认区保留已有操作入口
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
        <div className={styles.image} style={{ aspectRatio: `${image.width ?? 3} / ${image.height ?? 4}` }} data-fail={failed ? "true" : undefined}>
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
  onLocate,
  showHeader = true,
}: {
  result: WorkflowExecutionResult;
  graph: WorkflowGraph;
  disabled: boolean;
  onOpen: (image: WorkflowResultImage) => void;
  onContinue: (image: WorkflowResultImage) => void;
  onCompare: (images: readonly WorkflowResultImage[]) => void;
  onLocate?: ((image: WorkflowResultImage) => void) | undefined;
  showHeader?: boolean;
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
      {showHeader ? <header className={styles.header}>
        <strong>{status}</strong>
        <span className={styles.count}><NumberFlow value={result.images.length} /> 张图片</span>
        {result.images.length > 1 ? <AssistantIconButton label="比较本次结果" icon="compare" onClick={() => onCompare(result.images)} /> : null}
      </header> : result.images.length > 1 ? <div className={styles.header}><AssistantIconButton label="比较本次结果" icon="compare" onClick={() => onCompare(result.images)} /></div> : null}
      {showHeader && (result.attempts.failed || result.attempts.canceled) ? (
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
        {result.images.map((original) => {
          const image = { ...original, title: imageDisplayTitle(original.title) };
          const node = resultImageNode(graph, image);
          return (
            <article
              key={image.assetId}
              className={styles.card}
              data-result-asset={image.assetId}
            >
              <ResultThumbnail image={image} onOpen={() => onOpen(image)} />
              {onLocate ? <div className={styles.resultActions}>
                {node ? <button type="button" className={styles.locate} onClick={() => onLocate(image)}>查看画布</button> : <span className={styles.detached}>已移出画布，仍可查看</span>}
                <Menu label={`更多图片操作：${image.title}`} trigger={<WorkspaceIcon name="more" />} align="end">
                  <Button onClick={() => onOpen(image)}>放大查看</Button>
                  {node ? <Button disabled={disabled} onClick={() => onContinue(image)} aria-label={`继续修改：${image.title}`}>继续修改</Button> : null}
                </Menu>
              </div> : <div className={styles.overlay}>
                <AssistantIconButton className={styles.overlayBtn} label={`放大查看：${image.title}`} icon="expand" onClick={() => onOpen(image)} />
                {node ? (
                  <AssistantIconButton
                    className={styles.overlayBtn}
                    disabled={disabled}
                    onClick={() => onContinue(image)}
                    label={`继续修改：${image.title}`}
                    icon="annotate"
                  />
                ) : (
                  <span className={styles.detached}>已移出当前画布，仍可查看</span>
                )}
              </div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
