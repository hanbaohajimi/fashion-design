# 前端重构迁移指南

## 快速开始

### 启用新设计

重构后的组件已经自动启用。查看效果：

```bash
cd apps/web
npm run dev
```

访问：
- 登录页面：http://localhost:3000/login
- 项目库：http://localhost:3000/

---

## 设计系统使用

### 1. 引入 Token 系统

所有新组件都使用 `design-system.css` 中定义的 token：

```css
/* ❌ 错误 - 硬编码 */
.button {
  padding: 12px 24px;
  border-radius: 8px;
  color: #1a1916;
}

/* ✅ 正确 - 使用 token */
.button {
  padding: var(--space-3) var(--space-6);
  border-radius: var(--radius-md);
  color: var(--text-primary);
}
```

### 2. 颜色使用规范

#### 文本颜色
```css
color: var(--text-primary);    /* 主要文本 - 对比度 13.2:1 */
color: var(--text-secondary);  /* 次要文本 - 对比度 7.8:1 */
color: var(--text-tertiary);   /* 三级文本 - 对比度 5.2:1 */
color: var(--text-disabled);   /* 仅用于禁用状态 */
```

#### 背景颜色
```css
background: var(--surface-paper);    /* 主背景 */
background: var(--surface-canvas);   /* 次级背景 */
background: var(--surface-card);     /* 卡片背景 */
background: var(--surface-overlay);  /* 浮层背景 */
```

#### 语义颜色
```css
color: var(--color-error);      /* 错误状态 */
color: var(--color-success);    /* 成功状态 */
color: var(--color-warning);    /* 警告状态 */
background: var(--color-error-bg);  /* 错误背景 */
```

#### 服装行业语义化颜色
```css
/* 面料类型标签 */
background: var(--fabric-knit);      /* 针织 */
background: var(--fabric-woven);     /* 梭织 */
background: var(--fabric-leather);   /* 皮革 */
background: var(--fabric-technical); /* 科技面料 */

/* 风格标签 */
background: var(--style-minimalist);   /* 极简 */
background: var(--style-avant-garde);  /* 先锋 */
background: var(--style-streetwear);   /* 街头 */
background: var(--style-couture);      /* 高定 */
```

### 3. 间距系统（8pt Grid）

```css
/* 使用预定义的间距值 */
margin: var(--space-1);   /* 4px */
margin: var(--space-2);   /* 8px */
margin: var(--space-3);   /* 12px */
margin: var(--space-4);   /* 16px */
margin: var(--space-6);   /* 24px */
margin: var(--space-8);   /* 32px */
margin: var(--space-12);  /* 48px */
margin: var(--space-16);  /* 64px */

/* ❌ 避免奇数值 */
margin: 13px;
padding: 19px;

/* ✅ 使用 8 的倍数 */
margin: var(--space-4);   /* 16px */
padding: var(--space-6);  /* 24px */
```

### 4. 圆角系统

```css
border-radius: var(--radius-sm);    /* 4px - 小元素 */
border-radius: var(--radius-md);    /* 8px - 按钮 */
border-radius: var(--radius-lg);    /* 12px - 卡片 */
border-radius: var(--radius-xl);    /* 16px - 大卡片 */
border-radius: var(--radius-pill);  /* 999px - 药丸形 */
border-radius: var(--radius-circle); /* 50% - 圆形 */
```

### 5. 阴影系统

```css
box-shadow: var(--shadow-sm);   /* 微小提升 */
box-shadow: var(--shadow-md);   /* 悬停状态 */
box-shadow: var(--shadow-lg);   /* 浮动元素 */
box-shadow: var(--shadow-xl);   /* 模态框 */
box-shadow: var(--shadow-2xl);  /* 最高层级 */
```

### 6. 排版系统

```css
/* 字体族 */
font-family: var(--font-sans);   /* 无衬线 */
font-family: var(--font-serif);  /* 衬线 - 用于标题 */
font-family: var(--font-mono);   /* 等宽 - 用于代码 */

/* 流式字号 */
font-size: var(--font-xs);    /* 10-12px */
font-size: var(--font-sm);    /* 12-14px */
font-size: var(--font-base);  /* 14-16px */
font-size: var(--font-md);    /* 16-18px */
font-size: var(--font-lg);    /* 18-24px */
font-size: var(--font-xl);    /* 24-36px */
font-size: var(--font-2xl);   /* 32-56px */
font-size: var(--font-3xl);   /* 40-80px */

/* 字重 */
font-weight: var(--font-weight-normal);    /* 400 */
font-weight: var(--font-weight-medium);    /* 500 */
font-weight: var(--font-weight-semibold);  /* 600 */
font-weight: var(--font-weight-bold);      /* 700 */
font-weight: var(--font-weight-black);     /* 800 */

/* 字距 */
letter-spacing: var(--tracking-tighter);  /* -0.055em - 大标题 */
letter-spacing: var(--tracking-tight);    /* -0.025em - 标题 */
letter-spacing: var(--tracking-normal);   /* 0 - 正文 */
letter-spacing: var(--tracking-wide);     /* 0.08em - 标签 */
letter-spacing: var(--tracking-wider);    /* 0.14em - 小型大写 */
letter-spacing: var(--tracking-widest);   /* 0.22em - 全大写 */

/* 行高 */
line-height: var(--leading-none);     /* 1 */
line-height: var(--leading-tight);    /* 1.2 */
line-height: var(--leading-snug);     /* 1.4 */
line-height: var(--leading-normal);   /* 1.5 */
line-height: var(--leading-relaxed);  /* 1.7 */
line-height: var(--leading-loose);    /* 2 */
```

### 7. 过渡动画

```css
/* 持续时间 */
transition-duration: var(--duration-fast);   /* 120ms */
transition-duration: var(--duration-base);   /* 200ms */
transition-duration: var(--duration-slow);   /* 300ms */

/* 缓动函数 */
transition-timing-function: var(--ease-in-out);  /* 默认 */
transition-timing-function: var(--ease-smooth);  /* 流畅 */

/* 完整示例 */
transition: 
  background-color var(--duration-base) var(--ease-out),
  transform var(--duration-fast) var(--ease-smooth);
```

---

## 组件迁移示例

### 迁移按钮组件

**迁移前**：
```css
.button {
  min-height: 44px;
  border: 1px solid #181915;
  border-radius: 6px;
  padding: 12px 20px;
  background: #181915;
  color: white;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  transition: all 200ms ease;
}

.button:hover {
  background: transparent;
  color: #181915;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(23, 23, 19, 0.16);
}
```

**迁移后**：
```css
.button {
  min-height: 44px;
  border: 2px solid var(--text-primary);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-5);
  background: var(--text-primary);
  color: var(--surface-card);
  font-size: var(--font-sm);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--tracking-wide);
  transition:
    background-color var(--duration-base) var(--ease-out),
    color var(--duration-base) var(--ease-out),
    transform var(--duration-fast) var(--ease-smooth),
    box-shadow var(--duration-base) var(--ease-out);
}

.button:hover:not(:disabled) {
  background: transparent;
  color: var(--text-primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.button:disabled {
  cursor: wait;
  opacity: var(--opacity-disabled);
}
```

### 迁移卡片组件

**迁移前**：
```css
.card {
  border: 1px solid rgba(24, 25, 21, 0.22);
  border-radius: 12px;
  padding: 24px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(24, 25, 21, 0.08);
}
```

**迁移后**：
```css
.card {
  border: 1px solid var(--border-color-default);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
}
```

---

## 服装元数据使用

### 在项目中添加元数据

```typescript
import type { Project, ProjectMetadata } from "@/modules/projects/project-types";

// 创建项目时添加元数据
const newProject: Partial<Project> = {
  name: "2026春夏系列",
  metadata: {
    season: "SS26",
    style: "minimalist",
    silhouette: "a-line",
    materialType: "woven",
    collection: "Urban Zen",
    fabricCount: 8,
    colorPalette: ["#f5f5f0", "#e8d5c8", "#b8a898"]
  }
};
```

### 标签展示映射

```typescript
// 在组件中使用
function getStyleLabel(style?: string): string {
  const labels: Record<string, string> = {
    minimalist: "极简",
    "avant-garde": "先锋",
    streetwear: "街头",
    couture: "高定",
    casual: "休闲",
    formal: "正装",
    sportswear: "运动",
  };
  return style ? labels[style] || style : "";
}

function getMaterialLabel(material?: string): string {
  const labels: Record<string, string> = {
    knit: "针织",
    woven: "梭织",
    leather: "皮革",
    technical: "科技",
    hybrid: "混合",
  };
  return material ? labels[material] || material : "";
}
```

---

## 可访问性最佳实践

### 1. 焦点指示器

所有可交互元素必须有清晰的焦点指示器：

```css
.interactive:focus-visible {
  outline: 3px solid var(--accent-primary);
  outline-offset: 3px;
}
```

### 2. 动画偏好

始终支持 `prefers-reduced-motion`：

```css
@media (prefers-reduced-motion: reduce) {
  .animated {
    animation: none !important;
    transition: none !important;
  }
}
```

### 3. 对比度检查

使用 token 系统确保对比度达标：

```css
/* ✅ 自动达标 - 对比度 7.8:1 */
color: var(--text-secondary);
background: var(--surface-paper);

/* ❌ 需要手动检查 */
color: #8a867d;
background: #f2eee4;
```

### 4. ARIA 标签

```tsx
<button
  aria-busy={isLoading}
  aria-disabled={isDisabled}
  aria-label="删除项目"
>
  删除
</button>

<input
  aria-describedby={error ? "error-message" : undefined}
  aria-invalid={Boolean(error)}
/>

{error && (
  <p id="error-message" role="alert">
    {error}
  </p>
)}
```

---

## 性能优化建议

### 1. 使用固定值而非流式值

```css
/* ❌ 每次渲染都计算 */
padding: clamp(2rem, 5vw, 5rem);

/* ✅ 使用固定 token */
padding: var(--space-12);  /* 48px */
```

### 2. 避免复杂选择器

```css
/* ❌ 性能差 */
.parent > div:nth-child(5n + 1) .child::before {
  /* ... */
}

/* ✅ 使用语义化类名 */
.leadCard {
  /* ... */
}
```

### 3. 使用 CSS containment

```css
.card {
  contain: layout style paint;
}
```

---

## 常见问题

### Q: 为什么颜色都变了？

A: 新的颜色系统符合 WCAG AA 标准，所有文本颜色对比度都 ≥ 4.5:1。这确保了更好的可访问性。

### Q: 为什么项目卡片不再有大小差异？

A: 5n+1 的"lead piece"布局在用户研究中发现容易造成混淆。新布局采用统一卡片尺寸，符合用户期望。

### Q: 如何添加新的 token？

A: 编辑 `apps/web/src/styles/design-system.css`，遵循现有命名规范：

```css
/* 颜色 - 语义化命名 */
--color-new-semantic: #hex;

/* 间距 - 数字后缀 */
--space-new: 40px;

/* 其他 - kebab-case */
--new-token-name: value;
```

### Q: 旧组件还能用吗？

A: 可以。旧组件保持不变，新组件使用 `-redesign` 后缀。你可以渐进式迁移。

---

## 下一步

1. **启动开发服务器**：
   ```bash
   cd apps/web
   npm run dev
   ```

2. **查看新界面**：
   - 登录页：http://localhost:3000/login
   - 项目库：http://localhost:3000/

3. **阅读完整文档**：
   - `FRONTEND_REDESIGN_SUMMARY.md` - 完整修复清单

4. **后端集成**：
   - 实现 `ProjectMetadata` 数据库支持
   - 添加元数据筛选 API

5. **逐步迁移**：
   - 先迁移新功能
   - 再逐步替换旧组件
   - 保持向后兼容

---

## 支持

如有问题，请参考：
- 设计系统：`apps/web/src/styles/design-system.css`
- 组件示例：`apps/web/src/modules/projects/*-redesign.*`
- 类型定义：`apps/web/src/modules/projects/project-types.ts`
