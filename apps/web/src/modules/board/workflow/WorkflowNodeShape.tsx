import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
  type TLShape,
} from "tldraw";

import styles from "./workflow-node.module.css";

export const WORKFLOW_NODE_SHAPE_TYPE = "fashion-workflow-node";

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [WORKFLOW_NODE_SHAPE_TYPE]: {
      h: number;
      w: number;
      nodeId: string;
      kind: "asset" | "tool";
      nodeType: string;
      title: string;
      summary: string;
      imageUrl: string;
      color: string;
      status: string;
      highlighted: boolean;
      muted: boolean;
    };
  }
}

export type WorkflowNodeShape = TLShape<typeof WORKFLOW_NODE_SHAPE_TYPE>;

const labels: Readonly<Record<string, string>> = {
  analyze_brief: "ANALYSIS",
  brief: "TEXT",
  candidate: "IMAGE",
  constraint: "TEXT",
  edit_design: "EDIT",
  restore_version: "RESTORE",
  evaluate_design: "EVALUATION",
  evaluation: "REPORT",
  fabric: "FABRIC",
  generate_design: "GENERATION",
  legacy: "HISTORY",
  reference_image: "IMAGE",
  reference_text: "TEXT",
  sketch: "SKETCH",
  swatch: "COLOR",
  trend: "TREND",
};

export class WorkflowNodeShapeUtil extends BaseBoxShapeUtil<WorkflowNodeShape> {
  static override type = WORKFLOW_NODE_SHAPE_TYPE;
  static override props: RecordProps<WorkflowNodeShape> = {
    h: T.number,
    highlighted: T.boolean,
    imageUrl: T.string,
    color: T.string,
    kind: T.literalEnum("asset", "tool"),
    muted: T.boolean,
    nodeId: T.string,
    nodeType: T.string,
    status: T.string,
    summary: T.string,
    title: T.string,
    w: T.number,
  };

  override getDefaultProps(): WorkflowNodeShape["props"] {
    return {
      h: 212,
      highlighted: false,
      imageUrl: "",
      color: "",
      kind: "asset",
      muted: false,
      nodeId: "",
      nodeType: "brief",
      status: "ready",
      summary: "",
      title: "设计需求",
      w: 256,
    };
  }

  override canResize(): boolean {
    return false;
  }

  override canEdit(): boolean {
    return false;
  }

  override onTranslate = (shape: WorkflowNodeShape) =>
    shape.props.status === "proposed"
      ? {
          id: shape.id,
          type: "fashion-workflow-node" as const,
          x: shape.x,
          y: shape.y,
        }
      : undefined;

  override getText(shape: WorkflowNodeShape): string {
    return `${shape.props.title} ${shape.props.summary}`;
  }

  override component(shape: WorkflowNodeShape) {
    const { kind, nodeType, title, summary, imageUrl, status, color } =
      shape.props;
    return (
      <HTMLContainer
        className={styles.node}
        data-highlighted={shape.props.highlighted ? "true" : "false"}
        data-kind={kind}
        data-muted={shape.props.muted ? "true" : "false"}
        data-status={status}
        data-type={nodeType}
      >
        <span aria-hidden="true" className={styles.inputPort} />
        <header className={styles.nodeHeader}>
          <span className={styles.eyebrow}>
            {kind === "asset" ? "素材" : "工具"} ·{" "}
            {labels[nodeType] ?? nodeType.toUpperCase()}
          </span>
          <strong title={title}>{title}</strong>
        </header>
        {imageUrl ? (
          <div className={styles.imageFrame}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={title} src={imageUrl} />
          </div>
        ) : null}
        {nodeType === "swatch" && /^#[0-9A-Fa-f]{6}$/u.test(color) ? (
          <div
            aria-label={`色彩 ${color.toUpperCase()}`}
            className={styles.swatch}
            style={{ backgroundColor: color }}
          />
        ) : null}
        {summary ? <p className={styles.summary}>{summary}</p> : null}
        {kind === "tool" ? (
          <span className={styles.toolStatus}>
            <span aria-hidden="true" />
            {status === "running"
              ? "执行中"
              : status === "failed"
                ? "执行失败"
                : status === "completed" || status === "succeeded"
                  ? "已完成"
                  : "等待执行"}
          </span>
        ) : null}
        <span aria-hidden="true" className={styles.outputPort} />
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: WorkflowNodeShape): Path2D {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }
}
