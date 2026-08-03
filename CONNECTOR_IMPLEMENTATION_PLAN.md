# 连接器实现方案

## 架构审计总结

### 当前技术栈
- **tldraw 5.2.5** (非 Fabric.js)
- React 18 + TypeScript
- TLStore 作为状态管理
- TLShape 作为对象模型

### 对象管理
- **Shape ID**: `TLShapeId` 格式（如 `shape:abc123`）
- **自定义 Shape Types**:
  - `fashion-image` (ImageShapeUtil extends BaseBoxShapeUtil)
  - `fashion-note` (NoteShapeUtil)
  - `fashion-swatch` (SwatchShapeUtil)
  - `fashion-frame` (FrameShapeUtil)
  - `fashion-fabric` (FabricShapeUtil)

### 序列化与持久化
- **TLEditorSnapshot**: tldraw 完整快照
- **BoardElementPatch**: 增量更新系统
- localStorage outbox pattern 用于离线支持
- 服务端存储 revision + snapshot

### 撤销重做
- tldraw 内置 undo/redo
- `store.listen({scope: "document", source: "user"})` 监听用户操作

### 事件系统
- tldraw 事件：通过 `useValue()` 订阅响应式状态
- Shape 更新：`editor.updateShape()`
- 工具切换：`editor.setCurrentTool()`

### 坐标系统
- `x, y, rotation` (rotation 为弧度)
- `editor.getShapePageBounds()` 获取边界框
- `editor.getZoomLevel()` 获取缩放级别

---

## 实现方案

### 方案选择：自定义 Connector Shape

创建新的 `fashion-connector` Shape Type，继承 `BaseBoxShapeUtil`，实现：
1. 动态路径计算（基于绑定对象的实时位置）
2. 锚点系统（top/right/bottom/left）
3. 三种路由类型（bezier/orthogonal/rounded）
4. 箭头渲染
5. 选中与交互

### 数据结构

```typescript
// apps/web/src/modules/board/shapes/connector-types.ts
export const CONNECTOR_SHAPE_TYPE = "fashion-connector";

export type AnchorSide = "top" | "right" | "bottom" | "left";
export type ConnectorRouting = "bezier" | "orthogonal" | "rounded";

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [CONNECTOR_SHAPE_TYPE]: {
      sourceObjectId: string;
      targetObjectId: string;
      sourceAnchor: AnchorSide;
      targetAnchor: AnchorSide;
      routing: ConnectorRouting;
      arrowStart: boolean;
      arrowEnd: boolean;
      strokeColor: string;
      strokeWidth: number;
      opacity: number;
    };
  }
}

export type ConnectorShape = TLShape<typeof CONNECTOR_SHAPE_TYPE>;
```

### 锚点计算

```typescript
// apps/web/src/modules/board/connectors/anchorGeometry.ts
export interface Point {
  x: number;
  y: number;
}

export interface AnchorPoint extends Point {
  normal: Point; // 外法线方向
}

/**
 * 基于 shape 的边界框计算四个边缘中点锚点
 * 使用 editor.getShapePageBounds() 获取变换后的坐标
 */
export function computeAnchorPoints(
  editor: Editor,
  shape: TLShape
): Record<AnchorSide, AnchorPoint>
```

### 路径计算

```typescript
// apps/web/src/modules/board/connectors/pathRouting.ts

export function computeBezierPath(
  source: AnchorPoint,
  target: AnchorPoint,
  distance: number
): string

export function computeOrthogonalPath(
  source: AnchorPoint,
  target: AnchorPoint
): string

export function computeRoundedPath(
  source: AnchorPoint,
  target: AnchorPoint,
  radius: number
): string
```

### ConnectorShapeUtil 核心逻辑

```typescript
// apps/web/src/modules/board/shapes/ConnectorShape.tsx
export class ConnectorShapeUtil extends BaseBoxShapeUtil<ConnectorShape> {
  static override type = CONNECTOR_SHAPE_TYPE;

  // 1. 渲染组件：读取源和目标 shape，计算路径
  override component(shape: ConnectorShape) {
    const editor = useEditor();
    const sourceShape = editor.getShape(shape.props.sourceObjectId);
    const targetShape = editor.getShape(shape.props.targetObjectId);

    if (!sourceShape || !targetShape) {
      return null; // 对象已删除
    }

    // 实时计算锚点位置
    const sourceAnchors = computeAnchorPoints(editor, sourceShape);
    const targetAnchors = computeAnchorPoints(editor, targetShape);
    const sourceAnchor = sourceAnchors[shape.props.sourceAnchor];
    const targetAnchor = targetAnchors[shape.props.targetAnchor];

    // 计算路径
    const pathD = computePath(
      sourceAnchor,
      targetAnchor,
      shape.props.routing
    );

    return <SVGConnector path={pathD} shape={shape} />;
  }

  // 2. 指示器：选中时显示
  override getIndicatorPath(shape: ConnectorShape): Path2D {
    // 返回连接线路径的命中区域
  }

  // 3. 边界框：基于实际路径计算
  override getGeometry(shape: ConnectorShape) {
    // 计算路径边界框
  }
}
```

### 连接工具 (ConnectorTool)

```typescript
// apps/web/src/modules/board/tools/ConnectorTool.ts
export class ConnectorTool extends StateNode {
  static override id = "connector";

  // 状态机：Idle -> DraggingFromAnchor -> Complete
  //
  // 1. onPointerDown: 检测是否点击锚点
  // 2. onPointerMove: 绘制预览线
  // 3. onPointerUp: 检测目标锚点，创建连接器
}
```

### 锚点渲染系统

```typescript
// apps/web/src/modules/board/connectors/AnchorOverlay.tsx
export function AnchorOverlay() {
  const editor = useEditor();
  const selectedShapes = useValue('selected', () => editor.getSelectedShapes(), [editor]);
  const hoveredShape = useValue('hovered', () => editor.getHoveredShape(), [editor]);

  // 渲染锚点圆点
  // - 未选中：不显示
  // - 悬停：低透明度
  // - 选中或连接模式：完全显示
}
```

### 连接器管理器

```typescript
// apps/web/src/modules/board/connectors/ConnectorManager.ts
export class ConnectorManager {
  private objectToConnectors = new Map<string, Set<string>>();
  private connectors = new Map<string, ConnectorShape>();

  // 订阅 store 变化
  constructor(editor: Editor) {
    editor.store.listen((entry) => {
      // 检测对象删除，同步删除连接器
      // 检测对象移动，触发连接器重绘
    });
  }

  getConnectorsForObject(shapeId: string): ConnectorShape[] {
    const connectorIds = this.objectToConnectors.get(shapeId) || new Set();
    return Array.from(connectorIds).map(id => this.connectors.get(id)!);
  }
}
```

---

## 需要修改的文件

### 新增文件
```
apps/web/src/modules/board/connectors/
  ├── connector-types.ts          # TypeScript 类型定义
  ├── anchorGeometry.ts           # 锚点几何计算
  ├── pathRouting.ts              # 路径生成算法
  ├── ConnectorManager.ts         # 连接器索引与管理
  └── AnchorOverlay.tsx           # 锚点渲染组件

apps/web/src/modules/board/shapes/
  └── ConnectorShape.tsx          # ConnectorShapeUtil 实现

apps/web/src/modules/board/tools/
  └── ConnectorTool.ts            # 连接器绘制工具

apps/web/src/modules/board/connectors/
  └── connectorGeometry.spec.ts  # 几何计算单元测试
```

### 修改文件
```
apps/web/src/modules/board/shapes/index.ts
  - 导出 ConnectorShapeUtil
  - 注册到 boardShapeUtils

apps/web/src/modules/board/BoardCanvas.tsx
  - 注册 ConnectorTool
  - 添加 AnchorOverlay 组件

apps/web/src/modules/board/ToolRail.tsx
  - 添加连接器工具按钮

apps/web/src/modules/board/hooks/useBoardPersist.ts
  - 无需修改（自动支持新 shape type）
```

---

## 实现细节

### 锚点自动选择

```typescript
function autoSelectAnchors(
  sourceCenter: Point,
  targetCenter: Point
): [AnchorSide, AnchorSide] {
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0
      ? ["right", "left"]   // 水平排列，右连左
      : ["left", "right"];  // 水平排列，左连右
  } else {
    return dy > 0
      ? ["bottom", "top"]   // 垂直排列，下连上
      : ["top", "bottom"];  // 垂直排列，上连下
  }
}
```

### 贝塞尔曲线控制点

```typescript
function computeBezierControlPoints(
  p0: Point,
  p3: Point,
  n0: Point, // 源法线
  n3: Point  // 目标法线
): [Point, Point] {
  const distance = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const handleLength = Math.max(48, Math.min(180, distance * 0.35));

  const c1 = {
    x: p0.x + n0.x * handleLength,
    y: p0.y + n0.y * handleLength,
  };

  const c2 = {
    x: p3.x + n3.x * handleLength,
    y: p3.y + n3.y * handleLength,
  };

  return [c1, c2];
}
```

### 正交路径算法

```typescript
function computeOrthogonalPath(
  source: AnchorPoint,
  target: AnchorPoint
): string {
  // Manhattan routing
  // 1. 沿源法线延伸
  // 2. 水平或垂直转折
  // 3. 沿目标法线进入
}
```

### 箭头渲染

```typescript
function renderArrow(
  point: Point,
  tangent: Point,
  size: number = 7
): string {
  const angle = Math.atan2(tangent.y, tangent.x);
  // 生成三角形路径
}
```

---

## 序列化兼容

ConnectorShape 自动通过 tldraw 的序列化系统保存到 snapshot：
- `sourceObjectId` 和 `targetObjectId` 作为 props 存储
- 恢复时通过 `editor.getShape(id)` 验证对象存在性
- 缺失对象时跳过渲染，console.warn 提示

---

## 撤销重做集成

连接器创建、删除、修改自动进入 tldraw 的 history：
- `editor.createShape()` 创建连接器
- `editor.updateShape()` 修改绑定
- `editor.deleteShape()` 删除连接器

---

## 性能优化

1. **增量更新**：ConnectorManager 维护 objectId -> Set<connectorId> 索引
2. **按需重绘**：仅当绑定对象移动时更新相关连接器
3. **视口裁剪**：连接器超出视口时跳过渲染（tldraw 自动处理）
4. **React memo**：锚点覆盖层使用 useMemo 避免高频重渲染

---

## 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| 源对象被删除 | ConnectorManager 监听删除事件，同步删除连接器 |
| 目标对象被删除 | 同上 |
| 对象进入 Group | tldraw 自动处理坐标变换，getShapePageBounds 返回正确坐标 |
| 对象旋转 | 通过 shape.rotation 计算旋转后的锚点法线 |
| 画布缩放 | SVG 自动缩放，strokeWidth 保持视觉恒定（使用 vector-effect） |
| 自连接 | ConnectorTool 检测 sourceId === targetId 时拒绝创建 |

---

## 视觉样式

```css
.connector {
  fill: none;
  stroke: rgba(45, 43, 39, 0.68);
  stroke-width: 1.25px;
  vector-effect: non-scaling-stroke; /* 缩放时保持线宽 */
}

.connector-hit-area {
  fill: none;
  stroke: transparent;
  stroke-width: 12px;
  pointer-events: stroke;
}

.connector-selected {
  stroke-width: 2px;
}

.anchor-point {
  fill: rgba(45, 43, 39, 0.8);
  stroke: white;
  stroke-width: 1.5px;
  r: 3px;
}

.anchor-point-hover {
  fill: rgba(45, 43, 39, 1);
  r: 4px;
}
```

---

## 验收标准

- [ ] 水平/垂直排列图片连接正确
- [ ] 旋转后锚点位置准确
- [ ] 非等比缩放后连接不漂移
- [ ] 贝塞尔曲线自然离开/进入
- [ ] 命中区域宽，视觉线条细
- [ ] 删除对象时连接器同步删除
- [ ] 保存/加载后连接恢复
- [ ] 撤销/重做正常工作
- [ ] TypeScript 无错误
- [ ] 几何函数有单元测试

---

## 与 Fabric.js 需求的对应

| 原需求 (Fabric.js) | tldraw 实现 |
|-------------------|------------|
| `object:moving` 事件 | `store.listen()` + `useValue()` |
| `object.getCoords()` | `editor.getShapePageBounds()` |
| `canvas.requestRenderAll()` | tldraw 自动重绘 |
| Fabric 对象 ID | `TLShapeId` |
| Group 变换 | tldraw 自动处理 |
| 序列化 | TLEditorSnapshot |

---

## 后续增强（不在初版范围）

- [ ] 智能避障路由
- [ ] 多点折线
- [ ] 连接器样式面板（虚线、颜色选择器）
- [ ] 连接器标签文本
- [ ] 批量连接操作
