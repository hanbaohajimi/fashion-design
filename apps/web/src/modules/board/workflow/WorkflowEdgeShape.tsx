import {
  Polyline2d,
  ShapeUtil,
  SVGContainer,
  T,
  Vec,
  useEditor,
  useValue,
  type RecordProps,
  type TLShape,
} from "tldraw";
import type { CSSProperties } from "react";
import { curveLength, curvePath } from "./workflow-curve";
import { useWorkflowInteractions } from "./WorkflowInteractions";
import styles from "./workflow-connections.module.css";

export const WORKFLOW_EDGE_SHAPE_TYPE = "fashion-workflow-edge";
declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [WORKFLOW_EDGE_SHAPE_TYPE]: {
      edgeId: string;
      endX: number;
      endY: number;
      detourY: number;
      highlighted: boolean;
      proposed: boolean;
      editable: boolean;
      label: string;
      /** 源节点正在运行：连线显示流动光点。 */
      running: boolean;
      /** BFS 深度，用于生长动画错峰。 */
      enterIndex: number;
    };
  }
}
export type WorkflowEdgeShape = TLShape<typeof WORKFLOW_EDGE_SHAPE_TYPE>;

function EdgeView({ shape }: { shape: WorkflowEdgeShape }) {
  const interaction = useWorkflowInteractions();
  const editor = useEditor();
  const zoom = useValue("workflow-edge-zoom", () => editor.getZoomLevel(), [
    editor,
  ]);
  const selected = interaction?.selectedEdgeId === shape.props.edgeId;
  const curve = curvePath(
    shape.props.endX,
    shape.props.endY,
    shape.props.detourY,
  );
  // 生长动画需要真实弧长，否则短边会被拉成虚线、长边迟迟画不完
  const length = curveLength(
    shape.props.endX,
    shape.props.endY,
    shape.props.detourY,
  );
  return (
    <SVGContainer
      className={styles.edge}
      data-workflow-edge={shape.props.edgeId}
      data-selected={selected ? "true" : "false"}
      data-highlighted={shape.props.highlighted ? "true" : "false"}
      data-proposed={shape.props.proposed ? "true" : "false"}
      data-running={shape.props.running ? "true" : "false"}
      style={
        {
          "--edge-length": String(length),
          "--edge-enter-index": String(shape.props.enterIndex),
        } as CSSProperties
      }
    >
      <g
        onPointerDown={(event) => {
          event.stopPropagation();
          if (!shape.props.proposed)
            interaction?.selectEdge(shape.props.edgeId);
        }}
      >
        <path className={styles.edgeHit} d={curve.d}>
          <title>{shape.props.label}</title>
        </path>
        <path className={styles.edgeLine} d={curve.d} />
        {/* 流动光点：独立一条 path，避免与生长动画的 dash 互相干扰 */}
        <path className={styles.edgeFlow} d={curve.d} />
        {/* 8px 实心三角：1px 描线箭头在米色底上几乎不可见 */}
        <path
          className={styles.edgeArrow}
          d={`M ${shape.props.endX} ${shape.props.endY} L ${shape.props.endX - 8} ${shape.props.endY - 4.5} L ${shape.props.endX - 8} ${shape.props.endY + 4.5} Z`}
        />
        {selected && shape.props.editable ? (
          <g
            aria-label="拖动更换输入素材"
            transform={`scale(${1 / zoom})`}
            onPointerDown={(event) =>
              interaction?.reconnect(shape.props.edgeId, event)
            }
          >
            <circle
              cx={24}
              cy={0}
              r={14}
              fill="transparent"
              pointerEvents="all"
              cursor="grab"
            />
            <circle className={styles.reconnectHandle} cx={24} cy={0} r={4} />
          </g>
        ) : null}
      </g>
    </SVGContainer>
  );
}

export class WorkflowEdgeShapeUtil extends ShapeUtil<WorkflowEdgeShape> {
  static override type = WORKFLOW_EDGE_SHAPE_TYPE;
  static override props: RecordProps<WorkflowEdgeShape> = {
    edgeId: T.string,
    endX: T.number,
    endY: T.number,
    detourY: T.number,
    enterIndex: T.number,
    highlighted: T.boolean,
    proposed: T.boolean,
    editable: T.boolean,
    label: T.string,
    running: T.boolean,
  };
  override getDefaultProps(): WorkflowEdgeShape["props"] {
    return {
      edgeId: "",
      endX: 120,
      endY: 0,
      detourY: 0,
      enterIndex: 0,
      highlighted: false,
      proposed: false,
      editable: true,
      label: "参考素材",
      running: false,
    };
  }
  override getGeometry(shape: WorkflowEdgeShape) {
    return new Polyline2d({
      points: curvePath(
        shape.props.endX,
        shape.props.endY,
        shape.props.detourY,
      ).points.map((point) => new Vec(point.x, point.y)),
    });
  }
  override canResize() {
    return false;
  }
  override canEdit() {
    return false;
  }
  override canSnap() {
    return false;
  }
  override canTabTo() {
    return false;
  }
  override onTranslate = (shape: WorkflowEdgeShape) => ({
    id: shape.id,
    type: WORKFLOW_EDGE_SHAPE_TYPE as typeof WORKFLOW_EDGE_SHAPE_TYPE,
    x: shape.x,
    y: shape.y,
  });
  override component(shape: WorkflowEdgeShape) {
    return <EdgeView shape={shape} />;
  }
  override getIndicatorPath(shape: WorkflowEdgeShape) {
    return new Path2D(
      curvePath(shape.props.endX, shape.props.endY, shape.props.detourY).d,
    );
  }
  override toSvg(shape: WorkflowEdgeShape) {
    const theme = getComputedStyle(this.editor.getContainer());
    const color =
      theme
        .getPropertyValue(
          shape.props.highlighted ? "--swatch-indigo" : "--color-ink-tertiary",
        )
        .trim() || "#78746e";
    return (
      <g
        fill="none"
        stroke={color}
        strokeWidth={shape.props.highlighted ? 2 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={shape.props.highlighted ? 1 : 0.72}
      >
        <path
          d={
            curvePath(shape.props.endX, shape.props.endY, shape.props.detourY).d
          }
          strokeDasharray={shape.props.proposed ? "4 5" : undefined}
        />
        {/* 与画布一致的实心三角箭头。流动光点不导出：静态图里它只会变成一串散点。 */}
        <path
          d={`M ${shape.props.endX} ${shape.props.endY} L ${shape.props.endX - 8} ${shape.props.endY - 4.5} L ${shape.props.endX - 8} ${shape.props.endY + 4.5} Z`}
          fill={color}
          stroke="none"
          opacity={0.8}
        />
      </g>
    );
  }
}
