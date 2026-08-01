"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useContext, useEffect, useState } from "react";
import { useEditor } from "tldraw";

import { useAuth } from "../auth/AuthProvider";
import { fetchProject } from "../projects/projects-api";
import { ErrorBoundary } from "../../observability/ErrorBoundary";
import { CollectionDrawer } from "./generation/CollectionDrawer";
import { collectionKeys, listCollections } from "./generation/collection-api";
import { BOARD_FILE_PICKER_EVENT, BoardProjectContext } from "./board-context";
import type { BoardPersistStatus } from "./hooks/useBoardPersist";
import { FRAME_SHAPE_TYPE, NOTE_SHAPE_TYPE, SWATCH_SHAPE_TYPE } from "./shapes";
import styles from "./board.module.css";

interface BoardToolbarProps {
  readonly status: BoardPersistStatus;
}

const STATUS_LABELS: Readonly<Record<BoardPersistStatus, string>> = {
  conflict: "版本冲突 · 待处理",
  error: "加载失败",
  loading: "正在加载",
  offline: "离线 · 待重试",
  ready: "已就绪",
  saved: "已保存",
  saving: "正在保存",
};

export function BoardToolbar({ status }: BoardToolbarProps) {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const auth = useAuth();
  const [projectName, setProjectName] = useState("设计项目");
  const [collectionId, setCollectionId] = useState("");
  const [collectionOpen, setCollectionOpen] = useState(false);
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

  useEffect(() => {
    let active = true;
    void fetchProject(projectId)
      .then((project) => {
        if (active) setProjectName(project.name);
      })
      .catch(() => {
        if (active) setProjectName("设计项目");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const createShape = (
    type:
      | typeof NOTE_SHAPE_TYPE
      | typeof SWATCH_SHAPE_TYPE
      | typeof FRAME_SHAPE_TYPE,
  ): void => {
    const center = editor.getViewportPageBounds().center;
    const sizes: Readonly<Record<typeof type, readonly [number, number]>> = {
      [FRAME_SHAPE_TYPE]: [760, 520],
      [NOTE_SHAPE_TYPE]: [260, 210],
      [SWATCH_SHAPE_TYPE]: [180, 180],
    };
    const [width, height] = sizes[type];

    editor.createShape({
      type,
      x: center.x - width / 2,
      y: center.y - height / 2,
    });
    const created = editor.getCurrentPageShapes().at(-1);
    if (created) {
      editor.select(created);
    }
  };

  return (
    <div className={styles.boardToolbar}>
      <div className={styles.boardIdentity}>
        <Link href="/" aria-label="返回项目库">
          ←
        </Link>
        <strong title={projectName}>{projectName}</strong>
        <span aria-live="polite" data-status={status} role="status">
          {STATUS_LABELS[status]}
        </span>
      </div>

      <div className={styles.shapeActions} aria-label="添加画布元素">
        <span
          className={styles.quotaPill}
          title={`本月已使用 ${auth.session?.credits.used ?? 0} 次`}
        >
          剩余 {auth.session?.credits.remaining ?? "—"}
        </span>
        <button
          onClick={() =>
            window.dispatchEvent(new Event(BOARD_FILE_PICKER_EVENT))
          }
          title="上传图片（也可拖入或粘贴）"
          type="button"
        >
          图片
        </button>
        <button
          onClick={() => createShape(NOTE_SHAPE_TYPE)}
          title="添加便签"
          type="button"
        >
          便签
        </button>
        <button
          onClick={() => createShape(SWATCH_SHAPE_TYPE)}
          title="添加色卡"
          type="button"
        >
          色卡
        </button>
        <button
          onClick={() => createShape(FRAME_SHAPE_TYPE)}
          title="添加组织画框"
          type="button"
        >
          画框
        </button>
        {collectionsQuery.isError ? (
          <button
            aria-label="重新加载系列"
            disabled={collectionsQuery.isFetching}
            onClick={() => void collectionsQuery.refetch()}
            type="button"
          >
            {collectionsQuery.isFetching ? "重试中…" : "重试系列"}
          </button>
        ) : null}
        <select
          aria-label="选择系列"
          disabled={collections.length === 0}
          onChange={(event) => setCollectionId(event.currentTarget.value)}
          value={selectedCollectionId}
        >
          {collections.length === 0 ? (
            <option value="">
              {collectionsQuery.isError
                ? "系列加载失败"
                : collectionsQuery.isPending
                  ? "系列加载中…"
                  : "暂无系列"}
            </option>
          ) : (
            collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))
          )}
        </select>
        <button
          disabled={!selectedCollectionId}
          onClick={() => setCollectionOpen(true)}
          title={
            selectedCollectionId
              ? "打开已保存系列"
              : "先将一个候选设为 Hero 建立系列"
          }
          type="button"
        >
          打开系列
        </button>
      </div>
      {collectionOpen && selectedCollectionId ? (
        <ErrorBoundary area="collection">
          <CollectionDrawer
            collectionId={selectedCollectionId}
            onClose={() => setCollectionOpen(false)}
          />
        </ErrorBoundary>
      ) : null}
    </div>
  );
}
