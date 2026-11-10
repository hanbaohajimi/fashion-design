"use client";

import { useCallback } from "react";
import {
  useImagePlacement,
  type PendingImagePlacement,
  type PlacementResult,
} from "./use-image-placement";

export type PendingFilePlacement =
  PendingImagePlacement<"place_generated_asset">;
export function useGeneratedFilePlacement(
  projectId: string,
  onPlaced: (result: PlacementResult) => Promise<void>,
) {
  const placement = useImagePlacement(
    projectId,
    "generated-file-placement",
    "place_generated_asset",
    onPlaced,
  );
  const executePlacement = placement.execute;
  const execute = useCallback(
    (input?: {
      assetId: string;
      title: string;
      archived: boolean;
      position?: { x: number; y: number };
    }) =>
      executePlacement(
        input
          ? {
              title: input.title,
              command: {
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
