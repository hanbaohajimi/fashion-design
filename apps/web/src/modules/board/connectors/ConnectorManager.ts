import type { Editor, TLShapeId } from "tldraw";
import type { ConnectorShape } from "./connector-types";
import { CONNECTOR_SHAPE_TYPE } from "./connector-types";

/**
 * 连接器管理器：维护对象到连接器的索引，实现高效查询和清理。
 *
 * 主要功能：
 * 1. 维护 objectId -> Set<connectorId> 索引
 * 2. 监听对象删除，同步删除相关连接器
 * 3. 提供查询接口
 */
export class ConnectorManager {
  private editor: Editor;
  private objectToConnectors = new Map<string, Set<string>>();
  private dispose: (() => void) | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
    this.initialize();
  }

  private initialize(): void {
    // 初始扫描：构建索引
    this.rebuildIndex();

    // 监听 store 变化
    const stopListening = this.editor.store.listen(
      (entry) => {
        // 处理新增的连接器
        for (const record of Object.values(entry.changes.added)) {
          if (record.typeName === "shape" && record.type === CONNECTOR_SHAPE_TYPE) {
            this.addConnector(record as ConnectorShape);
          }
        }

        // 处理更新的连接器（绑定关系可能改变）
        for (const [, record] of Object.values(entry.changes.updated)) {
          if (record.typeName === "shape" && record.type === CONNECTOR_SHAPE_TYPE) {
            this.updateConnector(record as ConnectorShape);
          }
        }

        // 处理删除的连接器
        for (const record of Object.values(entry.changes.removed)) {
          if (record.typeName === "shape" && record.type === CONNECTOR_SHAPE_TYPE) {
            this.removeConnector(record as ConnectorShape);
          }
        }

        // 处理对象删除：同步删除相关连接器
        for (const record of Object.values(entry.changes.removed)) {
          if (record.typeName === "shape" && record.type !== CONNECTOR_SHAPE_TYPE) {
            this.handleObjectDeleted(record.id);
          }
        }
      },
      { scope: "document" },
    );

    this.dispose = stopListening;
  }

  /**
   * 重建索引（初始化或全量刷新时使用）
   */
  private rebuildIndex(): void {
    this.objectToConnectors.clear();

    const allShapes = this.editor.getCurrentPageShapes();
    for (const shape of allShapes) {
      if (shape.type === CONNECTOR_SHAPE_TYPE) {
        this.addConnector(shape as ConnectorShape);
      }
    }
  }

  /**
   * 添加连接器到索引
   */
  private addConnector(connector: ConnectorShape): void {
    const sourceId = connector.props.sourceObjectId;
    const targetId = connector.props.targetObjectId;

    if (sourceId) {
      const sourceConnectors = this.objectToConnectors.get(sourceId) ?? new Set();
      sourceConnectors.add(connector.id);
      this.objectToConnectors.set(sourceId, sourceConnectors);
    }

    if (targetId && targetId !== sourceId) {
      const targetConnectors = this.objectToConnectors.get(targetId) ?? new Set();
      targetConnectors.add(connector.id);
      this.objectToConnectors.set(targetId, targetConnectors);
    }
  }

  /**
   * 更新连接器索引（绑定关系可能改变）
   */
  private updateConnector(connector: ConnectorShape): void {
    // 简单策略：先移除再添加
    this.removeConnector(connector);
    this.addConnector(connector);
  }

  /**
   * 从索引中移除连接器
   */
  private removeConnector(connector: ConnectorShape): void {
    for (const connectorSet of this.objectToConnectors.values()) {
      connectorSet.delete(connector.id);
    }
  }

  /**
   * 对象删除时，删除所有相关连接器
   */
  private handleObjectDeleted(objectId: TLShapeId): void {
    const connectorIds = this.objectToConnectors.get(objectId);
    if (!connectorIds || connectorIds.size === 0) {
      return;
    }

    // 删除所有相关连接器
    const idsToDelete = Array.from(connectorIds) as TLShapeId[];
    this.editor.deleteShapes(idsToDelete);

    // 清理索引
    this.objectToConnectors.delete(objectId);
  }

  /**
   * 查询与指定对象相关的所有连接器
   */
  public getConnectorsForObject(objectId: string): ConnectorShape[] {
    const connectorIds = this.objectToConnectors.get(objectId);
    if (!connectorIds) {
      return [];
    }

    const connectors: ConnectorShape[] = [];
    for (const connectorId of connectorIds) {
      const shape = this.editor.getShape(connectorId as TLShapeId);
      if (shape && shape.type === CONNECTOR_SHAPE_TYPE) {
        connectors.push(shape as ConnectorShape);
      }
    }

    return connectors;
  }

  /**
   * 获取所有连接器
   */
  public getAllConnectors(): ConnectorShape[] {
    return this.editor
      .getCurrentPageShapes()
      .filter((shape) => shape.type === CONNECTOR_SHAPE_TYPE) as ConnectorShape[];
  }

  /**
   * 清理资源
   */
  public destroy(): void {
    if (this.dispose) {
      this.dispose();
      this.dispose = null;
    }
    this.objectToConnectors.clear();
  }
}
