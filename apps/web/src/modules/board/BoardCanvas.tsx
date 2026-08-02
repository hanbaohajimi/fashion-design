"use client";

import { createContext, useMemo, useState } from "react";
import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  Tldraw,
  type TLAnyShapeUtilConstructor,
  type TLComponents,
  useEditor,
  useValue,
} from "tldraw";

import { AtelierTopBar } from "./AtelierTopBar";
import { ToolRail } from "./ToolRail";
import { ContextInspector } from "./ContextInspector";
import { FabricDrawer } from "./FabricDrawer";
import { BoardFileDrop } from "./BoardFileDrop";
import { BoardFabricDrop } from "./BoardFabricDrop";
import { BoardSkeleton } from "./BoardSkeleton";
import { BOARD_FILE_PICKER_EVENT, BoardProjectContext } from "./board-context";
import { CandidateGrid } from "./generation/CandidateGrid";
import { GenerationBar } from "./generation/GenerationBar";
import { GenerationWorkspace } from "./generation/GenerationWorkspace";
import { TaskTray } from "./generation/TaskTray";
import {
  type BoardPersistStatus,
  useBoardPersist,
} from "./hooks/useBoardPersist";
import { boardShapeUtils } from "./shapes";
import styles from "./board.module.css";
import { ErrorBoundary } from "../../observability/ErrorBoundary";

interface BoardCanvasProps {
  readonly projectId: string;
}

const PersistStatusContext = createContext<BoardPersistStatus>("loading");

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
  return (
    <>
      <ToolRail onOpenFabrics={() => setFabricsOpen((v) => !v)} />
      <ContextInspector />
      {fabricsOpen && <FabricDrawer onClose={() => setFabricsOpen(false)} />}
      <BoardFileDrop />
      <BoardFabricDrop />
      <EmptyBoardGuide />
      <ErrorBoundary area="generation">
        <GenerationBar />
        <CandidateGrid />
        <TaskTray />
      </ErrorBoundary>
    </>
  );
}

const boardComponents: TLComponents = {
  InFrontOfTheCanvas: BoardCanvasOverlay,
};
const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;

export default function BoardCanvas({ projectId }: BoardCanvasProps) {
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
    <main className={styles.boardShell}>
      <PersistStatusContext.Provider value={persistence.status}>
        <BoardProjectContext.Provider value={projectId}>
          <AtelierTopBar
            onOpenCollection={() => {/* TODO Step 4: open collection modal */}}
            onOpenExport={() => {/* TODO Step 4: open export modal */}}
            status={persistence.status}
          />
          <GenerationWorkspace>
            <div className={styles.canvasWrapper}>
              <Tldraw
                autoFocus
                components={boardComponents}
                {...(tldrawLicenseKey ? { licenseKey: tldrawLicenseKey } : {})}
                shapeUtils={boardShapeUtils}
                store={store}
              />
            </div>
          </GenerationWorkspace>
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
