import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
  useEditor,
  useValue,
  useSvgExportContext,
  type TLShape,
} from "tldraw";

import type { WorkflowNode } from "./workflow-api";
import { displayNodeTitle, imageNodeSize } from "./workflow-graph";
import styles from "./workflow-node.module.css";
import { type CSSProperties, type ReactNode } from "react";
import { useWorkflowInteractions } from "./WorkflowInteractions";

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
      imageWidth: number;
      imageHeight: number;
      color: string;
      status: string;
      highlighted: boolean;
      muted: boolean;
    };
  }
}

export type WorkflowNodeShape = TLShape<typeof WORKFLOW_NODE_SHAPE_TYPE>;

/**
 * 节点形状收到的 title 已由 workflow-graph 的 displayNodeTitle 处理过，
 * 这里只负责把工具节点标记为 tool（kind），不再重复判断哈希。
 */
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
    imageWidth: T.number,
    imageHeight: T.number,
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
      imageWidth: 0,
      imageHeight: 0,
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

  override onDoubleClick = (shape: WorkflowNodeShape) => {
    if (shape.props.status !== "proposed")
      window.dispatchEvent(
        new CustomEvent("fashion-workflow:node-details", {
          detail: shape.props.nodeId,
        }),
      );
    return {
      id: shape.id,
      type: WORKFLOW_NODE_SHAPE_TYPE as typeof WORKFLOW_NODE_SHAPE_TYPE,
    };
  };

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
    const { kind, nodeType, summary, imageUrl, status, color } = shape.props;
    const title = displayNodeTitle({
      title: shape.props.title,
      type: nodeType as WorkflowNode["type"],
    });
    return (
      <WorkflowNodeFrame shape={shape}>
        {kind === "tool" && nodeType !== "restore_version" ? (
          <WorkflowPort shape={shape} side="input" />
        ) : (
          <span aria-hidden="true" className={styles.inputPort} />
        )}
        <header className={styles.nodeHeader}>
          <span className={styles.eyebrow}>
            {kind === "asset" ? "素材" : "工具"} ·{" "}
            {labels[nodeType] ?? nodeType.toUpperCase()}
          </span>
          <strong title={title}>{title}</strong>
        </header>
        {imageUrl ? (
          <div className={styles.imageFrame}>
            <WorkflowNodeImage key={imageUrl} shape={shape} title={title} />
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
        {kind === "tool" && status !== "ready" && status !== "proposed" ? (
          <span className={styles.toolStatus}>
            <span aria-hidden="true" />
            {status === "running"
              ? "执行中"
              : status === "failed"
                ? "执行失败"
                : "已完成"}
          </span>
        ) : null}
        {kind === "asset" ? (
          <WorkflowPort shape={shape} side="output" />
        ) : (
          <span aria-hidden="true" className={styles.outputPort} />
        )}
      </WorkflowNodeFrame>
    );
  }

  override getIndicatorPath(shape: WorkflowNodeShape): Path2D {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }
}

function WorkflowNodeImage({ shape, title }: { shape: WorkflowNodeShape; title: string }) {
  const editor = useEditor();
  const exporting = useSvgExportContext();
  return (
    // Canvas assets use their authenticated image URL directly, including during export.
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={title} draggable={false} src={shape.props.imageUrl} onLoad={(event) => {
      if (exporting || !["candidate", "reference_image", "sketch"].includes(shape.props.nodeType)) return;
      const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
      if (!width || !height) return;
      const current = editor.getShape<WorkflowNodeShape>(shape.id);
      if (!current || current.props.imageUrl !== shape.props.imageUrl ||
        (current.props.imageWidth === width && current.props.imageHeight === height)) return;
      editor.store.mergeRemoteChanges(() => {
        editor.updateShape<WorkflowNodeShape>({
          id: shape.id,
          type: WORKFLOW_NODE_SHAPE_TYPE,
          props: { ...imageNodeSize({ width, height }, Boolean(current.props.summary)), imageWidth: width, imageHeight: height },
        });
      });
    }} />
  );
}

function WorkflowNodeFrame({
  shape,
  children,
}: {
  shape: WorkflowNodeShape;
  children: ReactNode;
}) {
  const interaction = useWorkflowInteractions();
  const editor = useEditor();
  const exporting = useSvgExportContext();
  const exportStyle = exporting
    ? ({
        ...Object.fromEntries([
          "--color-paper",
          "--color-surface",
          "--color-border",
          "--color-border-strong",
          "--color-divider",
          "--color-ink",
          "--color-ink-secondary",
          "--color-ink-tertiary",
          "--swatch-indigo",
          "--swatch-linen",
          "--swatch-mauve",
          "--swatch-mauve-wash",
        ].map((token) => [
          token,
          getComputedStyle(editor.getContainer()).getPropertyValue(token),
        ])),
        // Export remounts the node; capture its final appearance, not the entry frame.
        animation: "none",
        transition: "none",
        transform: "none",
      } as CSSProperties)
    : undefined;
  const selected = useValue(
    "workflow-node-actions",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id],
  );
  const side = shape.props.kind === "asset" ? "output" : "input";
  const compact = useValue("workflow-overview", () => editor.getZoomLevel() < 0.85, [editor]);
  const hint = interaction?.hint(shape.props.nodeId, side);
  return (
    <HTMLContainer
      className={styles.node}
      style={exportStyle}
      data-highlighted={shape.props.highlighted ? "true" : "false"}
      data-kind={shape.props.kind}
      data-compact={!exporting && compact ? "true" : "false"}
      data-image={Boolean(shape.props.imageUrl) && ["candidate", "reference_image", "sketch"].includes(shape.props.nodeType) ? "true" : "false"}
      data-muted={shape.props.muted && !interaction?.gesture ? "true" : "false"}
      data-status={shape.props.status}
      data-type={shape.props.nodeType}
      data-connectable={hint ? (hint.valid ? "valid" : "invalid") : "none"}
      onDoubleClick={(event) => {
        event.stopPropagation();
        interaction?.details(shape.props.nodeId);
      }}
    >
      {children}
      {selected && !exporting && shape.props.status !== "proposed" ? (
        <div
          className={styles.nodeActions}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => interaction?.details(shape.props.nodeId)}
            type="button"
          >
            详情
          </button>
        </div>
      ) : null}
    </HTMLContainer>
  );
}

function WorkflowPort({
  shape,
  side,
}: {
  shape: WorkflowNodeShape;
  side: "input" | "output";
}) {
  const interaction = useWorkflowInteractions();
  const exporting = useSvgExportContext();
  if (exporting) return null;
  const hint = interaction?.hint(shape.props.nodeId, side);
  const label =
    hint?.label ?? (side === "input" ? "连接输入素材" : "连接到工具");
  return (
    <button
      aria-label={`${shape.props.title} · ${label}`}
      className={`${styles.interactivePort} ${side === "input" ? styles.portInput : styles.portOutput}`}
      data-workflow-port={side}
      data-node-id={shape.props.nodeId}
      data-valid={hint?.valid ? "true" : "false"}
      disabled={shape.props.status === "proposed"}
      title={label}
      type="button"
      onPointerDown={(event) =>
        interaction?.portDown(shape.props.nodeId, side, event)
      }
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          interaction?.portClick(shape.props.nodeId, side, true);
        }
      }}
      onPointerUp={(event) => interaction?.portUp(event)}
      onClick={(event) => {
        event.stopPropagation();
        interaction?.portClick(shape.props.nodeId, side);
      }}
    >
      <span aria-hidden="true" />
      <span className={styles.portLabel}>{label}</span>
    </button>
  );
}
