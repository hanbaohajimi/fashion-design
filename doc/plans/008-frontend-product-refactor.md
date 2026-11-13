# 产品级前端重构计划

> 作者：Claude Code Sonnet 5.5 / 日期：2026-11-13
> 状态：APPROVED — 待执行
> 决策：只读发现页 · 保留升级暖白+深绿 · 工作区对话优先重排 · 保留 tldraw 引擎

---

## Context

**为什么做**：当前平台核心能力完整（AI 对话、画布、Studio、趋势、导出、系列 DNA），但用户理解价值慢、起步路径长、工作区 AI 助手是隐藏侧边抽屉。首页登录后直接进项目列表，新用户缺少价值感知；导航随 projectId 动态增删三项，认知不稳定；发现页是外部链接列表，缺乏内部闭环；样式体系有两套 button/skeleton/spinner 和四份 EmptyState 变体。

**目标**：让用户更快理解平台价值 → 更快开始创作 → 更顺畅完成核心任务。

**参考逻辑**（不复制视觉）：
- Lovart.ai：对话式创作起步、Quick Start、画布工作区左中右布局
- LibTV：内容发现分类搜索、以内容为起点行动的闭环

---

## 阶段总览

| 阶段 | 范围 | 优先级 | 预计文件数 |
|------|------|--------|-----------|
| P0 设计系统统一 | token + 原语组件 | 地基 | ~8 |
| P1 信息架构与导航 | ArchiveNavigation + WorkspaceChrome | 高 | ~3 |
| P2 首页重构 | PublicLanding + ProjectLibrary | 高 | ~4 |
| P3 对话式创作入口 | ConversationalStarter 新组件 | 高 | ~3 |
| P4 工作区对话优先重排 | WorkflowCanvas 布局 | 高 | ~4 |
| P5 项目与资产 | ProjectDetailPage + AssetCenter | 中 | ~4 |
| P6 发现页重构 | trends/page.tsx + TrendArchive | 高 | ~4 |
| P7 Studio 导航收敛 | StudioNavigation | 中 | ~2 |
| P8 反馈系统统一 | loading/empty/error/toast | 中 | ~5 |

---

## P0：设计系统统一

**目标**：消除样式分裂，建立统一组件原语，让所有后续阶段有稳定地基。

### 0.1 清理归档文件

以下文件已标注归档，从 `globals.css` / `app/layout.tsx` 导入链中确认未引用后，整体移入 `src/styles/archive/`（不删除，保留历史）：

- `apps/web/src/styles/design-tokens-light.css`（旧橙红体系，`--accent: #E9522C`，与当前深绿冲突）
- `apps/web/src/styles/design-tokens.css`（V2，同上）

### 0.2 升级 design-system.css

文件：`apps/web/src/styles/design-system.css`

新增/修正以下 token（在 `:root` 末尾添加，不替换现有值）：

```css
/* ── 层级阴影补完（P4 对话面板浮层需要） ── */
--shadow-panel: 0 2px 8px rgba(24,24,24,0.08), 0 1px 2px rgba(24,24,24,0.04);
--shadow-panel-raised: 0 4px 20px rgba(24,24,24,0.12), 0 2px 4px rgba(24,24,24,0.06);

/* ── 对话面板专用表面（比 paper 略深，区分于画布） ── */
--color-chat-surface: oklch(97% 0.007 100);
--color-chat-input-bg: var(--surface-3);
--color-chat-bubble-user: var(--color-brand-bg);
--color-chat-bubble-ai: var(--surface-3);

/* ── 发现页卡片悬停 ── */
--color-discovery-hover: oklch(96.5% 0.009 100);

/* ── 创作起步输入框（比普通 input 更突出） ── */
--color-starter-border: var(--color-border-strong);
--color-starter-focus-bg: var(--surface-3);
--shadow-starter-focus: 0 0 0 3px color-mix(in srgb, var(--color-focus-ring) 18%, transparent);
```

同时修正字号体系（当前 xs/sm/base/lg 都只有 12/14/16/24px 四档，别名过多导致混乱）：

```css
/* 明确语义档，废弃多余别名 */
--text-xs:   12px;   /* 辅助说明、微标签 */
--text-sm:   13px;   /* 次要文字（新增 13px 过渡档） */
--text-base: 14px;   /* 正文主力 */
--text-lg:   16px;   /* 触控输入、标题级 */
--text-xl:   20px;   /* 模块标题（新增） */
--text-2xl:  28px;   /* 页面主标题（升级，原 24px 不够大） */
--text-3xl:  36px;   /* Hero 文字（新增，给 Landing/发现页用） */
```

### 0.3 收敛 components.css

文件：`apps/web/src/styles/components.css`

**方案**：不删除文件（影响面大），改为在文件顶部添加 `/* DEPRECATED */` 注释，并将所有引用旧 token（`--color-signal`、`--surface-elevated`、`--accent-primary`）的规则，用 `:root` 兼容别名已经覆盖的值来验证是否实际生效。

具体操作：搜索 `components.css` 中的以下类，确认在 `ui.module.css` 中已有对等实现后，在 `components.css` 中注释掉（不删除）：
- `.button-primary` / `.button-secondary` / `.button-ghost`（对应 `ui.module.css` 的 `[data-variant]`）
- `.spinner`（对应 `ui.module.css` 的 `.feedbackSpinner`）
- 重复的 `.skeleton`（保留 `ui.module.css` 版本）

### 0.4 统一 EmptyState

文件：`apps/web/src/components/ui.tsx`（已有 `SharedEmptyState`）

在 `ui.tsx` 中导出 `EmptyState` 名称，参数与 `SharedEmptyState` 一致：

```tsx
export { SharedEmptyState as EmptyState };
export type { SharedEmptyStateProps as EmptyStateProps };
```

然后修改以下文件，将本地 EmptyState 替换为从 `../../components/ui` 导入的 `EmptyState`：
- `apps/web/src/modules/projects/EmptyState.tsx`（转为 re-export 或直接删除）
- `apps/web/src/modules/board/workflow/WorkflowCanvas.tsx` 中的 EmptyState 引用

### 0.5 登录页 CSS 合并

文件：
- `apps/web/src/app/(auth)/login/login.module.css`
- `apps/web/src/app/(auth)/login/forest-login.module.css`

读取两个文件，找出重叠的类，合并为一个 `login.module.css`，删除 `forest-login.module.css`，更新 `page.tsx` 导入。

---

## P1：信息架构与导航

**目标**：导航固定 5 项，不随 projectId 变化；收敛新建入口。

### 1.1 重构 ArchiveNavigation

文件：`apps/web/src/components/ArchiveNavigation.tsx`

**现状问题**：`entries` 数组在有 `projectId` 时动态插入「设计工作台」和「款式与交付」，导致用户每次进出项目，导航项目数量在 3 和 5 之间跳变。

**新方案**：导航固定 5 项，项目内二级导航用项目页内部 tab 实现。

新的 `entries` 数组：
```tsx
const entries: { id: ArchiveSection; title: string; href: string; icon: string }[] = [
  { id: "projects", title: "项目",   href: "/",           icon: "projects" },
  { id: "discover", title: "发现",   href: "/trends",     icon: "discover" },
  { id: "fabrics",  title: "面料库", href: `/fabrics${context}`, icon: "fabrics" },
  { id: "assets",   title: "资产",   href: "/assets",     icon: "assets" },   // P5 新增页面
];
```

同时：
- `ArchiveSection` type 移除 `design` / `studio`，新增 `discover` / `assets`
- 移除「新建项目」快捷按钮，改为在首页内提供
- compact 模式下底部新增「+ 新建」浮动按钮（移动端主操作）

**新增 NavigationIcon svg** 对应 `discover`（眼睛/指南针）和 `assets`（层叠图片）：

```tsx
} : name === "discover" ? (
  <>
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
  </>
) : name === "assets" ? (
  <>
    <rect x="3" y="7" width="13" height="13" rx="2"/>
    <path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
  </>
) : (
```

### 1.2 WorkspaceChrome 移动端主操作

文件：`apps/web/src/components/WorkspaceChrome.tsx`

在 `<1200px` 时，在 WorkspaceChrome 底部渲染一个固定底部操作条：

```tsx
// 仅在非工作台页面（kind === "document"）显示
{compact && kind === "document" && (
  <div className={styles.mobileBottomBar}>
    <a href="/?new=1" className={styles.mobileNewButton}>
      <span>+ 新建</span>
    </a>
  </div>
)}
```

---

## P2：首页重构

**目标**：已登录用户快速续创；未登录用户快速理解平台价值。

### 2.1 ProjectLibrary 顶部区域重构

文件：`apps/web/src/modules/projects/ProjectLibrary.tsx`

在工具栏（搜索+状态筛选）**之上**，插入：

**① 续创入口**（仅有至少 1 个项目时显示）：

从 `useProjects` 结果取最近活跃项目（第一条），渲染：

```tsx
{projects.length > 0 && (
  <ResumeCard project={projects[0]} />
)}
```

`ResumeCard` 组件（新建于同目录）：显示项目封面图（`coverAssetId` 对应缩略图）、项目名、最后修改时间，右侧「继续创作 →」按钮，点击进入 `/${project.id}`。

**② ConversationalStarter（P3 组件）**：

```tsx
<ConversationalStarter
  onProjectCreated={(id) => router.push(`/${id}`)}
/>
```

**③ Quick Start 卡片**：保留现有 `QUICK_STARTS` 3 张卡片，但视觉改为横向滚动行（desktop 固定 3 列，移动端横向溢出滚动）。

**④ 项目网格**：移除顶部「项目库」大标题（信息重复），保留搜索+筛选工具栏 + `ProjectGrid`。

### 2.2 PublicLanding 重构

文件：`apps/web/src/modules/projects/PublicLanding.tsx`

读取现有文件内容后，重构为以下结构：

```
<section> Hero：「从灵感到交付的服装设计工作室」大标题 + 副标题 + 单 CTA「立即开始，免费使用」
<section> 三步流程：「描述想法 → AI 生成方案 → 整理交付」三列说明
<section> 能力矩阵：6 个工具卡（画布、系列 DNA、款式档案、趋势库、面料库、导出）
<section> Quick Start：三个示例 + 「立即试用」按钮
```

Hero 标题使用 `--text-3xl`（36px），配合现有暖白背景。CTA 按钮使用 `Button variant="primary" size="large"`（需在 ui.tsx 中支持 size="large" → 48px 高）。

---

## P3：对话式创作入口

**目标**：新建项目从「填表单」变成「说一句话」。

### 3.1 新建 ConversationalStarter 组件

文件：`apps/web/src/modules/projects/ConversationalStarter.tsx`（新建）

```tsx
// 对话式起步入口：一行输入 + 模板 chips + 参考图上传 → 创建项目并带 briefing 进入工作区
export function ConversationalStarter({
  onProjectCreated,
}: {
  onProjectCreated: (projectId: string) => void;
}) { ... }
```

UI 结构：
1. 大输入框（`<textarea>` 或 `contentEditable div`），placeholder：`「想做一组秋冬系列，主材羊毛，参考 Loewe 的松弛感…」`
2. 输入框下方 Chips（点击填充模板）：「做一个系列」「从面料出发」「视觉提案」「从趋势开始」
3. 输入框右侧图标按钮：上传参考图（触发 file input → 上传后作为 boardElement）
4. 发送按钮（Enter 或点击）

**数据流**：

```
用户输入文字 → useCreateProject().mutateAsync({name, briefing: input}) 
→ 创建成功后 router.push(`/${id}?starter=conversational`)
→ board 页读取 starter param → 展开助手面板 + 预填 briefing
```

样式文件：`ConversationalStarter.module.css`（新建），使用 `--color-starter-border`、`--shadow-starter-focus` token（P0 中新增）。

### 3.2 BoardPageClient 读取 starter param

文件：`apps/web/src/app/[projectId]/BoardPageClient.tsx`

在 `WorkflowCanvas` props 中传入 `initialAssistantOpen`：

```tsx
const starterParam = searchParams.get("starter");
// starter=conversational 时打开助手面板，starter=collection/material/lookbook 时带预填提示
<WorkflowCanvas
  ...
  initialAssistantOpen={!!starterParam}
  initialBriefingPrompt={briefingPromptForStarter(starterParam)}
/>
```

`WorkflowCanvas` 已有 `WorkflowAssistantPanel` 的 `sidebarOpen` 状态，只需在初始化时 `setSidebarOpen(true)` 并预填消息。

---

## P4：工作区对话优先重排

**目标**：左侧对话/任务流 + 中央画布 + 右侧可折叠检查器；新项目默认展开对话。

**核心约束**：
- 保留 tldraw 引擎，不修改任何 Shape/Tool 逻辑
- 保留保存逻辑（`useBoardPersistence`、`useCanvasPersistence`）
- 保留 `WorkflowAssistantPanel`（已有 SSE 对话，直接复用）
- 只改布局和初始状态

### 4.1 WorkflowCanvas 布局重构

文件：`apps/web/src/modules/board/workflow/WorkflowCanvas.tsx`

**当前布局**：画布全屏，助手面板作为右侧抽屉（`position: fixed`）overlay 在画布上方。

**新布局**：三列 flex 容器，左侧对话面板 + 中央画布 + 右侧检查器（已有 `WorkflowProjectPanels`）。

布局 CSS（在 `workflow-canvas.module.css` 中新增）：

```css
.boardLayout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.chatPanel {
  width: 320px;
  min-width: 280px;
  max-width: 400px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: var(--border-hairline) solid var(--color-border);
  background: var(--color-chat-surface);
  /* 可通过拖拽调整宽度，使用 react-resizable-panels */
}

.chatPanelCollapsed {
  width: 44px;
  min-width: 44px;
}

.canvasArea {
  flex: 1;
  position: relative;
  min-width: 0;
}

.inspectorPanel {
  width: var(--inspector-width, 320px);
  flex-shrink: 0;
  border-left: var(--border-hairline) solid var(--color-border);
}

/* 移动端：画布全屏 + 底部可拖拽抽屉 */
@media (max-width: 1199px) {
  .boardLayout { flex-direction: column; }
  .chatPanel { 
    position: fixed; bottom: 0; left: 0; right: 0;
    width: 100%; max-width: 100%;
    height: 60%;
    border-right: none;
    border-top: 1px solid var(--color-border);
    transform: translateY(calc(100% - 56px));
    transition: transform var(--motion-sheet-enter) var(--ease-drawer);
  }
  .chatPanel[data-open="true"] { transform: translateY(0); }
}
```

JSX 重构：

```tsx
// WorkflowCanvas return
return (
  <div className={styles.boardLayout}>
    {/* 左侧对话面板 */}
    <div
      className={`${styles.chatPanel} ${!sidebarOpen ? styles.chatPanelCollapsed : ""}`}
      data-open={sidebarOpen}
    >
      <ChatPanelHeader
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(v => !v)}
      />
      {sidebarOpen && (
        <WorkflowAssistantPanel
          projectId={projectId}
          conversationId={conversationId}
          initialPrompt={initialBriefingPrompt}
          onClose={() => setSidebarOpen(false)}
          // 以下已有 props，直接传递：
          referenceRequest={referenceRequest}
          onReferenceConsumed={() => setReferenceRequest(null)}
        />
      )}
    </div>

    {/* 中央画布 */}
    <div className={styles.canvasArea}>
      <AtelierTopBar ... />
      {/* tldraw canvas — 不动 */}
      <Tldraw ... />
      <BoardActionPanels ... />
    </div>

    {/* 右侧检查器 —— 仅有选中节点时显示 */}
    {selectedNodeId && (
      <div className={styles.inspectorPanel}>
        <WorkflowProjectPanels ... />
      </div>
    )}
  </div>
);
```

### 4.2 新建 ChatPanelHeader 组件

文件：`apps/web/src/modules/board/workflow/ChatPanelHeader.tsx`（新建）

折叠时显示一列图标（对话、任务数）；展开时显示「AI 助手」标题 + 收起按钮。

```tsx
export function ChatPanelHeader({
  open,
  onToggle,
  taskCount = 0,
}: {
  open: boolean;
  onToggle: () => void;
  taskCount?: number;
}) { ... }
```

### 4.3 空画布引导

文件：`apps/web/src/modules/board/workflow/WorkflowCanvas.tsx`

当 `nodes.length === 0`（空画布）且 `!initialAssistantOpen` 时，在画布中央渲染引导占位：

```tsx
{nodes.length === 0 && !sidebarOpen && (
  <div className={styles.emptyCanvasHint}>
    <p>从左侧助手开始描述设计想法，或直接拖拽素材到画布</p>
    <Button variant="primary" onClick={() => setSidebarOpen(true)}>
      开始对话
    </Button>
  </div>
)}
```

---

## P5：项目与资产

**目标**：项目详情概览；资产版本/血缘/决策可视化。

### 5.1 项目内二级导航

新建文件：`apps/web/src/modules/projects/ProjectTabNav.tsx`

在 `[projectId]/page.tsx`（BoardPageClient 外层）加入项目内 tab 导航：

```tsx
// tab: 工作台（board）/ 款式与交付（studio）/ 资产（assets）
<ProjectTabNav projectId={projectId} current="board" />
```

这取代了 ArchiveNavigation 中动态插入的两项。

### 5.2 资产中心页

新建文件：`apps/web/src/app/assets/page.tsx`

调用 `GET /api/design-assets/:id/versions` 和 `GET /api/design-assets/:id/path`，渲染：
- 顶部统计（总资产数、本周生成数）
- 资产卡片网格（按项目分组，或平铺+搜索）
- 点击资产 → 侧边 Drawer 显示版本历史、血缘路径（`DesignPathView`）、决策记录

**注意**：资产列表端点目前是 `GET /api/design-assets/:id/...`（按 ID 查询），没有全局列表端点。暂时在首期以「每个项目的资产」形式呈现，从 `useProjects` 结果中导航到具体项目的资产。若需要全局资产列表，后续需后端新增 `GET /api/design-assets?projectId=...` 端点。

---

## P6：发现页重构

**目标**：趋势数据分类可搜索；以趋势为起点闭环创作。

**数据来源**：`GET /api/trends`（已有，返回 `TrendItem[]`，含 `category`、`tags[]`、`platform`）和 `GET /api/trends/digest/current`（周报）。

### 6.1 TrendsPage 重构

文件：`apps/web/src/app/trends/page.tsx`

新布局（server component，保持 async）：

```tsx
export default async function TrendsPage({ searchParams }) {
  return (
    <>
      <AppHeader current="trends" />
      <main className={styles.discoverPage}>
        {/* 趋势周报 Hero — 从 /api/trends/digest/current 读取 */}
        <DigestHero digest={digest} />

        {/* 分类 Chips + 搜索 — 客户端状态，传给 TrendGrid */}
        <TrendGrid
          returnTo={returnTo}
          projectId={boardProjectId}
        />
      </main>
    </>
  );
}
```

### 6.2 新建 DigestHero 组件

文件：`apps/web/src/modules/trends/DigestHero.tsx`（新建）

显示当期趋势周报：主题标题（`digest.theme`）、概览文字（`digest.overview`）、封面趋势卡片。若 `digest` 为 null 则显示静态标题「趋势发现」。

### 6.3 TrendArchive → TrendGrid 重构

文件：`apps/web/src/modules/trends/TrendArchive.tsx`（改造，或新建 `TrendGrid.tsx`）

现状：`TrendArchive` 已调用 `GET /api/trends`，有基础展示。需新增：

**分类 Chips**：从 `trends` 数据中提取 `category` 值去重，渲染可切换的 chip 列表（client state）。

**搜索输入框**：前端过滤 `title` + `tags[]`（无需新 API）。

**卡片设计改进**：
- 每张卡片：封面图（`coverFileId` → `GET /api/boards/trend-assets/:trendItemId` 重定向）+ 标题 + 平台标签 + 发布时间
- 悬停：显示「导入画板」和「以此为起点」两个操作按钮

**「以此为起点创作」**：已有 `POST /api/boards/:boardId/import-trend`（导入为 fashion-note 形状）。  
新增路径：点击「以此为起点」→ `useCreateProject().mutateAsync({name: trend.title})` → 进入新建项目的工作区 → 自动调用 import-trend。

**外部来源**：从 `<details>` 折叠的底部，改为侧边小卡片列表（6 个常用平台），用 Badge 样式区分。

---

## P7：Studio 导航收敛

**目标**：12 个平铺 tab 改为 3 组分组，降低认知负担。

### 7.1 StudioNavigation 重构

文件：`apps/web/src/modules/studio/StudioNavigation.tsx`

**当前 12 个 tab**（3 组）：
- 创作：开始任务 / 款式档案 / 色料实验 / 印花工作台 / 商品展示 / 服装秀
- 交付：系列规划 / 技术包 / 样衣反馈 / 团队评审
- 资料：趋势简报 / 品牌资料

**新方案**：保留 3 组，但每组默认折叠，只展示组标题 + 小图标，点击展开。用 `<details>` / `<summary>` 或受控 state 实现。

```tsx
function NavGroup({ title, tabs, currentTab, onSelect, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.navGroup}>
      <button className={styles.groupHeader} onClick={() => setOpen(v => !v)}>
        <span>{title}</span>
        <ChevronIcon rotated={open} />
      </button>
      {open && tabs.map(tab => (
        <TabItem key={tab.id} tab={tab} active={tab.id === currentTab} onSelect={onSelect} />
      ))}
    </div>
  );
}
```

默认展开当前 tab 所在的组。

**不改变任何 TabPanel 组件、API 调用或数据逻辑。**

---

## P8：反馈系统统一

**目标**：路由 loading 一致、空状态有主操作、错误边界可重试、toast 文案统一。

### 8.1 路由 loading.tsx 统一

现有 4 处 `loading.tsx`：
- `app/[projectId]/loading.tsx`
- `app/[projectId]/studio/loading.tsx`
- `app/review/[token]/loading.tsx`
- `app/share/[token]/loading.tsx`

建立统一 Skeleton 模板 `components/PageSkeleton.tsx`：

```tsx
export function PageSkeleton({ variant }: { variant: "board" | "studio" | "review" }) {
  // 根据 variant 渲染匹配页面最终布局的 skeleton
  // 使用 ui.module.css 的 .skeleton + .skeletonGroup
}
```

各 `loading.tsx` 改为：
```tsx
import { PageSkeleton } from "../../components/PageSkeleton";
export default function Loading() { return <PageSkeleton variant="board" />; }
```

### 8.2 空状态规范

修改 `SharedEmptyState`（在 `ui.tsx`），新增 `action` prop：

```tsx
<EmptyState
  title="还没有项目"
  description="从一个想法或模板开始你的第一个设计"
  action={<Button variant="primary" onClick={...}>新建第一个项目</Button>}
/>
```

现有 `ProjectLibrary` 的空状态已经类似，确认统一使用 `SharedEmptyState`，移除 `modules/projects/EmptyState.tsx` 中的本地实现。

### 8.3 错误边界

文件：`apps/web/src/app/error.tsx`（已有）

在错误边界组件中，确保显示「重试」按钮（`router.refresh()` 或 `reset()` callback），而不是仅显示文字。

### 8.4 Toast 文案规范

文件：`apps/web/src/components/operation-notice.ts`

在此文件中集中定义常见操作的 toast 文案，避免分散在各业务组件中硬编码字符串。需要在重构中查找现有调用 `toast(...)` 的地方，统一通过 `notifyOperation(type, context)` 调用。

---

## 关键复用点

执行时必须复用这些已有实现，不要重写：

| 功能 | 复用位置 |
|------|---------|
| AI 对话 SSE 流 | `modules/board/agent/agent-api.ts` + `WorkflowAssistantPanel.tsx` |
| 项目创建 mutation | `modules/projects/use-projects.ts` → `useCreateProject()` |
| 趋势导入画板 | `modules/trends/trend-api.ts` → `importTrendToBoard()` |
| 画板保存逻辑 | `WorkflowCanvas.tsx` 现有 `useBoardPersistence` |
| 生成任务 SSE | `modules/board/generation/useGenerationSSE.ts` |
| 任务轮询 | `modules/tasks/project-task-source.tsx` |
| 私有 fetch 鉴权 | `modules/auth/private-fetch.ts` |

---

## 执行顺序与依赖

```
P0 (地基) ──► P1 (导航)
                   │
                   ├──► P2 (首页)──► P3 (创作入口)
                   │
                   ├──► P4 (工作区)
                   │
                   ├──► P6 (发现页)
                   │
                   └──► P7 (Studio)──► P8 (反馈)
                              │
                              └──► P5 (资产) [可并行]
```

P5 对后端有轻度依赖（全局资产列表端点），可在最后执行或放到 v2。

---

## 验证清单

每个阶段完成后执行：

```bash
# 类型检查
pnpm --filter @fashion/web typecheck

# 目标文件 lint
pnpm --filter @fashion/web lint -- --file src/components/ArchiveNavigation.tsx

# 相关单元测试
pnpm --filter @fashion/web test -- --reporter=verbose

# 本地开发服务器（手动验证）
pnpm dev
```

手动验证路径：
1. `localhost:3000` → 未登录 → PublicLanding 显示 Hero + 三步流程 + Quick Start
2. 登录后 → `localhost:3000` → 对话起步输入框 + 续创卡 + Quick Start + 项目网格
3. 点击 Quick Start → 创建项目 → 进入工作区 → 左侧对话面板自动展开
4. 在工作区对话输入「做外套系列」→ AI 回复正常（SSE 流）
5. 导航至 `/trends` → 周报 Hero + 分类 Chips + 卡片网格 + 搜索
6. 点击趋势卡片「以此为起点」→ 创建项目并跳转
7. `localhost:3000/fabrics` → 面料库正常（导航变更后确认路由不 404）
8. 移动端（375px 视口）→ Drawer 导航 + 底部新建按钮 + 工作区底部拖拽对话面板
9. Studio 页面 → 3 组折叠导航 + 进入二级 tab 功能正常
10. 断网状态 → 错误边界显示「重试」按钮

---

## 文件变更汇总

### 修改（existing files）

| 文件 | 变更内容 |
|------|---------|
| `apps/web/src/styles/design-system.css` | 新增 token：chat 表面、discovery 悬停、起步输入、字号档扩充 |
| `apps/web/src/styles/components.css` | 注释掉重复 button/spinner/skeleton 类 |
| `apps/web/src/components/ArchiveNavigation.tsx` | 固定 5 项导航，移除动态项目内导航项 |
| `apps/web/src/components/WorkspaceChrome.tsx` | 移动端底部新建浮钮 |
| `apps/web/src/modules/projects/ProjectLibrary.tsx` | 插入 ConversationalStarter + ResumeCard |
| `apps/web/src/modules/projects/PublicLanding.tsx` | 重构为 Hero + 三步 + 能力矩阵 + Quick Start |
| `apps/web/src/modules/projects/EmptyState.tsx` | 改为 re-export SharedEmptyState |
| `apps/web/src/app/[projectId]/BoardPageClient.tsx` | 读取 starter param，传 initialAssistantOpen |
| `apps/web/src/modules/board/workflow/WorkflowCanvas.tsx` | 三列布局 + 空画布引导 + 接受 initialAssistantOpen prop |
| `apps/web/src/app/trends/page.tsx` | 重构为 DigestHero + TrendGrid + 外部平台边栏 |
| `apps/web/src/modules/trends/TrendArchive.tsx` | 新增分类 Chips + 搜索 + 「以此为起点」操作 |
| `apps/web/src/modules/studio/StudioNavigation.tsx` | 折叠分组导航 |
| `apps/web/src/app/error.tsx` | 添加重试按钮 |
| `apps/web/src/components/operation-notice.ts` | 集中文案定义 |

### 新建（new files）

| 文件 | 用途 |
|------|------|
| `apps/web/src/modules/projects/ConversationalStarter.tsx` | 对话式起步输入组件 |
| `apps/web/src/modules/projects/ConversationalStarter.module.css` | 起步组件样式 |
| `apps/web/src/modules/projects/ResumeCard.tsx` | 续创最近项目卡片 |
| `apps/web/src/modules/board/workflow/ChatPanelHeader.tsx` | 对话面板头部（折叠/展开切换） |
| `apps/web/src/modules/trends/DigestHero.tsx` | 趋势周报 Hero 组件 |
| `apps/web/src/modules/projects/ProjectTabNav.tsx` | 项目内二级 tab 导航 |
| `apps/web/src/app/assets/page.tsx` | 资产中心页（P5，可后排） |
| `apps/web/src/components/PageSkeleton.tsx` | 统一路由 loading skeleton |
| `apps/web/DESIGN.md` | 更新设计契约（新增 chat 表面、发现页规范） |

---

*执行时注意：每阶段改完后先 typecheck，再 lint，再手动预览，确认无回归后再进入下一阶段。P4（工作区）改动范围最大，WorkflowCanvas.tsx 近 3000 行，需要分段阅读后再局部修改，不要全文重写。*
