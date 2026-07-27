import { FrameShapeUtil } from "./FrameShape";
import { ImageShapeUtil } from "./ImageShape";
import { NoteShapeUtil } from "./NoteShape";
import { SwatchShapeUtil } from "./SwatchShape";

export {
  BOARD_ROLES,
  FRAME_SHAPE_TYPE,
  IMAGE_SHAPE_TYPE,
  isBoardShape,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
  type BoardRole,
  type BoardShape,
  type ImageShape,
} from "./shape-types";

export const boardShapeUtils = [
  ImageShapeUtil,
  NoteShapeUtil,
  SwatchShapeUtil,
  FrameShapeUtil,
] as const;
