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
import { curvePath } from "./workflow-curve";
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
  return (
    <SVGContainer
      className={styles.edge}
      data-workflow-edge={shape.props.edgeId}
      data-selected={selected ? "true" : "false"}
      data-highlighted={shape.props.highlighted ? "true" : "false"}
      data-proposed={shape.props.proposed ? "true" : "false"}
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
        <path
          className={styles.edgeDirection}
          d={`M ${shape.props.endX - 5} ${shape.props.endY - 2.5} L ${shape.props.endX} ${shape.props.endY} L ${shape.props.endX - 5} ${shape.props.endY + 2.5}`}
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
    highlighted: T.boolean,
    proposed: T.boolean,
    editable: T.boolean,
    label: T.string,
  };
  override getDefaultProps(): WorkflowEdgeShape["props"] {
    return {
      edgeId: "",
      endX: 120,
      endY: 0,
      detourY: 0,
      highlighted: false,
      proposed: false,
      editable: true,
      label: "参考素材",
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
        strokeWidth={shape.props.highlighted ? 1.75 : 1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={shape.props.highlighted ? 1 : 0.65}
      >
        <path
          d={
            curvePath(shape.props.endX, shape.props.endY, shape.props.detourY).d
          }
          strokeDasharray={shape.props.proposed ? "4 5" : undefined}
        />
        <path
          d={`M ${shape.props.endX - 5} ${shape.props.endY - 2.5} L ${shape.props.endX} ${shape.props.endY} L ${shape.props.endX - 5} ${shape.props.endY + 2.5}`}
        />
      </g>
    );
  }
}
