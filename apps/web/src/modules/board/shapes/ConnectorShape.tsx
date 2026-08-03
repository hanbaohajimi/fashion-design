import {
  HTMLContainer,
  type RecordProps,
  Rectangle2d,
  ShapeUtil,
  T,
  type TLShapeId,
  useEditor,
  useValue,
} from "tldraw";

import type { ConnectorShape } from "../connectors/connector-types";
import { CONNECTOR_SHAPE_TYPE } from "../connectors/connector-types";
import { computeAnchorPoints } from "../connectors/anchorGeometry";
import {
  computeArrowPath,
  computeBezierEndTangent,
  computeBezierPath,
  computeOrthogonalEndTangent,
  computeOrthogonalPath,
  computeRoundedPath,
} from "../connectors/pathRouting";
import styles from "./connector.module.css";

interface ConnectorContentProps {
  readonly shape: ConnectorShape;
}

function ConnectorContent({ shape }: ConnectorContentProps) {
  const editor = useEditor();

  // 订阅源和目标 shape 的变化
  const sourceShape = useValue(
    `connector-source-${shape.id}`,
    () => editor.getShape(shape.props.sourceObjectId as TLShapeId),
    [editor, shape.props.sourceObjectId],
  );

  const targetShape = useValue(
    `connector-target-${shape.id}`,
    () => editor.getShape(shape.props.targetObjectId as TLShapeId),
    [editor, shape.props.targetObjectId],
  );

  // 如果源或目标已删除，不渲染
  if (!sourceShape || !targetShape) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[Connector ${shape.id}] Missing source or target shape:`,
        { sourceId: shape.props.sourceObjectId, targetId: shape.props.targetObjectId },
      );
    }
    return null;
  }

  // 计算锚点
  const sourceAnchors = computeAnchorPoints(editor, sourceShape);
  const targetAnchors = computeAnchorPoints(editor, targetShape);

  if (!sourceAnchors || !targetAnchors) {
    return null;
  }

  const sourceAnchor = sourceAnchors[shape.props.sourceAnchor];
  const targetAnchor = targetAnchors[shape.props.targetAnchor];

  // 计算路径
  let pathD = "";
  let endTangent = { x: 1, y: 0 };
  const distance = Math.hypot(
    targetAnchor.x - sourceAnchor.x,
    targetAnchor.y - sourceAnchor.y,
  );

  switch (shape.props.routing) {
    case "bezier":
      pathD = computeBezierPath(sourceAnchor, targetAnchor);
      endTangent = computeBezierEndTangent(targetAnchor, distance);
      break;
    case "orthogonal":
      pathD = computeOrthogonalPath(sourceAnchor, targetAnchor);
      endTangent = computeOrthogonalEndTangent(sourceAnchor, targetAnchor);
      break;
    case "rounded":
      pathD = computeRoundedPath(sourceAnchor, targetAnchor);
      endTangent = computeOrthogonalEndTangent(sourceAnchor, targetAnchor);
      break;
  }

  // 箭头路径
  const startArrowPath = shape.props.arrowStart
    ? computeArrowPath(sourceAnchor, { x: -sourceAnchor.normal.x, y: -sourceAnchor.normal.y }, 7)
    : "";
  const endArrowPath = shape.props.arrowEnd
    ? computeArrowPath(targetAnchor, endTangent, 7)
    : "";

  return (
    <HTMLContainer>
      <svg
        className={styles.connectorSvg}
        style={{
          left: 0,
          pointerEvents: "none",
          position: "absolute",
          top: 0,
        }}
      >
        {/* 宽命中区域（透明）*/}
        <path
          className={styles.connectorHitArea}
          d={pathD}
          fill="none"
          stroke="transparent"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="12"
          style={{ pointerEvents: "stroke" }}
        />

        {/* 视觉线条 */}
        <path
          className={styles.connectorPath}
          d={pathD}
          fill="none"
          stroke={shape.props.strokeColor}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={shape.props.strokeWidth}
          opacity={shape.props.opacity}
          style={{ vectorEffect: "non-scaling-stroke" }}
        />

        {/* 箭头 */}
        {startArrowPath && (
          <path
            d={startArrowPath}
            fill={shape.props.strokeColor}
            opacity={shape.props.opacity}
          />
        )}
        {endArrowPath && (
          <path
            d={endArrowPath}
            fill={shape.props.strokeColor}
            opacity={shape.props.opacity}
          />
        )}
      </svg>
    </HTMLContainer>
  );
}

export class ConnectorShapeUtil extends ShapeUtil<ConnectorShape> {
  static override type = CONNECTOR_SHAPE_TYPE;
  static override props: RecordProps<ConnectorShape> = {
    arrowEnd: T.boolean,
    arrowStart: T.boolean,
    opacity: T.number,
    routing: T.literalEnum("bezier", "orthogonal", "rounded"),
    sourceAnchor: T.literalEnum("top", "right", "bottom", "left"),
    sourceObjectId: T.string,
    strokeColor: T.string,
    strokeWidth: T.number,
    targetAnchor: T.literalEnum("top", "right", "bottom", "left"),
    targetObjectId: T.string,
  };

  override getDefaultProps(): ConnectorShape["props"] {
    return {
      arrowEnd: false,
      arrowStart: false,
      opacity: 1,
      routing: "bezier",
      sourceAnchor: "right",
      sourceObjectId: "",
      strokeColor: "rgba(45, 43, 39, 0.68)",
      strokeWidth: 1.25,
      targetAnchor: "left",
      targetObjectId: "",
    };
  }

  override canResize(): boolean {
    return false;
  }

  override canCrop(): boolean {
    return false;
  }

  override canBind(): boolean {
    return false;
  }

  override isAspectRatioLocked(): boolean {
    return false;
  }

  override component(shape: ConnectorShape) {
    return <ConnectorContent shape={shape} />;
  }

  override indicator() {
    // 连接器不需要传统的矩形指示器
    return null;
  }

  override getIndicatorPath(): undefined {
    // 连接器通过改变 strokeWidth 显示选中状态
    return undefined;
  }

  override getGeometry(shape: ConnectorShape): Rectangle2d {
    // 计算连接器的实际边界框
    const sourceShape = this.editor.getShape(shape.props.sourceObjectId as TLShapeId);
    const targetShape = this.editor.getShape(shape.props.targetObjectId as TLShapeId);

    if (!sourceShape || !targetShape) {
      return new Rectangle2d({
        width: 1,
        height: 1,
        x: 0,
        y: 0,
        isFilled: false,
      });
    }

    const sourceAnchors = computeAnchorPoints(this.editor, sourceShape);
    const targetAnchors = computeAnchorPoints(this.editor, targetShape);

    if (!sourceAnchors || !targetAnchors) {
      return new Rectangle2d({
        width: 1,
        height: 1,
        x: 0,
        y: 0,
        isFilled: false,
      });
    }

    const sourceAnchor = sourceAnchors[shape.props.sourceAnchor];
    const targetAnchor = targetAnchors[shape.props.targetAnchor];

    // 计算包含两个锚点的边界框
    const minX = Math.min(sourceAnchor.x, targetAnchor.x);
    const minY = Math.min(sourceAnchor.y, targetAnchor.y);
    const maxX = Math.max(sourceAnchor.x, targetAnchor.x);
    const maxY = Math.max(sourceAnchor.y, targetAnchor.y);

    const padding = 20; // 额外的边距，用于贝塞尔曲线的控制点

    return new Rectangle2d({
      x: minX - padding,
      y: minY - padding,
      width: Math.max(1, maxX - minX + padding * 2),
      height: Math.max(1, maxY - minY + padding * 2),
      isFilled: false,
    });
  }
}
