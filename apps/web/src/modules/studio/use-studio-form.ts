"use client";

import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { StudioDocumentView } from "@fashion/shared";
import type { SubmitFeedbackController } from "../../components/interactions/use-submit-feedback";
import { StudioApiError } from "./studio-api";
import { errorMessage } from "./studio-ui";
import { useDraftScope, usePersistentDraft } from "../../components/drafts/use-persistent-draft";
import { sameDraftBaseline, serializeDraft } from "../../components/drafts/draft-repository";
import { registerStudioSaveForm, STUDIO_SAVE_CONFIRMED, type StudioSaveContext } from "./studio-save-recovery";

export interface StudioPanelProps {
  readonly projectId: string;
  readonly canEdit: boolean;
  readonly onDirty: (dirty: boolean) => void;
  /** Refresh the list separately from the confirmed save; false means refresh failed. */
  readonly onSaved: () => Promise<unknown>;
  readonly onDocumentSaved?: (document: StudioDocumentView) => void;
  readonly beforeChange: () => Promise<boolean>;
  readonly feedback?: SubmitFeedbackController | undefined;
}

/** Keeps a failed request key stable until its exact payload changes or succeeds. */
export function useStudioForm<T>(initial: T, onDirty: (dirty: boolean) => void, options: { readonly notifySaved?: boolean; readonly feedback?: SubmitFeedbackController | undefined; readonly draftKey?: string; readonly initialDraft?: T | undefined; readonly persist?: boolean } = {}) {
  const [draft, setDraft] = useState(options.initialDraft ?? initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const packet = useRef<{ signature: string; requestKey: string } | null>(null);
  const flight = useRef(false);
  const mounted = useRef(true);
  const draftScope = useDraftScope();
  const scopeKey = JSON.stringify(draftScope);
  const activeScope = useRef(scopeKey);
  useLayoutEffect(() => { activeScope.current = scopeKey; }, [scopeKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = !sameDraftBaseline(JSON.stringify(draft), baseline);
  const recovery = usePersistentDraft({ value: draft, restore: setDraft, baseline, objectKey: options.draftKey ?? "form", enabled: options.persist !== false });
  useEffect(() => {
    if (!draftScope || options.persist === false) return;
    const key = JSON.stringify([draftScope.accountId, draftScope.projectId, draftScope.editor, options.draftKey ?? "form"]);
    const unregister = registerStudioSaveForm(key, async () => ({ value: draft, acknowledge: await recovery.captureAcknowledgement(draft) }));
    const confirmed = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: T }>).detail;
      if (detail?.key !== key || serializeDraft(detail.value) !== serializeDraft(draft)) return;
      void recovery.acknowledge(detail.value);
      setBaseline(JSON.stringify(draft)); packet.current = null; setError(null); setConflict(false); setSaved(true);
    };
    window.addEventListener(STUDIO_SAVE_CONFIRMED, confirmed);
    return () => { unregister(); window.removeEventListener(STUDIO_SAVE_CONFIRMED, confirmed); };
  }, [draftScope, draft, options.draftKey, options.persist, recovery]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const submit = async (action: (requestKey: string, recovery?: StudioSaveContext) => Promise<unknown>, actionKey = "save") => {
    if (flight.current) return false;
    flight.current = true;
    const receipt = options.feedback?.begin(actionKey);
    const signature = JSON.stringify(draft);
    const requestSignature = JSON.stringify([actionKey, draft]);
    if (packet.current?.signature !== requestSignature) packet.current = { signature: requestSignature, requestKey: crypto.randomUUID() };
    setBusy(true); setError(null); setConflict(false); setSaved(false);
    const scope = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-studio-motion]");
    try {
      const acknowledge = await recovery.captureAcknowledgement(draft);
      await action(packet.current.requestKey, draftScope && options.persist !== false ? {
        ...draftScope, objectKey: options.draftKey ?? "form", draft,
        isActive: () => mounted.current && activeScope.current === scopeKey,
      } : undefined);
      await acknowledge();
      if (!mounted.current) return true;
      if (options.notifySaved !== false) scope?.dispatchEvent(new CustomEvent("atelier:revision-saved", { detail: packet.current.requestKey }));
      setBaseline(signature); packet.current = null; setSaved(true); onDirty(false);
      receipt?.succeed();
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      setConflict(cause instanceof StudioApiError && cause.status === 409);
      setError(cause instanceof StudioApiError && cause.status === 409 ? "此资料已有新修订。当前输入已保留，请重新载入并合并后保存。" : errorMessage(cause));
      receipt?.fail();
      return false;
    } finally { flight.current = false; if (mounted.current) setBusy(false); }
  };
  const reset = (value: T) => { setBaseline(JSON.stringify(value)); packet.current = null; setDraft(value); onDirty(false); setError(null); };
  const changeDraft: Dispatch<SetStateAction<T>> = (value) => {
    setSaved(false);
    if (options.feedback?.snapshot.phase === "success" || options.feedback?.snapshot.phase === "error") options.feedback.reset();
    setDraft(value);
  };
  return { draft, setDraft: changeDraft, dirty, busy, error, setError, conflict, saved, submit, reset, recovery, isMounted: () => mounted.current };
}
