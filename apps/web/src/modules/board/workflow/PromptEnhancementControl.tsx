"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AssistantIconButton } from "./AssistantIconButton";
import { enhancePrompt } from "./prompt-enhancement-api";
import type {
  CanvasReferenceSelection,
  ReferenceInstances,
} from "./discussion-references";
import styles from "./prompt-enhancement.module.css";

interface Props {
  scopeKey: string;
  projectId: string;
  value: string;
  referenceIds: readonly string[];
  instances: ReferenceInstances;
  disabled: boolean;
  feedbackHost: HTMLDivElement | null;
  onPrepare?:
    | ((
        ids: readonly string[],
        instances: ReferenceInstances,
      ) => Promise<CanvasReferenceSelection>)
    | undefined;
  onChange: (value: string) => void;
  onBusy: (busy: boolean) => void;
}
const signature = (value: Props) =>
  JSON.stringify([value.value, value.referenceIds, value.instances]);
export function PromptEnhancementControl(props: Props) {
  return <EnhancementSession key={props.scopeKey} {...props} />;
}

function EnhancementSession(props: Props) {
  const current = useRef(props);
  useLayoutEffect(() => {
    current.current = props;
  });
  const alive = useRef(true),
    flight = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    original: string;
    enhanced: string;
  } | null>(null);
  const [undo, setUndo] = useState<{
    original: string;
    enhanced: string;
  } | null>(null);
  const cancel = () => {
    flight.current?.abort();
    flight.current = null;
    setBusy(false);
    current.current.onBusy(false);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      flight.current?.abort();
      flight.current = null;
      current.current.onBusy(false);
    };
  }, []);
  const apply = (result: { original: string; enhanced: string }) => {
    const original = current.current.value;
    current.current.onChange(result.enhanced);
    setUndo({ original, enhanced: result.enhanced });
    setPending(null);
    setNotice(null);
  };
  const start = async () => {
    if (flight.current) {
      cancel();
      return;
    }
    const source = current.current;
    if (source.disabled || !source.value.trim() || pending) return;
    const expected = signature(source);
    const ids = [...source.referenceIds],
      instances = structuredClone(source.instances);
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    source.onBusy(true);
    setNotice(null);
    setUndo(null);
    try {
      const prepared = await source.onPrepare?.(ids, instances);
      if (!alive.current || controller.signal.aborted) return;
      if (prepared && JSON.stringify(prepared.nodeIds) !== JSON.stringify(ids))
        throw new Error("引用素材已变化，请重新核对引用后再增强，原文已保留。");
      const result = await enhancePrompt(
        source.projectId,
        {
          requestId: crypto.randomUUID(),
          prompt: source.value,
          referencedNodeIds: prepared?.nodeIds ?? ids,
        },
        controller.signal,
      );
      if (
        !alive.current ||
        flight.current !== controller ||
        controller.signal.aborted
      )
        return;
      const entry = { original: source.value, enhanced: result.enhancedPrompt };
      if (signature(current.current) === expected) apply(entry);
      else {
        setPending(entry);
        setNotice(null);
      }
    } catch (cause) {
      if (alive.current && !controller.signal.aborted)
        setNotice(
          cause instanceof Error ? cause.message : "增强未完成，原文已保留。",
        );
    } finally {
      if (alive.current && flight.current === controller) {
        flight.current = null;
        setBusy(false);
        current.current.onBusy(false);
      }
    }
  };
  const canUndo = undo && props.value === undo.enhanced;
  const feedback = notice || pending || canUndo;
  return (
    <>
      <AssistantIconButton
        icon={busy ? "spinner" : "enhance"}
        label={busy ? "取消提示词增强" : "增强提示词"}
        busy={busy}
        className={busy ? styles.busy : ""}
        disabled={
          !busy && (props.disabled || !props.value.trim() || Boolean(pending))
        }
        onClick={() => void start()}
      />
      {props.feedbackHost && feedback
        ? createPortal(
            <div className={styles.feedback}>
              {notice ? (
                <div className={styles.row}>
                  <p role="alert">{notice}</p>
                  <button type="button" onClick={() => setNotice(null)}>
                    关闭提示
                  </button>
                </div>
              ) : null}
              {pending ? (
                <>
                  <p role="status">
                    增强期间草稿或引用有改动，当前输入已保留。
                  </p>
                  <details>
                    <summary>查看增强结果</summary>
                    <p className={styles.preview}>{pending.enhanced}</p>
                  </details>
                  <div className={styles.actions}>
                    <button type="button" onClick={() => apply(pending)}>
                      使用增强结果
                    </button>
                    <button type="button" onClick={() => setPending(null)}>
                      放弃增强结果
                    </button>
                  </div>
                </>
              ) : canUndo ? (
                <div className={styles.row}>
                  <span role="status">提示词已增强，可继续编辑后发送。</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (current.current.value === undo.enhanced)
                        current.current.onChange(undo.original);
                      setUndo(null);
                    }}
                  >
                    撤销增强
                  </button>
                </div>
              ) : null}
            </div>,
            props.feedbackHost,
          )
        : null}
    </>
  );
}
