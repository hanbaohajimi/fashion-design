import type { BoardElementRole } from "@fashion/shared";

export type SubstrateMaterial =
  | "paper"
  | "photo"
  | "card"
  | "fabric"
  | "tracing-paper";

export type EdgeStyle =
  | "straight"
  | "torn"
  | "deckled"
  | "pinked"
  | "rough-cut";

export type MountType = "pin" | "tape" | "clip" | "staple" | "stitch";

export type MountVariant =
  | "brass-pin"
  | "red-pin"
  | "silver-clip"
  | "washi-tape"
  | "masking-tape"
  | "binder-clip"
  | "staple-corner"
  | "running-stitch";

export interface Mount {
  readonly id: string;
  readonly type: MountType;
  readonly variant: MountVariant;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly action?: "lock" | "draft" | "group" | "avoid";
}

export interface SubstrateConfig {
  readonly material: SubstrateMaterial;
  readonly tone: string;
  readonly textureId?: string;
  readonly opacity: number;
  readonly padding: number;
}

export interface EdgeConfig {
  readonly style: EdgeStyle;
  readonly intensity: number;
}

export interface ShadowConfig {
  readonly elevation: number;
  readonly softness: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface ImperfectionConfig {
  readonly crease: number;
  readonly grain: number;
  readonly cornerWear: number;
}

export type MaterialPreset =
  | "editorial-photo"
  | "sketch-paper"
  | "fabric-swatch"
  | "color-card"
  | "archive-note"
  | "clean-sheet";

export interface MaterialAppearance {
  readonly preset: MaterialPreset;
  readonly substrate: SubstrateConfig;
  readonly edge: EdgeConfig;
  readonly mounts: readonly Mount[];
  readonly shadow: ShadowConfig;
  readonly imperfections: ImperfectionConfig;
  readonly seed: number;
}

/**
 * Resolve material appearance from board element role.
 * Maps semantic role to physical material preset following studio conventions.
 */
export function resolveMaterialAppearance(
  role: BoardElementRole,
): MaterialPreset {
  switch (role) {
    case "style_ref":
      return "editorial-photo";
    case "fabric_ref":
      return "fabric-swatch";
    case "palette":
      return "color-card";
    case "silhouette_ref":
      return "sketch-paper";
    case "detail_ref":
      return "editorial-photo";
    case "note":
      return "archive-note";
    case "avoid":
      return "editorial-photo";
    default:
      return "clean-sheet";
  }
}

/**
 * Generate deterministic material appearance from preset and seed.
 */
export function generateMaterialAppearance(
  preset: MaterialPreset,
  seed: number,
  role: BoardElementRole,
): MaterialAppearance {
  const seededRandom = (offset: number): number => {
    const x = Math.sin(seed + offset) * 10000;
    return x - Math.floor(x);
  };

  const base = PRESET_CONFIGS[preset];
  const mounts: Mount[] = [];

  // Generate mount positions deterministically
  if (preset === "editorial-photo" || preset === "fabric-swatch") {
    // Top-left brass pin
    mounts.push({
      id: `mount-${seed}-0`,
      type: "pin",
      variant: role === "avoid" ? "red-pin" : "brass-pin",
      x: 18 + seededRandom(1) * 8,
      y: 18 + seededRandom(2) * 8,
      rotation: seededRandom(3) * 360,
      ...(role === "avoid" ? { action: "avoid" as const } : {}),
    });

    // Top-right clip for larger pieces
    if (seededRandom(4) > 0.5) {
      mounts.push({
        id: `mount-${seed}-1`,
        type: "clip",
        variant: "silver-clip",
        x: 0.92,
        y: 12 + seededRandom(5) * 8,
        rotation: seededRandom(6) * 20 - 10,
      });
    }
  } else if (preset === "sketch-paper") {
    // Masking tape at top
    mounts.push({
      id: `mount-${seed}-0`,
      type: "tape",
      variant: "masking-tape",
      x: 0.5,
      y: -8,
      rotation: seededRandom(7) * 4 - 2,
      action: "draft",
    });
  } else if (preset === "archive-note") {
    // Top-left pin
    mounts.push({
      id: `mount-${seed}-0`,
      type: "pin",
      variant: "brass-pin",
      x: 14 + seededRandom(8) * 6,
      y: 14 + seededRandom(9) * 6,
      rotation: seededRandom(10) * 360,
    });
  } else if (preset === "color-card") {
    // Small brass pin for swatches
    mounts.push({
      id: `mount-${seed}-0`,
      type: "pin",
      variant: "brass-pin",
      x: 0.5,
      y: 12,
      rotation: seededRandom(11) * 360,
    });
  }

  return {
    preset,
    substrate: {
      ...base.substrate,
      tone: base.substrate.tone,
    },
    edge: {
      ...base.edge,
      intensity: base.edge.intensity * (0.8 + seededRandom(12) * 0.4),
    },
    mounts,
    shadow: {
      ...base.shadow,
      offsetX: base.shadow.offsetX * (0.9 + seededRandom(13) * 0.2),
      offsetY: base.shadow.offsetY * (0.9 + seededRandom(14) * 0.2),
    },
    imperfections: {
      crease: base.imperfections.crease * seededRandom(15),
      grain: base.imperfections.grain * (0.7 + seededRandom(16) * 0.6),
      cornerWear: base.imperfections.cornerWear * seededRandom(17),
    },
    seed,
  };
}

interface PresetConfig {
  readonly substrate: SubstrateConfig;
  readonly edge: EdgeConfig;
  readonly shadow: ShadowConfig;
  readonly imperfections: ImperfectionConfig;
}

const PRESET_CONFIGS: Record<MaterialPreset, PresetConfig> = {
  "editorial-photo": {
    substrate: {
      material: "photo",
      tone: "#f8f6f2",
      opacity: 1,
      padding: 12,
    },
    edge: {
      style: "straight",
      intensity: 0.15,
    },
    shadow: {
      elevation: 3,
      softness: 12,
      offsetX: 4,
      offsetY: 6,
    },
    imperfections: {
      crease: 0.05,
      grain: 0.25,
      cornerWear: 0.12,
    },
  },
  "sketch-paper": {
    substrate: {
      material: "paper",
      tone: "#f4f1ea",
      opacity: 0.98,
      padding: 16,
    },
    edge: {
      style: "torn",
      intensity: 0.6,
    },
    shadow: {
      elevation: 2,
      softness: 8,
      offsetX: 3,
      offsetY: 5,
    },
    imperfections: {
      crease: 0.18,
      grain: 0.45,
      cornerWear: 0.28,
    },
  },
  "fabric-swatch": {
    substrate: {
      material: "fabric",
      tone: "#f9f7f3",
      opacity: 1,
      padding: 10,
    },
    edge: {
      style: "pinked",
      intensity: 0.8,
    },
    shadow: {
      elevation: 2,
      softness: 10,
      offsetX: 3,
      offsetY: 4,
    },
    imperfections: {
      crease: 0.1,
      grain: 0.55,
      cornerWear: 0.08,
    },
  },
  "color-card": {
    substrate: {
      material: "card",
      tone: "#fdfcfa",
      opacity: 1,
      padding: 8,
    },
    edge: {
      style: "straight",
      intensity: 0.08,
    },
    shadow: {
      elevation: 1,
      softness: 6,
      offsetX: 2,
      offsetY: 3,
    },
    imperfections: {
      crease: 0.02,
      grain: 0.15,
      cornerWear: 0.05,
    },
  },
  "archive-note": {
    substrate: {
      material: "paper",
      tone: "#f2ede3",
      opacity: 0.96,
      padding: 14,
    },
    edge: {
      style: "deckled",
      intensity: 0.4,
    },
    shadow: {
      elevation: 2,
      softness: 9,
      offsetX: 3,
      offsetY: 5,
    },
    imperfections: {
      crease: 0.15,
      grain: 0.4,
      cornerWear: 0.22,
    },
  },
  "clean-sheet": {
    substrate: {
      material: "paper",
      tone: "#ffffff",
      opacity: 1,
      padding: 0,
    },
    edge: {
      style: "straight",
      intensity: 0,
    },
    shadow: {
      elevation: 1,
      softness: 4,
      offsetX: 2,
      offsetY: 2,
    },
    imperfections: {
      crease: 0,
      grain: 0,
      cornerWear: 0,
    },
  },
};
