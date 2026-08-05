"use client";

import { useQuery } from "@tanstack/react-query";
import { useContext, useState } from "react";
import { useEditor, useValue } from "tldraw";

import { AtelierTopBar } from "./AtelierTopBar";
import { BoardProjectContext } from "./board-context";
import { CollectionDrawer } from "./generation/CollectionDrawer";
import { ExportModal } from "./generation/ExportModal";
import { useGenerationWorkspace } from "./generation/GenerationWorkspace";
import { collectionKeys, listCollections } from "./generation/collection-api";
import type { ExportSource } from "./generation/export-api";
import type { BoardPersistStatus } from "./hooks/useBoardPersist";
import { IMAGE_SHAPE_TYPE } from "./shapes";
import styles from "./atelier-topbar.module.css";

export function BoardActionPanels({
  status,
}: {
  readonly status: BoardPersistStatus;
}) {
  const projectId = useContext(BoardProjectContext);
  const editor = useEditor();
  const generation = useGenerationWorkspace();
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [collectionId, setCollectionId] = useState("");
  const [drawerCollectionId, setDrawerCollectionId] = useState<string | null>(
    null,
  );
  const [exportSource, setExportSource] = useState<ExportSource | null>(null);
  const collectionsQuery = useQuery({
    queryFn: () => listCollections(projectId),
    queryKey: collectionKeys.list(projectId),
    retry: false,
  });
  const collections = collectionsQuery.data ?? [];
  const selectedCollectionId = collections.some(
    (collection) => collection.id === collectionId,
  )
    ? collectionId
    : (collections[0]?.id ?? "");
  const latestCanvasAsset = useValue(
    "latest-adopted-generation-asset",
    () => {
      const shapes = editor.getCurrentPageShapes();
      for (let index = shapes.length - 1; index >= 0; index -= 1) {
        const shape = shapes[index];
        if (
          shape?.type === IMAGE_SHAPE_TYPE &&
          typeof shape.props.assetId === "string" &&
          shape.props.assetId.length > 0 &&
          !shape.props.assetId.includes(":") &&
          shape.props.url
        ) {
          return { assetId: shape.props.assetId, url: shape.props.url };
        }
      }
      return null;
    },
    [editor],
  );
  const latestCandidate = generation.tasks
    .flatMap((task) => task.candidates)
    .find((candidate) => !candidate.assetId.includes(":")) ?? latestCanvasAsset;

  return (
    <>
      <AtelierTopBar
        collectionOpen={collectionMenuOpen}
        exportOpen={exportMenuOpen}
        onOpenCollection={() => {
          setCollectionMenuOpen((current) => !current);
          setExportMenuOpen(false);
        }}
        onOpenExport={() => {
          setExportMenuOpen((current) => !current);
          setCollectionMenuOpen(false);
        }}
        status={status}
      />

      {collectionMenuOpen ? (
        <section
          aria-label="系列选择"
          className={styles.actionPopover}
          data-panel="collection"
        >
          <header>
            <span>COLLECTION</span>
            <strong>打开项目系列</strong>
          </header>
          {collectionsQuery.isError ? (
            <div className={styles.actionPopoverState} role="alert">
              <p>系列列表暂时无法读取。</p>
              <button
                aria-label="重新加载系列"
                disabled={collectionsQuery.isFetching}
                onClick={() => void collectionsQuery.refetch()}
                type="button"
              >
                {collectionsQuery.isFetching ? "重试中…" : "重试系列"}
              </button>
            </div>
          ) : (
            <div className={styles.actionPopoverBody}>
              <label>
                <span>项目系列</span>
                <select
                  aria-label="选择系列"
                  disabled={collections.length === 0}
                  onChange={(event) =>
                    setCollectionId(event.currentTarget.value)
                  }
                  value={selectedCollectionId}
                >
                  {collections.length === 0 ? (
                    <option value="">
                      {collectionsQuery.isPending ? "系列加载中…" : "暂无系列"}
                    </option>
                  ) : (
                    collections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                disabled={!selectedCollectionId}
                onClick={() => {
                  setDrawerCollectionId(selectedCollectionId);
                  setCollectionMenuOpen(false);
                }}
                type="button"
              >
                {selectedCollectionId ? "打开系列工作台" : "暂无可打开的系列"}
              </button>
            </div>
          )}
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
            <strong>导出最新生成结果</strong>
          </header>
          <div className={styles.actionPopoverState}>
            <p>
              {latestCandidate
                ? "已定位到最近生成的设计资产。"
                : "完成一次生成后，可从这里快速导出 PNG、JPG 或 PDF。"}
            </p>
            <button
              disabled={!latestCandidate}
              onClick={() => {
                if (!latestCandidate) return;
                setExportSource({
                  assetId: latestCandidate.assetId,
                  previewUrl: latestCandidate.url,
                  type: "asset",
                });
                setExportMenuOpen(false);
              }}
              type="button"
            >
              {latestCandidate ? "打开导出设置" : "暂无生成结果"}
            </button>
          </div>
        </section>
      ) : null}

      {drawerCollectionId ? (
        <CollectionDrawer
          collectionId={drawerCollectionId}
          onClose={() => setDrawerCollectionId(null)}
        />
      ) : null}
      {exportSource ? (
        <ExportModal
          onClose={() => setExportSource(null)}
          source={exportSource}
        />
      ) : null}
    </>
  );
}
