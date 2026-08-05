import { createContext } from "react";

export const BOARD_FILE_PICKER_EVENT = "fashion-board:open-file-picker";
export const BOARD_LABEL_DESIGN_EVENT = "fashion-board:open-label-design";
export const BOARD_REMOTE_REFRESH_EVENT = "fashion-board:remote-refresh";
export const BOARD_LAYOUT_CHANGE_EVENT = "fashion-board:layout-change";

export interface BoardLabelDesignDetail {
  shapeId: string;
}

export function requestBoardLabelDesign(shapeId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<BoardLabelDesignDetail>(BOARD_LABEL_DESIGN_EVENT, {
      detail: { shapeId },
    }),
  );
}

export interface BoardRemoteRefreshDetail {
  boardId: string;
}

export function notifyBoardRemoteRefresh(boardId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<BoardRemoteRefreshDetail>(BOARD_REMOTE_REFRESH_EVENT, {
      detail: { boardId },
    }),
  );
}

export const BoardProjectContext = createContext("");
