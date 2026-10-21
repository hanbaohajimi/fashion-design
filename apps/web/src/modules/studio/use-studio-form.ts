"use client";

import { useEffect, useRef, useState } from "react";
import { StudioApiError } from "./studio-api";
import { errorMessage } from "./studio-ui";

export interface StudioPanelProps {
  readonly projectId: string;
  readonly canEdit: boolean;
  readonly onDirty: (dirty: boolean) => void;
  readonly onSaved: () => Promise<void>;
  readonly beforeChange: () => Promise<boolean>;
}

/** Keeps a failed request key stable until its exact payload changes or succeeds. */
export function useStudioForm<T>(initial: T, onDirty: (dirty: boolean) => void) {
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
  const submit = async (action: (requestKey: string) => Promise<unknown>) => {
    if (flight.current) return false;
    flight.current = true;
    const signature = JSON.stringify(draft);
    if (packet.current?.signature !== signature) packet.current = { signature, requestKey: crypto.randomUUID() };
    setBusy(true); setError(null); setConflict(false); setSaved(false);
    try {
      await action(packet.current.requestKey);
      setBaseline(signature); packet.current = null; setSaved(true); onDirty(false);
      return true;
    } catch (cause) {
      setConflict(cause instanceof StudioApiError && cause.status === 409);
      setError(cause instanceof StudioApiError && cause.status === 409 ? "此资料已有新修订。当前输入已保留，请重新载入并合并后保存。" : errorMessage(cause));
      return false;
    } finally { flight.current = false; setBusy(false); }
  };
  const reset = (value: T) => { setBaseline(JSON.stringify(value)); packet.current = null; setDraft(value); onDirty(false); setError(null); };
  return { draft, setDraft, dirty, busy, error, setError, conflict, saved, submit, reset };
}
