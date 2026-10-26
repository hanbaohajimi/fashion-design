"use client";
import { useRef, useState } from "react";
import { Button, Dialog, Input } from "../../components/ui";
import styles from "./projects.module.css";
import motion from "./project-motion.module.css";
import { PROJECT_NAME_HINT, useProjectNameValidation } from "./project-name";

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
  const validation = useProjectNameValidation(name, open);
  const close = () => {
    if (!pending.current) {
      onClose();
    }
  };
  const submit = async () => {
    if (pending.current) return;
    const value = name.trim();
    if (!validation.validate(input.current)) return;
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
  return (
    <Dialog
      open={open}
      onAfterClose={() => { setName(""); setError(null); validation.reset(); }}
      label="给新系列一个名字"
      onClose={close}
      className={styles.createDialog}
    >
      <form
        noValidate
        className={styles.dialog}
        aria-busy={submitting}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2>给新系列一个名字</h2>
        <p id="create-project-help">
          稍后可以随时重命名。{PROJECT_NAME_HINT}
        </p>
        <label htmlFor="project-name">项目名称</label>
        <Input
          autoFocus
          ref={input}
          id="project-name"
          aria-invalid={Boolean(validation.error)}
          aria-describedby={
            error || validation.error
              ? "create-project-help create-project-error"
              : "create-project-help"
          }
          maxLength={80}
          onBlur={validation.onBlur}
          onCompositionStart={validation.onCompositionStart}
          onCompositionEnd={validation.onCompositionEnd}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          placeholder="例：2027 春夏轮廓实验"
          readOnly={submitting}
          value={name}
        />
        <p className={motion.fieldFeedback} id="create-project-error" aria-live="polite" data-valid={validation.valid && !error || undefined}>
          {error || validation.error ? <span>{error ?? validation.error}</span> : validation.valid ? <span>✓ 名称格式有效</span> : null}
        </p>
        <div className={styles.dialogActions}>
          <Button disabled={submitting} onClick={close}>
            取消
          </Button>
          <Button interaction="ripple" variant="primary" loading={submitting} type="submit">
            {submitting ? "正在创建…" : "创建项目"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
