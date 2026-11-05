"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WardrobeCategory, WardrobeMaterialOperation, WardrobePreparationView } from "@fashion/shared";
import { cancelGeneration, fetchGenerationTask } from "../../board/generation/generation-api";
import { useSerialPolling } from "../../use-serial-polling";
import { userFacingError } from "../../../components/user-facing-error";
import { uploadWardrobeMask } from "./wardrobe-assets";
import { wardrobeApi } from "./wardrobe-api";
import type { ImageRegion } from "./RegionSelector";

type Phase = "idle" | "uploading" | "creating" | "running" | "deriving" | "failed" | "canceled";
interface Attempt {
  probeKey: string; deriveKey: string; sourceAssetId: string; name: string; category: WardrobeCategory;
  maskAssetId: string; taskId: string | null; rawAssetId: string | null; deriving: boolean; canceled: boolean;
  result?: WardrobePreparationView;
  deriveFailed?: boolean;
  sidePreparationId?: string;
  operation: WardrobeMaterialOperation;
}
export function useMaterialRepair({ projectId, sourceAssetId, name, category, open, enabled, sidePreparationId, operation = "transparency", onPrepared }: {
  projectId: string; sourceAssetId: string; name: string; category: WardrobeCategory; open: boolean; enabled: boolean;
  sidePreparationId?: string | undefined;
  operation?: WardrobeMaterialOperation | undefined;
  onPrepared: (preparation: WardrobePreparationView) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRawAsset, setHasRawAsset] = useState(false);
  const identity = `${projectId}:${sourceAssetId}:${sidePreparationId ?? "front"}:${operation}`;
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity); setTaskId(null); setPhase("idle"); setError(null); setHasRawAsset(false);
  }
  const attempt = useRef<Attempt | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const openRef = useRef(open);
  const upload = useRef<AbortController | null>(null);
  const callback = useRef(onPrepared);
  const submitting = useRef(false);
  useLayoutEffect(() => { callback.current = onPrepared; openRef.current = open; }, [onPrepared, open]);
  useLayoutEffect(() => {
    mounted.current = true;
    attempt.current = null; submitting.current = false;
    return () => { mounted.current = false; epoch.current += 1; upload.current?.abort(); };
  }, [projectId, sourceAssetId, sidePreparationId, operation]);
  useEffect(() => {
    if (open) return;
    epoch.current += 1; upload.current?.abort();
  }, [open]);
  const current = (run: Attempt) => mounted.current && attempt.current === run && !run.canceled;
  const apply = (run: Attempt, turn: number) => {
    if (!current(run) || !openRef.current || epoch.current !== turn || !run.result) return;
    const result = run.result;
    attempt.current = null; setTaskId(null); setPhase("idle"); setError(null); setHasRawAsset(false); callback.current(result);
  };
  const derive = async (run: Attempt, turn: number) => {
    if (!current(run) || !run.rawAssetId || run.deriving || !openRef.current) return;
    if (run.result) { apply(run, turn); return; }
    run.deriving = true; setPhase("deriving");
    try {
      const result = await wardrobeApi.materialAlpha(projectId, { requestKey: run.deriveKey, sourceAssetId: run.sourceAssetId, rawAssetId: run.rawAssetId, maskAssetId: run.maskAssetId, name: run.name, category: run.category, operation: run.operation, ...(run.sidePreparationId ? { sidePreparationId: run.sidePreparationId } : {}) });
      if (!current(run)) return;
      if (result.status !== "ready" || !result.candidates.length) {
        run.deriveFailed = result.status === "failed";
        setError(result.error ?? "候选处理尚未返回可核对的图片，原候选与选区保留。请重试处理。"); setPhase("failed"); return;
      }
      run.result = result; apply(run, turn);
    } catch (cause) {
      if (current(run)) { setError(userFacingError(cause)); setPhase("failed"); }
    } finally { run.deriving = false; }
  };
  const polling = useSerialPolling(`material-repair:${projectId}:${taskId ?? "idle"}`, open && !!taskId && (phase === "running" || phase === "deriving"), 2000, async signal => {
    const run = attempt.current;
    if (!run?.taskId || run.deriving || !current(run)) return;
    const turn = epoch.current;
    if (run.result) { apply(run, turn); return; }
    const task = await fetchGenerationTask(run.taskId);
    if (signal.aborted || !current(run) || !openRef.current || epoch.current !== turn) return;
    if (task.status === "failed" || task.status === "moderation_failed" || task.status === "canceled") {
      setError(task.error?.message ?? (task.status === "canceled" ? "候选处理已取消，原候选与选区保留。" : "候选生成失败，原候选与选区保留。"));
      setPhase(task.status === "canceled" ? "canceled" : "failed"); return;
    }
    if (task.status !== "succeeded") return;
    const images = task.output && typeof task.output === "object" && "images" in task.output ? task.output.images : undefined;
    const raw = Array.isArray(images) ? images.find(value => value && typeof value.assetId === "string") : undefined;
    if (!raw) { setError("任务未返回可追溯的图片素材，请在项目任务中查看。原候选与选区保留。"); setPhase("failed"); return; }
    run.rawAssetId = raw.assetId as string;
    setHasRawAsset(true);
    await derive(run, turn);
  });
  const start = async (blob: Blob, notes: string, detailRegion: ImageRegion | null) => {
    if (!mounted.current || !openRef.current || !enabled || submitting.current || ["uploading", "creating", "running", "deriving"].includes(phase)) return;
    if (operation === "correction" && !notes.trim()) { setError("请填写局部修正说明，明确需要改变和保留的细节。"); return; }
    submitting.current = true;
    const run: Attempt = { probeKey: crypto.randomUUID(), deriveKey: crypto.randomUUID(), sourceAssetId, name, category, operation, maskAssetId: "", taskId: null, rawAssetId: null, deriving: false, canceled: false, ...(sidePreparationId ? { sidePreparationId } : {}) };
    attempt.current = run; const turn = ++epoch.current;
    const controller = new AbortController(); upload.current = controller;
    setError(null); setTaskId(null); setHasRawAsset(false); setPhase("uploading");
    try {
      const mask = await uploadWardrobeMask(projectId, sourceAssetId, blob, controller.signal, operation);
      if (!current(run) || !openRef.current || epoch.current !== turn) return;
      run.maskAssetId = mask.id; setPhase("creating");
      const result = await wardrobeApi.materialProbe(projectId, { requestKey: run.probeKey, sourceAssetId, maskAssetId: mask.id, name, category, notes, operation, ...(detailRegion ? { detailRegion } : {}) });
      run.taskId = result.taskId;
      if (run.canceled) {
        try { await cancelGeneration(result.taskId); } catch (cause) { if (mounted.current && attempt.current === run) setError(`已停止后续处理，任务取消未完成：${userFacingError(cause)}。可在项目任务中查看。`); }
        return;
      }
      if (!current(run)) return;
      // Keep a submitted task for a later reopen, but never derive/apply while the dialog is closed.
      setTaskId(result.taskId); setPhase("running");
    } catch (cause) {
      if (current(run) && !controller.signal.aborted) { setError(userFacingError(cause)); setPhase("failed"); }
    } finally { if (attempt.current === run) submitting.current = false; if (current(run) && controller.signal.aborted && !run.taskId) setPhase("idle"); }
  };
  const cancel = async () => {
    const run = attempt.current;
    if (!run) return;
    run.canceled = true; epoch.current += 1; upload.current?.abort();
    setPhase("canceled"); setError(null); setHasRawAsset(false);
    if (!run.taskId || run.rawAssetId) return;
    try { await cancelGeneration(run.taskId); } catch (cause) { if (mounted.current && attempt.current === run) setError(`已停止后续处理，任务取消未完成：${userFacingError(cause)}。可在项目任务中查看。`); }
  };
  const retryProcessing = async () => {
    const run = attempt.current;
    if (!enabled || !run?.rawAssetId || run.canceled || phase !== "failed") return;
    // A dropped response may already have created the preparation. Reuse its key unless the server explicitly failed it.
    if (run.deriveFailed) { run.deriveKey = crypto.randomUUID(); run.deriveFailed = false; }
    setError(null); await derive(run, ++epoch.current);
  };
  return { phase, taskId, error: error ?? polling.error, start, cancel, retryProcessing,
    busy: ["uploading", "creating", "running", "deriving"].includes(phase), canRetryProcessing: phase === "failed" && hasRawAsset };
}
