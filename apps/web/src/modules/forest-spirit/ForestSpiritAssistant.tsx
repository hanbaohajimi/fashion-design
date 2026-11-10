"use client";

import { useAuth } from "../auth/AuthProvider";
import { createOfficialSpiritRenderer } from "./official-spirit-renderer";
import { ForestSpiritResourceHost, type SpiritHostProps } from "./ForestSpiritResourceHost";
import { parseReadySpiritAsset, type SpiritRendererFactory } from "./spirit-contract";

const MANIFEST_URL = "/live2d/forest-spirit/asset-manifest.json";
type Props = Omit<SpiritHostProps, "userId">;

/** Existing chat remains the only fallback and the only conversation owner. */
export function ForestSpiritAssistant(props: Props) {
  const { session } = useAuth();
  if (process.env.NEXT_PUBLIC_FOREST_SPIRIT_ENABLED !== "true" || !session) return null;
  return <ForestSpiritHost key={`${session.user.id}:${props.projectId}`} {...props} userId={session.user.id} />;
}

export function ForestSpiritHost({ userId, rendererFactory = createOfficialSpiritRenderer, manifestUrl = MANIFEST_URL, ...props }: Props & { userId: string; rendererFactory?: SpiritRendererFactory; manifestUrl?: string }) {
  return <ForestSpiritResourceHost {...props} userId={userId} manifestUrl={manifestUrl} parseAsset={parseReadySpiritAsset} rendererFactory={rendererFactory} />;
}
