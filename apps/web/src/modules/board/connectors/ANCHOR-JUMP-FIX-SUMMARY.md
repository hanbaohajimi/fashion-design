# 锚点跳动问题修复总结

## 问题
用户报告：点击锚点时仍然会跳动

## 已应用的修复

### 1. 移除 CSS 位置动画（关键修复）
**文件**: `connector.module.css`

**问题**: `transition: all` 会对锚点的所有属性（包括 cx、cy 位置）应用动画，当位置因坐标计算变化时产生视觉跳动。

**修复**:
```css
/* 之前 */
.anchorPoint {
  transition: all 0.12s ease;
}

/* 之后 */
.anchorPoint {
  transition: fill 0.12s ease, transform 0.12s ease;  /* 只动画视觉效果 */
  will-change: transform;  /* GPU 加速 */
}
```

### 2. 缩放感知的点击阈值
**文件**: `ConnectorTool.ts`

**问题**: 固定像素阈值在不同缩放级别下表现不一致。

**修复**:
```typescript
// onPointerDown
const camera = this.editor.getCamera();
const thresholdInPageUnits = 20 / camera.z;  // 屏幕像素转 page 单位
const clickedAnchor = findNearestAnchor(point.x, point.y, anchors, thresholdInPageUnits);

// onPointerMove
const thresholdInPageUnits = 30 / camera.z;
const nearestAnchor = findNearestAnchor(point.x, point.y, anchors, thresholdInPageUnits);
```

### 3. GPU 加速优化
**文件**: `AnchorOverlay.tsx`, `connector.module.css`

**问题**: 2D transform 可能不触发 GPU 加速，导致重绘性能问题。

**修复**:
```typescript
// AnchorOverlay.tsx
transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.z})`
```

```css
/* connector.module.css */
.anchorOverlay,
.anchorOverlay svg {
  will-change: transform;
}
```

### 4. React 渲染优化
**文件**: `AnchorOverlay.tsx`

**问题**: 不必要的重新计算和重新渲染。

**修复**:
```typescript
// 使用 useMemo 缓存
const shapesToRender = useMemo(() => {
  // ... 计算逻辑
}, [editor, isConnectorMode, selectedShapes, hoveredShape]);

// 订阅 shape 几何变化
const shapeGeometry = useValue(
  "anchor-shapes-geometry",
  () => {
    const allShapes = editor.getCurrentPageShapes();
    return allShapes.map((s) => ({ id: s.id, type: s.type }));
  },
  [editor],
);
```

## 修复原理

### 为什么 transition: all 会导致跳动？

1. 锚点位置 (cx, cy) 使用 page 坐标计算
2. 当用户点击或画布操作时，React 可能重新渲染组件
3. 即使坐标值相同，DOM 更新也可能触发 CSS transition
4. `transition: all` 会对 cx、cy 的任何变化应用 0.12s 的缓动动画
5. 结果：锚点看起来在"跳动"或"滑动"到新位置

**解决方案**: 只对视觉效果（fill、transform）应用 transition，不对位置属性（cx、cy）应用。

### 为什么需要缩放感知的阈值？

坐标系统：
```
屏幕像素 ←→ Page 坐标
关系: pageUnits = screenPixels / camera.z
```

例子：
- 100% 缩放 (camera.z = 1.0): 20px 屏幕 = 20 page 单位
- 200% 放大 (camera.z = 2.0): 20px 屏幕 = 10 page 单位
- 50% 缩小 (camera.z = 0.5): 20px 屏幕 = 40 page 单位

使用 `threshold / camera.z` 确保在所有缩放级别下，点击区域在屏幕上感觉大小一致。

## 验证方法

### 方法1：浏览器控制台验证
1. 打开 http://localhost:3000
2. 进入画布页面
3. 打开开发者工具（F12）
4. 复制 `verify-anchor-jump-fix.js` 内容到控制台
5. 查看自动验证结果

### 方法2：手动测试
1. 访问 http://localhost:3000
2. 进入项目画布
3. 点击连接器工具
4. **测试点击**: 点击任意锚点
   - ✅ 应该：立即响应，无延迟
   - ✅ 应该：锚点位置稳定
   - ❌ 不应该：锚点跳动、闪烁或滑动

5. **测试缩放**: 放大/缩小画布后点击
   - ✅ 应该：所有缩放级别下都准确响应
   - ✅ 应该：点击区域感觉大小一致

6. **测试拖动**: 从一个锚点拖到另一个
   - ✅ 应该：吸附平滑无跳动
   - ✅ 应该：预览线实时跟随

## 文件清单

修改的文件：
- ✅ `apps/web/src/modules/board/tools/ConnectorTool.ts`
- ✅ `apps/web/src/modules/board/connectors/AnchorOverlay.tsx`
- ✅ `apps/web/src/modules/board/shapes/connector.module.css`

新增的文档：
- ✅ `apps/web/src/modules/board/connectors/ANCHOR-JUMP-FIX.md` - 详细技术文档
- ✅ `verify-anchor-jump-fix.js` - 浏览器控制台验证脚本

## 开发服务器状态

✅ 运行中: http://localhost:3000
✅ 所有修改已应用
✅ TypeScript 编译成功
✅ 热重载生效

## 预期结果

修复后的行为：
1. **点击锚点**: 立即创建预览线，无视觉跳动
2. **缩放测试**: 所有缩放级别下点击准确
3. **拖动连接**: 吸附平滑，预览线流畅跟随
4. **性能**: 60fps 流畅交互，无卡顿

## 如果问题仍然存在

请提供以下信息：
1. **具体表现**:
   - 跳动的方向（上下/左右/对角线）
   - 跳动的距离（大约多少像素）
   - 是否只在点击时跳动，还是持续跳动

2. **环境信息**:
   - 浏览器类型和版本
   - 当前画布缩放级别
   - 是否使用高 DPI 屏幕

3. **控制台信息**:
   - 运行 `verify-anchor-jump-fix.js` 的输出
   - 是否有 JavaScript 错误

4. **重现步骤**:
   - 详细的操作步骤
   - 截图或屏幕录像

## 技术债务

未来可以进一步优化：
- [ ] 考虑使用 CSS containment 进一步优化渲染
- [ ] 使用 IntersectionObserver 只渲染可见锚点
- [ ] 添加性能监控，记录渲染时间
- [ ] 考虑使用 WebGL 渲染大量锚点

## 相关文档

- `connector-manual-test.md` - 完整的手动测试指南
- `IMPLEMENTATION_SUMMARY.md` - 连接器功能实现总结
- `verify-connector-implementation.js` - 功能完整性验证
