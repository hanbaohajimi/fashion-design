"use client";
import { useRef, useState } from "react";
import { Button, Dialog, Input } from "../../components/ui";
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
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const close = () => {
    if (!pending.current) {
      setName("");
      setError(null);
      onClose();
    }
  };
  const submit = async () => {
    if (pending.current) return;
    const value = name.trim();
    if (Array.from(value).length < 3 || Array.from(value).length > 80) {
      setError("项目名称需为 3–80 个字");
      input.current?.focus();
      return;
    }
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(value);
      pending.current = false;
      close();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "创建项目失败，请稍后重试。",
      );
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };
  if (!open) return null;
  return (
    <Dialog
      label="给新系列一个名字"
      onClose={close}
      className={styles.createDialog}
    >
      <form
        className={styles.dialog}
        aria-busy={submitting}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2>给新系列一个名字</h2>
        <p id="create-project-help">
          稍后可以随时重命名。名称长度为 3–80 个字。
        </p>
        <label htmlFor="project-name">项目名称</label>
        <Input
          autoFocus
          ref={input}
          id="project-name"
          aria-invalid={Boolean(error)}
          aria-describedby={
            error
              ? "create-project-help create-project-error"
              : "create-project-help"
          }
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          placeholder="例：2027 春夏轮廓实验"
          readOnly={submitting}
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
          <Button disabled={submitting} onClick={close}>
            取消
          </Button>
          <Button variant="primary" loading={submitting} type="submit">
            {submitting ? "正在创建…" : "创建项目"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
