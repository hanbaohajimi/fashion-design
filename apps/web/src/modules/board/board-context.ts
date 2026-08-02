import { createContext } from "react";

export const BOARD_FILE_PICKER_EVENT = "fashion-board:open-file-picker";
export const BOARD_REMOTE_REFRESH_EVENT = "fashion-board:remote-refresh";

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
