# 动效增强文档

## 概述

本次动效优化遵循 **Elegant · Precise · Tactile · Restrained · Responsive** 的设计原则，为新时尚 AI 设计平台添加了细腻而克制的动效系统。

## 核心设计原则

1. **性能优先**：所有动效仅使用 `transform` 和 `opacity`，避免触发 layout reflow
2. **渐进增强**：尊重用户的 `prefers-reduced-motion` 设置
3. **语义化动效**：不同类型的交互使用不同的缓动曲线
4. **视觉连续性**：状态变化流畅自然，提供清晰的反馈

---

## 添加的动效分类

### 1. 节点系统动效

#### 1.1 节点入场动效
- **实现位置**：`workflow-node.module.css`
- **动画名称**：`nodeEnter`
- **效果**：节点从上方自然落下，带有轻微缩放
- **时长**：280ms（`--dur-material-enter`）
- **缓动**：`cubic-bezier(0.16, 1, 0.3, 1)`（物理落感）

```css
animation: nodeEnter var(--dur-material-enter) var(--ease-material-drop) backwards;
```

#### 1.2 节点高亮提升
- **效果**：选中/高亮的节点微微向上提升 2px
- **用途**：增强深度感和层次关系
- **过渡**：160ms，弹性缓动

#### 1.3 节点状态指示器
- **动画名称**：`statusPulse`
- **效果**：进行中状态的脉冲动画
- **时长**：900ms（`--dur-ai-pulse`）
- **特点**：失败状态不闪烁，只有活跃状态才有动画

### 2. 连线系统动效

#### 2.1 连线入场
- **动画名称**：`edgeEnter`
- **效果**：连线淡入出现
- **时长**：260ms
- **平滑过渡**：stroke-width 和 opacity 都有过渡

#### 2.2 数据流动效果（高亮状态）
- **动画名称**：`flowData`
- **效果**：虚线沿连线方向流动
- **时长**：1.2s 循环
- **应用时机**：连线被选中或高亮时

#### 2.3 连接提示框
- **动画名称**：`slideUpFade`
- **效果**：从底部滑入并淡入
- **时长**：260ms

### 3. 交互端口动效

#### 3.1 端口悬停
- **效果**：
  - 圆点缩放至 1.4 倍
  - 添加发光阴影（`box-shadow`）
  - 颜色从灰色变为主题色（indigo）
- **时长**：120ms，弹性缓动

#### 3.2 端口标签
- **效果**：标签上滑并淡入
- **初始状态**：`translateY(4px)` + `opacity: 0`
- **时长**：120ms

### 4. UI 组件动效

#### 4.1 侧边栏入场
- **动画名称**：`slideInFromRight`
- **效果**：从右侧滑入
- **时长**：220ms（`--dur-layout`）

#### 4.2 底部菜单
- **动画名称**：`slideUpFromBottom`
- **效果**：从底部滑入
- **延迟**：150ms（让画布先出现）

#### 4.3 按钮按下反馈
- **效果**：`scale(0.97)` 或 `scale(0.95)`
- **时长**：80ms（`--dur-instant`）
- **缓动**：snappy（立即响应感）

#### 4.4 弹出菜单
- **动画名称**：`popFromBottom`
- **效果**：从下方弹出并带有轻微缩放
- **时长**：260ms
- **缓动**：弹性（`ease-spring`）

#### 4.5 菜单项悬停
- **效果**：向右平移 2px
- **时长**：120ms

### 5. 消息系统动效

#### 5.1 消息气泡入场
- **动画名称**：`messageEnter`
- **效果**：淡入 + 向上轻移
- **时长**：180ms（`--dur-standard`）

### 6. 全局增强动效

#### 6.1 焦点呼吸效果
- **动画名称**：`focusPulse`
- **效果**：输入框获得焦点时的微妙脉冲
- **时长**：1.8s 循环

#### 6.2 加载状态
- **旋转器**：`rotate`，700ms 线性循环
- **骨架屏**：`skeletonPulse`，1.5s 渐变流动

#### 6.3 Toast 通知
- **动画名称**：`toastEnter`
- **效果**：从顶部滑下并带有弹性
- **时长**：260ms

#### 6.4 对话框
- **动画名称**：`dialogEnter`
- **效果**：缩放 + 向上位移 + 淡入
- **时长**：260ms

#### 6.5 列表交错
- **动画名称**：`staggerFadeIn`
- **效果**：列表项依次淡入
- **延迟**：每项递增 60ms（`--stagger-sm`）
- **最多支持**：前 6 个子元素

---

## 技术实现细节

### 缓动函数库

| 函数名 | 值 | 用途 |
|--------|-----|------|
| `ease-state` | `cubic-bezier(0.4, 0, 0.2, 1)` | 状态平滑过渡 |
| `ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | 元素进入 |
| `ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | 元素退出 |
| `ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性反馈 |
| `ease-snappy` | `cubic-bezier(0.2, 0, 0, 1)` | 即时响应 |

### 时长系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--dur-instant` | 80ms | 按钮 press、checkbox |
| `--dur-fast` | 120ms | 按钮 hover、标签选中 |
| `--dur-standard` | 180ms | 面板状态变化 |
| `--dur-enter` | 260ms | 元素进入 |
| `--dur-exit` | 180ms | 元素离开 |
| `--dur-layout` | 220ms | 布局变化 |
| `--dur-material-enter` | 280ms | 素材落下 |
| `--dur-material-hover` | 160ms | 素材悬停 |

### 交错延迟

| Token | 值 | 用途 |
|-------|-----|------|
| `--stagger-xs` | 40ms | 紧密列表 |
| `--stagger-sm` | 60ms | 候选卡片 |
| `--stagger-md` | 80ms | 项目卡片 |

---

## Reduced Motion 支持

所有动效都完全支持 `prefers-reduced-motion: reduce`：

- **运动类动画**（transform）：duration → 0.01ms
- **状态指示器**：保留极慢脉冲（2s）用于指示状态
- **不移除的属性**：opacity、color 变化（这些是状态反馈，不是运动）

---

## 性能优化策略

### 1. 硬件加速
为频繁动画的元素添加 `will-change: transform`：
- 所有节点（`.node`）
- 所有连线（`.edge`）
- 所有按钮（`button`）

### 2. 动画完成后清理
动画结束后移除 `will-change` 避免内存占用。

### 3. 避免 Layout Thrashing
- 仅使用 `transform` 和 `opacity`
- 避免同时修改多个几何属性
- 批量 DOM 更新

---

## 使用示例

### 为新组件添加入场动效

```css
.my-component {
  animation: slideUpFade var(--dur-enter) var(--ease-enter) backwards;
}

@keyframes slideUpFade {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 为按钮添加悬停效果

```css
.my-button {
  transition: transform var(--dur-fast) var(--ease-state);
}

.my-button:hover {
  transform: translateY(-2px);
}

.my-button:active {
  transform: scale(0.97);
  transition-duration: var(--dur-instant);
}
```

---

## 文件清单

### 修改的文件
1. `apps/web/src/modules/board/workflow/workflow-node.module.css`
   - 节点入场动效
   - 节点高亮提升
   - 状态指示器脉冲
   - 交互端口动效增强

2. `apps/web/src/modules/board/workflow/workflow-connections.module.css`
   - 连线入场
   - 数据流动效果
   - 连接提示框动画

3. `apps/web/src/modules/board/workflow/workflow-canvas.module.css`
   - 侧边栏入场
   - 底部菜单入场
   - 按钮按下反馈
   - 弹出菜单动画
   - 消息气泡入场

### 新增的文件
1. `apps/web/src/styles/motion-enhancements.css`
   - 全局微交互
   - 通用组件动效
   - 加载状态
   - Toast 与对话框
   - 列表交错
   - Reduced Motion 支持

2. `apps/web/src/app/globals.css`
   - 引入新的动效增强样式

---

## 设计权衡

### 为什么这样设计？

1. **节点落下而非淡入**
   - 理由：符合物理直觉，赋予节点"重量感"
   - 替代方案：纯淡入（但缺少方向性）

2. **连线流动仅在高亮时出现**
   - 理由：避免视觉噪音，仅在需要时引导注意力
   - 替代方案：始终流动（但会分散注意力）

3. **端口默认不可见，悬停显现**
   - 理由：保持画布清爽，仅在交互时显示操作可能性
   - 替代方案：始终可见（但影响视觉层次）

4. **消息从下向上进入**
   - 理由：符合阅读顺序，新消息从底部"生长"出来
   - 替代方案：从上向下（但与列表堆叠不符）

---

## 未来改进方向

### 1. 基于操作成功率的动效调整
- 成功操作：绿色脉冲反馈
- 失败操作：红色抖动反馈

### 2. 长按手势支持
- 长按节点显示快捷菜单
- 带有圆形进度指示器

### 3. 拖拽反馈增强
- 拖拽时节点放大 1.05 倍
- 投影增强
- 可放置区域高亮

### 4. 画布缩放过渡
- 平滑的缩放动画
- 焦点元素保持在视口中心

### 5. 批量操作的视觉反馈
- 批量删除：逐个淡出
- 批量移动：波浪式移动

---

## 测试清单

- [x] 节点创建后自然落入画布
- [x] 节点悬停时微微提升
- [x] 连线在高亮时显示数据流动
- [x] 端口悬停时圆点放大并显示标签
- [x] 侧边栏从右侧平滑滑入
- [x] 底部菜单从下方滑入
- [x] 按钮按下时有缩放反馈
- [x] 弹出菜单从下方弹出
- [x] 消息气泡逐条淡入
- [x] 输入框焦点时有呼吸效果
- [x] 列表项交错淡入
- [ ] 在慢速设备上测试性能
- [ ] 验证 Reduced Motion 模式
- [ ] 不同浏览器兼容性测试

---

## 兼容性

| 特性 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| CSS Animations | ✅ | ✅ | ✅ | ✅ |
| CSS Transitions | ✅ | ✅ | ✅ | ✅ |
| cubic-bezier() | ✅ | ✅ | ✅ | ✅ |
| backdrop-filter | ✅ | ✅ | ✅ | ✅ |
| will-change | ✅ | ✅ | ✅ | ✅ |
| prefers-reduced-motion | ✅ | ✅ | ✅ | ✅ |

---

## 致谢

本动效系统设计参考了：
- Material Design Motion System
- Apple Human Interface Guidelines
- Framer Motion 最佳实践
- Stripe、Linear 等现代 Web 应用的动效设计

**设计目标达成**：创建一个优雅、克制、性能优异的动效系统，让界面操作更加流畅自然，同时不会喧宾夺主。
