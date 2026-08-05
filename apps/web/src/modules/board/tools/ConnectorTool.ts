import {
  createShapeId,
  StateNode,
  type TLPointerEventInfo,
  type TLShape,
  type TLShapeId,
} from "tldraw";

import type { AnchorSide, ConnectorShape } from "../connectors/connector-types";
import { CONNECTOR_SHAPE_TYPE } from "../connectors/connector-types";
import { computeAnchorPoints } from "../connectors/anchorGeometry";
import {
  FABRIC_SHAPE_TYPE,
  FRAME_SHAPE_TYPE,
  IMAGE_SHAPE_TYPE,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
} from "../shapes/shape-types";

// 可连接的 shape 类型
const CONNECTABLE_TYPES = [
  IMAGE_SHAPE_TYPE,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
  FABRIC_SHAPE_TYPE,
  FRAME_SHAPE_TYPE,
] as const;

function isConnectable(shape: TLShape): boolean {
  return (CONNECTABLE_TYPES as readonly string[]).includes(shape.type);
}

/**
 * 查找指针位置最近的锚点
 *
 * @param pointerX 指针 x 坐标（page 坐标）
 * @param pointerY 指针 y 坐标（page 坐标）
 * @param anchors 锚点位置（page 坐标）
 * @param thresholdInPageUnits 阈值（page 坐标单位）
 */
function findNearestAnchor(
  pointerX: number,
  pointerY: number,
  anchors: Record<AnchorSide, { x: number; y: number }>,
  thresholdInPageUnits: number = 20,
): AnchorSide | null {
  let nearest: AnchorSide | null = null;
  let minDistance = thresholdInPageUnits;

  for (const [side, anchor] of Object.entries(anchors) as Array<
    [AnchorSide, { x: number; y: number }]
  >) {
    const distance = Math.hypot(anchor.x - pointerX, anchor.y - pointerY);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = side;
    }
  }

  return nearest;
}

interface ClickState {
  previewId: TLShapeId;
  sourceAnchor: AnchorSide;
  sourceShapeId: TLShapeId;
}

/**
 * 连接器绘制工具。
 *
 * 交互流程：
 * 1. 点击第一个 shape 的锚点（源锚点）
 * 2. 预览线跟随鼠标移动
 * 3. 点击第二个 shape 的锚点（目标锚点）
 * 4. 创建连接器
 */
export class ConnectorTool extends StateNode {
  static override id = "connector";

  private clickState: ClickState | null = null;

  override onEnter = (): void => {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  };

  override onExit = (): void => {
    this.editor.setCursor({ type: "default", rotation: 0 });
    this.clearPreview();
  };

  override onPointerDown = (info: TLPointerEventInfo): void => {
    if (info.button !== 0) {
      return;
    }

    const point = this.editor.inputs.currentPagePoint;
    const hitShape = this.editor.getShapeAtPoint(point, {
      hitInside: true,
      margin: 0,
    });

    if (!hitShape || !isConnectable(hitShape)) {
      // 点击空白或不可连接对象时，取消当前预览
      if (this.clickState) {
        this.clearPreview();
      }
      return;
    }

    // 检查是否点击了锚点附近
    const anchors = computeAnchorPoints(this.editor, hitShape);
    if (!anchors) {
      return;
    }

    // 获取当前缩放级别，调整阈值（在 page 坐标中）
    const camera = this.editor.getCamera();
    const thresholdInPageUnits = 20 / camera.z; // 20px 屏幕距离转换为 page 单位

    const clickedAnchor = findNearestAnchor(point.x, point.y, anchors, thresholdInPageUnits);
    if (!clickedAnchor) {
      // 点击了可连接对象但没有点到锚点，取消当前预览
      if (this.clickState) {
        this.clearPreview();
      }
      return;
    }

    if (!this.clickState) {
      // 第一次点击：记录源锚点，创建预览线
      const previewId = createShapeId();

      // 创建临时预览 connector
      this.editor.createShape<ConnectorShape>({
        id: previewId,
        type: CONNECTOR_SHAPE_TYPE,
        x: 0,
        y: 0,
        props: {
          arrowEnd: true,
          arrowStart: false,
          opacity: 0.5,
          routing: "bezier",
          sourceAnchor: clickedAnchor,
          sourceObjectId: hitShape.id,
          strokeColor: "rgba(59, 109, 255, 0.6)",
          strokeWidth: 1.5,
          targetAnchor: clickedAnchor, // 初始指向源锚点
          targetObjectId: hitShape.id, // 初始指向自己
        },
      });

      this.clickState = {
        previewId,
        sourceAnchor: clickedAnchor,
        sourceShapeId: hitShape.id,
      };
    } else {
      // 第二次点击：创建正式连接器
      if (hitShape.id === this.clickState.sourceShapeId) {
        // 点击了源元素自己，取消操作
        this.clearPreview();
        return;
      }

      // 创建正式连接器
      const connectorId = createShapeId();
      this.editor.createShape<ConnectorShape>({
        id: connectorId,
        type: CONNECTOR_SHAPE_TYPE,
        x: 0,
        y: 0,
        props: {
          arrowEnd: true,
          arrowStart: false,
          opacity: 1,
          routing: "bezier",
          sourceAnchor: this.clickState.sourceAnchor,
          sourceObjectId: this.clickState.sourceShapeId,
          strokeColor: "rgba(45, 43, 39, 0.68)",
          strokeWidth: 1.25,
          targetAnchor: clickedAnchor,
          targetObjectId: hitShape.id,
        },
      });

      // 选中新创建的连接器
      this.editor.select(connectorId);

      // 删除预览，重置状态
      this.editor.deleteShape(this.clickState.previewId);
      this.clickState = null;
    }
  };

  override onPointerMove = (): void => {
    if (!this.clickState) {
      return;
    }

    const point = this.editor.inputs.currentPagePoint;
    const hitShape = this.editor.getShapeAtPoint(point, {
      hitInside: true,
      margin: 0,
    });

    // 获取当前缩放级别
    const camera = this.editor.getCamera();
    const thresholdInPageUnits = 30 / camera.z; // 30px 屏幕距离转换为 page 单位

    // 更新预览线的目标，跟随鼠标
    if (hitShape && isConnectable(hitShape) && hitShape.id !== this.clickState.sourceShapeId) {
      const anchors = computeAnchorPoints(this.editor, hitShape);
      if (!anchors) {
        return;
      }

      const nearestAnchor = findNearestAnchor(point.x, point.y, anchors, thresholdInPageUnits);
      if (nearestAnchor) {
        // 吸附到目标锚点
        this.editor.updateShape<ConnectorShape>({
          id: this.clickState.previewId,
          type: CONNECTOR_SHAPE_TYPE,
          props: {
            targetAnchor: nearestAnchor,
            targetObjectId: hitShape.id,
          },
        });
        return;
      }
    }

    // 没有吸附目标，预览线跟随鼠标（暂时保持最后的吸附状态）
  };

  override onPointerUp = (): void => {
    // 点击模式不需要 onPointerUp，所有逻辑在 onPointerDown 中处理
  };

  override onKeyDown = (info: { readonly key: string }): void => {
    if (info.key === "Escape") {
      this.clearPreview();
      this.editor.setCurrentTool("select");
    }
  };

  override onCancel = (): void => {
    this.clearPreview();
    this.editor.setCurrentTool("select");
  };

  private clearPreview(): void {
    if (this.clickState) {
      this.editor.deleteShape(this.clickState.previewId);
      this.clickState = null;
    }
  }
}
