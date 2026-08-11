"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { BoardElementRole } from "@fashion/shared";
import { useEditor, useValue, type TLShapeId } from "tldraw";

import { setElementRoles } from "./board-api";
import { BoardProjectContext } from "./board-context";
import {
  BOARD_ROLES,
  FABRIC_SHAPE_TYPE,
  IMAGE_SHAPE_TYPE,
  isRoleAssignableShape,
  NOTE_SHAPE_TYPE,
  normalizeBoardRole,
  SWATCH_SHAPE_TYPE,
  type ImageShape,
} from "./shapes";
import styles from "./board.module.css";

const ROLE_LABELS: Readonly<Record<BoardElementRole, string>> = {
  avoid: "避用",
  detail_ref: "细节参考",
  fabric_ref: "面料参考",
  garment_ref: "成衣",
  note: "备注",
  palette: "色彩方案",
  reference_garment: "参考衣",
  silhouette_ref: "廓形参考",
  style_ref: "风格参考",
};

interface QueuedRoleChange {
  readonly role: BoardElementRole;
  readonly shapeIds: readonly string[];
}

interface ElementRolePanelProps {
  /** When true, strips fixed-positioning so the panel sits in-flow inside ContextInspector */
  readonly embedded?: boolean;
  readonly shapeId: TLShapeId;
}

export function ElementRolePanel({
  embedded = false,
  shapeId,
}: ElementRolePanelProps) {
  const editor = useEditor();
  const projectId = useContext(BoardProjectContext);
  const [saveError, setSaveError] = useState<string | null>(null);
  const queue = useRef<QueuedRoleChange | null>(null);
  const roleButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const timer = useRef<number | undefined>(undefined);
  const selected = useValue(
    `label-design-element-${shapeId}`,
    () => {
      const shape = editor.getShape(shapeId);
      return shape && isRoleAssignableShape(shape) ? [shape] : [];
    },
    [editor, shapeId],
  );
  const roles = new Set(
    selected.map((shape) => normalizeBoardRole(shape.props.role)),
  );
  const activeRole = roles.size === 1 ? [...roles][0] : null;
  const selectedImage =
    selected.length === 1 && selected[0]?.type === IMAGE_SHAPE_TYPE
      ? (selected[0] as ImageShape)
      : null;

  const flush = useCallback(async (): Promise<void> => {
    const pending = queue.current;
    queue.current = null;
    if (!pending) {
      return;
    }
    try {
      await setElementRoles(projectId, pending.shapeIds, pending.role);
      setSaveError(null);
    } catch (cause) {
      queue.current = pending;
      setSaveError(
        cause instanceof Error ? cause.message : "角色保存失败，将随画布重试",
      );
    }
  }, [projectId]);

  useEffect(
    () => () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
      }
      void flush();
    },
    [flush],
  );

  const setRole = (role: BoardElementRole): void => {
    if (selected.length === 0) {
      return;
    }
    editor.run(() => {
      for (const shape of selected) {
        const meta = { ...shape.meta, roleSource: "manual" };
        if (shape.type === IMAGE_SHAPE_TYPE) {
          editor.updateShape({
            id: shape.id,
            type: IMAGE_SHAPE_TYPE,
            meta,
            props: {
              ...shape.props,
              role,
              roleConfidence: undefined,
              roleInferenceState: "ready",
              roleLabel:
                role === "note" && shape.props.role === "note"
                  ? shape.props.roleLabel
                  : undefined,
              roleSource: "manual",
            },
          });
        } else if (shape.type === NOTE_SHAPE_TYPE) {
          editor.updateShape({
            id: shape.id,
            type: NOTE_SHAPE_TYPE,
            meta,
            props: { ...shape.props, role },
          });
        } else if (shape.type === SWATCH_SHAPE_TYPE) {
          editor.updateShape({
            id: shape.id,
            type: SWATCH_SHAPE_TYPE,
            meta,
            props: { ...shape.props, role },
          });
        } else if (shape.type === FABRIC_SHAPE_TYPE) {
          editor.updateShape({
            id: shape.id,
            type: FABRIC_SHAPE_TYPE,
            meta,
            props: { ...shape.props, role },
          });
        }
      }
    });
    queue.current = {
      role,
      shapeIds: selected.map((shape) => shape.id),
    };
    if (timer.current) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void flush();
    }, 500);
  };

  const setImageNote = (value: string): void => {
    const shape = editor.getShape(shapeId);
    if (
      !shape ||
      shape.type !== IMAGE_SHAPE_TYPE ||
      shape.props.role !== "note"
    ) {
      return;
    }

    editor.updateShape({
      id: shape.id,
      type: IMAGE_SHAPE_TYPE,
      meta: { ...shape.meta, roleSource: "manual" },
      props: {
        ...shape.props,
        roleConfidence: undefined,
        roleInferenceState: "ready",
        roleLabel: value || undefined,
        roleSource: "manual",
      },
    });
  };

  const handleRoleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % BOARD_ROLES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + BOARD_ROLES.length) % BOARD_ROLES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = BOARD_ROLES.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const nextRole = BOARD_ROLES[nextIndex];
    if (!nextRole) {
      return;
    }

    setRole(nextRole);
    roleButtons.current[nextIndex]?.focus();
  };

  const lowConfidence =
    selectedImage?.props.roleSource === "inferred" &&
    ((selectedImage.props.roleConfidence ?? 0) < 0.7 ||
      selectedImage.props.roleLabel === "non_fashion");
  const showStatusFooter =
    selectedImage?.props.roleInferenceState === "pending" ||
    selectedImage?.props.roleInferenceState === "failed" ||
    lowConfidence ||
    selectedImage?.props.roleSource === "inferred" ||
    Boolean(saveError);

  return (
    <aside
      className={`${styles.rolePanel} ${embedded ? styles.rolePanelEmbedded : ""}`}
      data-role={activeRole ?? "mixed"}
      aria-label="标签设计"
    >
      <header>
        <strong>标签设计</strong>
      </header>

      {selected.length === 0 ? (
        <div className={styles.rolePanelEmpty}>
          <span>未选择可标注元素</span>
          <p>请点击元素左上角标签后设置当前元素。</p>
        </div>
      ) : (
        <>
          <div className={styles.roleOptions} role="radiogroup">
            {BOARD_ROLES.map((role, index) => (
              <button
                aria-checked={activeRole === role}
                data-role={role}
                key={role}
                onClick={() => setRole(role)}
                onKeyDown={(event) => handleRoleKeyDown(event, index)}
                ref={(node) => {
                  roleButtons.current[index] = node;
                }}
                role="radio"
                tabIndex={
                  activeRole === role || (activeRole === null && index === 0)
                    ? 0
                    : -1
                }
                type="button"
              >
                <span className={styles.roleLabel}>{ROLE_LABELS[role]}</span>
              </button>
            ))}
          </div>
          {selectedImage && activeRole === "note" ? (
            <label className={styles.roleNoteEditor}>
              <span>备注标签</span>
              <input
                aria-label="当前图片备注标签"
                autoFocus
                maxLength={32}
                onChange={(event) => setImageNote(event.currentTarget.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="输入当前图片的备注"
                value={selectedImage.props.roleLabel ?? ""}
              />
              <small>仅修改当前图片，不影响其他元素</small>
            </label>
          ) : null}
          {showStatusFooter ? (
            <footer>
              {selectedImage?.props.roleInferenceState === "pending" ? (
                <span>VLM 正在后台判读，不影响画布操作</span>
              ) : selectedImage?.props.roleInferenceState === "failed" ? (
                <span>自动识别失败，已使用风格参考</span>
              ) : lowConfidence ? (
                <span data-warning="true">非服装或低置信度，请人工确认</span>
              ) : selectedImage?.props.roleSource === "inferred" ? (
                <span>
                  自动推断 ·{" "}
                  {Math.round((selectedImage.props.roleConfidence ?? 0) * 100)}%
                </span>
              ) : null}
              {saveError ? <small>{saveError}</small> : null}
            </footer>
          ) : null}
        </>
      )}
    </aside>
  );
}
