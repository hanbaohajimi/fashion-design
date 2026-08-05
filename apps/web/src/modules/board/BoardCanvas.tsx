"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  DefaultStylePanel,
  Tldraw,
  type TLAnyShapeUtilConstructor,
  type TLComponents,
  type TLStateNodeConstructor,
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
import { GenerationBar } from "./generation/GenerationBar";
import { GenerationWorkspace } from "./generation/GenerationWorkspace";
import {
  type BoardPersistStatus,
  useBoardPersist,
} from "./hooks/useBoardPersist";
import { boardShapeUtils } from "./shapes";
import { MountTool } from "./tools/MountTool";
import { ConnectorTool } from "./tools/ConnectorTool";
import { AnchorOverlay } from "./connectors/AnchorOverlay";
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

function BoardCanvasOverlay() {
  const [fabricsOpen, setFabricsOpen] = useState(false);
  const status = useContext(PersistStatusContext);
  const layout = useContext(BoardLayoutContext);
  return (
    <>
      <BoardActionPanels status={status} />
      <ToolRail onOpenFabrics={() => setFabricsOpen((v) => !v)} />
      <ContextInspector />
      {fabricsOpen && <FabricDrawer onClose={() => setFabricsOpen(false)} />}
      <BoardFileDrop />
      <BoardFabricDrop />
      <EmptyBoardGuide />
      <AnchorOverlay />
      <ErrorBoundary area="generation">
        <GenerationBar />
      </ErrorBoundary>
      <ErrorBoundary area="generation">
        <BoardAgentPanel
          collapsed={layout.chatCollapsed}
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
const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;

export default function BoardCanvas({ projectId }: BoardCanvasProps) {
  const [chatCollapsed, setChatCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("fashion-board-agent-collapsed");
    if (saved !== null) return saved === "1";
    return window.matchMedia("(max-width: 1024px)").matches;
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
                  autoFocus
                  components={boardComponents}
                  {...(tldrawLicenseKey
                    ? { licenseKey: tldrawLicenseKey }
                    : {})}
                  shapeUtils={boardShapeUtils}
                  tools={
                    [
                      MountTool,
                      ConnectorTool,
                    ] as unknown as TLStateNodeConstructor[]
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
