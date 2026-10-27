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
import { useCallback, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { curveLength, curvePath } from "./workflow-curve";
import type { WorkflowEdgeRelation } from "./workflow-graph";
import { useWorkflowInteractions } from "./WorkflowInteractions";
import { WorkflowEdgeHoverLabel } from "./WorkflowEdgeHoverLabel";
import styles from "./workflow-connections.module.css";

export const WORKFLOW_EDGE_SHAPE_TYPE = "fashion-workflow-edge";
const RELATION_COLORS = {
  input: { token: "--color-workflow-edge-input", fallback: "#415879" },
  reference: { token: "--color-workflow-edge-reference", fallback: "#7a5e32" },
  result: { token: "--color-workflow-edge-result", fallback: "#61476c" },
} satisfies Record<WorkflowEdgeRelation, { token: string; fallback: string }>;
declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [WORKFLOW_EDGE_SHAPE_TYPE]: {
      edgeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      endX: number;
      endY: number;
      detourY: number;
      highlighted: boolean;
      muted: boolean;
      relation: WorkflowEdgeRelation;
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
  const labelId = useId();
  const [labelPoint, setLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const labelDismissed = useRef(false);
  const dismissLabel = useCallback(() => {
    labelDismissed.current = true;
    setLabelPoint(null);
  }, []);
  const label = shape.props.relation === "result" ? "生成结果"
    : shape.props.relation === "reference" ? "参考素材"
      : shape.props.label === "原图" ? "主图输入" : shape.props.label;
  const showLabel = (event: ReactPointerEvent<SVGPathElement>) => {
    if (event.pointerType === "mouse" && event.buttons === 0 &&
      !interaction?.gesture && !labelDismissed.current) {
      setLabelPoint({ x: event.clientX, y: event.clientY });
    }
  };
  const zoom = useValue("workflow-edge-zoom", () => editor.getZoomLevel(), [
    editor,
  ]);
  const selected = interaction?.selectedEdgeId === shape.props.edgeId;
  const hoveredNodeId = interaction?.hoveredNodeId;
  const adjacent = Boolean(hoveredNodeId && (
    shape.props.sourceNodeId === hoveredNodeId || shape.props.targetNodeId === hoveredNodeId
  ));
  // 悬停仅覆盖显示层；移开后直接恢复选中节点的链路，不写入画布存储。
  const highlighted = hoveredNodeId ? adjacent : shape.props.highlighted;
  const muted = hoveredNodeId ? !adjacent : shape.props.muted;
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
      data-relation={shape.props.relation}
      data-node-hovered={adjacent ? "true" : "false"}
      data-muted={muted && !selected && !interaction?.gesture ? "true" : "false"}
      data-highlighted={highlighted ? "true" : "false"}
      data-proposed={shape.props.proposed ? "true" : "false"}
      data-running={shape.props.running ? "true" : "false"}
      style={
        {
          "--edge-color": `var(${RELATION_COLORS[shape.props.relation].token})`,
          "--edge-length": String(length),
          "--edge-enter-index": String(shape.props.enterIndex),
        } as CSSProperties
      }
    >
      <g
        onPointerDownCapture={dismissLabel}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (!shape.props.proposed)
            interaction?.selectEdge(shape.props.edgeId);
        }}
      >
        <path className={styles.edgeHit} d={curve.d}
          aria-label={label}
          aria-describedby={labelPoint && !interaction?.gesture ? labelId : undefined}
          onPointerEnter={(event) => {
            labelDismissed.current = false;
            showLabel(event);
          }}
          onPointerMove={showLabel}
          onPointerLeave={() => {
            labelDismissed.current = false;
            setLabelPoint(null);
          }}
        />
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
      {labelPoint && !interaction?.gesture ? (
        <WorkflowEdgeHoverLabel id={labelId}
          label={shape.props.proposed ? `${label} 待确认` : label}
          color={`var(${RELATION_COLORS[shape.props.relation].token})`}
          point={labelPoint} onDismiss={dismissLabel} />
      ) : null}
    </SVGContainer>
  );
}

export class WorkflowEdgeShapeUtil extends ShapeUtil<WorkflowEdgeShape> {
  static override type = WORKFLOW_EDGE_SHAPE_TYPE;
  static override props: RecordProps<WorkflowEdgeShape> = {
    edgeId: T.string,
    sourceNodeId: T.string,
    targetNodeId: T.string,
    endX: T.number,
    endY: T.number,
    detourY: T.number,
    enterIndex: T.number,
    highlighted: T.boolean,
    muted: T.boolean,
    relation: T.literalEnum("input", "reference", "result"),
    proposed: T.boolean,
    editable: T.boolean,
    label: T.string,
    running: T.boolean,
  };
  override getDefaultProps(): WorkflowEdgeShape["props"] {
    return {
      edgeId: "",
      sourceNodeId: "",
      targetNodeId: "",
      endX: 120,
      endY: 0,
      detourY: 0,
      enterIndex: 0,
      highlighted: false,
      muted: false,
      relation: "reference",
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
    const palette = RELATION_COLORS[shape.props.relation];
    const color =
      theme
        .getPropertyValue(palette.token)
        .trim() || palette.fallback;
    return (
      <g
        fill="none"
        stroke={color}
        strokeWidth={shape.props.muted ? 1.5 : shape.props.highlighted ? 2.5 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={shape.props.muted ? 0.18 : shape.props.highlighted ? 1 : 0.9}
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
        />
      </g>
    );
  }
}
