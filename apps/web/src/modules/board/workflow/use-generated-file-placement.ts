"use client";

import { useCallback } from "react";
import {
  useImagePlacement,
  type PendingImagePlacement,
  type PlacementResult,
} from "./use-image-placement";

export type PendingFilePlacement =
  PendingImagePlacement<"place_generated_asset" | "place_generated_media">;
const PLACEMENT_TYPES = ["place_generated_asset", "place_generated_media"] as const;
export function useGeneratedFilePlacement(
  projectId: string,
  onPlaced: (result: PlacementResult) => Promise<void>,
) {
  const placement = useImagePlacement(
    projectId,
    "generated-file-placement",
    PLACEMENT_TYPES,
    onPlaced,
  );
  const executePlacement = placement.execute;
  const execute = useCallback(
    (input?: {
      assetId: string;
      title: string;
      archived: boolean;
      domain?: "asset" | "runway";
      position?: { x: number; y: number };
    }) =>
      executePlacement(
        input
          ? {
              title: input.title,
              command: input.domain === "runway" ? {
                type: "place_generated_media",
                mutationId: crypto.randomUUID(),
                mediaId: input.assetId,
                ...(input.position ? { position: input.position } : {}),
              } : {
                type: "place_generated_asset",
                mutationId: crypto.randomUUID(),
                assetId: input.assetId,
                archived: input.archived,
                ...(input.position ? { position: input.position } : {}),
              },
            }
          : undefined,
      ),
    [executePlacement],
  );
  return { ...placement, execute };
}
