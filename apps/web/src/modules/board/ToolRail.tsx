"use client";

import { GeoShapeGeoStyle, useEditor, useValue } from "tldraw";
import { useState } from "react";
import { BOARD_FILE_PICKER_EVENT } from "./board-context";
import { FRAME_SHAPE_TYPE, NOTE_SHAPE_TYPE, SWATCH_HEIGHT, SWATCH_SHAPE_TYPE, computeSwatchWidth } from "./shapes";
import { MOUNT_CATALOG } from "./shapes/material-appearance";
import { setActiveMountVariant, getActiveMountVariant } from "./tools/MountTool";
import styles from "./tool-rail.module.css";

interface ToolRailProps {
  readonly onOpenFabrics: () => void;
}

// ─── Mount variant mini-icons (pure SVG, no emoji) ───────────────────────────

function IconPin() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5.5" r="3.2" stroke="currentColor" strokeWidth="1.3" fill="currentColor" fillOpacity="0.12" />
      <circle cx="8" cy="5.5" r="1.4" fill="currentColor" />
      <line x1="8" y1="8.7" x2="8" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5.5" y1="9.5" x2="10.5" y2="9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconTapeRoll() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.1" />
      <line x1="10" y1="2.6" x2="14" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function ToolRail({ onOpenFabrics }: ToolRailProps) {
  const editor = useEditor();
  const currentToolId = useValue("tool-rail-current-tool", () => editor.getCurrentToolId(), [editor]);
  const [activeVariant, setActiveVariantLocal] = useState(getActiveMountVariant());

  const createShape = (type: typeof NOTE_SHAPE_TYPE | typeof SWATCH_SHAPE_TYPE | typeof FRAME_SHAPE_TYPE): void => {
    const center = editor.getViewportPageBounds().center;
    const sizes: Readonly<Record<typeof type, readonly [number, number]>> = {
      [FRAME_SHAPE_TYPE]: [760, 520],
      [NOTE_SHAPE_TYPE]: [260, 210],
      [SWATCH_SHAPE_TYPE]: [computeSwatchWidth(1), SWATCH_HEIGHT],
    };
    const [width, height] = sizes[type];
    editor.createShape({
      type,
      x: center.x - width / 2,
      y: center.y - height / 2,
    });
    const created = editor.getCurrentPageShapes().at(-1);
    if (created) editor.select(created);
  };

  const setTool = (toolId: string): void => {
    editor.setCurrentTool(toolId);
  };

  const setRectangleTool = (): void => {
    editor.setStyleForNextShapes(GeoShapeGeoStyle, "rectangle");
    editor.setCurrentTool("geo");
  };

  return (
    <aside className={styles.toolRail} aria-label="工具条">
      <div className={styles.toolScroller}>
        {/* ── 导航工具 ── */}
        <div className={styles.toolGroup}>
          {/* 选择 */}
          <button className={styles.toolButton} onClick={() => setTool("select")} title="选择 (V)" type="button" aria-label="选择工具" aria-pressed={currentToolId === "select"}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 2.5 L5 15 L8.5 11.5 L11.5 17 L13.5 16 L10.5 10.5 L16 10.5 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="currentColor" fillOpacity="0.1" />
            </svg>
          </button>

          {/* 抓手 */}
          <button className={styles.toolButton} onClick={() => setTool("hand")} title="抓手 (H)" type="button" aria-label="抓手工具" aria-pressed={currentToolId === "hand"}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M7.5 13.5V8a1.25 1.25 0 0 1 2.5 0v3.5
                     M10 8.5V6.25a1.25 1.25 0 0 1 2.5 0v4
                     M12.5 9V7.5a1.25 1.25 0 0 1 2.5 0V12
                     a5 5 0 0 1-5 5h-.5a5 5 0 0 1-5-5v-2.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>

        <div className={styles.toolDivider} />

        {/* ── 绘制工具 ── */}
        <div className={styles.toolGroup}>
          {/* 铅笔/自由绘制 */}
          <button className={styles.toolButton} onClick={() => setTool("draw")} title="自由绘制 (D)" type="button" aria-label="自由绘制工具" aria-pressed={currentToolId === "draw"}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4.5 15 L13 6.5 a2.1 2.1 0 0 1 2.95 2.95 L7.4 17.5 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="currentColor" fillOpacity="0.1" />
              <path d="M12 7.5 L15 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M4 16.5 L3.5 17.5 L4.5 17 Z" fill="currentColor" />
            </svg>
          </button>

          {/* 橡皮擦 */}
          <button className={styles.toolButton} onClick={() => setTool("eraser")} title="橡皮擦 (E)" type="button" aria-label="橡皮擦工具" aria-pressed={currentToolId === "eraser"}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M5 15 L3.8 13.8 a1.9 1.9 0 0 1 0-2.7 L10.5 4.4 a1.9 1.9 0 0 1 2.7 0 l3.1 3.1 a1.9 1.9 0 0 1 0 2.7 L9.5 17 H5 Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
                fill="currentColor"
                fillOpacity="0.1"
              />
              <path d="M8 6.5 L13.5 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M11 16 H17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>

          {/* 箭头 */}
          <button className={styles.toolButton} onClick={() => setTool("arrow")} title="箭头 (A)" type="button" aria-label="箭头工具" aria-pressed={currentToolId === "arrow"}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4.5 15.5 L15.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M9.5 4.5 H15.5 V10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* 上传图片 */}
          <button className={styles.toolButton} onClick={() => window.dispatchEvent(new Event(BOARD_FILE_PICKER_EVENT))} title="上传图片" type="button" aria-label="上传图片">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="3" y="5.5" width="14" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="7" cy="9.5" r="1.3" fill="currentColor" />
              <path d="M3 13.5 L6.5 10 L9.5 12.5 L13 8.5 L17 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              {/* upload arrow */}
              <path d="M14 3.5 V1.5 M12.5 3 L14 1.5 L15.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* 文本 */}
          <button className={styles.toolButton} onClick={() => setTool("text")} title="文本 (T)" type="button" aria-label="文本工具" aria-pressed={currentToolId === "text"}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4.5 5.5 H15.5 M10 5.5 V15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M7.5 15.5 H12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>

          {/* 矩形 */}
          <button className={styles.toolButton} onClick={setRectangleTool} title="矩形 (R)" type="button" aria-label="矩形工具" aria-pressed={currentToolId === "geo"}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>

        <div className={styles.toolDivider} />

        {/* ── 设计对象 ── */}
        <div className={styles.toolGroup}>
          {/* 便签 — sticky note 折角形 */}
          <button className={styles.toolButton} onClick={() => createShape(NOTE_SHAPE_TYPE)} title="灵感便签" type="button" aria-label="添加灵感便签">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 4 H13 L16.5 7.5 V16 H4 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="currentColor" fillOpacity="0.07" />
              {/* folded corner */}
              <path d="M13 4 V7.5 H16.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M7 9.5 H13 M7 12.5 H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>

          {/* 色卡 — 三列色带 */}
          <button className={styles.toolButton} onClick={() => createShape(SWATCH_SHAPE_TYPE)} title="色卡" type="button" aria-label="添加色卡">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="3.5" y="5" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="currentColor" fillOpacity="0.07" />
              <line x1="8.2" y1="5" x2="8.2" y2="15" stroke="currentColor" strokeWidth="1.3" />
              <line x1="12.8" y1="5" x2="12.8" y2="15" stroke="currentColor" strokeWidth="1.3" />
              {/* center band slight fill suggestion */}
              <rect x="8.2" y="5" width="4.6" height="10" fill="currentColor" fillOpacity="0.12" />
            </svg>
          </button>

          {/* Frame — 四角括号 */}
          <button className={styles.toolButton} onClick={() => createShape(FRAME_SHAPE_TYPE)} title="Frame 组织框" type="button" aria-label="添加Frame">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              {/* top-left */}
              <path d="M3.5 8.5 V3.5 H8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              {/* top-right */}
              <path d="M11.5 3.5 H16.5 V8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              {/* bottom-right */}
              <path d="M16.5 11.5 V16.5 H11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              {/* bottom-left */}
              <path d="M8.5 16.5 H3.5 V11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* 面料库 — 布卷图标 */}
          <button className={styles.toolButton} onClick={onOpenFabrics} title="面料素材库" type="button" aria-label="打开面料库">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              {/* cylinder body */}
              <path d="M4 7 V14.5 a6 2.5 0 0 0 12 0 V7" stroke="currentColor" strokeWidth="1.4" fill="currentColor" fillOpacity="0.07" />
              {/* top ellipse */}
              <ellipse cx="10" cy="7" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.4" />
              {/* mid ellipse */}
              <path d="M4 10.8 a6 2.5 0 0 0 12 0" stroke="currentColor" strokeWidth="1" strokeDasharray="2.5 2" />
            </svg>
          </button>

          {/* 趋势分析 — 导航 */}
          <button className={styles.navButton} onClick={() => window.open("/trends", "_blank", "noopener")} title="趋势分析" type="button" aria-label="打开趋势分析">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <polyline points="3,15 7,9.5 10.5,12.5 14.5,6.5 17,8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="14.5,6.5 17,6.5 17,9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* 连接器工具 */}
          <button
            className={styles.toolButton}
            onClick={() => setTool("connector")}
            title="连接器 - 在元素之间绘制连接线"
            type="button"
            aria-label="连接器工具"
            aria-pressed={currentToolId === "connector"}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="5" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4" fill="currentColor" fillOpacity="0.12" />
              <circle cx="15" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4" fill="currentColor" fillOpacity="0.12" />
              <path d="M7.5 10 Q 10 6, 12.5 10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              <path d="M14 9 L15 10 L14 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>

          {/* 固定工具 — 图钉形状 + 文字提示 */}
          <button
            className={styles.toolButton}
            onClick={() => editor.setCurrentTool("mount")}
            title="固定素材 - 使用图钉或胶带将元素钉在画布上"
            type="button"
            aria-label="固定工具"
            aria-pressed={currentToolId === "mount"}
            data-active={currentToolId === "mount" ? "true" : undefined}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              {/* diamond head */}
              <path d="M10 3 L14 9.5 L10 13 L6 9.5 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="currentColor" fillOpacity="0.12" />
              {/* inner circle */}
              <circle cx="10" cy="8.5" r="1.5" fill="currentColor" opacity="0.5" />
              {/* pin needle */}
              <line x1="10" y1="13" x2="10" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span className={styles.toolLabel}>固定</span>
          </button>
        </div>
      </div>

      {/* 固定变体选择器 — 从底部工具坞向上展开 */}
      {currentToolId === "mount" && (
        <div className={styles.mountVariantPicker}>
          <span className={styles.mountPickerLabel}>选择固定样式：</span>
          {MOUNT_CATALOG.map((item) => (
            <button
              key={item.variant}
              className={styles.mountVariantButton}
              onClick={() => {
                setActiveMountVariant(item.variant);
                setActiveVariantLocal(item.variant);
              }}
              title={item.label}
              type="button"
              aria-label={item.label}
              aria-pressed={activeVariant === item.variant}
              data-active={activeVariant === item.variant ? "true" : undefined}
            >
              {item.variant === "brass-pin" || item.variant === "red-pin" ? <IconPin /> : <IconTapeRoll />}
              <span className={styles.mountVariantLabel}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
