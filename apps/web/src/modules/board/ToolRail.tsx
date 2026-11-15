"use client";

import { useCallback, useContext, useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import {
  ArrowShapeArrowheadEndStyle,
  ArrowShapeArrowheadStartStyle,
  createShapeId,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  type DrawShapeUtil,
  type TLDrawShape,
  type TLFrameShape,
  type TLShape,
  type TLShapeId,
  useEditor,
  useValue,
} from "tldraw";
import { BOARD_FILE_PICKER_EVENT, BoardProjectContext } from "./board-context";
import { bindSketchReference } from "./board-api";
import {
  completeUpload,
  putOriginal,
  sha256Hex,
  signImageUpload,
  waitForThumbnail,
} from "./file-upload-api";
import {
  createFinalizedSketchImageRecord,
  type ImageShape,
  SWATCH_HEIGHT,
  SWATCH_SHAPE_TYPE,
  computeSwatchWidth,
} from "./shapes";
import {
  configureSketchEraser,
  getSketchPencilPreset,
  SKETCH_ERASER_TOOL_ID,
  type SketchPencilColor,
  type SketchPencilSize,
} from "./tools/MountTool";
import styles from "./tool-rail.module.css";
import { BottomToolbarIcon } from "./BottomToolbarIcon";
import WarmTooltip from "../../components/WarmTooltip";

function RailButton({ title, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <WarmTooltip content={title ?? props["aria-label"]}><button {...props} /></WarmTooltip>;
}

const SKETCH_PAPER_WIDTH = 640;
const SKETCH_PAPER_HEIGHT = 860;
const SKETCH_PAPER_GAP = 120;
const SKETCH_DRAWING_TYPES = new Set(["draw", "line"]);

type SketchStatus = "draft" | "error" | "rendering" | "uploading" | "ready";

const SKETCH_ERASER_RADIUS: Record<SketchPencilSize, number> = {
  l: 24,
  m: 14,
  s: 8,
};

interface PageRectangle {
  readonly h: number;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

function isSketchFrame(shape: TLShape | undefined): shape is TLFrameShape {
  return shape?.type === "frame" && shape.meta.fashionSketch === true;
}

function sketchTitle(shape: TLFrameShape | undefined): string {
  if (!shape) return "廓形草图";
  const title = shape.meta.sketchTitle;
  return typeof title === "string" && title.trim() ? title : "廓形草图";
}

function sketchSequence(shape: TLFrameShape): number {
  const stored = shape.meta.sketchIndex;
  if (typeof stored === "number" && Number.isInteger(stored) && stored > 0) {
    return stored;
  }
  const match = sketchTitle(shape).match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

function safeSketchFilename(title: string): string {
  const normalized = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${normalized || "fashion-sketch"}.png`;
}

function sketchErrorMessage(cause: unknown): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "当前处于离线状态。草图笔画已保留，联网后可继续建立 AI 引用。";
  }
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : "草图引用生成失败，请重试";
}

function rectanglesOverlap(
  candidate: PageRectangle,
  occupied: PageRectangle,
): boolean {
  return (
    candidate.x < occupied.x + occupied.w + SKETCH_PAPER_GAP &&
    candidate.x + candidate.w + SKETCH_PAPER_GAP > occupied.x &&
    candidate.y < occupied.y + occupied.h + SKETCH_PAPER_GAP &&
    candidate.y + candidate.h + SKETCH_PAPER_GAP > occupied.y
  );
}

function blankSketchPosition(editor: ReturnType<typeof useEditor>): {
  readonly x: number;
  readonly y: number;
} {
  const viewport = editor.getViewportPageBounds();
  const anchor = {
    x: viewport.center.x - SKETCH_PAPER_WIDTH / 2,
    y: viewport.center.y - SKETCH_PAPER_HEIGHT / 2,
  };
  const occupied = editor.getCurrentPageShapes().flatMap((shape) => {
    const bounds = editor.getShapePageBounds(shape);
    return bounds
      ? [{ h: bounds.h, w: bounds.w, x: bounds.x, y: bounds.y }]
      : [];
  });
  const horizontalStep = SKETCH_PAPER_WIDTH + SKETCH_PAPER_GAP * 2;
  const verticalStep = SKETCH_PAPER_HEIGHT + SKETCH_PAPER_GAP * 2;
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [2, 0],
    [0, 2],
    [-2, 0],
    [0, -2],
    [2, 1],
    [1, 2],
    [-1, 2],
    [-2, 1],
    [2, -1],
    [1, -2],
    [-1, -2],
    [-2, -1],
  ];

  for (const [column, row] of offsets) {
    const candidate = {
      h: SKETCH_PAPER_HEIGHT,
      w: SKETCH_PAPER_WIDTH,
      x: anchor.x + column * horizontalStep,
      y: anchor.y + row * verticalStep,
    };
    if (!occupied.some((bounds) => rectanglesOverlap(candidate, bounds))) {
      return { x: candidate.x, y: candidate.y };
    }
  }

  const rightEdge = occupied.reduce(
    (maximum, bounds) => Math.max(maximum, bounds.x + bounds.w),
    viewport.maxX,
  );
  return { x: rightEdge + SKETCH_PAPER_GAP, y: anchor.y };
}

interface ToolRailProps {
  readonly collectionsOpen: boolean;
  readonly onOpenCollections: () => void;
  readonly onOpenFabrics: () => void;
  readonly embedded?: boolean;
  readonly ready?: boolean;
  readonly onOpenSketch?: () => void;
  readonly onUpload?: () => void;
  readonly onOpenTrends?: () => void;
  readonly children?: ReactNode;
  readonly addNodeControl?: ReactNode;
}

export function ToolRail({
  onOpenFabrics,
  embedded = false,
  ready = true,
  onOpenSketch,
  onUpload,
  children,
  addNodeControl,
}: ToolRailProps) {
  const editor = useEditor();
  const readOnly = useValue("tool-rail-readonly", () => editor.getInstanceState().isReadonly, [editor]);
  const editable = ready && !readOnly;
  const projectId = useContext(BoardProjectContext);
  const [activeSketchId, setActiveSketchId] = useState<TLShapeId | null>(null);
  const [sketchColor, setSketchColor] = useState<SketchPencilColor>("black");
  const [sketchPencilSize, setSketchPencilSize] =
    useState<SketchPencilSize>("m");
  const [sketchEraserSize, setSketchEraserSize] =
    useState<SketchPencilSize>("m");
  const [sketchStatus, setSketchStatus] = useState<SketchStatus>("draft");
  const [sketchMessage, setSketchMessage] = useState<string | null>(null);
  const [renamingSketch, setRenamingSketch] = useState(false);
  const [sketchTitleDraft, setSketchTitleDraft] = useState("");
  const savingSketchRef = useRef(false);
  const currentToolId = useValue(
    "tool-rail-current-tool",
    () => editor.getCurrentToolId(),
    [editor],
  );
  const selectedSketchId = useValue(
    "tool-rail-selected-sketch",
    () => {
      const selected = editor.getSelectedShapes();
      return selected.length === 1 && isSketchFrame(selected[0])
        ? selected[0].id
        : null;
    },
    [editor],
  );
  const activeSketch = useValue(
    "tool-rail-active-sketch",
    () =>
      activeSketchId
        ? editor.getShape<TLFrameShape>(activeSketchId)
        : undefined,
    [activeSketchId, editor],
  );
  const sketchStrokeCount = useValue<number>(
    "tool-rail-sketch-stroke-count",
    () => {
      if (!activeSketchId) return 0;
      return editor.getSortedChildIdsForParent(activeSketchId).filter((id) => {
        const shape = editor.getShape(id);
        return shape ? SKETCH_DRAWING_TYPES.has(shape.type) : false;
      }).length;
    },
    [activeSketchId, editor],
  );
  const sketchDirty = activeSketch?.meta.sketchDirty === true;
  const hasSketchReference =
    typeof activeSketch?.meta.sketchFileId === "string" &&
    activeSketch.meta.sketchFileId.length > 0;
  const sketchSaving =
    sketchStatus === "rendering" || sketchStatus === "uploading";
  const activeSketchSize =
    currentToolId === SKETCH_ERASER_TOOL_ID
      ? sketchEraserSize
      : sketchPencilSize;

  useEffect(() => {
    const drawUtil = editor.getShapeUtil<DrawShapeUtil>("draw");
    const previousDisplayValues = drawUtil.options.getCustomDisplayValues;
    drawUtil.options.getCustomDisplayValues = (
      activeEditor,
      shape,
      theme,
      colorMode,
    ) => {
      const inherited = previousDisplayValues(
        activeEditor,
        shape,
        theme,
        colorMode,
      );
      if (shape.meta.fashionPencil !== true) return inherited;
      const size =
        shape.props.size === "s"
          ? "s"
          : shape.props.size === "l" || shape.props.size === "xl"
            ? "l"
            : "m";
      const color = shape.props.color === "grey" ? "grey" : "black";
      const preset = getSketchPencilPreset(size, color);
      return {
        ...inherited,
        strokeColor: preset.strokeColor,
        strokeWidth: preset.strokeWidth,
      };
    };
    return () => {
      drawUtil.options.getCustomDisplayValues = previousDisplayValues;
    };
  }, [editor]);

  const markSketchDirty = useCallback((): void => {
    if (!activeSketchId || savingSketchRef.current) return;
    const latest = editor.getShape<TLFrameShape>(activeSketchId);
    if (!isSketchFrame(latest)) return;
    if (
      latest.meta.sketchDirty === true &&
      latest.meta.sketchStatus === "draft" &&
      !latest.meta.sketchPendingFileId
    ) {
      return;
    }
    editor.updateShape<TLFrameShape>({
      id: activeSketchId,
      meta: {
        ...latest.meta,
        sketchDirty: true,
        sketchPendingFileId: "",
        sketchPendingFingerprint: "",
        sketchPendingPreviewUrl: "",
        sketchStatus: "draft",
      },
      type: "frame",
    });
    setSketchStatus("draft");
    setSketchMessage(
      typeof latest.meta.sketchFileId === "string" && latest.meta.sketchFileId
        ? "草图有新改动，AI 引用将在完成草图后更新"
        : null,
    );
  }, [activeSketchId, editor]);

  useEffect(() => {
    if (!activeSketchId) return;
    const stopListening = editor.store.listen(
      (entry) => {
        const removedRecords = Object.values(entry.changes.removed);
        if (editor.getCurrentToolId() === SKETCH_ERASER_TOOL_ID) {
          const protectedShapeRemoved = removedRecords.some(
            (record) =>
              record.typeName === "shape" &&
              !(
                SKETCH_DRAWING_TYPES.has(record.type) &&
                record.parentId === activeSketchId
              ),
          );
          if (protectedShapeRemoved) {
            editor.store.put(removedRecords);
            setSketchMessage("已保护底层素材：安全橡皮只会删除当前草图笔画");
            return;
          }
        }
        if (entry.changes.removed[activeSketchId]) {
          setActiveSketchId(null);
          editor.updateInstanceState({ isToolLocked: false });
          editor.setCurrentTool("select");
          return;
        }
        const addedSketchShapes = Object.values(entry.changes.added).flatMap(
          (record) =>
            record.typeName === "shape" && SKETCH_DRAWING_TYPES.has(record.type)
              ? [record.id as TLShapeId]
              : [],
        );
        if (addedSketchShapes.length > 0) {
          const shapesNeedingParent = addedSketchShapes.filter(
            (id) => editor.getShape(id)?.parentId !== activeSketchId,
          );
          if (shapesNeedingParent.length > 0) {
            editor.reparentShapes(shapesNeedingParent, activeSketchId);
          }
          for (const id of addedSketchShapes) {
            const shape = editor.getShape(id);
            if (!shape || !SKETCH_DRAWING_TYPES.has(shape.type)) continue;
            if (shape.type === "draw") {
              const pencil = getSketchPencilPreset(
                sketchPencilSize,
                sketchColor,
              );
              editor.updateShape<TLDrawShape>({
                id,
                meta: {
                  ...shape.meta,
                  fashionPencil: true,
                  pencilMaterial: "graphite",
                  sketchStrokeKind: "outline",
                },
                opacity: pencil.opacity,
                props: {
                  color: sketchColor,
                  dash: "draw",
                  size: sketchPencilSize,
                },
                type: "draw",
              });
            } else {
              editor.updateShape({
                id,
                meta: {
                  ...shape.meta,
                  legacySketchStructureLine: true,
                  sketchStrokeKind: "outline",
                },
                type: shape.type,
              });
            }
          }
        }
        const changedSketchContent =
          addedSketchShapes.length > 0 ||
          Object.values(entry.changes.updated).some(([before, after]) =>
            before.typeName === "shape" && after.typeName === "shape"
              ? SKETCH_DRAWING_TYPES.has(after.type) &&
                (before.parentId === activeSketchId ||
                  after.parentId === activeSketchId)
              : false,
          ) ||
          Object.values(entry.changes.removed).some(
            (record) =>
              record.typeName === "shape" &&
              SKETCH_DRAWING_TYPES.has(record.type) &&
              record.parentId === activeSketchId,
          );
        if (changedSketchContent) markSketchDirty();
      },
      { scope: "document", source: "user" },
    );
    return () => stopListening();
  }, [activeSketchId, editor, markSketchDirty, sketchColor, sketchPencilSize]);

  useEffect(() => {
    configureSketchEraser(
      editor,
      activeSketchId
        ? {
            frameId: activeSketchId,
            radius: SKETCH_ERASER_RADIUS[sketchEraserSize],
          }
        : null,
    );
    return () => configureSketchEraser(editor, null);
  }, [activeSketchId, editor, sketchEraserSize]);

  const createShape = (
    type: typeof SWATCH_SHAPE_TYPE,
  ): void => {
    if (!editable) return;
    editor.markHistoryStoppingPoint("新增白板素材");
    editor.setCurrentTool("select");
    const id = createShapeId();
    const center = editor.getViewportPageBounds().center;
    const sizes: Readonly<Record<typeof type, readonly [number, number]>> = {
      [SWATCH_SHAPE_TYPE]: [computeSwatchWidth(1), SWATCH_HEIGHT],
    };
    const [width, height] = sizes[type];
    const placement = {
      id,
      x: center.x - width / 2,
      y: center.y - height / 2,
    };
    editor.createShape({ ...placement, type });
    editor.select(id);
    editor.focus();
  };

  const setTool = useCallback(
    (toolId: string): void => {
      if (!ready || (readOnly && !["select", "hand"].includes(toolId))) return;
      if (toolId === "arrow") {
        editor.setStyleForNextShapes(DefaultDashStyle, "solid");
        editor.setStyleForNextShapes(ArrowShapeArrowheadStartStyle, "none");
        editor.setStyleForNextShapes(ArrowShapeArrowheadEndStyle, "arrow");
      }
      editor.setCurrentTool(
        toolId === "eraser" ? SKETCH_ERASER_TOOL_ID : toolId,
      );
      editor.focus();
    },
    [editor, readOnly, ready],
  );

  useEffect(() => {
    const handleArrowShortcut = (event: KeyboardEvent): void => {
      if (
        !editable ||
        (embedded && !editor.getInstanceState().isFocused) ||
        activeSketchId ||
        event.altKey ||
        event.ctrlKey ||
        event.isComposing ||
        event.metaKey ||
        event.repeat ||
        !event.shiftKey ||
        event.code !== "KeyL"
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"], [data-feature-guide]',
        )
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setTool("arrow");
    };

    window.addEventListener("keydown", handleArrowShortcut, true);
    return () => window.removeEventListener("keydown", handleArrowShortcut, true);
  }, [activeSketchId, editable, editor, embedded, setTool]);

  const enterSketch = (shapeId: TLShapeId): void => {
    const shape = editor.getShape<TLFrameShape>(shapeId);
    if (!isSketchFrame(shape)) return;
    setActiveSketchId(shapeId);
    setSketchStatus(
      shape.meta.sketchStatus === "ready" && shape.meta.sketchDirty !== true
        ? "ready"
        : "draft",
    );
    setSketchMessage(null);
    editor.select(shapeId);
    editor.zoomToSelection({ animation: { duration: 220 } });
    editor.updateInstanceState({ isToolLocked: true });
    editor.setStyleForNextShapes(DefaultColorStyle, sketchColor);
    editor.setStyleForNextShapes(DefaultSizeStyle, sketchPencilSize);
    editor.setStyleForNextShapes(DefaultDashStyle, "draw");
    editor.setCurrentTool("draw");
  };

  const createSketch = (): void => {
    const position = blankSketchPosition(editor);
    const sketchNumber =
      Math.max(
        0,
        ...editor
          .getCurrentPageShapes()
          .filter((shape): shape is TLFrameShape => isSketchFrame(shape))
          .map(sketchSequence),
      ) + 1;
    const title = `廓形草图 ${String(sketchNumber).padStart(2, "0")}`;
    const shapeId = createShapeId(`fashion-sketch-${crypto.randomUUID()}`);
    editor.markHistoryStoppingPoint("create fashion sketch");
    editor.createShape<TLFrameShape>({
      id: shapeId,
      meta: {
        fashionSketch: true,
        sketchDirty: true,
        sketchIndex: sketchNumber,
        sketchStatus: "draft",
        sketchTitle: title,
      },
      props: {
        h: SKETCH_PAPER_HEIGHT,
        name: title,
        w: SKETCH_PAPER_WIDTH,
      },
      type: "frame",
      x: position.x,
      y: position.y,
    });
    enterSketch(shapeId);
    setSketchMessage("已在附近空白区域创建；安全橡皮不会影响底层素材");
  };

  const openSketch = (): void => {
    if (!editable) return;
    if (onOpenSketch) {
      onOpenSketch();
      return;
    }
    if (selectedSketchId) {
      enterSketch(selectedSketchId);
    } else {
      createSketch();
    }
  };

  const leaveSketch = (): void => {
    const shapeId = activeSketchId;
    setActiveSketchId(null);
    editor.updateInstanceState({ isToolLocked: false });
    editor.setCurrentTool("select");
    if (shapeId && editor.getShape(shapeId)) {
      editor.select(shapeId);
    }
  };

  const requestExitSketch = (): void => {
    if (!activeSketchId || sketchSaving) return;
    if (sketchStrokeCount === 0 && !hasSketchReference) {
      if (!window.confirm("这是一张空白草图。退出并删除草图纸？")) return;
      const shapeId = activeSketchId;
      leaveSketch();
      editor.markHistoryStoppingPoint("delete empty fashion sketch");
      editor.deleteShape(shapeId);
      return;
    }
    if (sketchDirty) {
      const warning = hasSketchReference
        ? "草图有尚未更新到 AI 引用的新改动。退出后画布笔画会保留，但 AI 暂不会使用这张草图，直到你再次完成草图。仍要退出吗？"
        : "这张草图尚未建立 AI 引用。退出后笔画仍会保存在画布中。仍要退出吗？";
      if (!window.confirm(warning)) return;
    }
    leaveSketch();
  };

  const fitSketchToViewport = (): void => {
    if (!activeSketchId) return;
    editor.select(activeSketchId);
    editor.zoomToSelection({ animation: { duration: 180 } });
  };

  const beginRenameSketch = (): void => {
    if (!activeSketchId || sketchSaving) return;
    const current = editor.getShape<TLFrameShape>(activeSketchId);
    if (!isSketchFrame(current)) return;
    setSketchTitleDraft(sketchTitle(current));
    setRenamingSketch(true);
  };

  const commitSketchRename = (): void => {
    if (!activeSketchId) return;
    const current = editor.getShape<TLFrameShape>(activeSketchId);
    if (!isSketchFrame(current)) return;
    const title = sketchTitleDraft.trim().replace(/\s+/g, " ").slice(0, 60);
    setRenamingSketch(false);
    if (!title || title === sketchTitle(current)) return;
    editor.markHistoryStoppingPoint("rename fashion sketch");
    editor.updateShape<TLFrameShape>({
      id: activeSketchId,
      meta: { ...current.meta, sketchTitle: title },
      props: { name: title },
      type: "frame",
    });
  };

  const selectSketchTool = (toolId: "draw" | "eraser"): void => {
    if (sketchSaving) return;
    if (toolId === "draw") {
      editor.setStyleForNextShapes(DefaultDashStyle, "draw");
      editor.setStyleForNextShapes(DefaultColorStyle, sketchColor);
      editor.setStyleForNextShapes(DefaultSizeStyle, sketchPencilSize);
    }
    editor.setCurrentTool(toolId);
  };

  const changeSketchColor = (color: SketchPencilColor): void => {
    if (sketchSaving) return;
    setSketchColor(color);
    editor.setStyleForNextShapes(DefaultColorStyle, color);
  };

  const changeSketchSize = (size: SketchPencilSize): void => {
    if (sketchSaving) return;
    if (editor.getCurrentToolId() === SKETCH_ERASER_TOOL_ID) {
      setSketchEraserSize(size);
    } else {
      setSketchPencilSize(size);
      editor.setStyleForNextShapes(DefaultSizeStyle, size);
    }
  };

  const clearSketch = (): void => {
    if (!activeSketchId || sketchStrokeCount === 0 || sketchSaving) return;
    if (!window.confirm("清空这张草图的全部笔画？此操作可以撤销。")) return;
    const childIds = editor
      .getSortedChildIdsForParent(activeSketchId)
      .filter((id) => {
        const shape = editor.getShape(id);
        return shape ? SKETCH_DRAWING_TYPES.has(shape.type) : false;
      });
    editor.markHistoryStoppingPoint("clear fashion sketch");
    editor.deleteShapes(childIds);
    setSketchStatus("draft");
  };

  const finishSketch = async (): Promise<void> => {
    if (
      !activeSketchId ||
      !activeSketch ||
      sketchStrokeCount === 0 ||
      sketchSaving ||
      savingSketchRef.current ||
      (!sketchDirty && sketchStatus === "ready")
    ) {
      return;
    }
    const shapeId = activeSketchId;
    savingSketchRef.current = true;
    setSketchMessage(null);
    setSketchStatus("rendering");
    editor.setCurrentTool("select");
    let retryFileId = "";
    let retryFingerprint = "";
    let retryPreviewUrl = "";
    try {
      const latest = editor.getShape<TLFrameShape>(shapeId);
      if (!isSketchFrame(latest)) throw new Error("草图纸已不存在");

      let readyFileId =
        typeof latest.meta.sketchPendingFileId === "string"
          ? latest.meta.sketchPendingFileId
          : "";
      let fingerprint =
        typeof latest.meta.sketchPendingFingerprint === "string"
          ? latest.meta.sketchPendingFingerprint
          : "";
      let previewUrl =
        typeof latest.meta.sketchPendingPreviewUrl === "string"
          ? latest.meta.sketchPendingPreviewUrl
          : "";

      if (!readyFileId || !/^[a-f0-9]{64}$/.test(fingerprint)) {
        if (!navigator.onLine)
          throw new Error("当前离线，联网后可继续完成草图");
        const exportIds = [...editor.getShapeAndDescendantIds([shapeId])];
        const rendered = await editor.toImage(exportIds, {
          background: true,
          format: "png",
          padding: 0,
          pixelRatio: 2,
        });
        if (!rendered.blob.size) throw new Error("草图渲染结果为空，请重试");
        const file = new File(
          [rendered.blob],
          safeSketchFilename(sketchTitle(latest)),
          { type: "image/png" },
        );
        fingerprint = await sha256Hex(file);
        setSketchStatus("uploading");
        const signed = await signImageUpload(projectId, file);
        const processing = signed.upload
          ? await putOriginal(signed.upload, file).then(() =>
              completeUpload(signed.file.id),
            )
          : signed.file;
        const ready = await waitForThumbnail(signed.file.id, processing);
        readyFileId = ready.id;
        previewUrl = ready.thumbnail1024Url ?? ready.thumbnail256Url ?? "";
      } else {
        setSketchStatus("uploading");
      }

      retryFileId = readyFileId;
      retryFingerprint = fingerprint;
      retryPreviewUrl = previewUrl;

      if (!previewUrl) {
        throw new Error("草图图片地址不可用，请重试");
      }

      const current = editor.getShape<TLFrameShape>(shapeId);
      if (!isSketchFrame(current)) throw new Error("草图纸已不存在");
      const imageId = createShapeId(
        `fashion-sketch-image-${crypto.randomUUID()}`,
      );
      const readyRecord = createFinalizedSketchImageRecord(current, {
        fileId: readyFileId,
        fingerprint,
        imageId,
        previewUrl,
        updatedAt: new Date().toISOString(),
      });
      await bindSketchReference(projectId, imageId, {
        fileId: readyFileId,
        fingerprint,
        record: readyRecord,
      });
      editor.markHistoryStoppingPoint("finalize fashion sketch image");
      editor.run(() => {
        editor.createShape<ImageShape>(readyRecord);
        editor.deleteShape(shapeId);
        editor.select(imageId);
      });
      setActiveSketchId(null);
      configureSketchEraser(editor, null);
      editor.updateInstanceState({ isToolLocked: false });
      editor.setCurrentTool("select");
      setSketchStatus("ready");
      setSketchMessage("已合并为单张廓形图片，可直接用于 AI 生成与修改");
    } catch (cause) {
      const current = editor.getShape<TLFrameShape>(shapeId);
      if (
        isSketchFrame(current) &&
        retryFileId &&
        /^[a-f0-9]{64}$/.test(retryFingerprint)
      ) {
        editor.updateShape<TLFrameShape>({
          id: shapeId,
          meta: {
            ...current.meta,
            sketchDirty: true,
            sketchPendingFileId: retryFileId,
            sketchPendingFingerprint: retryFingerprint,
            sketchPendingPreviewUrl: retryPreviewUrl,
            sketchStatus: "draft",
          },
          type: "frame",
        });
      }
      setSketchStatus("error");
      setSketchMessage(sketchErrorMessage(cause));
      editor.updateInstanceState({ isToolLocked: true });
      editor.setCurrentTool("draw");
    } finally {
      savingSketchRef.current = false;
    }
  };

  useEffect(() => {
    if (!sketchSaving) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [sketchSaving]);

  useEffect(() => {
    if (!sketchMessage || sketchStatus === "error" || sketchSaving) return;
    const timer = window.setTimeout(() => setSketchMessage(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [sketchMessage, sketchSaving, sketchStatus]);

  useEffect(() => {
    if (!activeSketchId) return;
    const handleSketchShortcut = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-feature-guide]")) return;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void finishSketch();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const action = {
        "1": () => changeSketchSize("s"),
        "2": () => changeSketchSize("m"),
        "3": () => changeSketchSize("l"),
        b: () => selectSketchTool("draw"),
        e: () => selectSketchTool("eraser"),
        f: fitSketchToViewport,
      }[key];
      if (action) {
        event.preventDefault();
        action();
      } else if (event.key === "Escape") {
        event.preventDefault();
        requestExitSketch();
      }
    };
    window.addEventListener("keydown", handleSketchShortcut, true);
    return () =>
      window.removeEventListener("keydown", handleSketchShortcut, true);
  });

  return (
    <>
      {activeSketchId ? (
        <>
          <div
            aria-hidden="true"
            className={styles.sketchFocusShade}
            data-saving={sketchSaving ? "true" : "false"}
          />
          {sketchMessage ? (
            <div
              aria-live="polite"
              className={styles.sketchToast}
              data-status={sketchStatus}
              role={sketchStatus === "error" ? "alert" : "status"}
            >
              {sketchMessage}
            </div>
          ) : null}
        </>
      ) : sketchMessage ? (
        <div
          aria-live="polite"
          className={styles.sketchToast}
          data-status={sketchStatus}
          role={sketchStatus === "error" ? "alert" : "status"}
        >
          {sketchMessage}
        </div>
      ) : null}
      <aside
        aria-label={activeSketchId ? "草绘工具条" : "工具条"}
        className={`${styles.toolRail} ${activeSketchId ? styles.sketchToolRail : ""}`}
        data-embedded={embedded || undefined}
        data-sketch-mode={activeSketchId ? "true" : "false"}
      >
        {activeSketchId ? (
          <fieldset
            aria-busy={sketchSaving}
            className={styles.sketchControls}
            disabled={sketchSaving}
          >
            <div
              aria-label={`当前草图：${sketchTitle(activeSketch)}，铅笔笔画 ${sketchStrokeCount} 条`}
              className={styles.sketchDocumentInfo}
            >
              {renamingSketch ? (
                <div className={styles.sketchRenameControls}>
                  <input
                    aria-label="草图名称"
                    autoFocus
                    maxLength={60}
                    onChange={(event) =>
                      setSketchTitleDraft(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitSketchRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setRenamingSketch(false);
                      }
                    }}
                    value={sketchTitleDraft}
                  />
                  <button onClick={commitSketchRename} type="button">
                    保存
                  </button>
                  <button
                    onClick={() => setRenamingSketch(false)}
                    type="button"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  className={styles.sketchDocumentTitle}
                  disabled={sketchSaving}
                  onClick={beginRenameSketch}
                  title="重命名草图"
                  type="button"
                >
                  <strong>{sketchTitle(activeSketch)}</strong>
                  <span>编辑</span>
                </button>
              )}
              <span
                className={styles.sketchSyncState}
                data-state={sketchStatus}
              >
                <i aria-hidden="true" />
                {sketchStatus === "error"
                  ? "引用失败"
                  : sketchSaving
                    ? "保存中"
                    : sketchDirty
                      ? hasSketchReference
                        ? "待更新引用"
                        : "未建立引用"
                      : "已同步引用"}
              </span>
            </div>
            <div className={styles.toolDivider} />
            <div className={styles.sketchPrimaryTools} aria-label="草绘工具">
              <button
                aria-label="石墨铅笔"
                aria-pressed={currentToolId === "draw"}
                className={`${styles.toolButton} ${styles.sketchPrimaryTool}`}
                onClick={() => selectSketchTool("draw")}
                title="石墨铅笔 (B)"
                type="button"
              >
                <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                  <path
                    d="M4 15.5c2-6 3.5-9 7.5-11 2-1 4 1 2.5 2.5-3 3-5.5 5-7 9Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.45"
                  />
                </svg>
                <span>铅笔</span>
              </button>
              <button
                aria-label="局部橡皮"
                aria-pressed={currentToolId === SKETCH_ERASER_TOOL_ID}
                className={`${styles.toolButton} ${styles.sketchPrimaryTool}`}
                onClick={() => selectSketchTool("eraser")}
                title="局部橡皮（沿轨迹擦除当前草图笔画）(E)"
                type="button"
              >
                <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                  <path
                    d="m4.5 12 7-7a2 2 0 0 1 2.8 0l1 1a2 2 0 0 1 0 2.8l-6.7 6.7H6Z"
                    stroke="currentColor"
                    strokeLinejoin="round"
                    strokeWidth="1.4"
                  />
                  <path
                    d="m9 7.5 3.5 3.5M10 16h6"
                    stroke="currentColor"
                    strokeWidth="1.35"
                  />
                </svg>
                <span>橡皮</span>
              </button>
            </div>
            <div className={styles.toolDivider} />
            <button
              aria-label="适配草图纸"
              className={`${styles.toolButton} ${styles.sketchSecondaryTool}`}
              onClick={fitSketchToViewport}
              title="适配草图纸 (F)"
              type="button"
            >
              <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                <path
                  d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.45"
                />
              </svg>
            </button>
            <div className={styles.sketchOptionGroup} data-control="size">
              <span className={styles.sketchOptionLabel} aria-hidden="true">
                {currentToolId === SKETCH_ERASER_TOOL_ID ? "大小" : "粗细"}
              </span>
              <div
                className={styles.sketchSizes}
                aria-label={
                  currentToolId === SKETCH_ERASER_TOOL_ID
                    ? "橡皮大小"
                    : "铅笔粗细"
                }
              >
                {(["s", "m", "l"] as const).map((size) => (
                  <button
                    aria-label={
                      currentToolId === SKETCH_ERASER_TOOL_ID
                        ? `${{ l: "大", m: "中", s: "小" }[size]}橡皮`
                        : `${{ l: "粗", m: "中", s: "细" }[size]}铅笔`
                    }
                    aria-pressed={activeSketchSize === size}
                    data-size={size}
                    key={size}
                    onClick={() => changeSketchSize(size)}
                    type="button"
                  >
                    <span />
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.sketchOptionGroup} data-control="color">
              <span className={styles.sketchOptionLabel} aria-hidden="true">
                颜色
              </span>
              <div className={styles.sketchColors} aria-label="石墨颜色">
                {(["black", "grey"] as const).map((color) => (
                  <button
                    aria-label={color === "black" ? "黑色" : "灰色"}
                    aria-pressed={sketchColor === color}
                    data-color={color}
                    key={color}
                    onClick={() => changeSketchColor(color)}
                    type="button"
                  />
                ))}
              </div>
            </div>
            <div className={styles.toolDivider} />
            <div className={styles.toolGroup} aria-label="草图历史">
              <button
                aria-label="撤销"
                className={styles.toolButton}
                onClick={() => editor.undo()}
                title="撤销"
                type="button"
              >
                ↶
              </button>
              <button
                aria-label="重做"
                className={styles.toolButton}
                onClick={() => editor.redo()}
                title="重做"
                type="button"
              >
                ↷
              </button>
              <button
                aria-label="清空草图"
                className={styles.toolButton}
                disabled={sketchStrokeCount === 0}
                onClick={clearSketch}
                title="清空草图"
                type="button"
              >
                ×
              </button>
            </div>
            <div className={styles.toolDivider} />
            <button
              className={styles.sketchExitButton}
              onClick={requestExitSketch}
              type="button"
            >
              退出
            </button>
            <button
              className={styles.sketchFinishButton}
              disabled={
                sketchStrokeCount === 0 ||
                (!sketchDirty && sketchStatus === "ready")
              }
              onClick={() => void finishSketch()}
              type="button"
            >
              {sketchStatus === "rendering"
                ? "渲染中"
                : sketchStatus === "uploading"
                  ? "引用中"
                  : sketchStatus === "error"
                    ? "重试完成"
                    : !sketchDirty && sketchStatus === "ready"
                      ? "AI 已同步"
                      : "完成并引用"}
            </button>
          </fieldset>
        ) : (
          <div className={styles.toolScroller}>
            {/* ── 导航工具 ── */}
            <div className={styles.toolGroup}>
              {/* 添加节点或上传图片 */}
              {addNodeControl ??
              <RailButton
                className={styles.toolButton}
                onClick={() =>
                  onUpload ? onUpload() : window.dispatchEvent(new Event(BOARD_FILE_PICKER_EVENT))
                }
                disabled={!editable}
                title="上传图片"
                type="button"
                aria-label="上传图片"
              >
                <BottomToolbarIcon name="upload" />
              </RailButton>}
            </div>

            <div className={styles.toolDivider} />

            {/* ── 绘制工具 ── */}
            <div className={styles.toolGroup}>
              {/* 选择 */}
              <RailButton
                className={styles.toolButton}
                onClick={() => setTool("select")}
                disabled={!ready}
                title="选择 (V)"
                type="button"
                aria-label="选择工具"
                aria-pressed={currentToolId === "select"}
              >
                <BottomToolbarIcon name="select" />
              </RailButton>

              {/* 服装草绘入口 */}
              <RailButton
                className={styles.toolButton}
                data-tool="sketch"
                onClick={openSketch}
                disabled={!editable}
                title={selectedSketchId ? "编辑选中的廓形草图" : "新建廓形草图"}
                type="button"
                aria-label={
                  selectedSketchId ? "编辑选中的廓形草图" : "新建廓形草图"
                }
                aria-pressed={Boolean(selectedSketchId)}
              >
                <BottomToolbarIcon name="sketch" />
              </RailButton>

            </div>

            <div className={styles.toolDivider} />

            {/* ── 设计对象 ── */}
            <div className={styles.toolGroup}>
              {/* 色卡 — 三列色带 */}
              <RailButton
                className={styles.toolButton}
                onClick={() => createShape(SWATCH_SHAPE_TYPE)}
                disabled={!editable}
                title="色卡"
                type="button"
                aria-label="添加色卡"
              >
                <BottomToolbarIcon name="swatches" />
              </RailButton>


              {/* 面料库 — 布卷图标 */}
              <RailButton
                className={styles.toolButton}
                onClick={onOpenFabrics}
                disabled={!ready}
                title="面料素材库"
                type="button"
                aria-label="打开面料库"
              >
                <BottomToolbarIcon name="fabric" />
              </RailButton>


            </div>
          </div>
        )}
        {!activeSketchId ? children : null}
      </aside>
    </>
  );
}
