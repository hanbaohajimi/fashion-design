"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSnapshot,
  loadSnapshot,
  type TLRecord,
  type TLShape,
  type TLShapeId,
  type TLStore,
} from "tldraw";

import {
  BoardApiError,
  type BoardElementPatch,
  type BoardElementRow,
  type BoardPatchPayload,
  fetchBoard,
  patchBoard,
} from "../board-api";
import {
  BOARD_REMOTE_REFRESH_EVENT,
  type BoardRemoteRefreshDetail,
} from "../board-context";
import { IMAGE_SHAPE_TYPE, isBoardShape, normalizeBoardRole } from "../shapes";
import { captureAnalytics } from "../../../observability/analytics";

const SAVE_DEBOUNCE_MS = 1_500;
const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 30_000;

export type BoardPersistStatus =
  "loading" | "ready" | "saving" | "saved" | "offline" | "conflict" | "error";

export interface BoardPersistState {
  readonly error: string | null;
  readonly resolveConflict: () => void;
  readonly retry: () => void;
  readonly status: BoardPersistStatus;
}

function isShapeRecord(record: TLRecord): record is TLShape {
  return record.typeName === "shape";
}

function roleForShape(shape: TLShape): string {
  if (isBoardShape(shape)) {
    return normalizeBoardRole(shape.props.role);
  }

  const role = shape.meta.role;
  return typeof role === "string" ? role : "generic";
}

function semanticForShape(shape: TLShape) {
  const candidate =
    typeof shape.meta.roleSource === "string"
      ? shape.meta.roleSource
      : shape.type === IMAGE_SHAPE_TYPE
        ? shape.props.roleSource
        : undefined;
  let roleSource: "default" | "inferred" | "manual" = "default";
  if (candidate === "manual" || candidate === "inferred") {
    roleSource = candidate;
  }
  if (shape.type !== IMAGE_SHAPE_TYPE) {
    return {
      roleInferenceState: "ready" as const,
      roleSource,
    };
  }
  const state = shape.props.roleInferenceState;
  const roleInferenceState: "none" | "pending" | "ready" | "failed" =
    state === "pending" || state === "failed" || state === "ready"
      ? state
      : "none";
  return {
    roleConfidence: shape.props.roleConfidence ?? null,
    roleInferenceState,
    roleLabel: shape.props.roleLabel ?? null,
    roleSource,
  };
}

function applyElementRows(
  store: TLStore,
  elements: readonly BoardElementRow[],
): void {
  store.mergeRemoteChanges(() => {
    for (const element of elements) {
      const shapeId = element.shapeId as TLShapeId;

      if (element.deleted) {
        if (store.has(shapeId)) {
          store.remove([shapeId]);
        }
        continue;
      }

      if (!element.record) {
        continue;
      }

      const current = store.get(shapeId);
      const base = current?.typeName === "shape" ? current : element.record;
      const next = isBoardShape(base)
        ? {
            ...base,
            props: {
              ...base.props,
              ...element.record.props,
              role: normalizeBoardRole(element.role),
              ...(base.type === IMAGE_SHAPE_TYPE
                ? {
                    roleConfidence: element.roleConfidence ?? undefined,
                    roleInferenceState: element.roleInferenceState,
                    roleLabel: element.roleLabel ?? undefined,
                    roleSource: element.roleSource,
                  }
                : {}),
            },
            meta: {
              ...base.meta,
              ...element.record.meta,
              roleSource: element.roleSource,
            },
          }
        : {
            ...base,
            meta: {
              ...base.meta,
              role: element.role,
            },
          };

      store.put([next as TLShape]);
    }
  });
}

function applyElementPatches(
  store: TLStore,
  patches: readonly BoardElementPatch[],
): void {
  store.mergeRemoteChanges(() => {
    for (const patch of patches) {
      const shapeId = patch.shapeId as TLShapeId;
      if (patch.deleted) {
        if (store.has(shapeId)) {
          store.remove([shapeId]);
        }
      } else {
        store.put([patch.record]);
      }
    }
  });
}

type StoredBoardPatchPayload = Omit<BoardPatchPayload, "baseRevision"> & {
  readonly baseRevision?: number;
};

function readOutbox(key: string): StoredBoardPatchPayload | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as StoredBoardPatchPayload) : null;
  } catch {
    return null;
  }
}

function storedBaseRevision(payload: StoredBoardPatchPayload): number {
  return typeof payload.baseRevision === "number" &&
    Number.isInteger(payload.baseRevision) &&
    payload.baseRevision >= 0
    ? payload.baseRevision
    : 0;
}

export function useBoardPersist(
  projectId: string,
  store: TLStore,
): BoardPersistState {
  const [status, setStatus] = useState<BoardPersistStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const rebaseOutboxRef = useRef(false);
  const retry = useCallback(() => setReloadToken((value) => value + 1), []);
  const resolveConflict = useCallback(() => {
    rebaseOutboxRef.current = true;
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const outboxKey = `fashion-board-outbox:${projectId}`;
    const pending = new Map<string, BoardElementPatch>();
    let snapshotDirty = false;
    let disposed = false;
    let conflictDetected = false;
    let flushInFlight = false;
    let inFlightPayload: BoardPatchPayload | null = null;
    let revision = 0;
    let saveTimer: number | undefined;
    let retryTimer: number | undefined;
    let retryDelay = RETRY_MIN_MS;

    const saveOutbox = (payload: BoardPatchPayload): void => {
      try {
        window.localStorage.setItem(outboxKey, JSON.stringify(payload));
      } catch {
        // Network retry still keeps the queue in memory when storage is full.
      }
    };

    const makePayload = (
      patches: readonly BoardElementPatch[],
    ): BoardPatchPayload => ({
      baseRevision: revision,
      batchId: crypto.randomUUID(),
      patches,
      snapshot: getSnapshot(store),
    });

    const scheduleFlush = (delay = SAVE_DEBOUNCE_MS): void => {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
      }
      saveTimer = window.setTimeout(() => {
        saveTimer = undefined;
        void flush();
      }, delay);
    };

    const flush = async (): Promise<void> => {
      if (disposed || flushInFlight || (!snapshotDirty && pending.size === 0)) {
        return;
      }

      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = undefined;
      }

      flushInFlight = true;
      const sending = new Map(pending);
      pending.clear();
      snapshotDirty = false;
      const payload = makePayload([...sending.values()]);
      inFlightPayload = payload;
      saveOutbox(payload);
      setStatus(navigator.onLine ? "saving" : "offline");

      try {
        const result = await patchBoard(projectId, payload);
        revision = result.revision;
        retryDelay = RETRY_MIN_MS;
        setError(null);

        if (pending.size === 0 && !snapshotDirty) {
          window.localStorage.removeItem(outboxKey);
          setStatus("saved");
        }
      } catch (cause) {
        for (const [shapeId, patch] of sending) {
          if (!pending.has(shapeId)) {
            pending.set(shapeId, patch);
          }
        }
        snapshotDirty = true;
        saveOutbox(makePayload([...pending.values()]));

        if (saveTimer) {
          window.clearTimeout(saveTimer);
          saveTimer = undefined;
        }

        if (
          cause instanceof BoardApiError &&
          cause.status === 409 &&
          cause.code === "BOARD_REVISION_CONFLICT"
        ) {
          conflictDetected = true;
          if (retryTimer) {
            window.clearTimeout(retryTimer);
            retryTimer = undefined;
          }
          setStatus("conflict");
          setError(
            "检测到其他窗口已保存更新。本地待保存内容已保留；请读取最新版本后再重试。",
          );
        } else {
          setStatus("offline");
          setError(cause instanceof Error ? cause.message : "画布保存失败");
        }

        if (!conflictDetected && !retryTimer) {
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            void flush();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        }
      } finally {
        flushInFlight = false;
        inFlightPayload = null;
        if (
          !disposed &&
          !conflictDetected &&
          !retryTimer &&
          (pending.size > 0 || snapshotDirty)
        ) {
          scheduleFlush();
        }
      }
    };

    const queueRecord = (record: TLRecord, deleted: boolean): void => {
      if (!isShapeRecord(record)) {
        return;
      }

      pending.set(
        record.id,
        deleted
          ? { deleted: true, shapeId: record.id }
          : {
              deleted: false,
              record,
              role: roleForShape(record),
              ...semanticForShape(record),
              shapeId: record.id,
              shapeType: record.type,
            },
      );
    };

    const restore = async (): Promise<() => void> => {
      setStatus("loading");
      setError(null);
      const localOutbox = readOutbox(outboxKey);
      let serverRevision: number | null = null;

      try {
        const board = await fetchBoard(projectId);
        serverRevision = board.revision;
        revision = board.revision;

        if (board.snapshot) {
          loadSnapshot(store, board.snapshot);
        }
        applyElementRows(store, board.elements);
      } catch (cause) {
        if (!localOutbox) {
          throw cause;
        }
      }

      if (localOutbox) {
        const localBaseRevision = storedBaseRevision(localOutbox);
        const latestRevision = rebaseOutboxRef.current ? serverRevision : null;
        if (latestRevision !== null) {
          revision = latestRevision;
          rebaseOutboxRef.current = false;
        } else {
          revision = localBaseRevision;
          if (serverRevision !== null && localBaseRevision !== serverRevision) {
            conflictDetected = true;
          }
          if (rebaseOutboxRef.current && serverRevision === null) {
            conflictDetected = true;
          }
        }

        if (latestRevision !== null) {
          applyElementPatches(store, localOutbox.patches);
        } else {
          loadSnapshot(store, localOutbox.snapshot);
        }
        for (const patch of localOutbox.patches) {
          pending.set(patch.shapeId, patch);
        }
        snapshotDirty = true;
        saveOutbox(makePayload([...pending.values()]));
      } else if (serverRevision !== null) {
        rebaseOutboxRef.current = false;
      }

      const stopListening = store.listen(
        (entry) => {
          snapshotDirty = true;

          for (const record of Object.values(entry.changes.added)) {
            queueRecord(record, false);
            if (isShapeRecord(record)) {
              captureAnalytics("board_element_added", {
                element_type: record.type,
              });
            }
          }
          for (const [, record] of Object.values(entry.changes.updated)) {
            queueRecord(record, false);
          }
          for (const record of Object.values(entry.changes.removed)) {
            queueRecord(record, true);
          }

          if (conflictDetected) {
            saveOutbox(makePayload([...pending.values()]));
          } else {
            setStatus("saving");
            scheduleFlush();
          }
        },
        { scope: "document", source: "user" },
      );

      if (conflictDetected) {
        setStatus("conflict");
        setError(
          serverRevision === null
            ? "本地待保存内容已保留；需要联网读取最新版本后才能重试。"
            : "检测到其他窗口已保存更新。本地待保存内容已保留；请读取最新版本后再重试。",
        );
      } else {
        setStatus(localOutbox ? "offline" : "ready");
      }
      if (localOutbox && !conflictDetected) {
        scheduleFlush(0);
      }
      return stopListening;
    };

    let stopListening: (() => void) | undefined;
    void restore()
      .then((cleanup) => {
        if (disposed) {
          cleanup();
        } else {
          stopListening = cleanup;
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "画布加载失败");
        setStatus("error");
      });

    const handleOnline = (): void => {
      if (conflictDetected) {
        if (rebaseOutboxRef.current) {
          setReloadToken((value) => value + 1);
        }
        return;
      }
      setStatus("ready");
      void flush();
    };
    const handleOffline = (): void => {
      if (!conflictDetected) {
        setStatus("offline");
      }
    };
    const handlePageHide = (): void => {
      if (inFlightPayload || snapshotDirty || pending.size > 0) {
        const recoverable = new Map<string, BoardElementPatch>();
        for (const patch of inFlightPayload?.patches ?? []) {
          recoverable.set(patch.shapeId, patch);
        }
        for (const patch of pending.values()) {
          recoverable.set(patch.shapeId, patch);
        }
        saveOutbox(makePayload([...recoverable.values()]));
      }
    };
    const handleRemoteRefresh = (event: Event): void => {
      const detail = (event as CustomEvent<BoardRemoteRefreshDetail>).detail;
      if (detail?.boardId !== projectId) {
        return;
      }

      void fetchBoard(projectId)
        .then((board) => {
          if (disposed) {
            return;
          }
          revision = board.revision;
          applyElementRows(store, board.elements);
        })
        .catch((cause: unknown) => {
          if (!disposed) {
            setError(cause instanceof Error ? cause.message : "白板刷新失败");
          }
        });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener(BOARD_REMOTE_REFRESH_EVENT, handleRemoteRefresh);

    return () => {
      handlePageHide();
      disposed = true;
      stopListening?.();
      if (saveTimer) {
        window.clearTimeout(saveTimer);
      }
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener(BOARD_REMOTE_REFRESH_EVENT, handleRemoteRefresh);
    };
  }, [projectId, reloadToken, store]);

  return { error, resolveConflict, retry, status };
}
