import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OutfitSnapshotView, WardrobeCapabilities, WardrobeRevisionView } from "@fashion/shared";
import { userFacingError } from "../../../components/user-facing-error";
import { wardrobeApi } from "./wardrobe-api";
import type { OutfitDraft } from "./wardrobe-state";

/** Serializes full-outfit preparations; stale results never reach the live session. */
export function useRealtimeOutfit({ projectId, draft, revisions, base, capabilities, enabled }: {
  projectId: string; draft: OutfitDraft; revisions: Map<string, WardrobeRevisionView>;
  base: OutfitSnapshotView | null; capabilities: WardrobeCapabilities; enabled: boolean;
}) {
  const payload = { name: draft.name.trim() || "试穿中的搭配", items: draft.items, layeringConfirmed: draft.layeringConfirmed, ...(base ? { baseSnapshotId: base.id } : {}) };
  const signature = JSON.stringify({ items: draft.items, layeringConfirmed: draft.layeringConfirmed });
  const items = draft.items.flatMap(entry => { const item = revisions.get(entry.revisionId); return item ? [{ ...item, layer: entry.layer, wearNote: entry.wearNote }] : []; });
  const supported = items.length === draft.items.length && items.length > 0 && capabilities.realtimeOutfitEnabled && (items.length === 1 || capabilities.realtimeMultiItemVerified) && items.every(item => capabilities.realtimeCategories.includes(item.category));
  const preview: OutfitSnapshotView | null = items.length ? { id: `draft:${projectId}`, outfitId: draft.outfitId ?? "draft", projectId, version: draft.version ?? 0, name: payload.name, items, layeringConfirmed: draft.layeringConfirmed, prompt: "", createdAt: "" } : null;
  const [prepared, setPrepared] = useState<{ signature: string; snapshot: OutfitSnapshotView } | null>(null);
  const [failure, setFailure] = useState<{ signature: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ enabled, supported, signature, payload });
  const mounted = useRef(true);
  const running = useRef(false);
  const completed = useRef("");
  const packet = useRef<{ signature: string; key: string; payload: typeof payload } | null>(null);
  useLayoutEffect(() => { latest.current = { enabled, supported, signature, payload }; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (mounted.current && latest.current.enabled && latest.current.supported && latest.current.signature !== completed.current) {
        const current = latest.current;
        if (packet.current?.signature !== current.signature) packet.current = { signature: current.signature, key: crypto.randomUUID(), payload: current.payload };
        const key = packet.current.key;
        try {
          const snapshot = await wardrobeApi.trial(projectId, { ...packet.current.payload, requestKey: key });
          if (!mounted.current || !latest.current.enabled || !latest.current.supported) return;
          if (current.signature !== latest.current.signature) continue;
          const reference = await wardrobeApi.reference(projectId, snapshot.id, `${key}-reference`);
          if (!mounted.current || !latest.current.enabled || !latest.current.supported) return;
          if (current.signature !== latest.current.signature) continue;
          completed.current = current.signature; setPrepared({ signature: current.signature, snapshot: reference }); setFailure(null);
        } catch (cause) {
          if (!mounted.current || !latest.current.enabled) return;
          if (current.signature !== latest.current.signature) continue;
          setFailure({ signature: current.signature, message: userFacingError(cause) }); break;
        }
      }
    } finally { running.current = false; }
  }, [projectId]);
  useEffect(() => {
    if (!enabled || !supported) return;
    const timer = setTimeout(() => void drain(), 350);
    return () => clearTimeout(timer);
  }, [enabled, supported, signature, attempt, drain]);
  return {
    snapshot: failure?.signature === signature ? null : supported ? prepared?.snapshot ?? base : preview,
    updating: enabled && supported && prepared?.signature !== signature && failure?.signature !== signature,
    error: failure?.signature === signature ? failure.message : null,
    retry: () => { setFailure(null); setAttempt(value => value + 1); },
  };
}
