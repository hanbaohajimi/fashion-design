"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import type { Project } from "./project-types";
import styles from "./project-motion.module.css";

type Phase = "ready" | "restoring" | "error";
export const ARCHIVE_UNDO_MS = 4000;

export function ArchiveUndoNotice({ count, phase, revision, onUndo, onDismiss }: {
  count: number; phase: Phase; revision: number; onUndo: () => void; onDismiss: () => void;
}) {
  const line = useRef<HTMLSpanElement>(null);
  const paused = useRef(new Set<string>());
  const [pause, setPause] = useState(false);
  const remaining = useRef(ARCHIVE_UNDO_MS);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  const toggle = (reason: string, value: boolean) => {
    if (value) paused.current.add(reason); else paused.current.delete(reason);
    setPause(paused.current.size > 0);
  };
  useEffect(() => {
    const visibility = () => toggle("hidden", document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    remaining.current = ARCHIVE_UNDO_MS;
    if (line.current) line.current.style.transform = "scaleX(1)";
  }, [revision]);
  useEffect(() => {
    if (pause || phase !== "ready") return;
    started.current = performance.now();
    timer.current = setTimeout(() => dismiss.current(), remaining.current);
    // 撤销进度表示真实剩余时间，因此采用线性倒计时；悬停、焦点和隐藏时暂停。
    const progressLine = line.current;
    const animation = progressLine?.animate?.([
      { transform: `scaleX(${remaining.current / ARCHIVE_UNDO_MS})` },
      { transform: "scaleX(0)" },
    ], { duration: remaining.current, easing: "linear", fill: "forwards" });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started.current));
      if (progressLine) progressLine.style.transform = `scaleX(${remaining.current / ARCHIVE_UNDO_MS})`;
      animation?.cancel();
    };
  }, [pause, phase, revision]);
  return <div className={styles.undoNotice} role="status"
    onPointerEnter={() => toggle("pointer", true)} onPointerLeave={() => toggle("pointer", false)}
    onFocus={() => toggle("focus", true)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) toggle("focus", false);
    }}>
    <span>{phase === "restoring" ? `正在恢复 ${count} 个项目…` : phase === "error" ? `${count} 个项目恢复失败` : `已归档 ${count} 个项目`}</span>
    <button type="button" disabled={phase === "restoring"} onClick={onUndo}>
      {phase === "error" ? "重试恢复" : "撤销"}
    </button>
    <button type="button" disabled={phase === "restoring"} aria-label="关闭归档提示" onClick={onDismiss}>×</button>
    {phase === "error" ? <small>归档仍然保留，也可稍后在已归档项目中恢复。</small> : null}
    {phase === "ready" ? <span className={styles.undoTime} ref={line} aria-hidden="true" /> : null}
  </div>;
}

export function useProjectArchiveUndo(restore: (project: Project) => Promise<unknown>) {
  const undoId = useId();
  const action = useRef(restore);
  useEffect(() => { action.current = restore; }, [restore]);
  const controller = useRef({ active: new Map<string, Project>(), queued: new Map<string, Project>(),
    phase: "ready" as Phase, revision: 0, mounted: true, id: `project-archive-${undoId}` });
  useEffect(() => {
    const state = controller.current;
    state.mounted = true;
    return () => { state.mounted = false; toast.dismiss(state.id); };
  }, []);
  const publish = () => {
    const state = controller.current;
    if (!state.mounted) return;
    if (!state.active.size) { toast.dismiss(state.id); return; }
    toast.custom(() => <ArchiveUndoNotice count={state.active.size} phase={state.phase} revision={state.revision}
      onUndo={() => void undo()} onDismiss={advance} />, { id: state.id, duration: Infinity });
  };
  const advance = () => {
    const state = controller.current;
    if (state.phase === "restoring") return;
    state.active = state.queued;
    state.queued = new Map();
    state.phase = "ready";
    state.revision += 1;
    publish();
  };
  const undo = async () => {
    const state = controller.current;
    if (state.phase === "restoring") return;
    state.phase = "restoring";
    const batch = [...state.active.values()];
    publish();
    const results = await Promise.allSettled(batch.map((project) => action.current(project)));
    if (!state.mounted) return;
    results.forEach((result, index) => {
      const project = batch[index];
      if (result.status === "fulfilled" && project) state.active.delete(project.id);
    });
    state.phase = state.active.size ? "error" : "ready";
    if (!state.active.size) advance(); else publish();
  };
  return (project: Project) => {
    const state = controller.current;
    if (state.phase !== "ready") state.queued.set(project.id, project);
    else { state.active.set(project.id, project); state.revision += 1; publish(); }
  };
}
