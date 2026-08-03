import type { TLShape } from "tldraw";

export const CONNECTOR_SHAPE_TYPE = "fashion-connector";

export type AnchorSide = "top" | "right" | "bottom" | "left";
export type ConnectorRouting = "bezier" | "orthogonal" | "rounded";

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [CONNECTOR_SHAPE_TYPE]: {
      arrowEnd: boolean;
      arrowStart: boolean;
      opacity: number;
      routing: ConnectorRouting;
      sourceAnchor: AnchorSide;
      sourceObjectId: string;
      strokeColor: string;
      strokeWidth: number;
      targetAnchor: AnchorSide;
      targetObjectId: string;
    };
  }
}

export type ConnectorShape = TLShape<typeof CONNECTOR_SHAPE_TYPE>;

export interface Point {
  x: number;
  y: number;
}

export interface AnchorPoint extends Point {
  /** 外法线单位向量 (normalized) */
  normal: Point;
}
