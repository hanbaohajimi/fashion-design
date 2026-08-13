import { BOARD_ELEMENT_ROLES, type BoardElementRole } from "@fashion/shared";
import type { TLFrameShape, TLShape, TLShapeId } from "tldraw";
import type { MaterialAppearance, Mount } from "./material-appearance";
import type { SwatchColor } from "./swatch-colors";

export const IMAGE_SHAPE_TYPE = "fashion-image";
export const NOTE_SHAPE_TYPE = "fashion-note";
export const SWATCH_SHAPE_TYPE = "fashion-swatch";
export const FRAME_SHAPE_TYPE = "fashion-frame";
export const FABRIC_SHAPE_TYPE = "fashion-fabric";

export const BOARD_ROLES = BOARD_ELEMENT_ROLES;
export type BoardRole = BoardElementRole;
export type RoleInferenceState = "none" | "pending" | "ready" | "failed";
export type RoleSource = "default" | "inferred" | "manual";

type ImageOriginProps = Readonly<{
  assetId?: string | undefined;
  fileId?: string | undefined;
  generationCandidateId?: string | undefined;
  generationTaskId?: string | undefined;
}>;

export function isPlatformGeneratedImage(props: ImageOriginProps): boolean {
  return Boolean(
    props.generationCandidateId ||
      props.generationTaskId ||
      (props.assetId && !props.fileId),
  );
}

export function normalizeImageRole(
  role: string,
  props: ImageOriginProps,
): BoardRole {
  const normalized = normalizeBoardRole(role);
  return normalized === "garment_ref" && !isPlatformGeneratedImage(props)
    ? "reference_garment"
    : normalized;
}

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [IMAGE_SHAPE_TYPE]: {
      appearance?: MaterialAppearance;
      assetId?: string;
      fileId?: string;
      generationCandidateId?: string;
      generationError?: string;
      generationPrompt?: string;
      generationStatus?: string;
      generationTaskId?: string;
      h: number;
      mounts?: readonly Mount[];
      role: string;
      roleConfidence?: number | undefined;
      roleInferenceState?: string | undefined;
      roleLabel?: string | undefined;
      roleSource?: string | undefined;
      title: string;
      uploadStatus?: string;
      url: string;
      w: number;
    };
    [NOTE_SHAPE_TYPE]: {
      appearance?: MaterialAppearance;
      h: number;
      mounts?: readonly Mount[];
      role: string;
      text: string;
      tone: string;
      w: number;
    };
    [SWATCH_SHAPE_TYPE]: {
      appearance?: MaterialAppearance;
      /** Mirrors `colors[0].color` — kept for the role inspector and palette API. */
      color: string;
      colors?: readonly SwatchColor[];
      h: number;
      /** Mirrors `colors[0].label`. */
      label: string;
      mounts?: readonly Mount[];
      role: string;
      w: number;
    };
    [FRAME_SHAPE_TYPE]: {
      h: number;
      role: string;
      title: string;
      w: number;
    };
    [FABRIC_SHAPE_TYPE]: {
      appearance?: MaterialAppearance;
      fabricId: string;
      fabricTags: readonly string[];
      h: number;
      mounts?: readonly Mount[];
      role: string;
      thumbnailUrl: string;
      w: number;
    };
  }
}

export type ImageShape = TLShape<typeof IMAGE_SHAPE_TYPE>;
export type NoteShape = TLShape<typeof NOTE_SHAPE_TYPE>;
export type SwatchShape = TLShape<typeof SWATCH_SHAPE_TYPE>;
export type FrameShape = TLShape<typeof FRAME_SHAPE_TYPE>;
export type FabricShape = TLShape<typeof FABRIC_SHAPE_TYPE>;
export type BoardShape =
  ImageShape | NoteShape | SwatchShape | FrameShape | FabricShape;

interface FinalizedSketchImageInput {
  readonly fileId: string;
  readonly fingerprint: string;
  readonly imageId: TLShapeId;
  readonly previewUrl: string;
  readonly updatedAt: string;
}

/**
 * Converts the temporary, editable sketch paper into the single image record
 * that is persisted on the board and consumed by generation.
 */
export function createFinalizedSketchImageRecord(
  frame: TLFrameShape,
  input: FinalizedSketchImageInput,
): ImageShape {
  const storedTitle = frame.meta.sketchTitle;
  const title =
    typeof storedTitle === "string" && storedTitle.trim()
      ? storedTitle
      : frame.props.name || "廓形草图";

  return {
    ...frame,
    id: input.imageId,
    meta: {
      ...frame.meta,
      fashionSketch: true,
      fashionSketchImage: true,
      role: "silhouette_ref",
      roleSource: "manual",
      sketchDirty: false,
      sketchFileId: input.fileId,
      sketchFingerprint: input.fingerprint,
      sketchPendingFileId: "",
      sketchPendingFingerprint: "",
      sketchPendingPreviewUrl: "",
      sketchPreviewUrl: input.previewUrl,
      sketchSourceFrameId: frame.id,
      sketchStatus: "ready",
      sketchUpdatedAt: input.updatedAt,
    },
    props: {
      fileId: input.fileId,
      h: frame.props.h,
      role: "silhouette_ref",
      roleInferenceState: "ready",
      roleLabel: "fashion_sketch",
      roleSource: "manual",
      title,
      uploadStatus: "ready",
      url: input.previewUrl,
      w: frame.props.w,
    },
    type: IMAGE_SHAPE_TYPE,
  };
}

export function isBoardShape(shape: TLShape): shape is BoardShape {
  return (
    shape.type === IMAGE_SHAPE_TYPE ||
    shape.type === NOTE_SHAPE_TYPE ||
    shape.type === SWATCH_SHAPE_TYPE ||
    shape.type === FRAME_SHAPE_TYPE ||
    shape.type === FABRIC_SHAPE_TYPE
  );
}

export function isRoleAssignableShape(
  shape: TLShape,
): shape is ImageShape | NoteShape | SwatchShape | FabricShape {
  return (
    shape.type === IMAGE_SHAPE_TYPE ||
    shape.type === NOTE_SHAPE_TYPE ||
    shape.type === SWATCH_SHAPE_TYPE ||
    shape.type === FABRIC_SHAPE_TYPE
  );
}

export function normalizeBoardRole(role: string): BoardRole {
  if ((BOARD_ROLES as readonly string[]).includes(role)) {
    return role as BoardRole;
  }
  if (role === "palette") return "palette";
  if (role === "note" || role === "frame") return "note";
  return "style_ref";
}

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  const withHash = normalized.startsWith("#") ? normalized : `#${normalized}`;
  return /^#[0-9A-F]{6}$/u.test(withHash) ? withHash : null;
}
