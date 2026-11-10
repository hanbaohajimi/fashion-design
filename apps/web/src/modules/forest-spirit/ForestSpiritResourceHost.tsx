"use client";

import { useEffect, useState } from "react";
import { ForestSpiritSurface } from "./ForestSpiritSurface";
import type { SpiritRenderAsset, SpiritRendererFactory } from "./spirit-contract";

export interface SpiritHostProps {
  userId: string;
  projectId: string;
  conversationId: string | null;
  chatOpen: boolean;
  suspended?: boolean;
  onOpenChat(): void;
}

/** Resource lifecycle only. The caller owns its approval policy; this grants no approval. */
export function ForestSpiritResourceHost<T extends SpiritRenderAsset>({
  manifestUrl, parseAsset, rendererFactory, ...props
}: SpiritHostProps & {
  manifestUrl: string;
  parseAsset(value: unknown): T | null;
  rendererFactory: SpiritRendererFactory;
}) {
  const [loaded, setLoaded] = useState<{ url: string; parser: typeof parseAsset; asset: T | null } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(manifestUrl, { signal: abort.signal }).then(async response => {
      if (!response.ok) return;
      const asset = parseAsset(await response.json());
      if (!abort.signal.aborted) setLoaded({ url: manifestUrl, parser: parseAsset, asset });
    }).catch(() => { /* Existing full assistant remains available. */ });
    return () => abort.abort();
  }, [manifestUrl, parseAsset]);
  const asset = loaded?.url === manifestUrl && loaded.parser === parseAsset ? loaded.asset : null;
  if (!asset) return null;
  return <ForestSpiritSurface key={`${props.userId}:${props.projectId}:${manifestUrl}:${asset.model3Url}`} {...props} asset={asset} rendererFactory={rendererFactory} />;
}
