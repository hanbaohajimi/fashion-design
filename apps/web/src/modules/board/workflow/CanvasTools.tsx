"use client";

import { useState, type ReactNode } from "react";
import {
  createShapeId,
  DefaultColorStyle,
  DefaultSizeStyle,
  useEditor,
  useValue,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
} from "tldraw";
import { Menu } from "../../../components/ui";
import { BoardProjectContext } from "../board-context";
import { ToolRail } from "../ToolRail";
import { fitCanvasContents, selectedMaterialShapes } from "./canvas-placements";
import styles from "./infinite-workspace.module.css";

const icons: Record<string, ReactNode> = {
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
};
function Icon({ name }: { name: string }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}

const colors: readonly [TLDefaultColorStyle, string, string][] = [
  ["black", "墨黑", "#1d1d1d"],
  ["green", "绿色", "#446a38"],
  ["blue", "蓝色", "#4263eb"],
  ["red", "红色", "#e03131"],
  ["orange", "橙色", "#f08c00"],
  ["grey", "灰色", "#7b7b7b"],
];
const sizes: readonly [TLDefaultSizeStyle, string][] = [
  ["s", "细"],
  ["m", "中"],
  ["l", "粗"],
  ["xl", "特粗"],
];

export interface CanvasToolActions {
  toolsOpen: boolean;
  collectionsOpen: boolean;
  onOpenCollections: () => void;
  onOpenFabrics: () => void;
  onOpenTrends: () => void;
  onOpenSketch: () => void;
  onUpload: () => void;
  onUseTools: () => void;
}

export function CanvasTools({
  projectId,
  actions,
  ready,
  canEdit,
  onOpen,
  onAddMaterial,
}: {
  projectId: string;
  actions: CanvasToolActions;
  ready: boolean;
  canEdit: boolean;
  onOpen: (nodeId: string) => void;
  onAddMaterial: () => void;
}) {
  const editor = useEditor();
  const [showTips, setShowTips] = useState(false);
  const state = useValue(
    "canvas-tool-state",
    () => {
      const selected = editor.getSelectedShapes();
      const ids = [
        ...new Set(
          selectedMaterialShapes(editor).flatMap((shape) =>
            typeof shape.meta.canvasNodeId === "string"
              ? [shape.meta.canvasNodeId]
              : [],
          ),
        ),
      ];
      const shared = editor.getSharedStyles();
      const color = shared.get(DefaultColorStyle);
      const size = shared.get(DefaultSizeStyle);
      return {
        tool: editor.getCurrentToolId(),
        count: selected.length,
        ids,
        hasGroup: selected.some((shape) => shape.type === "group"),
        canUndo: editor.canUndo(),
        canRedo: editor.canRedo(),
        hasShapes: editor.getCurrentPageShapes().length > 0,
        styleSelection:
          selected.length > 0 &&
          selected.every((shape) =>
            ["draw", "text", "note"].includes(shape.type),
          ),
        color:
          color?.type === "shared"
            ? color.value
            : editor.getStyleForNextShape(DefaultColorStyle),
        size:
          size?.type === "shared"
            ? size.value
            : editor.getStyleForNextShape(DefaultSizeStyle),
      };
    },
    [editor],
  );
  const editable = ready && canEdit;
  const action = (name: string, work: () => void) => {
    editor.markHistoryStoppingPoint(name);
    work();
    editor.focus();
  };
  const frameSelection = () =>
    action("整理到画框", () => {
      const selected = editor.getSelectedShapeIds();
      const bounds = editor.getSelectionPageBounds();
      if (!bounds || !selected.length) return;
      const id = createShapeId();
      editor.createShape({
        id,
        type: "frame",
        x: bounds.x - 24,
        y: bounds.y - 24,
        props: { w: bounds.w + 48, h: bounds.h + 48, name: "素材整理" },
      });
      editor.reparentShapes(selected, id);
      editor.select(id);
    });
  const showStyles =
    editable && (["draw", "text"].includes(state.tool) || state.styleSelection);

  return (
    <div
      className={styles.controls}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <BoardProjectContext.Provider value={projectId}>
        <ToolRail {...actions} embedded ready={ready}>
          <div className={styles.railExtras}>
            <button
              className={styles.designToolsButton}
              type="button"
              aria-label="使用设计工具"
              aria-expanded={actions.toolsOpen}
              data-canvas-menu-trigger
              disabled={!editable}
              onClick={actions.onUseTools}
            >
              设计工具
            </button>
            <Menu
              label="更多白板操作"
              trigger={<Icon name="more" />}
              align="start"
              guideAnchor="workspace-materials"
            >
              <button disabled={!editable} onClick={onAddMaterial}>
                添加设计素材
              </button>
              <button
                disabled={!editable}
                onClick={() => {
                  editor.setCurrentTool("draw");
                  editor.focus();
                }}
              >
                自由手绘
              </button>
              <button
                disabled={!editable}
                onClick={() => {
                  editor.setCurrentTool("frame");
                  editor.focus();
                }}
              >
                画框
              </button>
              <button
                disabled={!editable || !state.count}
                onClick={() =>
                  action("复制摆放实例", () =>
                    editor.duplicateShapes(editor.getSelectedShapeIds()),
                  )
                }
              >
                复制所选对象
              </button>
              <button
                disabled={!editable || !state.count}
                onClick={frameSelection}
              >
                放入画框
              </button>
              <button
                disabled={!editable || state.count < 2}
                onClick={() =>
                  action("左对齐", () =>
                    editor.alignShapes(editor.getSelectedShapeIds(), "left"),
                  )
                }
              >
                左对齐
              </button>
              <button
                disabled={!editable || state.count < 2}
                onClick={() =>
                  action("顶对齐", () =>
                    editor.alignShapes(editor.getSelectedShapeIds(), "top"),
                  )
                }
              >
                顶对齐
              </button>
              <button
                disabled={!editable || state.count < 3}
                onClick={() =>
                  action("均匀分布", () =>
                    editor.distributeShapes(
                      editor.getSelectedShapeIds(),
                      "horizontal",
                    ),
                  )
                }
              >
                水平等距分布
              </button>
              <button
                disabled={!editable || !state.count}
                onClick={() =>
                  action("移除摆放实例", () =>
                    editor.deleteShapes(editor.getSelectedShapeIds()),
                  )
                }
              >
                移除所选摆放
              </button>
              <button
                disabled={!editable || !state.canUndo}
                onClick={() => editor.undo()}
              >
                撤销白板操作
              </button>
              <button
                disabled={!editable || !state.canRedo}
                onClick={() => editor.redo()}
              >
                重做白板操作
              </button>
              <button
                disabled={!ready || !state.hasShapes}
                onClick={() => fitCanvasContents(editor)}
              >
                查看全图
              </button>
              <button disabled={!ready} onClick={() => editor.zoomOut()}>
                缩小画布
              </button>
              <button disabled={!ready} onClick={() => editor.resetZoom()}>
                画布原始比例
              </button>
              <button disabled={!ready} onClick={() => editor.zoomIn()}>
                放大画布
              </button>
              <button onClick={() => setShowTips((value) => !value)}>
                白板操作提示
              </button>
            </Menu>
          </div>
        </ToolRail>
      </BoardProjectContext.Provider>
      {ready && state.count > 0 && !showTips ? (
        <div
          className={styles.selectionBar}
          role="toolbar"
          aria-label="所选对象操作"
        >
          <span className={styles.selectionCount}>已选 {state.count} 项</span>
          <button
            type="button"
            disabled={state.ids.length !== 1}
            onClick={() => {
              if (state.ids[0]) onOpen(state.ids[0]);
            }}
          >
            查看详情
          </button>
          <button
            type="button"
            disabled={!editable || state.count < 2}
            onClick={() =>
              action("整理分组", () =>
                editor.groupShapes(editor.getSelectedShapeIds()),
              )
            }
          >
            分组
          </button>
          <button
            type="button"
            disabled={!editable || !state.hasGroup}
            onClick={() =>
              action("解除分组", () =>
                editor.ungroupShapes(editor.getSelectedShapeIds()),
              )
            }
          >
            解除分组
          </button>
          <button
            type="button"
            aria-label="取消选择"
            onClick={() => editor.selectNone()}
          >
            <Icon name="close" />
          </button>
        </div>
      ) : null}
      {showStyles && !showTips ? (
        <div
          className={styles.drawingSettings}
          data-with-selection={state.count > 0}
          aria-label="绘制设置"
        >
          <fieldset>
            <legend>颜色</legend>
            <div className={styles.colorOptions}>
              {colors.map(([color, label, hex]) => (
                <button
                  key={color}
                  type="button"
                  aria-label={label}
                  aria-pressed={state.color === color}
                  onClick={() => {
                    editor.setStyleForNextShapes(DefaultColorStyle, color);
                    editor.setStyleForSelectedShapes(DefaultColorStyle, color);
                  }}
                >
                  <span style={{ background: hex }} />
                  {state.color === color ? (
                    <span className={styles.colorCheck}>
                      <Icon name="check" />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{state.tool === "text" ? "字号" : "粗细"}</legend>
            <div className={styles.sizeOptions}>
              {sizes.map(([size, label]) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={state.size === size}
                  onClick={() => {
                    editor.setStyleForNextShapes(DefaultSizeStyle, size);
                    editor.setStyleForSelectedShapes(DefaultSizeStyle, size);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
      {showTips ? (
        <div className={styles.tips} role="region" aria-label="白板操作提示">
          <button
            type="button"
            aria-label="关闭白板操作提示"
            onClick={() => setShowTips(false)}
          >
            <Icon name="close" />
          </button>
          <strong>自由整理，随时继续创作</strong>
          <p>
            按住空格拖动画布；Shift
            加选，拖动空白处框选。选择素材会更新对话引用，点击空白处会保留引用。
          </p>
          <p>
            画框和分组只用于整理。移除摆放不删除作品，撤销白板操作不取消生成任务。
          </p>
        </div>
      ) : null}
      {ready && !state.hasShapes && state.tool === "select" ? (
        <div className={styles.emptyState}>
          <h2>{canEdit ? "从一份素材开始" : "白板中还没有素材"}</h2>
          <p>
            {canEdit
              ? "拖入图片、粘贴参考，或用手绘和文字记录想法。选中素材后，可在设计助手中继续创作。"
              : "项目中的素材和作品将在这里展示。"}
          </p>
          {canEdit ? (
            <button type="button" onClick={onAddMaterial}>
              添加设计素材
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
