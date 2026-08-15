"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { BoardProjectContext } from "../board-context";
import { collectionKeys, createCollection } from "./collection-api";
import type { CollectionDetail } from "./collection-types";
import { CollectionDrawer } from "./CollectionDrawer";
import { ExportModal } from "./ExportModal";
import { InpaintPanel } from "./InpaintPanel";
import type { GenerationCandidate } from "./generation-types";
import { hasToneMismatch } from "./tone-analysis";
import { VariationControl } from "./VariationControl";
import { VersionTimeline } from "./VersionTimeline";
import styles from "./generation.module.css";
import { captureAnalytics } from "../../../observability/analytics";
import { ErrorBoundary } from "../../../observability/ErrorBoundary";

export function CandidateLightbox({
  candidate,
  initialMode,
  onTaskCreated,
  onClose,
  onDiscard,
}: {
  readonly candidate: GenerationCandidate;
  readonly initialMode: "view" | "inpaint";
  readonly onTaskCreated?: (
    taskId: string,
    prompt: string,
  ) => Promise<void> | void;
  readonly onClose: () => void;
  readonly onDiscard?: () => void;
}) {
  const projectId = useContext(BoardProjectContext);
  const queryClient = useQueryClient();
  const [activeCandidate, setActiveCandidate] = useState(candidate);
  const [mode, setMode] = useState<"history" | "inpaint" | "view">(initialMode);
  const [toneWarning, setToneWarning] = useState(false);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const collectionTriggerRef = useRef<HTMLButtonElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => {
        if (
          previouslyFocused?.isConnected &&
          !previouslyFocused.closest("[inert]")
        ) {
          previouslyFocused.focus();
        }
      });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (collectionOpen || exportOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        trapFocus(event, dialogRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [collectionOpen, exportOpen, onClose]);

  const openCollection = async (): Promise<void> => {
    if (collectionId) {
      setCollectionOpen(true);
      return;
    }
    setCreatingCollection(true);
    setCollectionError(null);
    try {
      const collection = await createCollection(activeCandidate.assetId);
      captureAnalytics("collection_created", {});
      queryClient.setQueryData<readonly CollectionDetail[]>(
        collectionKeys.list(projectId),
        (current) =>
          current?.some((item) => item.id === collection.id)
            ? current
            : [collection, ...(current ?? [])],
      );
      void queryClient.invalidateQueries({
        queryKey: collectionKeys.list(projectId),
      });
      setCollectionId(collection.id);
      setCollectionOpen(true);
    } catch (error) {
      setCollectionError(
        error instanceof Error ? error.message : "系列创建失败，请稍后重试",
      );
    } finally {
      setCreatingCollection(false);
    }
  };

  const closeCollection = (): void => {
    setCollectionOpen(false);
    window.requestAnimationFrame(() => collectionTriggerRef.current?.focus());
  };

  const closeExport = (): void => {
    setExportOpen(false);
    window.requestAnimationFrame(() => exportTriggerRef.current?.focus());
  };

  useEffect(() => {
    let disposed = false;
    if (activeCandidate.taskType === "inpaint" && activeCandidate.sourceUrl) {
      void hasToneMismatch(activeCandidate.sourceUrl, activeCandidate.url).then(
        (mismatch) => {
          if (!disposed) setToneWarning(mismatch === true);
        },
      );
    }
    return () => {
      disposed = true;
    };
  }, [activeCandidate]);

  return createPortal(
    <div
      className={styles.lightboxBackdrop}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !collectionOpen) onClose();
      }}
    >
      <section
        aria-label="候选设计详情"
        aria-modal="true"
        className={styles.lightbox}
        inert={collectionOpen || exportOpen ? true : undefined}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <span>{mode === "inpaint" ? "LOCAL EDIT" : "LIGHTBOX / EDIT"}</span>
            <strong>
              {mode === "inpaint"
                ? "局部编辑模式"
                : mode === "history"
                  ? "版本与血缘"
                  : "候选设计"}
            </strong>
          </div>
          <nav aria-label={mode === "inpaint" ? "局部编辑操作" : "候选操作"}>
            {mode !== "inpaint" ? (
              <>
                <button onClick={() => setMode("view")} type="button">
                  预览
                </button>
                <button onClick={() => setMode("inpaint")} type="button">
                  局部重绘
                </button>
                <button onClick={() => setMode("history")} type="button">
                  版本
                </button>
                <button
                  disabled={creatingCollection}
                  onClick={() => void openCollection()}
                  ref={collectionTriggerRef}
                  type="button"
                >
                  {creatingCollection
                    ? "提取 DNA…"
                    : collectionId
                      ? "打开系列 DNA"
                      : "设为 Hero → 建系列"}
                </button>
                <button
                  onClick={() => setExportOpen(true)}
                  ref={exportTriggerRef}
                  type="button"
                >
                  导出
                </button>
                {onDiscard ? (
                  <button onClick={onDiscard} type="button">
                    丢弃
                  </button>
                ) : null}
              </>
            ) : null}
            <button aria-label="关闭候选详情" onClick={onClose} type="button">
              关闭
            </button>
          </nav>
        </header>
        {toneWarning ? (
          <p className={styles.toneWarning} role="status">
            局部结果与原图平均色调差异较大，建议降低强度或重新生成。
          </p>
        ) : null}
        {collectionError ? (
          <p className={styles.toneWarning} role="alert">
            {collectionError}
          </p>
        ) : null}
        {mode === "inpaint" ? (
          <InpaintPanel
            candidate={activeCandidate}
            onSubmitted={async (taskId, prompt) => {
              await onTaskCreated?.(taskId, prompt);
              onClose();
            }}
          />
        ) : mode === "history" ? (
          <VersionTimeline
            assetId={activeCandidate.assetId}
            onRestore={(asset) => {
              setCollectionId(null);
              setCollectionOpen(false);
              setCollectionError(null);
              setActiveCandidate((current) => ({
                ...current,
                assetId: asset.id,
                url: asset.url,
                ...(asset.height === null ? {} : { height: asset.height }),
                ...(asset.seed === null ? {} : { seed: asset.seed }),
                ...(asset.width === null ? {} : { width: asset.width }),
              }));
            }}
          />
        ) : (
          <div className={styles.lightboxPreview}>
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="候选设计大图" src={activeCandidate.url} />
            </figure>
            <VariationControl candidate={activeCandidate} />
          </div>
        )}
      </section>
      {collectionOpen && collectionId ? (
        <ErrorBoundary area="collection">
          <CollectionDrawer
            collectionId={collectionId}
            onClose={closeCollection}
          />
        </ErrorBoundary>
      ) : null}
      {exportOpen ? (
        <ExportModal
          onClose={closeExport}
          source={{
            assetId: activeCandidate.assetId,
            previewUrl: activeCandidate.url,
            type: "asset",
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "summary",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.closest("[inert]") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0,
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    container.focus();
    return;
  }
  if (document.activeElement === container) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!container.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
