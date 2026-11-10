"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../../components/ui";
import { ImageViewer } from "./ImageViewer";
import { nodeImageUrl } from "./workflow-graph";
import type { WorkflowNode } from "./workflow-api";
import { useImagePlacement, type PlacementResult } from "./use-image-placement";
import styles from "./assistant-reference-viewer.module.css";

const noop = () => {};
export interface ReferencePlacementActions {
  canPlace: boolean;
  isPlaced: (nodeId: string) => boolean;
  prepare: (signal: AbortSignal) => Promise<{ x: number; y: number }>;
  apply: (result: PlacementResult, signal: AbortSignal) => Promise<void>;
  locate: (nodeId: string) => void;
}

export function AssistantReferenceViewer({
  node,
  projectId,
  actions,
  onClose,
}: {
  node: WorkflowNode;
  projectId: string;
  actions?: ReferencePlacementActions | undefined;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [placedHere, setPlacedHere] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true),
    lock = useRef(false),
    request = useRef<AbortController | null>(null);
  const placement = useImagePlacement(
    projectId,
    `assistant-reference-placement:${node.id}`,
    "place_reference_image",
    async (result, signal) => {
      if (!actions?.canPlace)
        throw new Error("当前白板不可编辑，请核对权限后继续。");
      await actions.apply(result, signal);
      if (active.current && !signal.aborted) setPlacedHere(true);
    },
    node.id,
  );
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  const placed = placedHere || Boolean(actions?.isPlaced(node.id));
  const place = async () => {
    if (lock.current || !actions?.canPlace || !placement.ready) return;
    lock.current = true;
    setPreparing(true);
    setError(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const position = await actions.prepare(controller.signal);
      controller.signal.throwIfAborted();
      if (!active.current) return;
      await placement.execute(
        placement.pending
          ? undefined
          : {
              title: node.title,
              command: {
                type: "place_reference_image",
                mutationId: crypto.randomUUID(),
                nodeId: node.id,
                position,
              },
            },
      );
    } catch (cause) {
      if (active.current && !controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "放入画布尚未完成，请重试。",
        );
    } finally {
      lock.current = false;
      if (request.current === controller) request.current = null;
      if (active.current) setPreparing(false);
    }
  };
  const url = nodeImageUrl(node);
  return (
    <Dialog
      open
      label="参考图片预览"
      className={styles.dialog}
      returnFocusSelector={`[data-reference-preview="${CSS.escape(node.id)}"]`}
      onClose={onClose}
    >
      <header className={styles.header}>
        <div>
          <h2>{node.title}</h2>
          <span>项目参考图片</span>
        </div>
        <Button variant="ghost" onClick={onClose}>
          关闭预览
        </Button>
      </header>
      <div className={styles.viewer}>
        {url ? (
          <ImageViewer
            url={url}
            title={node.title}
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
        ) : (
          <p role="alert">参考图片暂时无法读取。</p>
        )}
      </div>
      <footer className={styles.footer}>
        <div role="status">
          {placement.pending
            ? "上次放置尚未确认，继续会核对同一次操作。"
            : placed
              ? "已放入画布"
              : "已加入聊天参考"}
        </div>
        {error || placement.error ? (
          <p role="alert">{error ?? placement.error}</p>
        ) : null}
        <div className={styles.actions}>
          <Button onClick={() => setZoom(100)}>原始大小</Button>
          {!placement.ready && placement.error ? (
            <Button onClick={() => void placement.reload()}>
              重新读取放置记录
            </Button>
          ) : null}
          {actions?.canPlace && (placement.pending || !placed) ? (
            <Button
              variant="primary"
              disabled={!placement.ready || preparing || placement.busy}
              onClick={() => void place()}
            >
              {preparing || placement.busy
                ? "正在放入画布…"
                : placement.pending
                  ? "继续确认放置"
                  : "放入画布"}
            </Button>
          ) : null}
          {placed && actions ? (
            <Button
              onClick={() => {
                actions.locate(node.id);
                onClose();
              }}
            >
              在画布中查看
            </Button>
          ) : null}
        </div>
      </footer>
    </Dialog>
  );
}
