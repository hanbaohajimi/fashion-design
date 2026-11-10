"use client";

import { useEffect, useRef, useState } from "react";
import { Select } from "../../../components/ui";
import { ImageViewer } from "./ImageViewer";
import styles from "./image-comparison.module.css";

export interface ComparisonImage {
  readonly id: string;
  readonly title: string;
}
const noop = () => {};
const empty = { annotations: [], comments: [] };
const pen = { kind: "pen" as const, color: "#000000", width: 1, text: "" };

export function ImageComparison({
  current,
  choices,
  onClose,
  onOpen,
  onRestore,
  history: historyView = false,
  compactHeader = false,
  busy = false,
}: {
  readonly current: ComparisonImage;
  readonly choices: readonly ComparisonImage[];
  readonly onClose: () => void;
  readonly onOpen?: (assetId: string) => void;
  readonly onRestore?: (assetId: string) => void;
  readonly history?: boolean;
  readonly compactHeader?: boolean;
  readonly busy?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(choices[0]?.id);
  const selected =
    choices.find((choice) => choice.id === selectedId) ?? choices[0];
  const [zoom, setZoom] = useState<number | null>(null);
  const [side, setSide] = useState<"current" | "comparison">("comparison");
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);
  const history = historyView || Boolean(onRestore);

  return (
    <section
      className={styles.comparison}
      data-image-comparison
      aria-label={history ? "对比历史版本" : "比较方案"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onClose();
        }
      }}
    >
      <header className={styles.heading}>
        <button ref={back} disabled={busy} onClick={onClose} type="button">
          {history ? "返回版本历史" : "返回图片"}
        </button>
        {!compactHeader ? <h2>{history ? "对比历史版本" : "比较方案"}</h2> : null}
        <label className={styles.zoom}>
          缩放
          <Select
            compact
            aria-label="比较图片缩放"
            value={zoom === null ? "fit" : String(zoom)}
            onChange={(event) =>
              setZoom(
                event.target.value === "fit"
                  ? null
                  : Number(event.target.value),
              )
            }
          >
            <option value="fit">完整显示</option>
            {[50, 100, 200].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
            {zoom !== null && ![50, 100, 200].includes(zoom) ? (
              <option value={zoom}>{Math.round(zoom)}%</option>
            ) : null}
          </Select>
        </label>
      </header>
      <div className={styles.mobileTabs} role="group" aria-label="切换比较图片">
        <button
          aria-pressed={side === "current"}
          onClick={() => setSide("current")}
          type="button"
        >
          当前图
        </button>
        <button
          aria-pressed={side === "comparison"}
          onClick={() => setSide("comparison")}
          type="button"
        >
          {history ? "历史版本" : "对比图"}
        </button>
      </div>
      <div className={styles.panes}>
        {[
          { image: current, kind: "current" },
          { image: selected, kind: "comparison" },
        ].map(({ image, kind }) =>
          image ? (
            <section
              key={kind}
              className={styles.pane}
              data-mobile-active={kind === side}
              aria-label={kind === "current" ? "当前图片" : "对比图片"}
            >
              <div className={styles.identity}>
                <span>
                  {kind === "current"
                    ? "当前图"
                    : history
                      ? "历史版本"
                      : "对比图"}
                </span>
                {kind === "comparison" && choices.length > 1 ? (
                  <Select
                    compact
                    aria-label="选择对比图片"
                    disabled={busy}
                    value={image.id}
                    onChange={(event) => {
                      setSelectedId(event.target.value);
                      setZoom(null);
                    }}
                  >
                    {choices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.title}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <strong title={image.title}>{image.title}</strong>
                )}
              </div>
              <ImageViewer
                key={image.id}
                url={`/api/design-assets/${encodeURIComponent(image.id)}/content`}
                title={image.title}
                zoom={zoom}
                onZoom={setZoom}
                onSize={noop}
                {...empty}
                mode="view"
                pen={pen}
                onAnnotation={noop}
                onPoint={noop}
              />
              {(!history || onRestore || onOpen) && (kind === "current" || onRestore || onOpen) ? <footer className={styles.action}>
                {kind === "comparison" && onRestore ? (
                  <button
                    className={styles.primary}
                    disabled={busy}
                    onClick={() => onRestore(image.id)}
                    type="button"
                  >
                    {busy ? "正在恢复…" : "恢复为新版本"}
                  </button>
                ) : kind === "current" || onOpen ? (
                  <button
                    className={
                      kind === "comparison" ? styles.primary : undefined
                    }
                    disabled={busy}
                    onClick={() =>
                      kind === "current" ? onClose() : onOpen?.(image.id)
                    }
                    type="button"
                  >
                    {kind === "current"
                      ? history
                        ? onRestore ? "暂不恢复" : "返回版本历史"
                        : "继续编辑当前图"
                      : "继续编辑对比图"}
                  </button>
                ) : null}
              </footer> : null}
            </section>
          ) : null,
        )}
      </div>
      <p className={styles.hint}>
        {onRestore
          ? "恢复会新建一个版本，当前图和历史记录都会保留。"
          : "缩放同时应用于两张图片，放大后可分别拖动查看细节。"}
      </p>
    </section>
  );
}
