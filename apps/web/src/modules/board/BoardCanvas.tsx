"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  DefaultStylePanel,
  Tldraw,
  type TLAnyShapeUtilConstructor,
  type TLComponents,
  type TLStateNodeConstructor,
  type TLShapeId,
  type TLUiOverrides,
  type TLUiStylePanelProps,
  useEditor,
  useValue,
} from "tldraw";

import { BoardActionPanels } from "./BoardActionPanels";
import { BoardAgentPanel } from "./agent/BoardAgentPanel";
import { ToolRail } from "./ToolRail";
import { ContextInspector } from "./ContextInspector";
import { FabricDrawer } from "./FabricDrawer";
import { BoardFileDrop } from "./BoardFileDrop";
import { BoardFabricDrop } from "./BoardFabricDrop";
import { BoardSkeleton } from "./BoardSkeleton";
import {
  BOARD_FILE_PICKER_EVENT,
  BOARD_LAYOUT_CHANGE_EVENT,
  BoardProjectContext,
} from "./board-context";
import {
  GenerationWorkspace,
  useGenerationWorkspace,
} from "./generation/GenerationWorkspace";
import type {
  GenerationCandidate,
  GenerationTaskItem,
} from "./generation/generation-types";
import { shouldCreateGenerationPlaceholder } from "./generation/generation-types";
import {
  type BoardPersistStatus,
  useBoardPersist,
} from "./hooks/useBoardPersist";
import { boardShapeUtils, IMAGE_SHAPE_TYPE, type ImageShape } from "./shapes";
import { MountTool, SketchEraserTool } from "./tools/MountTool";
import styles from "./board.module.css";
import { ErrorBoundary } from "../../observability/ErrorBoundary";

interface BoardCanvasProps {
  readonly projectId: string;
}

const PersistStatusContext = createContext<BoardPersistStatus>("loading");
interface BoardLayoutValue {
  readonly chatCollapsed: boolean;
  readonly toggleChat: () => void;
}

const BoardLayoutContext = createContext<BoardLayoutValue>({
  chatCollapsed: false,
  toggleChat: () => undefined,
});
const DRAWING_SHAPE_TYPES = new Set(["arrow", "draw", "geo", "text"]);
const GENERATION_TILE_WIDTH = 420;
const GENERATION_TILE_GAP = 56;
const FRESH_GENERATION_WINDOW_MS = 30_000;

function generationTileSize(
  task: GenerationTaskItem,
  candidate?: GenerationCandidate,
): { readonly height: number; readonly width: number } {
  const sourceWidth = candidate?.width ?? task.request.parameters.width;
  const sourceHeight = candidate?.height ?? task.request.parameters.height;
  const ratio = Math.min(1.65, Math.max(0.58, sourceHeight / sourceWidth));
  const width = Math.min(
    480,
    Math.max(320, candidate?.width ?? GENERATION_TILE_WIDTH),
  );
  return {
    height: Math.round(width * ratio),
    width,
  };
}

function taskAnchor(
  editor: ReturnType<typeof useEditor>,
  task: GenerationTaskItem,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  const referenceBounds = task.request.shapeIds.flatMap((id) => {
    const shape = editor.getShape(id as TLShapeId);
    const bounds = shape ? editor.getShapePageBounds(shape) : null;
    return bounds ? [bounds] : [];
  });
  if (referenceBounds.length > 0) {
    return {
      x: Math.max(...referenceBounds.map((bounds) => bounds.maxX)) + 88,
      y: Math.min(...referenceBounds.map((bounds) => bounds.minY)),
    };
  }
  const viewport = editor.getViewportPageBounds();
  return {
    x: viewport.center.x - width / 2,
    y: viewport.center.y - height / 2,
  };
}

function overlapsGenerationTile(
  x: number,
  y: number,
  width: number,
  height: number,
  occupied: readonly {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  }[],
): boolean {
  return occupied.some(
    (item) =>
      x < item.x + item.width + GENERATION_TILE_GAP &&
      x + width + GENERATION_TILE_GAP > item.x &&
      y < item.y + item.height + GENERATION_TILE_GAP &&
      y + height + GENERATION_TILE_GAP > item.y,
  );
}

function openGenerationPosition(
  editor: ReturnType<typeof useEditor>,
  task: GenerationTaskItem,
  width: number,
  height: number,
  occupied: readonly {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  }[],
): { readonly x: number; readonly y: number } {
  const anchor = taskAnchor(editor, task, width, height);
  let x = anchor.x;
  let y = anchor.y;
  let attempts = 0;
  while (
    attempts < 24 &&
    overlapsGenerationTile(x, y, width, height, occupied)
  ) {
    const column = (attempts + 1) % 3;
    const row = Math.floor((attempts + 1) / 3);
    x = anchor.x + column * (width + GENERATION_TILE_GAP);
    y = anchor.y + row * (height + GENERATION_TILE_GAP);
    attempts += 1;
  }
  return { x, y };
}

function DrawingStylePanel(props: TLUiStylePanelProps) {
  const editor = useEditor();
  const visible = useValue(
    "drawing-style-panel-visible",
    () => {
      const selectedShapes = editor.getSelectedShapes();
      return (
        selectedShapes.length > 0 &&
        selectedShapes.every((shape) => DRAWING_SHAPE_TYPES.has(shape.type))
      );
    },
    [editor],
  );

  return visible ? <DefaultStylePanel {...props} /> : null;
}

function EmptyBoardGuide() {
  const editor = useEditor();
  const empty = useValue(
    "empty-board-guide",
    () => editor.getCurrentPageShapes().length === 0,
    [editor],
  );
  if (!empty) return null;

  return (
    <section className={styles.emptyBoardGuide} aria-label="白板三步上手">
      <span>START / 01</span>
      <h1>把第一份灵感放进白板</h1>
      <p>拖入或粘贴图片，也可以从这里选择文件。系统会在后台识别素材角色。</p>
      <ol>
        <li>上传参考</li>
        <li>确认角色</li>
        <li>框选并生成</li>
      </ol>
      <button
        onClick={() => window.dispatchEvent(new Event(BOARD_FILE_PICKER_EVENT))}
        type="button"
      >
        上传第一张参考
      </button>
    </section>
  );
}

function GenerationCanvasBridge() {
  const editor = useEditor();
  const { dismissCandidate, tasks } = useGenerationWorkspace();
  const focusedTasks = useRef(new Set<string>());

  useEffect(
    () =>
      editor.store.listen(
        (entry) => {
          for (const record of Object.values(entry.changes.removed)) {
            if (
              record.typeName !== "shape" ||
              record.type !== IMAGE_SHAPE_TYPE
            ) {
              continue;
            }
            const candidateId = (record as ImageShape).props
              .generationCandidateId;
            if (candidateId) {
              void dismissCandidate(candidateId);
            }
          }
        },
        { scope: "document", source: "user" },
      ),
    [dismissCandidate, editor],
  );

  useEffect(() => {
    const imageShapes = editor
      .getCurrentPageShapes()
      .filter((shape) => shape.type === IMAGE_SHAPE_TYPE) as ImageShape[];
    const occupied = imageShapes
      .filter((shape) => shape.props.generationTaskId)
      .map((shape) => ({
        height: shape.props.h,
        width: shape.props.w,
        x: shape.x,
        y: shape.y,
      }));
    let focusedThisPass = false;

    for (const task of tasks) {
      const candidates = task.candidates.filter(
        (candidate) => candidate.disposition !== "dismissed",
      );
      const taskShapes = imageShapes.filter(
        (shape) => shape.props.generationTaskId === task.id,
      );
      const firstTaskShape = taskShapes[0];
      const firstSize = generationTileSize(task, candidates[0]);
      const origin = firstTaskShape
        ? { x: firstTaskShape.x, y: firstTaskShape.y }
        : openGenerationPosition(
            editor,
            task,
            firstSize.width,
            firstSize.height,
            occupied,
          );

      const placeShape = (
        index: number,
        candidate?: GenerationCandidate,
      ): void => {
        const size = generationTileSize(task, candidate);
        const candidateId = candidate?.id;
        const existing = candidate
          ? (imageShapes.find(
              (shape) =>
                shape.props.generationCandidateId === candidate.id ||
                (candidate.assetId &&
                  shape.props.assetId === candidate.assetId),
            ) ??
            (index === 0
              ? taskShapes.find((shape) => !shape.props.generationCandidateId)
              : undefined))
          : firstTaskShape;
        const x = origin.x + (index % 2) * (size.width + GENERATION_TILE_GAP);
        const y =
          origin.y +
          Math.floor(index / 2) * (size.height + GENERATION_TILE_GAP);

        if (existing) {
          const wasPlaceholder = Boolean(
            existing.props.generationTaskId && !existing.props.url,
          );
          const nextProps = {
            ...(candidate ? { assetId: candidate.assetId } : {}),
            ...(candidateId ? { generationCandidateId: candidateId } : {}),
            generationError: task.error ?? "",
            generationPrompt: task.prompt,
            generationStatus: task.status,
            generationTaskId: task.id,
            ...(wasPlaceholder && candidate
              ? { h: size.height, w: size.width }
              : {}),
            ...(candidate ? { url: candidate.url } : {}),
          };
          const changed =
            existing.props.generationCandidateId !== candidateId ||
            existing.props.generationError !== (task.error ?? "") ||
            existing.props.generationPrompt !== task.prompt ||
            existing.props.generationStatus !== task.status ||
            existing.props.generationTaskId !== task.id ||
            (candidate !== undefined &&
              (existing.props.assetId !== candidate.assetId ||
                existing.props.url !== candidate.url ||
                (wasPlaceholder &&
                  (existing.props.w !== size.width ||
                    existing.props.h !== size.height))));
          if (changed) {
            editor.updateShape<ImageShape>({
              id: existing.id,
              props: nextProps,
              type: IMAGE_SHAPE_TYPE,
            });
          }
          if (candidate && candidate.disposition !== "adopted") {
            void dismissCandidate(candidate.id, "adopted");
          }
          return;
        }

        const shapeId = createShapeId(`generation-${task.id}-${index}`);
        editor.createShape<ImageShape>({
          id: shapeId,
          props: {
            ...(candidate ? { assetId: candidate.assetId } : {}),
            ...(candidateId ? { generationCandidateId: candidateId } : {}),
            generationError: task.error ?? "",
            generationPrompt: task.prompt,
            generationStatus: task.status,
            generationTaskId: task.id,
            h: size.height,
            role: "garment_ref",
            roleInferenceState: "ready",
            roleSource: "default",
            title: candidate ? "AI 生成设计" : "AI 生成中",
            uploadStatus: "ready",
            url: candidate?.url ?? "",
            w: size.width,
          },
          type: IMAGE_SHAPE_TYPE,
          x,
          y,
        });
        imageShapes.push(editor.getShape(shapeId) as ImageShape);
        occupied.push({ height: size.height, width: size.width, x, y });
        if (candidate && candidate.disposition !== "adopted") {
          void dismissCandidate(candidate.id, "adopted");
        }

        const createdRecently =
          Date.now() - Date.parse(task.createdAt) < FRESH_GENERATION_WINDOW_MS;
        if (
          !focusedThisPass &&
          createdRecently &&
          !focusedTasks.current.has(task.id)
        ) {
          focusedThisPass = true;
          focusedTasks.current.add(task.id);
          editor.select(shapeId);
          if (task.taskType === "inpaint") {
            editor.zoomToSelection({ animation: { duration: 220 } });
          }
        }
      };

      if (candidates.length > 0) {
        candidates.forEach((candidate, index) => placeShape(index, candidate));
      } else if (
        shouldCreateGenerationPlaceholder(task.status, Boolean(firstTaskShape))
      ) {
        placeShape(0);
      }
    }
  }, [dismissCandidate, editor, tasks]);

  return null;
}

function BoardCanvasOverlay() {
  const [fabricsOpen, setFabricsOpen] = useState(false);
  const [collectionLauncherOpen, setCollectionLauncherOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const projectId = useContext(BoardProjectContext);
  const status = useContext(PersistStatusContext);
  const layout = useContext(BoardLayoutContext);
  return (
    <>
      <BoardActionPanels
        collectionLauncherOpen={collectionLauncherOpen}
        exportMenuOpen={exportMenuOpen}
        onCollectionLauncherOpenChange={setCollectionLauncherOpen}
        onExportMenuOpenChange={setExportMenuOpen}
        status={status}
      />
      <ToolRail
        collectionsOpen={collectionLauncherOpen}
        onOpenCollections={() => {
          setCollectionLauncherOpen((current) => !current);
          setExportMenuOpen(false);
          setFabricsOpen(false);
        }}
        onOpenFabrics={() => {
          setFabricsOpen((current) => !current);
          setCollectionLauncherOpen(false);
          setExportMenuOpen(false);
        }}
      />
      <ContextInspector />
      {fabricsOpen && <FabricDrawer onClose={() => setFabricsOpen(false)} />}
      <BoardFileDrop />
      <BoardFabricDrop />
      <EmptyBoardGuide />
      <GenerationCanvasBridge />
      <ErrorBoundary area="generation">
        <BoardAgentPanel
          boardStatus={status}
          collapsed={layout.chatCollapsed}
          key={projectId}
          onToggle={layout.toggleChat}
        />
      </ErrorBoundary>
    </>
  );
}

const boardComponents: TLComponents = {
  InFrontOfTheCanvas: BoardCanvasOverlay,
  MenuPanel: null,
  QuickActions: null,
  StylePanel: DrawingStylePanel,
  Toolbar: null,
};
const boardUiOverrides: TLUiOverrides = {
  translations: {
    "zh-cn": {
      "action.copy-hovered-styles": "复制悬停样式",
      "action.frame-selection": "为所选内容添加画板框",
      "page-menu.max-pages-reached": "已达到页面数量上限",
      "page-menu.resize": "调整页面菜单大小",
    },
  },
};
const boardAssetUrls = {
  translations: {
    "zh-cn": "/tldraw-translations/zh-cn",
  },
};
const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;

export default function BoardCanvas({ projectId }: BoardCanvasProps) {
  const [chatCollapsed, setChatCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("fashion-board-agent-collapsed");
    if (saved !== null) return saved === "1";
    return window.matchMedia("(max-width: 1280px)").matches;
  });
  const store = useMemo(
    () =>
      createTLStore({
        bindingUtils: defaultBindingUtils,
        shapeUtils: [
          ...defaultShapeUtils,
          ...boardShapeUtils,
        ] as unknown as readonly TLAnyShapeUtilConstructor[],
      }),
    [],
  );
  const persistence = useBoardPersist(projectId, store);
  const layout = useMemo(
    () => ({
      chatCollapsed,
      toggleChat: () => setChatCollapsed((current) => !current),
    }),
    [chatCollapsed],
  );

  useEffect(() => {
    window.localStorage.setItem(
      "fashion-board-agent-collapsed",
      chatCollapsed ? "1" : "0",
    );
    document.documentElement.style.setProperty(
      "--board-agent-current-width",
      chatCollapsed ? "48px" : "400px",
    );
    window.dispatchEvent(new Event(BOARD_LAYOUT_CHANGE_EVENT));
  }, [chatCollapsed]);

  if (persistence.status === "loading") {
    return <BoardSkeleton />;
  }

  if (persistence.status === "error") {
    return (
      <main className={styles.boardError}>
        <p>BOARD / ERROR</p>
        <h1>画布暂时无法打开</h1>
        <span>{persistence.error}</span>
        <button onClick={persistence.retry} type="button">
          重新加载
        </button>
      </main>
    );
  }

  return (
    <main
      className={styles.boardShell}
      data-chat-collapsed={chatCollapsed ? "true" : "false"}
    >
      <PersistStatusContext.Provider value={persistence.status}>
        <BoardProjectContext.Provider value={projectId}>
          <BoardLayoutContext.Provider value={layout}>
            <GenerationWorkspace>
              <div className={styles.canvasWrapper}>
                <Tldraw
                  assetUrls={boardAssetUrls}
                  autoFocus
                  components={boardComponents}
                  locale="zh-cn"
                  overrides={boardUiOverrides}
                  {...(tldrawLicenseKey
                    ? { licenseKey: tldrawLicenseKey }
                    : {})}
                  shapeUtils={boardShapeUtils}
                  tools={
                    [MountTool, SketchEraserTool] as unknown as TLStateNodeConstructor[]
                  }
                  store={store}
                />
              </div>
            </GenerationWorkspace>
          </BoardLayoutContext.Provider>
        </BoardProjectContext.Provider>
      </PersistStatusContext.Provider>
      {persistence.status === "conflict" ? (
        <section
          aria-live="assertive"
          className={styles.boardConflictNotice}
          role="alert"
        >
          <div>
            <strong>检测到版本冲突</strong>
            <span>{persistence.error}</span>
          </div>
          <button onClick={persistence.resolveConflict} type="button">
            读取最新版本并合并
          </button>
          <small>
            此操作会读取最新远端画布，并重新应用当前本地待保存修改。
          </small>
        </section>
      ) : null}
    </main>
  );
}
