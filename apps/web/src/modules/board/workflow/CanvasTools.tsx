"use client";

import { useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
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
import { BottomToolbarIcon } from "../BottomToolbarIcon";
import { CanvasWelcome } from "./CanvasWelcome";
import { CanvasObjectsPanel } from "./CanvasObjectsPanel";
import { CanvasOverview } from "./CanvasOverview";
import { CanvasObjectHistory, type CanvasHistoryTarget } from "./CanvasObjectHistory";
import { fitCanvasContents, selectedMaterialShapes } from "./canvas-placements";
import { canvasImageFitBounds, fitCanvasImageToSource } from "./canvas-image-sizing";
import { imageToolEntries, type ImageToolEntry } from "./image-tool-entry";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./infinite-workspace.module.css";
import { CreationWorkspaceContext } from "./creation-context";
import WarmTooltip from "../../../components/WarmTooltip";
import { CanvasAction } from "./CanvasAction";
import { AddNodeMenu } from "./AddNodeMenu";

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
  layers: <><path d="m12 3 9 5-9 5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
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
  projectFunctions?: readonly import("./canvas-project-functions").CanvasProjectFunction[];
  onProjectFunction?: (id: string) => void | Promise<void>;
  onFunctionsReady?: (ready: boolean) => void;
  toolsOpen: boolean;
  collectionsOpen: boolean;
  onOpenCollections: () => void;
  onOpenFabrics: () => void;
  onOpenTrends: () => void;
  onOpenSketch: () => void;
  onUpload: () => void;
  onUseTools: () => void;
  onReference?: () => void;
  onReferenceNodeIds?: (ids: readonly string[]) => void;
  referencesPreparing?: boolean;
  onStartConversation?: (focusInput: boolean) => void;
  assistantOpen?: boolean;
  onCanvasPanelOpenChange?: (open: boolean) => void;
  onCreationPanelOpenChange?: (open: boolean) => void;
  onObjectHistoryOpenChange?: (open: boolean) => void;
  onOpenAssetHistory?: (nodeId: string, assetId: string) => boolean;
  imageToolNodeIds?: readonly string[];
  onOpenImageTool?: (nodeId: string, assetId: string, action: ImageToolEntry) => void;
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
  useEffect(() => {
    const retireNoteShortcut = (event: KeyboardEvent) => {
      if (event.code !== "KeyN" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || !editor.getInstanceState().isFocused) return;
      if (event.target instanceof HTMLElement && (event.target.matches("input,textarea,select") || event.target.isContentEditable)) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", retireNoteShortcut, true);
    return () => window.removeEventListener("keydown", retireNoteShortcut, true);
  }, [editor]);
  const creation = useContext(CreationWorkspaceContext);
  const [showTips, setShowTips] = useState(false);
  const [showObjects, setShowObjects] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [history, setHistory] = useState<CanvasHistoryTarget | null>(null);
  const openHistory = useCallback((target: CanvasHistoryTarget) => setHistory(target), []);
  const onObjectHistoryOpenChange = actions.onObjectHistoryOpenChange;
  useEffect(() => { onObjectHistoryOpenChange?.(history !== null); }, [history, onObjectHistoryOpenChange]);
  useEffect(() => () => onObjectHistoryOpenChange?.(false), [onObjectHistoryOpenChange]);
  const objectsId = useId();
  const objectsButton = useRef<HTMLButtonElement>(null);
  const registerObjects = creation?.registerObjects;
  useEffect(() => registerObjects?.(() => { setShowObjects(true); setShowTips(false); setShowOverview(false); }), [registerObjects]);
  const moreButton = useRef<HTMLElement>(null);
  const closeObjects = useCallback(() => { setShowObjects(false); objectsButton.current?.focus(); }, []);
  const closeOverview = useCallback(() => { setShowOverview(false); moreButton.current?.focus(); }, []);
  const onCanvasPanelOpenChange = actions.onCanvasPanelOpenChange;
  useEffect(() => { onCanvasPanelOpenChange?.(showObjects || showOverview); }, [onCanvasPanelOpenChange, showObjects, showOverview]);
  useEffect(() => () => { onCanvasPanelOpenChange?.(false); }, [onCanvasPanelOpenChange]);
  const state = useValue(
    "canvas-tool-state",
    () => {
      const selected = editor.getSelectedShapes();
      const materials = selectedMaterialShapes(editor);
      const ids = [
        ...new Set(
          materials.flatMap((shape) =>
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
        referenceCount: ids.length + materials.filter((shape) => typeof shape.meta.canvasNodeId !== "string" && ["draw", "text", "fashion-text", "fashion-swatch"].includes(shape.type)).length,
        ids,
        hasGroup: selected.some((shape) => shape.type === "group"),
        hasLocked: selected.some((shape) => editor.isShapeOrAncestorLocked(shape)),
        imageToFit: selected.length === 1 && selected[0]?.type === "fashion-image" ? selected[0].id : null,
        canFitImage: selected.length === 1 && selected[0]?.type === "fashion-image" && Boolean(canvasImageFitBounds(selected[0])),
        history: selected.length === 1 && selected[0]?.type === "fashion-image" && typeof selected[0].props.assetId === "string" && selected[0].props.assetId ? {
          assetId: selected[0].props.assetId, title: String(selected[0].props.title || "图片"), nodeId: typeof selected[0].meta.canvasNodeId === "string" ? selected[0].meta.canvasNodeId : null,
        } : null,
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
  const editableSelection = editable && !state.hasLocked;
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
        <ToolRail {...actions} embedded ready={ready} {...(creation ? { addNodeControl: <AddNodeMenu disabled={!editable || creation.creating} onCreate={creation.createNode} onUpload={() => creation.openResources("upload")} onExisting={() => creation.openResources("existing")} /> } : {})}>
          <div className={styles.railExtras}>
            <WarmTooltip content="全部功能模块"><button
              ref={objectsButton}
              className={styles.designToolsButton}
              type="button"
              aria-label="全部功能模块"
              data-guide="workspace-functions"
              aria-expanded={creation?.functionsOpen ?? actions.toolsOpen}
              data-canvas-menu-trigger
              disabled={!ready}
              onClick={creation?.openFunctions ?? actions.onUseTools}
            >
              <BottomToolbarIcon name="modules" />
            </button></WarmTooltip>
            <WarmTooltip content="更多白板操作" triggerSelector="summary"><Menu
              nativeTitle={false}
              label="更多白板操作"
              triggerRef={moreButton}
              trigger={<BottomToolbarIcon name="more" />}
              align="start"
              guideAnchor="workspace-materials"
            >
              <button disabled={!ready} aria-expanded={showOverview} onClick={() => { setShowOverview(value => !value); setShowObjects(false); setShowTips(false); }}>画布总览</button>
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
                disabled={!editableSelection || !state.count}
                onClick={() =>
                  action("复制摆放实例", () =>
                    editor.duplicateShapes(editor.getSelectedShapeIds()),
                  )
                }
              >
                复制所选对象
              </button>
              <button
                disabled={!editableSelection || !state.count}
                onClick={frameSelection}
              >
                放入画框
              </button>
              <button
                disabled={!editableSelection || state.count < 2}
                onClick={() =>
                  action("左对齐", () =>
                    editor.alignShapes(editor.getSelectedShapeIds(), "left"),
                  )
                }
              >
                左对齐
              </button>
              <button
                disabled={!editableSelection || state.count < 2}
                onClick={() =>
                  action("顶对齐", () =>
                    editor.alignShapes(editor.getSelectedShapeIds(), "top"),
                  )
                }
              >
                顶对齐
              </button>
              <button
                disabled={!editableSelection || state.count < 3}
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
                disabled={!editableSelection || !state.count}
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
              <button onClick={() => { setShowTips(value => !value); setShowObjects(false); setShowOverview(false); }}>
                白板操作提示
              </button>
            </Menu></WarmTooltip>
          </div>
        </ToolRail>
      </BoardProjectContext.Provider>
      {ready && showObjects ? <CanvasObjectsPanel id={objectsId} editable={editable} onClose={closeObjects} onHistory={openHistory} /> : null}
      {history ? <CanvasObjectHistory key={history.assetId} target={history} onClose={() => setHistory(null)} onOpenWorkspace={editable && actions.onOpenAssetHistory ? () => actions.onOpenAssetHistory?.(history.nodeId ?? "", history.assetId) ?? false : undefined} /> : null}
      {ready && showOverview ? <CanvasOverview onClose={closeOverview} /> : null}
      {ready && state.count > 0 && !(creation && state.count === 1 && (state.imageToFit || editor.getOnlySelectedShape()?.type === "fashion-creation")) && !showTips && !showObjects && !showOverview ? (
        <div
          className={styles.selectionBar}
          role="toolbar"
          aria-label="所选对象操作"
        >
          <span className={styles.selectionCount}>已选 {state.count} 项</span>
          {actions.onReference ? <CanvasAction label={actions.referencesPreparing ? "正在准备引用…" : "引用到助手"} icon="comment" disabled={!state.referenceCount || state.referenceCount > 16 || actions.referencesPreparing} onClick={actions.onReference} /> : null}
          {state.history?.nodeId && editable && !state.hasLocked && actions.imageToolNodeIds?.includes(state.history.nodeId) && actions.onOpenImageTool ? <div data-canvas-image-tools><Menu key={`${state.history.nodeId}:${state.history.assetId}`} label="图片工具" align="start" trigger={<><WorkspaceIcon name="inpaint" />图片工具<WorkspaceIcon name="chevron" /></>}>
            {imageToolEntries.map(entry => <button type="button" key={entry.action} onClick={() => {
              const target = state.history;
              if (!target?.nodeId) return;
              const selected = editor.getOnlySelectedShape();
              if (!selected || editor.getIsReadonly() || editor.isShapeOrAncestorLocked(selected) || editor.isShapeHidden(selected)) return;
              if (selected.meta.canvasNodeId === target.nodeId && "assetId" in selected.props && selected.props.assetId === target.assetId) actions.onOpenImageTool?.(target.nodeId, target.assetId, entry.action);
            }}>{entry.label}</button>)}
          </Menu></div> : null}
          <CanvasAction
            label="查看详情" icon="results"
            disabled={state.ids.length !== 1}
            onClick={() => {
              if (state.ids[0]) onOpen(state.ids[0]);
            }}
          />
          {state.history ? <CanvasAction label="查看历史" icon="history" onClick={() => { if (state.history) openHistory(state.history); }} /> : null}
          {state.imageToFit ? <CanvasAction label="匹配图片比例" icon="frame" disabled={!editableSelection || !state.canFitImage} onClick={() => {
            if (state.imageToFit) fitCanvasImageToSource(editor, state.imageToFit);
          }} /> : null}
          {state.count >= 2 ? <CanvasAction
            label="分组" icon="group_objects"
            disabled={!editableSelection || state.count < 2}
            onClick={() =>
              action("整理分组", () =>
                editor.groupShapes(editor.getSelectedShapeIds()),
              )
            }
          /> : null}
          {state.hasGroup ? <CanvasAction
            label="解除分组" icon="ungroup_objects"
            disabled={!editableSelection || !state.hasGroup}
            onClick={() =>
              action("解除分组", () =>
                editor.ungroupShapes(editor.getSelectedShapeIds()),
              )
            }
          /> : null}
          <CanvasAction
            label="取消选择" icon="close"
            onClick={() => editor.selectNone()}
          />
        </div>
      ) : null}
      {showStyles && !showTips && !showObjects && !showOverview && !state.hasLocked ? (
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
            加选，拖动空白处框选。选好素材后，点击“引用到助手”加入对话参考。
          </p>
          <p>
            画框和分组只用于整理。移除摆放不删除作品，撤销白板操作不取消生成任务。
          </p>
        </div>
      ) : null}
      {ready && !state.hasShapes && state.tool === "select" ? (
        <CanvasWelcome canEdit={canEdit} assistantOpen={Boolean(actions.assistantOpen)} onStart={actions.onStartConversation} onUpload={actions.onUpload} onSketch={actions.onOpenSketch} />
      ) : null}
    </div>
  );
}
