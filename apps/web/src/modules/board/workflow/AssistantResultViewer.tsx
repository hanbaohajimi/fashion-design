"use client";

import { useRef, useState } from "react";
import type { WorkflowResultImage } from "@fashion/shared";
import { Button, Dialog } from "../../../components/ui";
import { ImageViewer } from "./ImageViewer";
import { ImageComparison } from "./ImageComparison";
import { resultImageNode } from "./assistant-result-data";
import type { WorkflowGraph } from "./workflow-api";
import styles from "./assistant-reference-viewer.module.css";

const noop = () => {};
export function AssistantResultViewer({
  images,
  compare = false,
  graph,
  disabled,
  onClose,
  onOpen,
  onContinue,
  onOpenFiles,
}: {
  images: readonly WorkflowResultImage[];
  compare?: boolean;
  graph: WorkflowGraph;
  disabled: boolean;
  onClose: () => void;
  onOpen: (image: WorkflowResultImage) => void;
  onContinue: (image: WorkflowResultImage) => void;
  onOpenFiles?: (() => void) | undefined;
}) {
  const [comparison, setComparison] = useState(compare && images.length > 1);
  const [selected, setSelected] = useState(images[0]?.assetId);
  const [zoom, setZoom] = useState<number | null>(null);
  const [open, setOpen] = useState(true);
  const closingAction = useRef<(() => void) | null>(null);
  const image = images.find((image) => image.assetId === selected) ?? images[0];
  if (!image) return null;
  const node = resultImageNode(graph, image);
  const leave = (action: () => void) => {
    closingAction.current = action;
    setOpen(false);
  };
  return (
    <Dialog
      open={open}
      label="生成结果预览"
      className={styles.dialog}
      onClose={() => setOpen(false)}
      onAfterClose={() => {
        const action = closingAction.current;
        closingAction.current = null;
        onClose();
        action?.();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2>{comparison ? "比较本次结果" : image.title}</h2>
          <span>
            {images.length > 1 ? `本次 ${images.length} 张图片` : "生成图片"}
          </span>
        </div>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          关闭结果预览
        </Button>
      </header>
      <div className={styles.viewer}>
        {comparison ? (
          <ImageComparison
            current={{ id: image.assetId, title: image.title }}
            choices={images
              .filter((other) => other.assetId !== image.assetId)
              .map((other) => ({ id: other.assetId, title: other.title }))}
            compactHeader
            onClose={() => setComparison(false)}
            onOpen={(assetId) => {
              setSelected(assetId);
              setZoom(null);
              setComparison(false);
            }}
          />
        ) : (
          <ImageViewer
            key={image.assetId}
            url={`/api/design-assets/${encodeURIComponent(image.assetId)}/content`}
            title={image.title}
            zoom={zoom}
            onZoom={setZoom}
            onSize={noop}
            annotations={[]}
            comments={[]}
            mode="view"
            pen={{ kind: "pen", color: "#1d4d3b", width: 2, text: "" }}
            onAnnotation={noop}
            onPoint={noop}
          />
        )}
      </div>
      {!comparison ? (
        <footer className={styles.footer}>
          {!node ? (
            <div role="status">
              这张结果已移出当前画布，可以从项目生成文件中继续。
            </div>
          ) : null}
          <div className={styles.actions}>
            {images.length > 1 ? (
              <Button onClick={() => setComparison(true)}>比较本次结果</Button>
            ) : null}
            {node ? (
              <>
                <Button onClick={() => leave(() => onOpen(image))}>
                  打开图片编辑
                </Button>
                <Button
                  variant="primary"
                  disabled={disabled}
                  onClick={() => leave(() => onContinue(image))}
                >
                  引用后继续修改
                </Button>
              </>
            ) : onOpenFiles ? (
              <Button onClick={() => leave(onOpenFiles)}>
                打开项目生成文件
              </Button>
            ) : null}
          </div>
        </footer>
      ) : null}
    </Dialog>
  );
}
