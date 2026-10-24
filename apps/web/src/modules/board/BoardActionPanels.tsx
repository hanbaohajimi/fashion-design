"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditor, useValue } from "tldraw";

import { ErrorBoundary } from "../../observability/ErrorBoundary";
import { AtelierTopBar } from "./AtelierTopBar";
import { BoardProjectContext } from "./board-context";
import { CollectionDrawer } from "./generation/CollectionDrawer";
import {
  collectionKeys,
  createCollection,
  importDesignAsset,
  listCollections,
} from "./generation/collection-api";
import type { CollectionDetail } from "./generation/collection-types";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  validateImage,
  waitForThumbnail,
} from "./file-upload-api";
import type { BoardPersistStatus } from "./hooks/useBoardPersist";
import { IMAGE_SHAPE_TYPE, type ImageShape } from "./shapes";
import styles from "./atelier-topbar.module.css";

type CollectionAction = "creating" | "importing" | "idle" | "uploading";

export function BoardActionPanels({
  collectionLauncherOpen,
  exportMenuOpen,
  onCollectionLauncherOpenChange,
  onExportMenuOpenChange,
  status,
}: {
  readonly collectionLauncherOpen: boolean;
  readonly exportMenuOpen: boolean;
  readonly onCollectionLauncherOpenChange: (open: boolean) => void;
  readonly onExportMenuOpenChange: (open: boolean) => void;
  readonly status: BoardPersistStatus;
}) {
  const projectId = useContext(BoardProjectContext);
  const editor = useEditor();
  const queryClient = useQueryClient();
  const [collectionAction, setCollectionAction] =
    useState<CollectionAction>("idle");
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [drawerCollectionId, setDrawerCollectionId] = useState<string | null>(
    null,
  );
  const [exportingCanvas, setExportingCanvas] = useState(false);
  const collectionFileInput = useRef<HTMLInputElement>(null);
  const collectionsQuery = useQuery({
    queryFn: () => listCollections(projectId),
    queryKey: collectionKeys.list(projectId),
    retry: false,
  });
  const collections = collectionsQuery.data ?? [];
  const selectedImageState = useValue(
    "collection-selected-image",
    () => {
      const shapes = editor.getSelectedShapes();
      const selected = shapes[0];
      if (shapes.length !== 1 || selected?.type !== IMAGE_SHAPE_TYPE) {
        return { count: shapes.length, image: null };
      }
      return {
        count: 1,
        image: {
          assetId:
            typeof selected.props.assetId === "string"
              ? selected.props.assetId
              : "",
          fileId:
            typeof selected.props.fileId === "string"
              ? selected.props.fileId
              : "",
          shapeId: selected.id,
          title: selected.props.title || "画布图片",
          uploadStatus: selected.props.uploadStatus ?? "ready",
          url: selected.props.url,
        },
      };
    },
    [editor],
  );
  const canvasShapeCount = useValue(
    "canvas-export-shape-count",
    () => editor.getCurrentPageShapes().length,
    [editor],
  );
  const selectedImage = selectedImageState.image;
  const selectedAssetReady = Boolean(
    selectedImage &&
    ((selectedImage.assetId && !selectedImage.assetId.includes(":")) ||
      (selectedImage.fileId && selectedImage.uploadStatus === "ready")),
  );
  const busy = collectionAction !== "idle";

  const exportEntireCanvas = async (): Promise<void> => {
    if (exportingCanvas) return;
    const shapeIds = editor.getCurrentPageShapes().map((shape) => shape.id);
    if (shapeIds.length === 0) {
      toast.error("画布为空", {
        description: "请先添加内容后再导出",
      });
      return;
    }

    setExportingCanvas(true);
    try {
      const rendered = await editor.toImage(shapeIds, {
        background: true,
        format: "png",
        padding: 64,
        pixelRatio: 2,
      });
      if (!rendered.blob.size) throw new Error("画布渲染结果为空");

      const downloadUrl = URL.createObjectURL(rendered.blob);
      const link = document.createElement("a");
      link.download = `fashion-canvas-${projectId}.png`;
      link.href = downloadUrl;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      onExportMenuOpenChange(false);
    } catch (error) {
      toast.error("导出失败", {
        description: error instanceof Error ? error.message : "画布导出失败，请稍后重试",
      });
    } finally {
      setExportingCanvas(false);
    }
  };

  useEffect(() => {
    if (!collectionLauncherOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        !target.closest('[data-panel="collection-launcher"]') &&
        !target.closest('[data-tool="collection"]')
      ) {
        onCollectionLauncherOpenChange(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCollectionLauncherOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [collectionLauncherOpen, onCollectionLauncherOpenChange]);

  const rememberCollection = (collection: CollectionDetail): void => {
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
  };

  const createAndOpenCollection = async (assetId: string): Promise<void> => {
    setCollectionAction("creating");
    const collection = await createCollection(assetId);
    rememberCollection(collection);
    setDrawerCollectionId(collection.id);
    onCollectionLauncherOpenChange(false);
  };

  const createFromSelectedImage = async (): Promise<void> => {
    if (!selectedImage || !selectedAssetReady || busy) return;
    setCollectionError(null);
    try {
      let assetId = selectedImage.assetId;
      if (!assetId || assetId.includes(":")) {
        setCollectionAction("importing");
        const imported = await importDesignAsset(
          projectId,
          selectedImage.fileId,
        );
        assetId = imported.id;
        const shape = editor.getShape<ImageShape>(selectedImage.shapeId);
        if (shape?.type === IMAGE_SHAPE_TYPE) {
          editor.updateShape<ImageShape>({
            id: shape.id,
            type: IMAGE_SHAPE_TYPE,
            props: { ...shape.props, assetId },
          });
        }
      }
      await createAndOpenCollection(assetId);
    } catch (error) {
      setCollectionError(
        error instanceof Error ? error.message : "系列创建失败，请稍后重试",
      );
    } finally {
      setCollectionAction("idle");
    }
  };

  const uploadCollectionHero = async (file: File): Promise<void> => {
    if (busy) return;
    const validationError = validateImage(file);
    if (validationError) {
      setCollectionError(validationError);
      return;
    }
    setCollectionError(null);
    setCollectionAction("uploading");
    try {
      const signed = await signImageUpload(projectId, file);
      const processing = signed.upload
        ? await putOriginal(signed.upload, file).then(() =>
            completeUpload(signed.file.id),
          )
        : signed.file;
      const ready = await waitForThumbnail(signed.file.id, processing);
      setCollectionAction("importing");
      const imported = await importDesignAsset(projectId, ready.id);
      await createAndOpenCollection(imported.id);
    } catch (error) {
      setCollectionError(
        error instanceof Error ? error.message : "核心图片上传失败，请稍后重试",
      );
    } finally {
      setCollectionAction("idle");
    }
  };

  const selectionHint = selectedImage
    ? selectedImage.uploadStatus === "ready"
      ? selectedImage.title
      : "图片仍在处理中"
    : selectedImageState.count > 1
      ? "请只选择一张图片"
      : "先在画布中选择一张图片";
  const actionLabel = {
    creating: "正在提取系列 DNA…",
    idle: "",
    importing: "正在准备核心资产…",
    uploading: "正在上传并生成缩略图…",
  }[collectionAction];

  return (
    <>
      <AtelierTopBar
        exportOpen={exportMenuOpen}
        onOpenExport={() => {
          onExportMenuOpenChange(!exportMenuOpen);
          onCollectionLauncherOpenChange(false);
        }}
        status={status}
      />

      {collectionLauncherOpen ? (
        <section
          aria-busy={busy}
          aria-label="系列工作台入口"
          className={`${styles.actionPopover} ${styles.collectionLauncher}`}
          data-panel="collection-launcher"
        >
            <header>
              <div>
                <span>COLLECTION / INDEX</span>
                <strong>系列库</strong>
              </div>
            <button
              aria-label="关闭系列入口"
              className={styles.collectionLauncherClose}
              onClick={() => onCollectionLauncherOpenChange(false)}
              type="button"
            >
              ×
            </button>
          </header>
          <div className={styles.collectionLauncherBody}>
            <span className={styles.collectionSectionLabel}>建立新系列</span>
            <div className={styles.collectionSourceGrid}>
              <button
                className={styles.collectionSourceButton}
                disabled={!selectedAssetReady || busy}
                onClick={() => void createFromSelectedImage()}
                type="button"
              >
                <span className={styles.collectionSourcePreview}>
                  {selectedImage?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={selectedImage.title} src={selectedImage.url} />
                  ) : (
                    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                      <path d="M4 5h16v14H4zM7 15l3-3 2 2 3-4 2 3" />
                    </svg>
                  )}
                </span>
                <span>
                  <strong>使用画布选中图</strong>
                  <small title={selectionHint}>{selectionHint}</small>
                </span>
              </button>
              <button
                className={styles.collectionSourceButton}
                disabled={busy}
                onClick={() => collectionFileInput.current?.click()}
                type="button"
              >
                <span className={styles.collectionSourcePreview}>
                  <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                    <path d="M12 16V4m0 0L8 8m4-4 4 4M5 14v5h14v-5" />
                  </svg>
                </span>
                <span>
                  <strong>上传核心图</strong>
                  <small>JPG、PNG、WebP 或 HEIC</small>
                </span>
              </button>
            </div>
            <input
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void uploadCollectionHero(file);
              }}
              ref={collectionFileInput}
              type="file"
            />

            {actionLabel ? (
              <p className={styles.collectionProgress} role="status">
                <i />
                {actionLabel}
              </p>
            ) : null}
            {collectionError ? (
              <p className={styles.collectionLauncherError} role="alert">
                {collectionError}
              </p>
            ) : null}

            <div className={styles.collectionExisting}>
              <div className={styles.collectionLibraryHeading}>
                <span className={styles.collectionSectionLabel}>系列库</span>
                <strong>{collections.length}</strong>
              </div>
              {collectionsQuery.isError ? (
                <div className={styles.collectionListError} role="alert">
                  <span>系列列表暂时无法读取</span>
                  <button
                    disabled={collectionsQuery.isFetching}
                    onClick={() => void collectionsQuery.refetch()}
                    type="button"
                  >
                    {collectionsQuery.isFetching ? "重试中…" : "重试"}
                  </button>
                </div>
              ) : collectionsQuery.isPending ? (
                <div
                  aria-label="正在加载系列"
                  className={styles.collectionListSkeleton}
                  role="status"
                >
                  {Array.from({ length: 3 }, (_, index) => (
                    <i key={index} />
                  ))}
                </div>
              ) : collections.length === 0 ? (
                <div className={styles.collectionEmpty}>
                  <span>0 / COLLECTIONS</span>
                  <strong>暂无系列</strong>
                </div>
              ) : (
                <ul aria-label="系列列表" className={styles.collectionList}>
                  {collections.map((collection) => (
                    <li key={collection.id}>
                      <button
                        aria-label={`打开系列 ${collection.name}`}
                        className={styles.collectionEntry}
                        disabled={busy}
                        onClick={() => {
                          setDrawerCollectionId(collection.id);
                          onCollectionLauncherOpenChange(false);
                        }}
                        type="button"
                      >
                        <span className={styles.collectionEntryHero}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt={`${collection.name} Hero`}
                            src={
                              collection.hero.thumbnailUrl ??
                              collection.hero.url
                            }
                          />
                        </span>
                        <span className={styles.collectionEntryContent}>
                          <strong>{collection.name}</strong>
                          <span className={styles.collectionEntryMeta}>
                            <b>
                              {collection.sourceGarmentType?.label ??
                                "类型未指定"}
                            </b>
                            <small>
                              更新 {formatCollectionDate(collection.updatedAt)}
                            </small>
                          </span>
                          <span
                            className={styles.collectionEntryStatus}
                            data-status={collection.dna.extractionStatus}
                          >
                            <i />
                            {collection.dna.extractionStatus === "ready"
                              ? "DNA 已就绪"
                              : "DNA 待完善"}
                          </span>
                        </span>
                        <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
                          <path d="M3 8h9m-4-4 4 4-4 4" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {exportMenuOpen ? (
        <section
          aria-label="导出选项"
          className={styles.actionPopover}
          data-panel="export"
        >
          <header>
            <span>EXPORT</span>
            <strong>导出整个画布</strong>
          </header>
          <div className={styles.actionPopoverState}>
            <p>
              {canvasShapeCount > 0
                ? `将画布中的全部 ${canvasShapeCount} 个元素导出为高清 PNG。`
                : "画布为空，请先添加图片、草图或其他设计元素。"}
            </p>
            <button
              disabled={canvasShapeCount === 0 || exportingCanvas}
              onClick={() => void exportEntireCanvas()}
              type="button"
            >
              {exportingCanvas
                ? "正在导出…"
                : canvasShapeCount > 0
                  ? "下载整个画布"
                  : "画布暂无内容"}
            </button>
          </div>
        </section>
      ) : null}

      {drawerCollectionId ? (
        <ErrorBoundary area="collection">
          <CollectionDrawer
            collectionId={drawerCollectionId}
            onClose={() => setDrawerCollectionId(null)}
          />
        </ErrorBoundary>
      ) : null}
    </>
  );
}

function formatCollectionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
  })
    .format(date)
    .replaceAll("/", ".");
}
