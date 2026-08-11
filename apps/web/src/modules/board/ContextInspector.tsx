"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { ElementRolePanel } from "./ElementRolePanel";
import {
  BOARD_LAYOUT_CHANGE_EVENT,
  BOARD_LABEL_DESIGN_EVENT,
  type BoardLabelDesignDetail,
} from "./board-context";
import { isRoleAssignableShape } from "./shapes";
import styles from "./context-inspector.module.css";

const PANEL_GAP_PX = 16;
const PANEL_FALLBACK_WIDTH_PX = 320;
const TOPBAR_FALLBACK_HEIGHT_PX = 62;
const TOOL_DOCK_SAFE_BOTTOM_PX = 82;

function readCssPixelValue(name: string, fallback: number): number {
  const value = Number.parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(value) ? value : fallback;
}

export function ContextInspector() {
  const editor = useEditor();
  const [labelDesignShapeId, setLabelDesignShapeId] =
    useState<TLShapeId | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);

  useEffect(() => {
    const handleOpen = (event: Event): void => {
      const detail = (event as CustomEvent<BoardLabelDesignDetail>).detail;
      if (detail?.shapeId) {
        setLabelDesignShapeId(detail.shapeId as TLShapeId);
      }
    };
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          '[data-label-design-trigger="true"], [data-label-design-panel="true"]',
        )
      ) {
        return;
      }
      setLabelDesignShapeId(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setLabelDesignShapeId(null);
      }
    };

    window.addEventListener(BOARD_LABEL_DESIGN_EVENT, handleOpen);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener(BOARD_LABEL_DESIGN_EVENT, handleOpen);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const refreshLayout = (): void => {
      setLayoutRevision((current) => current + 1);
    };
    window.addEventListener(BOARD_LAYOUT_CHANGE_EVENT, refreshLayout);
    window.addEventListener("resize", refreshLayout);
    return () => {
      window.removeEventListener(BOARD_LAYOUT_CHANGE_EVENT, refreshLayout);
      window.removeEventListener("resize", refreshLayout);
    };
  }, []);

  const selection = useValue(
    "inspector-selection",
    () => {
      const candidate = labelDesignShapeId
        ? editor.getShape(labelDesignShapeId)
        : null;
      const labelDesignShape =
        candidate && isRoleAssignableShape(candidate) ? candidate : null;
      const bounds = labelDesignShape
        ? editor.getShapePageBounds(labelDesignShape)
        : null;
      let position: {
        readonly maxHeight: number;
        readonly x: number;
        readonly y: number;
      } | null = null;

      if (labelDesignShape && bounds) {
        const containerBounds = editor.getContainer().getBoundingClientRect();
        const viewportAnchor = editor.pageToViewport({
          x: bounds.x + bounds.width,
          y: bounds.y,
        });
        const panelWidth = Math.min(
          readCssPixelValue("--inspector-width", PANEL_FALLBACK_WIDTH_PX),
          window.innerWidth - PANEL_GAP_PX * 2,
        );
        const topbarHeight = readCssPixelValue(
          "--topbar-height",
          TOPBAR_FALLBACK_HEIGHT_PX,
        );
        const estimatedHeight = 300;
        const minX = PANEL_GAP_PX;
        const agentWidth =
          window.innerWidth > 1024
            ? readCssPixelValue("--board-agent-current-width", 400)
            : 0;
        const maxX = Math.max(
          minX,
          window.innerWidth - agentWidth - panelWidth - PANEL_GAP_PX,
        );
        const minY = topbarHeight + PANEL_GAP_PX;
        const availableHeight = Math.max(
          80,
          window.innerHeight -
            minY -
            PANEL_GAP_PX -
            TOOL_DOCK_SAFE_BOTTOM_PX,
        );
        const maxY = Math.max(
          minY,
          window.innerHeight -
            Math.min(estimatedHeight, availableHeight) -
            PANEL_GAP_PX -
            TOOL_DOCK_SAFE_BOTTOM_PX,
        );

        const x = Math.min(
          Math.max(
            containerBounds.left + viewportAnchor.x + PANEL_GAP_PX,
            minX,
          ),
          maxX,
        );
        const y = Math.min(
          Math.max(containerBounds.top + viewportAnchor.y, minY),
          maxY,
        );

        position = {
          maxHeight: Math.max(
            80,
            window.innerHeight -
              y -
              PANEL_GAP_PX -
              TOOL_DOCK_SAFE_BOTTOM_PX,
          ),
          x,
          y,
        };
      }

      return {
        labelDesignShape,
        position,
      };
    },
    [editor, labelDesignShapeId, layoutRevision],
  );

  const positionStyle = selection.position
    ? ({
        "--inspector-selection-x": `${selection.position.x}px`,
        "--inspector-selection-y": `${selection.position.y}px`,
        "--inspector-selection-max-height": `${selection.position.maxHeight}px`,
      } as CSSProperties)
    : undefined;

  return (
    <>
      {selection.labelDesignShape ? (
        <aside
          aria-label="标签设计"
          className={`${styles.inspector} ${styles.inspectorSelection}`}
          data-label-design-panel="true"
          style={positionStyle}
        >
          <ElementRolePanel embedded shapeId={selection.labelDesignShape.id} />
        </aside>
      ) : null}
    </>
  );
}
