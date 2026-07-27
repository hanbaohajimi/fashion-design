"use client";

import { createContext, useContext, useMemo } from "react";
import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  Tldraw,
  type TLAnyShapeUtilConstructor,
  type TLComponents,
} from "tldraw";

import { BoardToolbar } from "./BoardToolbar";
import { BoardFileDrop } from "./BoardFileDrop";
import { ElementRolePanel } from "./ElementRolePanel";
import { BoardSkeleton } from "./BoardSkeleton";
import { BoardProjectContext } from "./board-context";
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

interface BoardCanvasProps {
  readonly projectId: string;
}

const PersistStatusContext = createContext<BoardPersistStatus>("loading");

function ConnectedBoardToolbar() {
  return <BoardToolbar status={useContext(PersistStatusContext)} />;
}

function BoardCanvasOverlay() {
  return (
    <>
      <BoardFileDrop />
      <ElementRolePanel />
      <GenerationBar />
      <CandidateGrid />
      <TaskTray />
    </>
  );
}

const boardComponents: TLComponents = {
  InFrontOfTheCanvas: BoardCanvasOverlay,
  TopPanel: ConnectedBoardToolbar,
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
          <GenerationWorkspace>
            <Tldraw
              autoFocus
              components={boardComponents}
              {...(tldrawLicenseKey ? { licenseKey: tldrawLicenseKey } : {})}
              shapeUtils={boardShapeUtils}
              store={store}
            />
          </GenerationWorkspace>
        </BoardProjectContext.Provider>
      </PersistStatusContext.Provider>
    </main>
  );
}
