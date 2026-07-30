"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import styles from "./projects.module.css";

interface CreateProjectDialogProps {
  readonly onClose: () => void;
  readonly onCreate: (name: string) => Promise<void>;
  readonly open: boolean;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "创建项目失败，请稍后重试。";
}

export function CreateProjectDialog({
  onClose,
  onCreate,
  open,
}: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const resetAndClose = useCallback((): void => {
    setName("");
    setError(null);
    setSubmitting(false);
    submittingRef.current = false;
    onClose();
  }, [onClose]);

  const requestClose = useCallback((): void => {
    if (!submittingRef.current) {
      resetAndClose();
    }
  }, [resetAndClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const submit = async (): Promise<void> => {
    if (submittingRef.current) {
      return;
    }

    const trimmed = name.trim();
    const length = Array.from(trimmed).length;

    if (length < 3 || length > 80) {
      setError("项目名称需为 3–80 个字");
      inputRef.current?.focus();
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      await onCreate(trimmed);
      resetAndClose();
    } catch (createError) {
      setError(getErrorMessage(createError));
      submittingRef.current = false;
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter((element) => element.getClientRects().length > 0);

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1);

    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !dialogRef.current?.contains(document.activeElement))
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        !dialogRef.current?.contains(document.activeElement))
    ) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      aria-busy={submitting}
      aria-describedby="create-project-help"
      aria-labelledby="create-project-title"
      aria-modal="true"
      className={styles.dialogBackdrop}
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
      role="dialog"
    >
      <form
        className={styles.dialog}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        ref={dialogRef}
      >
        <div className={styles.dialogIndex}>NEW / 01</div>
        <h2 id="create-project-title">给新系列一个名字</h2>
        <p id="create-project-help">
          稍后可以随时重命名。名称长度为 3–80 个字。
        </p>
        <label htmlFor="project-name">项目名称</label>
        <input
          aria-describedby={
            error
              ? "create-project-help create-project-error"
              : "create-project-help"
          }
          aria-invalid={Boolean(error)}
          id="project-name"
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);

            if (error) {
              setError(null);
            }
          }}
          placeholder="例：2027 春夏轮廓实验"
          readOnly={submitting}
          ref={inputRef}
          value={name}
        />
        {error ? (
          <p
            className={styles.fieldError}
            id="create-project-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <button
            className={styles.secondaryButton}
            disabled={submitting}
            onClick={requestClose}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={submitting}
            type="submit"
          >
            {submitting ? "正在创建…" : "创建项目"}
          </button>
        </div>
      </form>
    </div>
  );
}
