---
name: Atelier 设计工作室 · 织物档案
description: 用户选定 A 后的生产视觉系统：深青绿目录、暖白工作面、完整服装与可追溯修订。
colors:
  image-stage-background: '#e7e9e2'
  canvas: '#f5f4ee'
  paper: '#fffefa'
  surface: '#f7f8f2'
  overlay: '#eef1e9'
  control-border: '#7c8d81'
  disabled-bg: '#f5f5f5'
  disabled-ink: '#6a6a6a'
  disabled-border: '#d7d7d7'
  studio-canvas: '#d7d7d7'
  studio-canvas-edge: '#d7d7d7'
  ink: '#20332e'
  ink-secondary: '#586a60'
  ink-tertiary: '#627167'
  action: '#286452'
  action-hover: '#1c4c3d'
  action-active: '#183f35'
  action-on: '#ffffff'
  action-subtle: '#f0f4ea'
  selection-bg: '#e7eee2'
  selection-ink: '#1c4c3d'
  selection-border: '#286452'
  focus-ring: '#2b7058'
  brand: '#286452'
  brand-hover: '#1c4c3d'
  brand-bg: '#e7eee2'
  border: '#d8ddd3'
  border-strong: '#a6b2a7'
  divider: '#e0e4db'
  scrim: rgba(24, 24, 24, 0.72)
  scrim-soft: rgba(24, 24, 24, 0.48)
  canvas-dot: rgba(24, 24, 24, 0.12)
  inverse: '#2b2b2b'
  inverse-hover: '#181818'
  on-inverse: '#ffffff'
  status-success: '#4a6b57'
  status-success-bg: '#effbf5'
  status-warning: '#8c5831'
  status-warning-bg: '#fff6eb'
  status-error: '#b92727'
  status-error-bg: '#ffebed'
  status-info: '#1c4c3d'
  status-info-bg: '#e7eee2'
  status-running: '#1c4c3d'
  status-running-bg: '#e7eee2'
  swatch-wool: '#8c9199'
  swatch-wool-wash: '#e4e6e9'
  swatch-linen: '#b09a78'
  swatch-linen-wash: '#ede5d8'
  swatch-madder: '#a85846'
  swatch-madder-wash: '#f0ddd6'
  swatch-indigo: '#55647a'
  swatch-indigo-wash: '#dde1e8'
  swatch-turmeric: '#c29b3e'
  swatch-turmeric-wash: '#f2e7cb'
  swatch-sage: '#8a927f'
  swatch-sage-wash: '#e5e8e0'
  swatch-mauve: '#68586f'
  swatch-mauve-wash: '#e6e0e9'
  workflow-edge-input: '#415879'
  workflow-edge-reference: '#7a5e32'
  workflow-edge-result: '#61476c'
  navigation: '#183f35'
  navigation-ink: '#f2f6ec'
  navigation-muted: '#c2d6c9'
  navigation-hover: '#234c40'
  navigation-selected: '#315d4e'
  navigation-border: '#426557'
typography:
  headline:
    fontFamily: '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", -apple-system, system-ui, sans-serif'
    fontSize: 32px
    fontWeight: 600
    letterSpacing: -0.02em
  title:
    fontFamily: '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", -apple-system, system-ui, sans-serif'
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
  section:
    fontFamily: '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", -apple-system, system-ui, sans-serif'
    fontSize: 20px
    fontWeight: 600
  body:
    fontFamily: '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", -apple-system, system-ui, sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", -apple-system, system-ui, sans-serif'
    fontSize: 12px
    fontWeight: 400
  brand:
    fontFamily: '"Palatino Linotype", Palatino, "Book Antiqua", "Songti SC", "Noto Serif SC", "Source Han Serif SC", serif'
    fontSize: 38px
    lineHeight: 1
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '10': 40px
  '12': 48px
  '16': 64px
  '20': 80px
components:
  button-primary:
    backgroundColor: '{colors.action}'
    textColor: '{colors.action-on}'
    rounded: '{rounded.md}'
    typography: '{typography.body}'
    padding: 8px 12px
  button-primary-hover:
    backgroundColor: '{colors.action-hover}'
  button-primary-active:
    backgroundColor: '{colors.action-active}'
  button-secondary:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: 8px 12px
  button-ghost:
    backgroundColor: transparent
    textColor: '{colors.ink-secondary}'
    rounded: '{rounded.md}'
    padding: 8px 12px
  button-danger:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.status-error}'
    rounded: '{rounded.md}'
    padding: 8px 12px
  button-disabled:
    backgroundColor: '{colors.disabled-bg}'
    textColor: '{colors.disabled-ink}'
  input:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    typography: '{typography.body}'
    padding: 8px 12px
  badge:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink-secondary}'
    rounded: '{rounded.sm}'
    typography: '{typography.label}'
    padding: 3px 8px
  navigation:
    backgroundColor: '{colors.navigation}'
    textColor: '{colors.navigation-muted}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: 10px 12px
  planning-card:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: 16px
  segment-selected:
    backgroundColor: '{colors.selection-bg}'
    textColor: '{colors.selection-ink}'
    rounded: '{rounded.md}'
    padding: 4px 12px
  project-record:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
---

# Design System: Atelier 设计工作室 · 织物档案

## Overview

**Creative North Star: "织物档案"**

本系统记录用户选定 A「织物档案」后落地的生产界面。深青绿目录提供稳定位置，暖白纸面承托工作内容，服装与素材保持自身颜色和完整轮廓。中文无衬线、清楚的对象名称、已保存修订和紧凑索引共同支持持续创作。

这是专业设计工具的工作世界：作品、当前任务和可执行的下一步优先；模块之间延续同一项目与对象。层级依靠表面、细线、字号和留白，材料投影仅服务作品与素材，交互动画用于回应状态变化。

**Key Characteristics:**

- 深青绿单列目录与暖白工作面。
- 动作、选择、焦点、状态和品牌分别命名。
- 作品保持原比例；对象名称与已保存修订随任务保留。
- 桌面稳定目录、手机单行导航与按需展开工具。

证据优先级为当前生产源码、生产复核、方向记录。唯一运行时主题 `src/styles/design-system.css` 由 `src/app/globals.css` 导入；`src/app/layout.tsx` 加载 globals 与 tldraw 样式。`AppHeader.tsx` 已代理 `ArchiveNavigation.tsx`，未导入的旧 `app-header.module.css` 不代表现行导航。历史系统已归档至 `../../doc/impeccable/现行浅色设计基线.md` 与同名 JSON。

方向依据 `PRODUCT.md`、`../../doc/impeccable/设计契约.md`、`.impeccable/surfaces/redesign-comparison.md`。生产复核见 `../../output/impeccable-redesign/production-finish-review/review.md` 与 `verdict-1.md`；后者确认原四项修复 resolved、ship 仅覆盖该批修复，不等于重新运行全平台验收。本次文档提取未重跑 detector、浏览器或业务测试。

前置 YAML 是已落地 token 的规范快照；运行时仍以 CSS 为准。`colors` 对应 `--color-<name>`，`swatch-*` 与 `image-stage-background` 对应同名变量；`rounded` 对应 `--radius-*`，`spacing` 对应 `--space-*`。未将所有声明过的超大字号固化为页面规范；sidecar 只扩展预览、来源、阴影、动效和断点。

## Colors

深青绿组织位置与操作，暖纸与墨绿文字承担长时间阅读，素材颜色保持真实。

### Primary

- **档案深绿**（`navigation` 系列）：全局目录底色、目录文字、hover 与当前项分别命名。
- **操作青绿**（`action` 系列）：保存、提交等主操作；hover、active 独立。
- **浅绿选择**（`selection-*`）：对象、分段控件和页签的选择状态，结合轮廓、内描边或侧线。
- **焦点青绿**（`focus-ring`）：浅色工作面的键盘定位；深绿目录使用 `navigation-ink` 焦点轮廓。
- **品牌青绿**（`brand` 系列）：保留独立语义，当前数值与动作/选择相关色相同。

### Secondary

- **材料色板**（`swatch-*`）：羊毛、亚麻、茜草、靛蓝、姜黄、鼠尾草、紫草及其 wash，仅承担素材角色和色卡。`workflow-edge-*` 是连线专用深色，不是全局动作色。

### Neutral

- `canvas` / `paper` / `surface` / `overlay` 区分页面、操作面板和次级表面；`studio-canvas` 与 `image-stage-background` 分别承托流程画布和图像工作区。
- `ink`、`ink-secondary`、`ink-tertiary` 区分正文、说明与元数据；控件边界与分割线分别使用 `control-border`、`border`、`divider`。
- `disabled-*` 使用独立禁用值；`scrim*` 用于遮罩。共享 Tooltip 实际使用 `ink` 与 `paper`，不能把 `inverse` 的声明当作 Tooltip 计算值。
- `status-success`、`status-warning`、`status-error`、`status-info`、`status-running` 及其 bg 是语义状态；图形与文本共同说明状态。

**The Semantic Separation Rule.** 动作、选择、焦点、品牌和状态使用各自语义变量；颜色相同也不合并用途。

Sidecar 的八级 tonalRamp 是合成 OKLCH 色板预览，非新增生产 token，也不代表已完成对比度验证。

## Typography

**Body Font:** YAML `body.fontFamily` 保留 Inter / 中文无衬线 / 系统回退栈。**Brand Font:** `brand.fontFamily` 保留 Palatino / 宋体栈，仅目录斜体 a 标识采用该品牌角色；品牌名称为无衬线。**Label/Mono Font:** 普通标签仍用无衬线，局部状态及统计用 `--font-mono`（SF Mono、JetBrains Mono、Consolas、Liberation Mono、Menlo）。未导入的旧字体文件不构成新增字体依赖。

### Hierarchy

- **Headline:** 项目库页标题使用 YAML headline（32px、600、紧字距）；这是工作标题，不另造展示型大字层级。
- **Title:** WorkspaceHeader 和 Studio 模块标题使用 title（24px、600、1.3）。
- **Section:** Studio 区块标题使用 section（20px、600）。
- **Body:** body（14px、400、1.5）；较大正文/对象名使用现有 16px 档。
- **Label:** label（12px、400）；用作元信息与状态文字，不升格为标题前眉题。

当前 `--font-medium` 实际也是 400，不能按名称推断为 500。WorkspaceHeader 说明最长 64ch，EmptyState 说明最长 44ch。手机及 any-pointer: coarse 的文字输入强制 16px。桌面目录 a 标识 38px，窄屏目录隐藏品牌；不把品牌字号推广为正文。

## Layout

- 桌面全局目录宽 204px，fixed 占满 100dvh、纵向可滚动；app-root 留同宽左侧空间。项目、工作台、资料及工作室共享此目录，工作室功能嵌入目录，不再叠加第二列全局侧栏。
- ≤767px 目录回到正常流，单行结构为 44px 导航/账户触控区加上下各 10px，常规高度 64px；品牌与目录内的资料/功能分组隐藏，导航必要时横向滚动。工作室在内容区显示当前功能选择器。768–1023px 保留全局目录，隐藏该重复选择器。
- 全局内容上限 token 为 1600px；页边距默认 32px，≥1600px 为 48px，≤767px 为 16px。Studio 主区桌面左右 24px，≤1023px 采用 page-gutter。局部工作区仍依据自身任务排布。
- 项目列表为单列档案行：桌面 200px 作品列与可伸缩资料列，手机作品列 96px。继续操作保留在资料区；服装封面 contain，手机资料允许换行。
- 技术包 ≥1200px 采用 200px 对象列加可伸缩表单列，列距 24px。对象列 sticky 距顶 16px，图片区域 260px 高；表单、交接说明、复核与保存导出依次正常流排列。1024px 且高度≥640px 的章节规则保留 flex 方向，但高度 auto、fieldset 不内部裁切；不再约束为固定视口高度。较窄屏回到单列。
- Studio 的部分比较/表单/评审布局在 ≤600px 进一步单列；工作流画布媒体查询及素材工作区容器查询保留局部 760px 断点，均不替代目录的 767px 断点。完整流程画布作为专家入口，图像工作台的手机多行工具头按实际内容高度布局，工具内容从头部之后开始。
- 间距以 4px 基础尺度与 8px 节奏组织；字段通常间隔 16px、区块通常 24px。默认、紧凑、主操作控件最小高度为 36 / 32 / 40px；粗指针统一为 44px。ImagePreview 默认 contain，cover 仅为显式选项。

## Elevation & Depth

**The Domain Depth Rule.** 普通工作面靠表面与细线组织；材料投影属于作品与素材，弹出层使用专用阴影。

精确阴影保存在 sidecar `extensions.shadows`，直接提取唯一主题：none、hairline、ui、material-1/2/3、popup、modal。画布材料保留柔和的多层投影；菜单与 Tooltip 使用 popup，Dialog 使用 modal。源码旧注释曾称暖墨 31,29,26，实际阴影为 24,24,24，以声明值为准。不要因平面工作面而禁止该世界原生的材料投影。

## Shapes

控件为 md 圆角、Badge 为 sm、规划卡和菜单面板为 lg、Dialog 为 xl；full 用于滚动条等胶囊端部。主操作边框与底色同色；规划卡默认细边框、选中时出现轮廓。档案行、章节分隔与可折叠资料均属于系统，不要求所有内容都包成独立卡片。

## Components

### Buttons

`src/components/ui.tsx` 提供 primary / secondary / ghost / danger，默认 secondary；size 为 default / small。共同 padding 见 YAML；small 为 4px 12px，文字仍 14px。Hover 改变表面和边框，primary 有独立 active 色；按下不位移。共享焦点为 2px 轮廓、偏移 3px。禁用使用专用三色；loading 保留名称、禁用点击、设置 aria-busy，300ms 后出现不改变宽度的等待标记。IconButton 要求 label。

### Inputs / Fields

Input、Select、Textarea 共用纸面、控件边界、md 圆角与 body 字体；textarea 可纵向缩放、行高 1.65。aria-invalid 切换错误边框；Field 的错误优先于 hint 并用 role=alert。disabled 保留可读文字，错误和重试对应真实请求状态。

### Chips / Status

Badge 的 neutral / success / warning / error / info / running 结合轮廓 SVG 与文字；Notice 的 error 使用 role=alert，其余 role=status。只读状态标签不模拟可点击 hover。SegmentedControl 使用 aria-pressed 和选中内描边，左右键切换并移动焦点。

### Cards / Containers

规划卡为纸面 lg 圆角、16px padding、12px 内间距，选中为 2px 焦点色轮廓。项目档案行保留完整服装、项目资料及继续入口。共享 ActionBar 只负责状态与操作布局；不能自行推断保存或生成行为。

### Navigation

`ArchiveNavigation` 是现行共享目录。无项目时显示项目库/面料库/趋势档案；项目内显示项目库/设计工作台/款式与交付，资料库在 disclosure 中，资源页保留当前位置及返回上下文。全局当前项使用 aria-current=page、浅亮字、深绿选中底与 600 字重；工作室当前功能另加内侧线，键盘焦点用亮色轮廓。11 个工作室模块共享同一目录、对象语境及 `studio.module.css`：开始任务、款式档案、技术包、色料实验、印花工作台、商品展示、系列规划、样衣反馈、团队评审、趋势简报、品牌资料。

Tabs 手动激活：方向键/Home/End 移焦，不自动启动昂贵面板；TabPanel 用 hidden 控制。Studio 的窄屏功能选择器与桌面目录保持同一 tab 值，不另造 URL 协议。

### Dialog / Menu / Tooltip

Dialog 使用原生 showModal、初始焦点、Tab 约束、Escape 关闭和触发焦点恢复；最大尺寸扣除视口边距与安全区。未保存确认框宽度为 min(480px, 100vw - 32px)，内边距 24px，继续编辑与丢弃并离开分开。Menu 使用 details，外部点击/选择关闭、Escape 返回 summary、方向键遍历。Tooltip 键盘立即显示，鼠标等待 180ms、关闭延迟 120ms；触摸不触发 hover 提示，原生 dialog 内使用同一模态层。

### StudioWorkspace / Loading / Motion

完整流程画布在低缩放时将端口命中区置于节点外，视觉连接点仍贴节点边缘；选中连线临时提升绘制层，使重连手柄可拖动，不改变节点与连线的常态层级。

StudioWorkspace 区分首次 Skeleton、错误 Notice、不可打开 EmptyState、数据内容、刷新中和只读；离开脏草稿走 guard。技术包人工复核缺项有定位入口；异步导出排队后可以离开，不能把草稿保留描述为持久保存。

共享状态过渡主要改变颜色、背景与边框：fast 140ms、normal 180ms、result 280ms、instant 90ms。ui.module.css 未显式指定 easing 的过渡使用 CSS 默认 ease，不虚报为 standard。JS motionDuration 从 CSS 读取并响应 reduced-motion；事件驱动装饰时间轴及兼容周期见 sidecar，不强制每个表面播放。busyMark 的 1.2s 呼吸及 revisionSaved 均有减弱动态分支；根 reduce 归零核心 duration 与 AI 周期，但不能据此声称所有 motion-* 都自动归零。

## Do's and Don'ts

### Do:

- Do 从 `src/styles/design-system.css` 读取现行语义变量；兼容别名只用于延续旧调用。
- Do 复用同一目录和共享控件；保持当前项目、对象名称和已保存修订可定位。
- Do 在选中、运行、失败和只读状态保留文字、标记或图形；复用已有重试和未保存保护。
- Do 保留键盘焦点、原生弹窗焦点返回、触控尺寸与减弱动态分支。
- Do 让长表单和交接说明参与正常文档流；宽屏对象列可 sticky，不能以固定高度挤压复核控件。

### Don't:

- Don't 把归档的旧浅色/深色主题、未导入样式或候选 B/C 当作生产规范。
- Don't 用错误色覆盖作品图片，或用裁切隐藏需要核对的服装轮廓。
- Don't 将微标签、标题眉题和字符图标等遗留问题复制为新的系统规范。
- Don't 把 fixture 截图、模拟生成或导出状态当作真实模型、队列和用户验证证据。

**未规范化、未修复：** 源码仍有旧配色/字体注释、未导入的旧导航样式与遗留 micro-label/eyebrow 类定义，均不作为新规范；类存在不等于现行页面仍渲染眉题。已复核删除的四处冗余眉题和修复的复核布局不作为遗留缺陷重复登记。局部媒体断点不是新的全局尺度。此文档不证明全平台运行测试、真实模型质量、完整可访问性或真实设计师效率。
