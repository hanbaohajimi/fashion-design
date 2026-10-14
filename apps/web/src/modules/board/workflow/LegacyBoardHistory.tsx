"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  loadSnapshot,
  Tldraw,
  type Editor,
  type TLAnyShapeUtilConstructor,
  type TLShape,
  type TLShapeId,
  type TLStore,
  useEditor,
  useValue,
} from "tldraw";

import { fetchBoard, type BoardElementRow } from "../board-api";
import {
  boardShapeUtils,
  IMAGE_SHAPE_TYPE,
  isBoardShape,
  normalizeBoardRole,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
} from "../shapes";
import styles from "./legacy-board-history.module.css";

export interface LegacyBoardImport {
  readonly shapeId: string;
  readonly type: "image" | "note" | "swatch";
  readonly title: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface LegacyBoardHistoryProps {
  readonly projectId: string;
  readonly onClose: () => void;
  readonly onImport: (item: LegacyBoardImport) => void | Promise<void>;
}

function restoreElementRows(store: TLStore, elements: readonly BoardElementRow[]) {
  store.mergeRemoteChanges(() => {
    for (const element of elements) {
      const shapeId = element.shapeId as TLShapeId;
      if (element.deleted) {
        if (store.has(shapeId)) store.remove([shapeId]);
        continue;
      }
      if (!element.record) continue;

      const stored = store.get(shapeId);
      const base = stored?.typeName === "shape" ? stored : element.record;
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
            meta: { ...base.meta, role: element.role },
          };
      store.put([next as TLShape]);
    }
  });
}

function importableShape(
  shape: TLShape,
  projectId: string,
  revision: number,
  element: BoardElementRow | undefined,
): LegacyBoardImport | null {
  if (
    shape.type !== IMAGE_SHAPE_TYPE &&
    shape.type !== NOTE_SHAPE_TYPE &&
    shape.type !== SWATCH_SHAPE_TYPE
  ) {
    return null;
  }

  const type =
    shape.type === IMAGE_SHAPE_TYPE
      ? "image"
      : shape.type === NOTE_SHAPE_TYPE
        ? "note"
        : "swatch";
  const title =
    shape.type === IMAGE_SHAPE_TYPE
      ? shape.props.title.trim() || "历史图片"
      : shape.type === NOTE_SHAPE_TYPE
        ? shape.props.text.trim().slice(0, 32) || "历史便签"
        : shape.props.label.trim() || "历史色卡";

  return {
    shapeId: shape.id,
    type,
    title,
    payload: {
      ...shape.props,
      meta: shape.meta,
      legacyBoard: {
        projectId,
        revision,
        shapeId: shape.id,
        role: element?.role ?? shape.props.role,
        roleLabel: element?.roleLabel ?? null,
        roleSource: element?.roleSource ?? "default",
      },
    },
  };
}

function SelectionObserver({
  elements,
  onChange,
  projectId,
  revision,
}: {
  readonly elements: readonly BoardElementRow[];
  readonly onChange: (item: LegacyBoardImport | null) => void;
  readonly projectId: string;
  readonly revision: number;
}) {
  const editor = useEditor();
  const selectedId = useValue(
    "legacy-board-selected-shape",
    () => editor.getOnlySelectedShapeId(),
    [editor],
  );

  useEffect(() => {
    const shape = selectedId ? editor.getShape(selectedId) : undefined;
    onChange(
      shape
        ? importableShape(
            shape,
            projectId,
            revision,
            elements.find((element) => element.shapeId === shape.id),
          )
        : null,
    );
  }, [editor, elements, onChange, projectId, revision, selectedId]);

  return null;
}

const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;

export function LegacyBoardHistory({
  projectId,
  onClose,
  onImport,
}: LegacyBoardHistoryProps) {
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
  const [elements, setElements] = useState<readonly BoardElementRow[]>([]);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<LegacyBoardImport | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose]);

  useEffect(() => {
    let active = true;
    void fetchBoard(projectId).then(
      (board) => {
        if (!active) return;
        try {
          if (board.snapshot) loadSnapshot(store, board.snapshot);
          restoreElementRows(store, board.elements);
          setElements(board.elements);
          setRevision(board.revision);
          setReady(true);
        } catch (cause) {
          setLoadingError(
            cause instanceof Error ? cause.message : "历史白板数据无法读取",
          );
        }
      },
      (cause: unknown) => {
        if (!active) return;
        setLoadingError(
          cause instanceof Error ? cause.message : "历史白板加载失败",
        );
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, store]);

  const handleSelection = useCallback((item: LegacyBoardImport | null) => {
    setSelected(item);
    setNotice(null);
  }, []);

  const handleImport = async () => {
    if (!selected || importing) return;
    setImporting(true);
    setNotice(null);
    try {
      await onImport(selected);
      setNotice(`已将「${selected.title}」加入当前工作流`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "加入工作流失败，请重试");
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    if (!editor || exporting) return;
    const shapeIds = editor.getCurrentPageShapes().map((shape) => shape.id);
    if (shapeIds.length === 0) {
      setNotice("历史白板没有可导出的内容");
      return;
    }
    setExporting(true);
    setNotice(null);
    try {
      const rendered = await editor.toImage(shapeIds, {
        background: true,
        format: "png",
        padding: 64,
        pixelRatio: 2,
      });
      if (!rendered.blob.size) throw new Error("画布渲染结果为空");
      const url = URL.createObjectURL(rendered.blob);
      const link = document.createElement("a");
      link.download = `fashion-history-board-${projectId}.png`;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "历史白板导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={styles.backdrop}>
      <section
        aria-label="历史白板"
        aria-modal="true"
        className={styles.panel}
        role="dialog"
      >
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>ARCHIVE / LEGACY BOARD</span>
            <h2>历史白板</h2>
            <p>仅供查看与引用。点击图片、便签或色卡，可加入当前工作流。</p>
          </div>
          <div className={styles.headerActions}>
            <button
              disabled={!ready || !editor || exporting}
              onClick={() => void handleExport()}
              type="button"
            >
              {exporting ? "正在导出…" : "导出 PNG"}
            </button>
            <button onClick={onClose} ref={closeButtonRef} type="button">
              关闭
            </button>
          </div>
        </header>

        <div
          className={styles.canvas}
          onFocusCapture={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLElement &&
              target.closest(".tl-shape") &&
              target.matches("button, input, textarea, a")
            ) {
              target.tabIndex = -1;
              target.blur();
            }
          }}
        >
          {loadingError ? (
            <div className={styles.message} role="alert">
              <strong>历史白板无法打开</strong>
              <span>{loadingError}</span>
            </div>
          ) : !ready ? (
            <div className={styles.message} role="status">
              正在读取历史白板…
            </div>
          ) : (
            <Tldraw
              hideUi
              locale="zh-cn"
              onMount={(instance) => {
                instance.updateInstanceState({ isReadonly: true });
                instance.zoomToFit();
                setEditor(instance);
              }}
              shapeUtils={boardShapeUtils}
              store={store}
              {...(tldrawLicenseKey ? { licenseKey: tldrawLicenseKey } : {})}
            >
              <SelectionObserver
                elements={elements}
                onChange={handleSelection}
                projectId={projectId}
                revision={revision}
              />
            </Tldraw>
          )}
        </div>

        <footer className={styles.footer}>
          <div className={styles.selection} aria-live="polite">
            {selected ? (
              <>
                <strong>{selected.title}</strong>
                <span>
                  {selected.type === "image"
                    ? "图片参考"
                    : selected.type === "note"
                      ? "文字便签"
                      : "色彩参考"}
                </span>
              </>
            ) : (
              <span>选择历史图片、便签或色卡</span>
            )}
          </div>
          {notice ? <span className={styles.notice}>{notice}</span> : null}
          <button
            className={styles.importButton}
            disabled={!selected || importing}
            onClick={() => void handleImport()}
            type="button"
          >
            {importing ? "正在加入…" : "加入当前工作流"}
          </button>
        </footer>
      </section>
    </div>
  );
}
