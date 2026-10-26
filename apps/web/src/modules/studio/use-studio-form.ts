"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SubmitFeedbackController } from "../../components/interactions/use-submit-feedback";
import { StudioApiError } from "./studio-api";
import { errorMessage } from "./studio-ui";

export interface StudioPanelProps {
  readonly projectId: string;
  readonly canEdit: boolean;
  readonly onDirty: (dirty: boolean) => void;
  readonly onSaved: () => Promise<void>;
  readonly beforeChange: () => Promise<boolean>;
  readonly feedback?: SubmitFeedbackController | undefined;
}

/** Keeps a failed request key stable until its exact payload changes or succeeds. */
export function useStudioForm<T>(initial: T, onDirty: (dirty: boolean) => void, options: { readonly notifySaved?: boolean; readonly feedback?: SubmitFeedbackController | undefined } = {}) {
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const packet = useRef<{ signature: string; requestKey: string } | null>(null);
  const flight = useRef(false);
  const dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const submit = async (action: (requestKey: string) => Promise<unknown>, actionKey = "save") => {
    if (flight.current) return false;
    flight.current = true;
    const receipt = options.feedback?.begin(actionKey);
    const signature = JSON.stringify(draft);
    if (packet.current?.signature !== signature) packet.current = { signature, requestKey: crypto.randomUUID() };
    setBusy(true); setError(null); setConflict(false); setSaved(false);
    const scope = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-studio-motion]");
    try {
      await action(packet.current.requestKey);
      if (options.notifySaved !== false) scope?.dispatchEvent(new CustomEvent("atelier:revision-saved", { detail: packet.current.requestKey }));
      setBaseline(signature); packet.current = null; setSaved(true); onDirty(false);
      receipt?.succeed();
      return true;
    } catch (cause) {
      setConflict(cause instanceof StudioApiError && cause.status === 409);
      setError(cause instanceof StudioApiError && cause.status === 409 ? "此资料已有新修订。当前输入已保留，请重新载入并合并后保存。" : errorMessage(cause));
      receipt?.fail();
      return false;
    } finally { flight.current = false; setBusy(false); }
  };
  const reset = (value: T) => { setBaseline(JSON.stringify(value)); packet.current = null; setDraft(value); onDirty(false); setError(null); };
  const changeDraft: Dispatch<SetStateAction<T>> = (value) => {
    if (options.feedback?.snapshot.phase === "success" || options.feedback?.snapshot.phase === "error") options.feedback.reset();
    setDraft(value);
  };
  return { draft, setDraft: changeDraft, dirty, busy, error, setError, conflict, saved, submit, reset };
}
