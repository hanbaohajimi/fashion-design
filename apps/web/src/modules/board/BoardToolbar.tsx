"use client";

import Link from "next/link";
import { useEditor } from "tldraw";

import type { BoardPersistStatus } from "./hooks/useBoardPersist";
import {
  FRAME_SHAPE_TYPE,
  IMAGE_SHAPE_TYPE,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
} from "./shapes";
import styles from "./board.module.css";

interface BoardToolbarProps {
  readonly status: BoardPersistStatus;
}

const STATUS_LABELS: Readonly<Record<BoardPersistStatus, string>> = {
  error: "加载失败",
  loading: "正在加载",
  offline: "离线 · 待重试",
  ready: "已就绪",
  saved: "已保存",
  saving: "正在保存",
};

export function BoardToolbar({ status }: BoardToolbarProps) {
  const editor = useEditor();
  const createShape = (
    type:
      | typeof IMAGE_SHAPE_TYPE
      | typeof NOTE_SHAPE_TYPE
      | typeof SWATCH_SHAPE_TYPE
      | typeof FRAME_SHAPE_TYPE,
  ): void => {
    const center = editor.getViewportPageBounds().center;
    const sizes: Readonly<Record<typeof type, readonly [number, number]>> = {
      [FRAME_SHAPE_TYPE]: [760, 520],
      [IMAGE_SHAPE_TYPE]: [340, 260],
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
        <strong>BOARD / 01</strong>
        <span data-status={status}>{STATUS_LABELS[status]}</span>
      </div>

      <div className={styles.shapeActions} aria-label="添加画布元素">
        <button onClick={() => createShape(IMAGE_SHAPE_TYPE)} type="button">
          图片
        </button>
        <button onClick={() => createShape(NOTE_SHAPE_TYPE)} type="button">
          便签
        </button>
        <button onClick={() => createShape(SWATCH_SHAPE_TYPE)} type="button">
          色卡
        </button>
        <button onClick={() => createShape(FRAME_SHAPE_TYPE)} type="button">
          画框
        </button>
      </div>
    </div>
  );
}
