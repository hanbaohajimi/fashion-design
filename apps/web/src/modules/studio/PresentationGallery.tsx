"use client";

import { Button, ImagePreview } from "../../components/ui";
import { PicturePreview, type PreviewPicture } from "../../components/interactions/picture-preview";
import type { StudioAsset } from "./studio-ui";
import styles from "./presentation-sets.module.css";

export function PresentationGallery({
  assets,
  items,
  assetName,
  disabled,
  onPreview,
  onToggle,
}: {
  readonly assets: readonly StudioAsset[];
  readonly items: readonly { assetId: string; reviewed: boolean }[];
  readonly assetName: (id: string) => string;
  readonly disabled: boolean;
  readonly onPreview: (id: string, source?: HTMLElement, keyboard?: boolean) => void;
  readonly onToggle: (id: string) => void;
}) {
  if (!assets.length)
    return (
      <div className={styles.empty}>
        <h3>还没有可用图片</h3>
        <p>先从任务入口上传草图或在设计工作台生成候选，再来整理展示内容。</p>
      </div>
    );
  return (
    <div className={styles.gallery}>
      {assets.map((asset, index) => {
        const order = items.findIndex((item) => item.assetId === asset.id);
        const selected = order >= 0;
        const atLimit = !selected && items.length >= 12;
        return (
          <article
            className={styles.assetCard}
            key={asset.id}
            data-selected={selected || undefined}
          >
            <button
              type="button"
              className={styles.imageButton}
              data-picture-source={asset.id}
              aria-label={`查看大图：${assetName(asset.id)}`}
              onClick={(event) => onPreview(asset.id, event.currentTarget, event.detail === 0)}
            >
              <ImagePreview
                retryable={false}
                src={asset.thumbnailUrl ?? asset.url}
                alt={assetName(asset.id)}
              />
              <span className={styles.viewLabel}>查看大图</span>
            </button>
            <div className={styles.assetCaption}>
              <strong title={assetName(asset.id)}>{assetName(asset.id)}</strong>
              <span className={styles.assetId}>
                素材 ID · {asset.id.slice(-8)}
              </span>
              <div className={styles.cardActions}>
                <Button
                  aria-label={`选择图片 ${index + 1}`}
                  aria-pressed={selected}
                  disabled={disabled || atLimit}
                  onClick={() => onToggle(asset.id)}
                >
                  {selected
                    ? `已选入 · 第 ${order + 1} 张`
                    : atLimit
                      ? "已达 12 张上限"
                      : "选入展示包"}
                </Button>
                {selected ? (
                  <span>{items[order]?.reviewed ? "已核对" : "待核对"}</span>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function PresentationPreview({
  name,
  src,
  onClose,
  pictures,
  initialIndex = 0,
  sourceElement,
  getSourceElement,
  keyboardOpened = false,
}: {
  readonly name: string;
  readonly src: string | undefined;
  readonly onClose: () => void;
  readonly pictures?: readonly PreviewPicture[];
  readonly initialIndex?: number;
  readonly sourceElement?: HTMLElement | null;
  readonly getSourceElement?: (id: string) => HTMLElement | null;
  readonly keyboardOpened?: boolean;
}) {
  return <PicturePreview pictures={pictures ?? [{ id: src ?? name, src, name }]} initialIndex={initialIndex} sourceElement={sourceElement} getSourceElement={getSourceElement} keyboardOpened={keyboardOpened} onClose={onClose} />;
}
