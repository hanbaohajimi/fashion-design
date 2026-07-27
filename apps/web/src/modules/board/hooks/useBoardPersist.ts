"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getSnapshot,
  loadSnapshot,
  type TLRecord,
  type TLShape,
  type TLShapeId,
  type TLStore,
} from "tldraw";

import {
  type BoardElementPatch,
  type BoardElementRow,
  type BoardPatchPayload,
  fetchBoard,
  patchBoard,
} from "../board-api";
import {
  IMAGE_SHAPE_TYPE,
  isBoardShape,
  normalizeBoardRole,
} from "../shapes";

const SAVE_DEBOUNCE_MS = 1_500;
const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 30_000;

export type BoardPersistStatus =
  | "loading"
  | "ready"
  | "saving"
  | "saved"
  | "offline"
  | "error";

interface BoardPersistState {
  readonly error: string | null;
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
  const roleInferenceState:
    | "none"
    | "pending"
    | "ready"
    | "failed" =
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

function readOutbox(key: string): BoardPatchPayload | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as BoardPatchPayload) : null;
  } catch {
    return null;
  }
}

export function useBoardPersist(
  projectId: string,
  store: TLStore,
): BoardPersistState {
  const [status, setStatus] = useState<BoardPersistStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const retry = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const outboxKey = `fashion-board-outbox:${projectId}`;
    const pending = new Map<string, BoardElementPatch>();
    let snapshotDirty = false;
    let disposed = false;
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
      batchId: crypto.randomUUID(),
      patches,
      snapshot: getSnapshot(store),
    });

    const scheduleFlush = (delay = SAVE_DEBOUNCE_MS): void => {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
      }
      saveTimer = window.setTimeout(() => {
        void flush();
      }, delay);
    };

    const flush = async (): Promise<void> => {
      if (disposed || (!snapshotDirty && pending.size === 0)) {
        return;
      }

      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = undefined;
      }

      const sending = new Map(pending);
      pending.clear();
      snapshotDirty = false;
      const payload = makePayload([...sending.values()]);
      saveOutbox(payload);
      setStatus(navigator.onLine ? "saving" : "offline");

      try {
        await patchBoard(projectId, payload);
        retryDelay = RETRY_MIN_MS;

        if (pending.size === 0 && !snapshotDirty) {
          window.localStorage.removeItem(outboxKey);
          setStatus("saved");
        } else {
          scheduleFlush();
        }
      } catch (cause) {
        for (const [shapeId, patch] of sending) {
          if (!pending.has(shapeId)) {
            pending.set(shapeId, patch);
          }
        }
        snapshotDirty = true;
        setStatus(navigator.onLine ? "offline" : "offline");
        setError(cause instanceof Error ? cause.message : "画布保存失败");

        if (!retryTimer) {
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            void flush();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
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

      try {
        const board = await fetchBoard(projectId);

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
        loadSnapshot(store, localOutbox.snapshot);
        for (const patch of localOutbox.patches) {
          pending.set(patch.shapeId, patch);
        }
        snapshotDirty = true;
      }

      const stopListening = store.listen(
        (entry) => {
          snapshotDirty = true;

          for (const record of Object.values(entry.changes.added)) {
            queueRecord(record, false);
          }
          for (const [, record] of Object.values(entry.changes.updated)) {
            queueRecord(record, false);
          }
          for (const record of Object.values(entry.changes.removed)) {
            queueRecord(record, true);
          }

          setStatus("ready");
          scheduleFlush();
        },
        { scope: "document", source: "user" },
      );

      setStatus(localOutbox ? "offline" : "ready");
      if (localOutbox) {
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
      setStatus("ready");
      void flush();
    };
    const handleOffline = (): void => setStatus("offline");
    const handlePageHide = (): void => {
      if (snapshotDirty || pending.size > 0) {
        saveOutbox(makePayload([...pending.values()]));
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pagehide", handlePageHide);

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
    };
  }, [projectId, reloadToken, store]);

  return { error, retry, status };
}
