import { FrameShapeUtil } from "./FrameShape";
import { FabricShapeUtil } from "./FabricShape";
import { ImageShapeUtil } from "./ImageShape";
import { NoteShapeUtil } from "./NoteShape";
import { SwatchShapeUtil } from "./SwatchShape";
import { ConnectorShapeUtil } from "./ConnectorShape";

export {
  BOARD_ROLES,
  FABRIC_SHAPE_TYPE,
  FRAME_SHAPE_TYPE,
  IMAGE_SHAPE_TYPE,
  isBoardShape,
  isRoleAssignableShape,
  normalizeBoardRole,
  normalizeHexColor,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
  type BoardRole,
  type BoardShape,
  type FabricShape,
  type ImageShape,
  type RoleInferenceState,
  type RoleSource,
  type SwatchShape,
} from "./shape-types";

export {
  CONNECTOR_SHAPE_TYPE,
  type AnchorSide,
  type ConnectorRouting,
  type ConnectorShape,
} from "../connectors/connector-types";

export {
  computeSwatchWidth,
  createSwatchColor,
  getSwatchColors,
  normalizeSwatchHex,
  SWATCH_HEIGHT,
  SWATCH_MAX_COLORS,
  type SwatchColor,
} from "./swatch-colors";

export const boardShapeUtils = [
  ImageShapeUtil,
  NoteShapeUtil,
  SwatchShapeUtil,
  FrameShapeUtil,
  FabricShapeUtil,
  ConnectorShapeUtil,
] as const;
