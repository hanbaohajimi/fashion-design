import { useEditor, useValue } from "tldraw";
import { computeAnchorPoints } from "../connectors/anchorGeometry";
import type { AnchorSide } from "../connectors/connector-types";
import {
  FABRIC_SHAPE_TYPE,
  FRAME_SHAPE_TYPE,
  IMAGE_SHAPE_TYPE,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
} from "../shapes/shape-types";
import styles from "../shapes/connector.module.css";

const CONNECTABLE_TYPES = [
  IMAGE_SHAPE_TYPE,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
  FABRIC_SHAPE_TYPE,
  FRAME_SHAPE_TYPE,
] as const;

/**
 * 锚点覆盖层：仅在连接器模式下显示可连接对象的锚点。
 *
 * 显示规则：
 * 普通选择、悬停或使用其他工具时均不显示，避免遮挡素材内容。
 */
export function AnchorOverlay() {
  const editor = useEditor();

  const currentTool = useValue("anchor-tool", () => editor.getCurrentToolId(), [
    editor,
  ]);

  // 实时订阅相机变化（缩放和平移）
  useValue("anchor-camera", () => editor.getCamera(), [editor]);

  // 订阅所有 shape 的变化，确保锚点位置实时更新
  const shapeGeometry = useValue(
    "anchor-shapes-geometry",
    () => {
      const allShapes = editor.getCurrentPageShapes();
      return allShapes.map((s) => ({ id: s.id, type: s.type }));
    },
    [editor],
  );

  const isConnectorMode = currentTool === "connector";

  // 条件返回必须在所有 hooks 之后
  if (!isConnectorMode) {
    return null;
  }

  const shapesToRender = shapeGeometry.filter((shape) =>
    (CONNECTABLE_TYPES as readonly string[]).includes(shape.type),
  );

  return (
    <div className={styles.anchorOverlay}>
      <svg
        aria-hidden="true"
        focusable="false"
        style={{
          height: "100%",
          left: 0,
          position: "absolute",
          top: 0,
          width: "100%",
        }}
      >
        {shapesToRender.map(({ id: shapeId }) => {
          const shape = editor.getShape(shapeId);
          if (!shape) return null;

          const anchors = computeAnchorPoints(editor, shape);
          if (!anchors) return null;

          return (
            <g key={shapeId}>
              {(
                Object.entries(anchors) as Array<
                  [AnchorSide, { x: number; y: number }]
                >
              ).map(([side, anchor]) => {
                const viewportAnchor = editor.pageToViewport(anchor);
                return (
                  <circle
                    key={`${shapeId}-${side}`}
                    className={styles.anchorPoint}
                    cx={viewportAnchor.x}
                    cy={viewportAnchor.y}
                    r={6}
                    opacity={1}
                    strokeWidth={2}
                    data-shape-id={shapeId}
                    data-anchor-side={side}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
