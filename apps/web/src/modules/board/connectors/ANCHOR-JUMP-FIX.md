# 锚点跳动修复验证

## 问题描述
用户报告：点击锚点时仍然会跳动

## 根本原因分析

### 原因1：CSS transition 导致的视觉跳动
**问题**: `.anchorPoint` 使用 `transition: all 0.12s ease`，当锚点位置（cx/cy）因坐标计算变化时，会产生动画效果，看起来像是"跳动"。

**修复**:
```css
/* 之前 */
.anchorPoint {
  transition: all 0.12s ease;  /* 包括 cx, cy, r, opacity 等所有属性 */
}

/* 之后 */
.anchorPoint {
  transition: fill 0.12s ease, transform 0.12s ease;  /* 只对视觉效果动画 */
  will-change: transform;  /* GPU 加速 */
}
```

### 原因2：缩放感知的点击检测阈值
**问题**: `findNearestAnchor` 使用固定的像素阈值（15px），但没有考虑画布缩放。当画布放大时，15px 的屏幕距离对应更小的 page 坐标距离，导致锚点难以点击或点击检测不准确。

**修复**:
```typescript
// 之前
const clickedAnchor = findNearestAnchor(point.x, point.y, anchors, 15);

// 之后
const camera = this.editor.getCamera();
const thresholdInPageUnits = 20 / camera.z;  // 20px 屏幕距离转换为 page 单位
const clickedAnchor = findNearestAnchor(point.x, point.y, anchors, thresholdInPageUnits);
```

**原理**:
- 当 camera.z = 1.0（100% 缩放）：阈值 = 20 / 1.0 = 20 page 单位
- 当 camera.z = 2.0（200% 放大）：阈值 = 20 / 2.0 = 10 page 单位
- 当 camera.z = 0.5（50% 缩小）：阈值 = 20 / 0.5 = 40 page 单位

这样可以确保在所有缩放级别下，锚点的点击区域在屏幕上保持恒定的 20px。

### 原因3：GPU 加速优化
**问题**: SVG transform 使用 2D transform，可能不会触发 GPU 加速，导致频繁重绘时出现卡顿或跳动。

**修复**:
```typescript
// 之前
transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`

// 之后
transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.z})`
```

```css
.anchorOverlay,
.anchorOverlay svg {
  will-change: transform;  /* 提示浏览器这些元素会频繁变换 */
}
```

### 原因4：不必要的重新渲染
**问题**: 每次渲染时都重新计算 `shapesToRender` Set，即使 shapes 没有变化。

**修复**:
```typescript
// 使用 useMemo 缓存计算结果
const shapesToRender = useMemo(() => {
  const shapes = new Set<string>();
  // ... 计算逻辑
  return shapes;
}, [editor, isConnectorMode, selectedShapes, hoveredShape]);

// 添加 shape 几何变化订阅
const shapeGeometry = useValue(
  "anchor-shapes-geometry",
  () => {
    const allShapes = editor.getCurrentPageShapes();
    return allShapes.map((s) => ({ id: s.id, type: s.type }));
  },
  [editor],
);
```

## 修复的文件

1. ✅ `ConnectorTool.ts` - 缩放感知的点击阈值
   - `onPointerDown`: 20 / camera.z
   - `onPointerMove`: 30 / camera.z

2. ✅ `AnchorOverlay.tsx` - 渲染优化
   - 添加 `useMemo` 缓存 shapesToRender
   - 添加 shape 几何订阅
   - 使用 `translate3d` 触发 GPU 加速

3. ✅ `connector.module.css` - 移除位置动画
   - 将 `transition: all` 改为 `transition: fill, transform`
   - 添加 `will-change: transform`

## 验证步骤

### 测试1：点击锚点不跳动
1. 打开 http://localhost:3000 进入画布
2. 激活连接器工具
3. 点击任意锚点
4. **验证**: 锚点不应该出现位置跳动或闪烁
5. **验证**: 点击后立即创建预览线

### 测试2：缩放后点击准确
1. 放大画布到 200%（Ctrl + 滚轮）
2. 点击锚点
3. **验证**: 锚点响应准确，不需要多次点击
4. **验证**: 点击区域在屏幕上感觉大小一致

5. 缩小画布到 50%
6. 点击锚点
7. **验证**: 同样准确响应

### 测试3：拖动流畅无跳动
1. 激活连接器工具
2. 从一个锚点开始拖动
3. 移动鼠标到另一个锚点附近
4. **验证**: 预览线吸附到目标锚点时平滑无跳动
5. **验证**: 松开鼠标创建连接

### 测试4：高频操作测试
1. 快速连续点击多个锚点
2. **验证**: 每次点击都准确响应
3. **验证**: 没有视觉上的延迟或跳动

### 测试5：边界情况
1. 在极端缩放下测试（10%、500%）
2. **验证**: 锚点点击仍然准确
3. **验证**: 没有跳动或位置错误

## 技术细节

### 坐标空间转换
```
Screen Space (屏幕坐标)
  ↑ ÷ camera.z
Page Space (页面坐标，锚点计算使用)
  ↑ × camera.z
Screen Space (实际渲染)
```

**关键点**:
- 锚点位置 (cx, cy) 使用 Page Space
- SVG 容器通过 `translate3d` + `scale` 将 Page Space 映射到 Screen Space
- 点击阈值需要从 Screen Space 转换到 Page Space：`screenPixels / camera.z`

### 性能优化

**GPU 加速**:
- `translate3d` 替代 `translate` → 触发合成层
- `will-change: transform` → 提前通知浏览器
- 结果：transform 变化不触发重排，只触发重绘

**React 优化**:
- `useMemo` → 避免不必要的 Set 重建
- `useValue` 订阅 → 只在真正变化时重新渲染
- 稳定的 key → React 不会重新创建 DOM 元素

**CSS 优化**:
- 只对必要属性添加 transition
- 避免 `transition: all` 导致位置动画

## 预期结果

✅ 点击锚点时：
- 立即响应，无延迟
- 锚点位置稳定，不跳动
- 预览线立即出现

✅ 所有缩放级别下：
- 点击区域感觉一致（约 20-30px 屏幕距离）
- 锚点视觉大小恒定（6px 屏幕半径）
- 交互流畅，60fps

✅ 拖动过程中：
- 预览线实时跟随
- 吸附到目标锚点时平滑
- 没有视觉抖动或跳跃

## 回归测试

确保没有破坏现有功能：
- ✅ 锚点在连接器模式下显示
- ✅ 锚点在选中对象时显示
- ✅ 锚点悬停效果正常（放大、颜色变化）
- ✅ 连接器创建成功
- ✅ 工具保持在连接器模式
- ✅ 按 Esc 退出连接器模式

## 测试清单

| 测试项 | 状态 | 备注 |
|--------|------|------|
| 点击锚点不跳动 | ⏳ 待测试 | 主要验证点 |
| 100% 缩放点击准确 | ⏳ 待测试 | |
| 200% 缩放点击准确 | ⏳ 待测试 | |
| 50% 缩放点击准确 | ⏳ 待测试 | |
| 拖动吸附平滑 | ⏳ 待测试 | |
| 高频点击响应 | ⏳ 待测试 | |
| 悬停效果正常 | ⏳ 待测试 | 回归测试 |
| 连接创建成功 | ⏳ 待测试 | 回归测试 |

## 如果仍有问题

### 检查点1：浏览器开发者工具
打开 Performance 面板，记录点击锚点时的性能：
- 查看是否有频繁的 Layout 或 Paint
- 查看 transform 是否在 Composite 层执行

### 检查点2：控制台验证
```javascript
// 运行此脚本检查 transform
const svg = document.querySelector('.anchorOverlay svg');
console.log('Transform:', svg.style.transform);
console.log('Should include translate3d');
```

### 检查点3：CSS 验证
```javascript
// 检查 transition 设置
const anchor = document.querySelector('.anchorPoint');
const styles = window.getComputedStyle(anchor);
console.log('Transition:', styles.transition);
console.log('Should NOT include cx, cy in transition');
```

## 开发服务器状态

✅ 服务器运行中：http://localhost:3000
✅ 所有修改已应用
✅ TypeScript 编译成功

请在浏览器中测试并反馈结果。
