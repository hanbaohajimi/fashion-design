import { FrameShapeUtil } from "./FrameShape";
import { FabricShapeUtil } from "./FabricShape";
import { ImageShapeUtil } from "./ImageShape";
import { NoteShapeUtil } from "./NoteShape";
import { SwatchShapeUtil } from "./SwatchShape";

export {
  BOARD_ROLES,
  FABRIC_SHAPE_TYPE,
  FRAME_SHAPE_TYPE,
  IMAGE_SHAPE_TYPE,
  isBoardShape,
  isRoleAssignableShape,
  normalizeBoardRole,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
  type BoardRole,
  type BoardShape,
  type FabricShape,
  type ImageShape,
  type RoleInferenceState,
  type RoleSource,
} from "./shape-types";

export const boardShapeUtils = [
  ImageShapeUtil,
  NoteShapeUtil,
  SwatchShapeUtil,
  FrameShapeUtil,
  FabricShapeUtil,
] as const;
