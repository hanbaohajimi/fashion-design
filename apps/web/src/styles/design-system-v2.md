# 新时尚 AI 设计工作台 - 视觉设计系统 V2

> 历史设计资料：以下深色方案已不用于当前运行时。现行规范以 `design-system.css` 和 `doc/全系统界面优化实施-2026-10-24.md` 为准，请勿据此重新引入旧主题。

## 设计理念

**定位：** 面向专业服装设计师的高端 AI 设计工具  
**视觉语言：** 深色主题 + 编辑式排版 + 时尚行业美学  
**参考标杆：** Figma, Runway, Midjourney（专业创意工具）+ Vogue, WGSN（时尚编辑美学）

---

## 色彩系统

### 主色调（深色主题）

```css
/* 背景层级 */
--surface-base: #0a0a0b; /* 深黑背景，主画布 */
--surface-elevated: #1a1a1c; /* 卡片、面板 */
--surface-overlay: #2a2a2c; /* 浮层、弹窗 */

/* 文字颜色 */
--text-primary: #fafafa; /* 主要文字 */
--text-secondary: #a8a8a8; /* 次要文字 */
--text-tertiary: #6b6b6b; /* 辅助文字 */
--text-disabled: #4a4a4a; /* 禁用状态 */

/* 强调色 - 温暖橙红 */
--accent-primary: #e9522c; /* 主强调色 */
--accent-hover: #ff6b42; /* 悬停状态 */
--accent-pressed: #d44520; /* 按下状态 */
--accent-muted: rgba(233, 82, 44, 0.12); /* 淡化背景 */

/* 语义色 */
--status-success: #4caf50;
--status-warning: #ff9800;
--status-error: #f44336;
--status-info: #2196f3;

/* 边框和分割线 */
--border-subtle: rgba(255, 255, 255, 0.08);
--border-strong: rgba(255, 255, 255, 0.16);
--divider: rgba(255, 255, 255, 0.06);
```

### 工作流节点颜色

```css
/* 节点类型配色 */
--node-brief: #3b82f6; /* 设计需求 - 蓝色 */
--node-reference: #8b5cf6; /* 参考素材 - 紫色 */
--node-tool: #f59e0b; /* 工具操作 - 橙色 */
--node-result: #10b981; /* 候选结果 - 绿色 */
--node-constraint: #06b6d4; /* 设计约束 - 青色 */
--node-evaluation: #ec4899; /* 评估报告 - 粉色 */
```

---

## 字体系统

### 字体族

```css
/* 衬线字体 - 用于标题、品牌、重要内容 */
--font-serif: Georgia, "Songti SC", "Noto Serif SC", serif;

/* 无衬线字体 - 用于界面、正文、数据 */
--font-sans:
  "Inter", "PingFang SC", "Microsoft YaHei", -apple-system, system-ui,
  sans-serif;

/* 等宽字体 - 用于代码、数据 */
--font-mono: "JetBrains Mono", "Fira Code", Consolas, monospace;
```

### 字体层级

```css
/* Display - 大标题 */
--text-display-lg: 48px / 1.1 / 600; /* 页面主标题 */
--text-display-md: 36px / 1.2 / 600; /* 区块标题 */
--text-display-sm: 28px / 1.2 / 600; /* 小标题 */

/* Heading - 标题 */
--text-heading-lg: 24px / 1.3 / 600; /* 一级标题 */
--text-heading-md: 20px / 1.4 / 600; /* 二级标题 */
--text-heading-sm: 18px / 1.4 / 600; /* 三级标题 */

/* Body - 正文 */
--text-body-lg: 16px / 1.6 / 400; /* 大正文 */
--text-body-md: 14px / 1.6 / 400; /* 标准正文 */
--text-body-sm: 13px / 1.5 / 400; /* 小正文 */

/* Label - 标签 */
--text-label-lg: 14px / 1.4 / 500; /* 大标签 */
--text-label-md: 12px / 1.4 / 500; /* 标准标签 */
--text-label-sm: 11px / 1.4 / 500; /* 小标签 */

/* Caption - 说明文字 */
--text-caption: 12px / 1.5 / 400; /* 辅助说明 */
```

---

## 间距系统

```css
/* 基础单位 4px */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
--space-24: 96px;

/* 组件内部间距 */
--padding-xs: var(--space-2); /* 8px */
--padding-sm: var(--space-3); /* 12px */
--padding-md: var(--space-4); /* 16px */
--padding-lg: var(--space-6); /* 24px */
--padding-xl: var(--space-8); /* 32px */

/* 组件间间距 */
--gap-xs: var(--space-2); /* 8px */
--gap-sm: var(--space-4); /* 16px */
--gap-md: var(--space-6); /* 24px */
--gap-lg: var(--space-8); /* 32px */
--gap-xl: var(--space-12); /* 48px */
```

---

## 圆角系统

```css
--radius-sm: 4px; /* 小元素 */
--radius-md: 8px; /* 卡片、按钮 */
--radius-lg: 12px; /* 大卡片 */
--radius-xl: 16px; /* 容器 */
--radius-full: 9999px; /* 圆形、药丸 */
```

---

## 阴影系统

```css
/* 卡片阴影 - 柔和不刺眼 */
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.3);
--shadow-md:
  0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.3);
--shadow-lg:
  0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3);
--shadow-xl:
  0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 10px 10px -5px rgba(0, 0, 0, 0.3);

/* 发光效果 - 仅用于强调 */
--glow-accent: 0 0 20px rgba(233, 82, 44, 0.3);
--glow-focus: 0 0 0 3px rgba(233, 82, 44, 0.2);
```

---

## 动效系统

```css
/* 缓动函数 */
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
--ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
--ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
--ease-sharp: cubic-bezier(0.4, 0, 0.6, 1);

/* 时长 */
--duration-instant: 100ms;
--duration-fast: 200ms;
--duration-normal: 300ms;
--duration-slow: 400ms;
--duration-slower: 600ms;

/* 常用组合 */
--transition-base: all var(--duration-fast) var(--ease-standard);
--transition-smooth: all var(--duration-normal) var(--ease-standard);
--transition-color:
  color var(--duration-fast) var(--ease-standard),
  background-color var(--duration-fast) var(--ease-standard),
  border-color var(--duration-fast) var(--ease-standard);
```

---

## 组件设计规范

### 按钮

```css
/* Primary Button - 主要操作 */
.button-primary {
  background: var(--accent-primary);
  color: white;
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-weight: 500;
  transition: var(--transition-base);
  box-shadow: var(--shadow-sm);
}

.button-primary:hover {
  background: var(--accent-hover);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

/* Secondary Button - 次要操作 */
.button-secondary {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
  padding: 10px 20px;
  border-radius: var(--radius-md);
  transition: var(--transition-base);
}

.button-secondary:hover {
  background: var(--surface-elevated);
  border-color: var(--accent-primary);
}

/* Ghost Button - 幽灵按钮 */
.button-ghost {
  background: transparent;
  color: var(--text-secondary);
  padding: 10px 20px;
  transition: var(--transition-color);
}

.button-ghost:hover {
  color: var(--accent-primary);
}
```

### 卡片

```css
.card {
  background: var(--surface-elevated);
  border-radius: var(--radius-lg);
  padding: var(--padding-lg);
  border: 1px solid var(--border-subtle);
  transition: var(--transition-smooth);
}

.card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

/* 项目卡片特殊样式 */
.project-card {
  overflow: hidden;
}

.project-card-image {
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: var(--radius-md);
}

.project-card-title {
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 500;
  margin-top: var(--space-4);
}
```

### 输入框

```css
.input {
  background: var(--surface-base);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  color: var(--text-primary);
  transition: var(--transition-base);
}

.input:hover {
  border-color: var(--border-strong);
}

.input:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: var(--glow-focus);
}
```

---

## 页面布局模式

### 项目列表页

```
┌─────────────────────────────────────────────────┐
│ Logo    项目 趋势 面料         Avatar  +新建项目  │ ← 导航栏 60px
├─────────────────────────────────────────────────┤
│                                                 │
│  设计项目                                        │ ← 页面标题
│  Your Fashion Design Projects                   │
│                                                 │
│  ┌────────┐  ┌────────┐  ┌────────┐          │
│  │ Image  │  │ Image  │  │ Image  │          │ ← 项目卡片网格
│  │        │  │        │  │        │          │   3列，间距24px
│  └────────┘  └────────┘  └────────┘          │
│   Title        Title       Title              │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 工作流画布页

```
┌─────────────────────────────────────────────────┐
│ 项目/春季  春季系列设计  已保存 导出 Avatar      │ ← 顶部栏
├──────────────────────────────┬──────────────────┤
│                              │  对话│节点详情   │
│   ○ 设计需求 ─→ ○ 方案生成   │                  │
│                              │  Chat messages   │
│   ○ 参考图片 ─→ ○ 候选A      │  ...             │
│                  │           │                  │
│                  └→ ○ 评估   │  Input field     │
│                              │                  │
├──────────────────────────────┴──────────────────┤
│     +添加素材  │  +添加工具                      │ ← 底部工具栏
└─────────────────────────────────────────────────┘
```

### 趋势档案页

```
┌─────────────────────────────────────────────────┐
│  趋势档案                                        │
│  TREND RESEARCH ARCHIVE                         │
│                                                 │
│  [廓形] [色彩] [面料] [风格]        🔍 搜索      │ ← 筛选器
│                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ Image   │  │ Image   │  │ Image   │       │ ← 趋势卡片
│  │ Tag     │  │ Tag     │  │ Tag     │       │   3列网格
│  ├─────────┤  ├─────────┤  ├─────────┤       │
│  │ Title   │  │ Title   │  │ Title   │       │
│  │ Summary │  │ Summary │  │ Summary │       │
│  │ 🎨🎨🎨  │  │ 🎨🎨🎨  │  │ 🎨🎨🎨  │       │ ← 色板
│  │ [加入]  │  │ [加入]  │  │ [加入]  │       │
│  └─────────┘  └─────────┘  └─────────┘       │
└─────────────────────────────────────────────────┘
```

---

## 设计原则

1. **留白为王** - 充足的空间让内容呼吸，避免拥挤
2. **对比清晰** - 强烈的字号、颜色、间距对比
3. **层级分明** - 通过大小、颜色、位置建立清晰层级
4. **专业克制** - 避免过度装饰，保持专业工具感
5. **视觉一致** - 相同元素在不同页面保持一致表现
6. **响应迅速** - 流畅的动效和即时的视觉反馈
7. **时尚感知** - 借鉴时尚行业的编辑美学

---

## 避免的模式

❌ 紫蓝色 AI 渐变  
❌ 发光边缘和光晕  
❌ 过多玻璃态效果  
❌ 拥挤的卡片堆叠  
❌ 弱层级的排版  
❌ 通用 SaaS 模板感  
❌ 过于鲜艳的配色

✅ 深色优雅背景  
✅ 清晰的视觉层级  
✅ 充足的留白空间  
✅ 专业的时尚美学  
✅ 精致的交互动效  
✅ 强烈的品牌识别
