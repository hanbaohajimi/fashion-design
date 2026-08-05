import { useEditor, useValue, type TLShapeId } from "tldraw";
import { useMemo } from "react";
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
 * 锚点覆盖层：在选中或连接模式下显示可连接对象的锚点。
 *
 * 显示规则：
 * - 未选中：不显示
 * - 悬停：低透明度显示
 * - 选中或连接模式：完整显示
 */
export function AnchorOverlay() {
  const editor = useEditor();

  const selectedShapes = useValue(
    "anchor-selected",
    () => editor.getSelectedShapes(),
    [editor],
  );

  const hoveredShape = useValue(
    "anchor-hovered",
    () => editor.getHoveredShape(),
    [editor],
  );

  const currentTool = useValue(
    "anchor-tool",
    () => editor.getCurrentToolId(),
    [editor],
  );

  // 实时订阅相机变化（缩放和平移）
  const camera = useValue(
    "anchor-camera",
    () => editor.getCamera(),
    [editor],
  );

  // 订阅所有 shape 的变化，确保锚点位置实时更新
  const shapeGeometry = useValue(
    "anchor-shapes-geometry",
    () => {
      const allShapes = editor.getCurrentPageShapes();
      return allShapes.map((s) => ({ id: s.id, type: s.type }));
    },
    [editor],
  );

  // 只在连接模式或有选中对象时显示锚点
  const isConnectorMode = currentTool === "connector";
  const hasSelection = selectedShapes.length > 0;

  // 收集需要显示锚点的 shape（必须在所有 hooks 之后）
  const shapesToRender = useMemo(() => {
    const shapes = new Set<TLShapeId>();

    if (isConnectorMode) {
      // 连接模式：显示所有可连接对象的锚点
      for (const shape of shapeGeometry) {
        if ((CONNECTABLE_TYPES as readonly string[]).includes(shape.type)) {
          shapes.add(shape.id);
        }
      }
    } else {
      // 普通模式：只显示选中对象和悬停对象的锚点
      for (const shape of selectedShapes) {
        if ((CONNECTABLE_TYPES as readonly string[]).includes(shape.type)) {
          shapes.add(shape.id);
        }
      }
      if (hoveredShape && (CONNECTABLE_TYPES as readonly string[]).includes(hoveredShape.type)) {
        shapes.add(hoveredShape.id);
      }
    }

    return shapes;
  }, [isConnectorMode, selectedShapes, hoveredShape, shapeGeometry]);

  // 条件返回必须在所有 hooks 之后
  if (!isConnectorMode && !hasSelection) {
    return null;
  }

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
          transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.z})`,
          transformOrigin: "0 0",
        }}
      >
        {Array.from(shapesToRender).map((shapeId) => {
          const shape = editor.getShape(shapeId);
          if (!shape) return null;

          const anchors = computeAnchorPoints(editor, shape);
          if (!anchors) return null;

          const isSelected = selectedShapes.some((s) => s.id === shapeId);
          const isHovered = hoveredShape?.id === shapeId;
          const opacity = isConnectorMode || isSelected ? 1 : isHovered ? 0.6 : 0;

          if (opacity === 0) return null;

          return (
            <g key={shapeId}>
              {(Object.entries(anchors) as Array<[AnchorSide, { x: number; y: number }]>).map(
                ([side, anchor]) => {
                  return (
                    <circle
                      key={`${shapeId}-${side}`}
                      className={styles.anchorPoint}
                      cx={anchor.x}
                      cy={anchor.y}
                      r={6 / camera.z}
                      opacity={opacity}
                      strokeWidth={2 / camera.z}
                      data-shape-id={shapeId}
                      data-anchor-side={side}
                    />
                  );
                },
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
