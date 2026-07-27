"use client";

import { useState } from "react";

import styles from "./projects.module.css";

interface CreateProjectDialogProps {
  readonly onClose: () => void;
  readonly onCreate: (name: string) => Promise<void>;
  readonly open: boolean;
}

export function CreateProjectDialog({
  onClose,
  onCreate,
  open,
}: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  const close = (): void => {
    setName("");
    setError(null);
    onClose();
  };

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    const length = Array.from(trimmed).length;

    if (length < 3 || length > 80) {
      setError("项目名称需为 3–80 个字");
      return;
    }

    close();
    await onCreate(trimmed);
  };

  return (
    <div
      aria-labelledby="create-project-title"
      aria-modal="true"
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
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
      >
        <div className={styles.dialogIndex}>NEW / 01</div>
        <h2 id="create-project-title">给新系列一个名字</h2>
        <p>稍后可以随时重命名。名称长度为 3–80 个字。</p>
        <label htmlFor="project-name">项目名称</label>
        <input
          autoFocus
          id="project-name"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder="例：2027 春夏轮廓实验"
          value={name}
        />
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <button
            className={styles.secondaryButton}
            onClick={close}
            type="button"
          >
            取消
          </button>
          <button className={styles.primaryButton} type="submit">
            创建项目
          </button>
        </div>
      </form>
    </div>
  );
}
