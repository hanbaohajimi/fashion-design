"use client";

import { useEditor } from "tldraw";
import { BOARD_FILE_PICKER_EVENT } from "./board-context";
import { FRAME_SHAPE_TYPE, NOTE_SHAPE_TYPE, SWATCH_SHAPE_TYPE } from "./shapes";
import styles from "./tool-rail.module.css";

interface ToolRailProps {
  readonly onOpenFabrics: () => void;
}

export function ToolRail({ onOpenFabrics }: ToolRailProps) {
  const editor = useEditor();

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

  const setTool = (toolId: string): void => {
    editor.setCurrentTool(toolId);
  };

  const undo = (): void => {
    editor.undo();
  };

  const redo = (): void => {
    editor.redo();
  };

  return (
    <aside className={styles.toolRail} aria-label="工具条">
      <div className={styles.toolGroup}>
        <button
          className={styles.toolButton}
          onClick={() => setTool("select")}
          title="选择 (V)"
          type="button"
          aria-label="选择工具"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M4 3 L4 15 L9 11 L12 16 L14 15 L11 10 L16 10 Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </button>

        <button
          className={styles.toolButton}
          onClick={() => setTool("hand")}
          title="抓手 (H)"
          type="button"
          aria-label="抓手工具"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M7 10V6a1.5 1.5 0 013 0v4m0-3V5a1.5 1.5 0 013 0v5m0-2V6.5a1.5 1.5 0 013 0V12a5 5 0 01-10 0V9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>

      <div className={styles.toolDivider} />

      <div className={styles.toolGroup}>
        <button
          className={styles.toolButton}
          onClick={() =>
            window.dispatchEvent(new Event(BOARD_FILE_PICKER_EVENT))
          }
          title="上传图片"
          type="button"
          aria-label="上传图片"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect
              x="3"
              y="5"
              width="14"
              height="11"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="7" cy="9" r="1.5" fill="currentColor" />
            <path
              d="M3 13l4-4 3 3 4-5 3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          className={styles.toolButton}
          onClick={() => setTool("text")}
          title="文本"
          type="button"
          aria-label="文本工具"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 5h10M10 5v10M7 15h6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <button
          className={styles.toolButton}
          onClick={() => createShape(NOTE_SHAPE_TYPE)}
          title="便签"
          type="button"
          aria-label="添加便签"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect
              x="4"
              y="4"
              width="12"
              height="12"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M7 8h6M7 11h4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <button
          className={styles.toolButton}
          onClick={() => createShape(SWATCH_SHAPE_TYPE)}
          title="色卡"
          type="button"
          aria-label="添加色卡"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect
              x="4"
              y="4"
              width="12"
              height="12"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="10" cy="10" r="3" fill="currentColor" opacity="0.3" />
          </svg>
        </button>

        <button
          className={styles.toolButton}
          onClick={() => createShape(FRAME_SHAPE_TYPE)}
          title="Frame 组织框"
          type="button"
          aria-label="添加Frame"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect
              x="3"
              y="3"
              width="14"
              height="14"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          </svg>
        </button>

        <button
          className={styles.toolButton}
          onClick={onOpenFabrics}
          title="面料素材库"
          type="button"
          aria-label="打开面料库"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M4 6h12M4 10h12M4 14h12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M8 6v8M12 6v8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.4"
            />
          </svg>
        </button>
      </div>

      <div className={styles.toolDivider} />

      <div className={styles.toolGroup}>
        <button
          className={styles.toolButton}
          onClick={undo}
          title="撤销 (Ctrl+Z)"
          type="button"
          aria-label="撤销"
          disabled={!editor.getCanUndo()}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M7 8H3V4M3 8c0-3.5 2.5-6 6-6s6 2.5 6 6-2.5 6-6 6-4.5-1.5-5.5-3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          className={styles.toolButton}
          onClick={redo}
          title="重做 (Ctrl+Shift+Z)"
          type="button"
          aria-label="重做"
          disabled={!editor.getCanRedo()}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M13 8h4V4M17 8c0-3.5-2.5-6-6-6s-6 2.5-6 6 2.5 6 6 6 4.5-1.5 5.5-3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </aside>
  );
}
