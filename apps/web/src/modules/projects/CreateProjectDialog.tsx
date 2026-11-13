"use client";
import { useRef, useState } from "react";
import { Button, Dialog, Field, Input, Textarea } from "../../components/ui";
import styles from "./projects.module.css";
import motion from "./project-motion.module.css";
import { PROJECT_NAME_HINT, useProjectNameValidation } from "./project-name";

interface CreateProjectDialogProps {
  readonly onClose: () => void;
  readonly onCreate: (name: string, brief?: string) => Promise<void>;
  readonly open: boolean;
}
export function CreateProjectDialog({
  onClose,
  onCreate,
  open,
}: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
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
      await onCreate(value, brief.trim() || undefined);
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
      onAfterClose={() => { setName(""); setBrief(""); setError(null); validation.reset(); }}
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
        <Field
          hint="可先写目标、受众、场景和不能改变的条件；进入白板后会作为待确认的设计简报，不会自动生成图片。"
          label="设计目标（可选）"
        >
          <Textarea
            maxLength={1200}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="例：为 25–35 岁通勤人群设计一组轻量防风外套，保留自然肌理和低饱和配色，先确认廓形与面料方向。"
            rows={4}
            value={brief}
          />
        </Field>
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
