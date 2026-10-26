---
name: 森织设计工作室 · 织物档案
description: 用户选定「织物档案」并确认统一浅色导航后的生产视觉系统：暖白目录、深绿文字、浅绿选中、完整服装与可追溯修订。
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
  studio-work-surface: '#e8eee7'
  studio-reference-surface: '#eee8dc'
  studio-artwork-surface: '#ececea'
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
  navigation: '#fffefa'
  navigation-ink: '#20332e'
  navigation-muted: '#586a60'
  navigation-hover: '#f7f8f2'
  navigation-selected: '#e7eee2'
  navigation-border: '#e0e4db'
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
    fontSize: 24px
    lineHeight: 1.2
  studio-heading:
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.35
  studio-heading-mobile:
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.35
  studio-section:
    fontSize: 18px
    fontWeight: 600
  studio-label:
    fontSize: 14px
    lineHeight: 1.6
  studio-planning-start:
    fontSize: 22px
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
    textColor: '{colors.navigation-ink}'
    typography: '{typography.body}'
    width: 184px
    padding: 20px 12px
  navigation-item:
    backgroundColor: transparent
    textColor: '{colors.navigation-muted}'
    rounded: '{rounded.md}'
    typography: '{typography.body}'
    height: 40px
    padding: 8px 12px
  navigation-selected:
    backgroundColor: '{colors.navigation-selected}'
    textColor: '{colors.selection-ink}'
  planning-card:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: 12px
  segment-selected:
    backgroundColor: '{colors.selection-bg}'
    textColor: '{colors.selection-ink}'
    rounded: '{rounded.md}'
    padding: 4px 12px
  project-record:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
  studio-navigation:
    backgroundColor: '{colors.navigation}'
    textColor: '{colors.ink-secondary}'
    width: 184px
    padding: 20px 12px
  studio-navigation-item:
    backgroundColor: transparent
    textColor: '{colors.ink-secondary}'
    rounded: '{rounded.md}'
    typography: '{typography.body}'
    padding: 4px 12px
  studio-navigation-selected:
    backgroundColor: '{colors.selection-bg}'
    textColor: '{colors.selection-ink}'
---

# Design System: 森织设计工作室 · 织物档案

## Overview

**Creative North Star: "织物档案"**

本系统记录用户选定 A「织物档案」后落地的生产界面，并合并用户于 2026-10-26 选定第二张参考图、推广至全平台的暖白导航。共享目录使用暖白底、深绿文字、浅灰绿当前项与原彩色 Logo，页面切换保持同一外框。暖白纸面承托工作内容，服装与素材保持自身颜色和完整轮廓。中文无衬线、清楚的对象名称、已保存修订和紧凑索引共同支持持续创作。

这是专业设计工具的工作世界：作品、当前任务和可执行的下一步优先；模块之间延续同一项目与对象。层级依靠表面、细线、字号和留白，材料投影仅服务作品与素材，交互动画用于回应状态变化。

**Key Characteristics:**

- 全平台统一暖白单列目录、深绿文字、浅灰绿选中与彩色 Logo。
- 动作、选择、焦点、状态和品牌分别命名。
- 作品保持原比例；对象名称与已保存修订随任务保留。
- 桌面稳定目录与底部账户，窄屏统一工作区菜单栏；工作室保留分组功能选择器与按需编辑。

证据优先级为当前生产源码、生产复核、方向记录。唯一运行时主题 `src/styles/design-system.css` 由 `src/app/globals.css` 导入；`src/app/layout.tsx` 加载 globals 与 tldraw 样式。`AppHeader.tsx` 已代理 `ArchiveNavigation.tsx`，未导入的旧 `app-header.module.css` 不代表现行导航。历史系统已归档至 `../../doc/impeccable/现行浅色设计基线.md` 与同名 JSON。

方向依据 `PRODUCT.md`、`../../doc/impeccable/设计契约.md`、`.impeccable/surfaces/redesign-comparison.md`。生产复核见 `../../output/impeccable-redesign/production-finish-review/review.md` 与 `verdict-1.md`；后者确认原四项修复 resolved、ship 仅覆盖该批修复，不等于重新运行全平台验收。本次文档提取未重跑 detector、浏览器或业务测试。

工作室增量依据 `../../doc/impeccable/工作室子功能设计契约.md` 与当前 `src/modules/studio/`。截图记录位于 `../../output/studio-redesign/review-final/`；该目录是模拟项目的页面采集，不能据此推断真实用户反馈或全套验收通过。

统一导航依据 `../../doc/impeccable/统一浅色导航契约.md`、`ArchiveNavigation` 与当前主题。`../../output/unified-navigation/finish-review.md` 的 ship 仅覆盖统一导航 UI 与指定首屏的 27 张截图；不覆盖登录、流程画布的独立视觉验收、Docker 基线批准或真实业务链路。本次合并仅同步文档与 sidecar，没有重新运行 context、detector、浏览器或应用测试。

前置 YAML 是已落地 token 的规范快照；运行时仍以 CSS 为准。`colors` 对应 `--color-<name>`，`swatch-*`、`studio-*-surface` 与 `image-stage-background` 对应同名变量；`navigation.width` 对应 `--workspace-nav-width`，`--studio-navigation-width` 是它的兼容别名。`navigation-item.height` 记录桌面最小高度，窄屏为触控高度。`rounded` 对应 `--radius-*`，`spacing` 对应 `--space-*`。未将所有声明过的超大字号固化为页面规范；sidecar 只扩展预览、来源、阴影、动效和断点。

## Colors

暖白目录与工作面承托内容，深绿文字和操作维持层级，浅灰绿标记当前项，素材颜色保持真实。

### Primary

- **暖白目录**（`navigation` 系列）：全平台共用目录底色、深绿文字、hover、浅灰绿当前项与分隔线；不再按路由切换深浅主题。
- **操作青绿**（`action` 系列）：保存、提交等主操作；hover、active 独立。
- **浅绿选择**（`selection-*`）：对象、分段控件和页签的选择状态，结合轮廓、内描边或侧线。
- **焦点青绿**（`focus-ring`）：浅色工作面与共享目录的键盘定位。
- **品牌青绿**（`brand` 系列）：保留独立语义，当前数值与动作/选择相关色相同。

### Secondary

- **材料色板**（`swatch-*`）：羊毛、亚麻、茜草、靛蓝、姜黄、鼠尾草、紫草及其 wash，仅承担素材角色和色卡。`workflow-edge-*` 是连线专用深色，不是全局动作色。
- **工作室用途区域**：灰绿 `studio-work-surface` 承托当前操作，暖沙 `studio-reference-surface` 承托绑定对象、章节与品牌摘要，中性 `studio-artwork-surface` 承托款式、展示和评审图像。开始任务的来源台当前仍使用 `image-stage-background`，无来源说明区为透明。三种区域色不表示运行、失败或审批状态，也不改变服装原图。

### Neutral

- `canvas` / `paper` / `surface` / `overlay` 区分页面、操作面板和次级表面；`studio-canvas` 与 `image-stage-background` 分别承托流程画布和图像工作区。
- `ink`、`ink-secondary`、`ink-tertiary` 区分正文、说明与元数据；控件边界与分割线分别使用 `control-border`、`border`、`divider`。
- `disabled-*` 使用独立禁用值；`scrim*` 用于遮罩。共享 Tooltip 实际使用 `ink` 与 `paper`，不能把 `inverse` 的声明当作 Tooltip 计算值。
- `status-success`、`status-warning`、`status-error`、`status-info`、`status-running` 及其 bg 是语义状态；图形与文本共同说明状态。

**The Semantic Separation Rule.** 动作、选择、焦点、品牌和状态使用各自语义变量；颜色相同也不合并用途。

Sidecar 的八级 tonalRamp 是合成 OKLCH 色板预览，非新增生产 token，也不代表已完成对比度验证。

## Typography

**Body Font:** YAML `body.fontFamily` 保留 Inter / 中文无衬线 / 系统回退栈。**Brand Font:** `brand.fontFamily` 保留 Palatino / 宋体栈，用于“森织”品牌名称；“设计工作室”副标题为无衬线。**Label/Mono Font:** 普通标签仍用无衬线，局部状态及统计用 `--font-mono`（SF Mono、JetBrains Mono、Consolas、Liberation Mono、Menlo）。未导入的旧字体文件不构成新增字体依赖。

### Hierarchy

- **Headline:** 项目库页标题使用 YAML headline（32px、600、紧字距）；这是工作标题，不另造展示型大字层级。
- **Title:** WorkspaceHeader 保留 title（24px、600、1.3）；工作室对象页头使用局部 `studio-heading`（28px、600、1.35），≤767px 使用 `studio-heading-mobile`（24px）。
- **Section:** 既有 section 保留 20px 档；本轮工作室主区域和常驻资料标题使用局部 `studio-section`（18px、600）。
- **Body:** body（14px、400、1.5）；较大正文/对象名使用现有 16px 档。
- **Label:** label（12px、400）；用作元信息与状态文字，不升格为标题前眉题。

`studio-label` 记录工作室素材选择说明与常驻资料摘要的 14px / 1.6；对象页头说明另为 14px / 1.7。`studio-planning-start` 的 22px 仅用于系列尚未建立时的引导标题。以上是工作室局部 CSS 的规范快照，继承现有无衬线字体，不新增全局字号变量或替换其他页面的层级。

当前 `--font-medium` 实际也是 400，不能按名称推断为 500。WorkspaceHeader 说明最长 64ch，EmptyState 说明最长 44ch。手机及 any-pointer: coarse 的文字输入强制 16px。桌面目录使用 44px 彩色叶片裙摆标识、24px 品牌名称与 12px 副标题；<1200px 保留 32px 彩色标识并隐藏品牌文字，不把品牌字号推广为正文。

### 森织品牌与登录页

用户可见品牌为“森织”，副标题为“设计工作室”；页面标题模板为 `%s · 森织`。`BrandLockup` 共享图形、文字和替代文本规则；图文并列时图形不重复朗读，单独显示图形时替代文本为“森织”。素材说明见 `public/branding/SOURCE.md`，位图中的叶片与织物融合轮廓作为品牌识别，不作为工作区背景纹理。

登录页使用独立的 `forest-login.module.css`。≥900px 为 55% 暖白展示区与 45% 浅绿表单区，表单区使用 `brand-bg`，暖白卡片最大宽度 440px；彩色标识显示 240–360px，品牌名称为 44px。<900px 使用单列暖白页面，标识缩为 64px、名称为 28px，隐藏桌面说明。保留邮箱一次性登录链接、发送反馈和错误重试，消息自然撑开页面，无持续品牌动画。图片与画布继续使用各自的中性工作底色。

## Layout

- ≥1200px 全平台共享 YAML `navigation` 宽度的暖白目录，fixed 占满 100dvh，app-root 留同宽左侧空间。彩色 Logo、全局入口、当前项目依次排列，账户固定在底部；工作室功能区独立纵向滚动，不挤走账户，也不叠加第二列全局侧栏。
- <1200px 全平台目录回到正常流，高度为 `--workspace-mobile-nav-height`（64px）。彩色 Logo、带下拉标记的当前工作区菜单、账户依次排列；菜单保留项目名、当前入口与键盘访问。桌面全局链接和项目局部目录隐藏，导航与账户触控区最小高 44px。
- 全局内容上限 token 为 1600px；页边距默认 32px，≥1600px 为 48px，≤767px 为 16px。工作室主区左右间距按 ≥1200px / 768–1199px / <768px 分别为 32 / 20 / 16px。
- 项目列表为单列档案行：桌面 200px 作品列与可伸缩资料列，手机作品列 96px。继续操作保留在资料区；服装封面 contain，手机资料允许换行。
- 工作室 ≥1200px 显示 YAML `studio-navigation` 宽度的目录及全部 11 项分组入口。用户确认商品展示包样板后推广的是对象、主工作面、辅助资料的层级，范围仅为 `/studio` 的 11 个子功能。款式、样衣、品牌规则使用 `minmax(0, 1fr) 296px`；色料实验与正在编辑位置的系列看板使用 `minmax(0, 1fr) 340px`，无位置编辑时看板为单列；这些布局在 ≤1099px 堆叠。款式主图保持 contain，高度为 `clamp(300px, 48dvh, 520px)`。主要纸面常用 24px 内边距，手机 16px；辅助资料在页面底色上排布，列距通常 28px。
- 开始任务及趋势为伸缩主区加 320px 资料列，≤1099px 缩为 280px，≤767px 单列；任务来源位于手机输入前，趋势表单在手机来源列表前，桌面趋势表单 sticky 距顶 24px。印花保留平铺画布与 `--inspector-width`（320px）参数列，≤760px 单列。技术包保留 ≥1200px 的 160px 章节目录加内容列，列距 24px、目录 sticky 距顶 16px；窄屏目录回到内容上方，内容不锁定视口高度。团队评审保留对象、作品与意见结构，不套用固定资料双栏。
- 商品展示包保留独立布局：伸缩素材区加 296px 资料列，≤1399px 资料列为 280px，≤1099px 工作区单列且资料字段两列，≤767px 字段单列；整理与逐图核对共享草稿，底部保存操作计入安全区。该局部规则不要求其他应用页面使用双栏。
- 工作室 <1200px 使用统一顶栏并取消左侧占位，顶部保留项目导航与项目选项，内容区显示带创作/交付/资料 optgroup 的“当前功能”选择器，768–1199px 同样可见。≤767px 素材选择为两列，图像高 200px，作品保持 contain；图片选择和查看大图为独立动作。常驻资料按正常文档流堆叠，旧按需编辑模式的手机规则见 Components。
- Studio 的部分比较/表单/评审布局在 ≤600px 进一步单列；工作流画布媒体查询及素材工作区容器查询保留局部 760px 断点，均不替代共享目录的 1200px 切换点。完整流程画布作为专家入口，图像工作台的手机多行工具头按实际内容高度布局，工具内容从头部之后开始。
- 间距以 4px 基础尺度与 8px 节奏组织；字段通常间隔 16px、区块通常 24px。共享默认、紧凑、主操作控件最小高度为 36 / 32 / 40px，粗指针的共享高度 token 为 44px；工作室桌面功能导航独立使用 40px。ImagePreview 默认 contain，cover 仅为显式选项。

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

工作室规划卡为纸面 lg 圆角、12px padding、无常态描边，选中为 2px 焦点色轮廓。项目档案行保留完整服装、项目资料及继续入口。共享 ActionBar 只负责状态与操作布局；不能自行推断保存或生成行为。

### Navigation

`ArchiveNavigation` 是全平台现行共享目录，`current` 只决定当前入口，不再决定颜色变体。无项目时显示项目库/面料库/趋势档案；项目内按项目库/设计工作台/款式与交付/面料库/趋势档案排列，资料库直接可达，资源页保留当前位置及返回上下文。当前项使用 aria-current=page、深绿选择文字、浅灰绿选中底与 600 字重；键盘焦点用 `focus-ring` 轮廓。桌面彩色 Logo 在顶部，账户在底部；窄屏使用同一组入口的工作区菜单，Escape 关闭后恢复触发焦点。

工作室在同一全局目录的项目区域中插入 `StudioNavigation`，直接显示创作（开始任务、款式档案、色料实验、印花工作台、商品展示）、交付（系列规划、技术包、样衣反馈、团队评审）、资料（趋势简报、品牌资料）共 11 项，不再折叠专业入口。该区域独立滚动，进入页面或切换功能时，选中项以 nearest 滚动到可见范围。选中项使用浅绿表面、600 字重和箭头，没有旧内侧线；按钮最小高 40px，padding 4px 12px，继承共享目录的焦点轮廓。导航继续保留项目、URL 参数及原有离开保护。

Tabs 手动激活：方向键/Home/End 移焦，不自动启动昂贵面板；TabPanel 用 hidden 控制。Studio 的窄屏功能选择器与桌面目录保持同一 tab 值，不另造 URL 协议。

工作室的父级入口是局部例外：`StudioWorkspace` 传入 `currentIsParent`，使“款式与交付”的 `data-current-parent` 使用透明底和 500 字重，保留当前路径语义与选择文字色。`StudioNavigation` 的 `data-studio-hierarchy` 将分组内子功能左缩进 8px，实际选中子页保留浅绿底与 600 字重；其余页面的全局当前项仍使用上面的共享样式。

### 工作室对象、素材与常驻资料

11 个模块以作品、文档或当前集合为中心，分别保留素材工作面、平铺画布、制作章节、系列看板、来源阅读和品牌规则。`StudioPageHeader` 为推广的 10 页统一对象名称、类型/说明、状态与次级新建入口；商品展示包保留相同层级的独立页头。对象名不在邻近摘要中重复为大标题。准确绑定的款式修订与素材名称继续随对象展示。

`StudioEditSection persistent` 输出常驻 section，标题、摘要和字段参与正常文档流，无展开按钮或手机模态；款式、色料、印花、技术包、样衣、评审对象、趋势与品牌采用此模式。它只改变呈现，草稿仍由所属表单持有，不表示自动保存或刷新后持久恢复。未启用 persistent 的兼容模式仍保留字段挂载、按需展开，以及 <768px 主动/受控打开时的原生全屏 dialog、Escape 与焦点返回；不能把兼容模式描述为当前所有子页的行为。

`AssetPicker` 将素材名、选择状态/顺序、独立“查看大图”入口放在完整图片下。选择使用 aria-pressed 和图片外轮廓；查看原图不改变选择，选图数上限继续给出文字提示。`SaveBar` 区分正在保存、只读、有未保存修改、新资料尚未保存和已保存；新资料可提交，已有且未改动的资料禁用保存。对应长表单底部操作 sticky，保存、提交生成、人工核对与发布仍是独立显式操作。

技术包完整发布检查只在“复核发布”章节显示；摘要保留待复核数量，检查项可跳至对应章节。系列位置编辑隐藏后继续保留草稿，再选同一位置继续编辑，切换位置仍经过离开保护。样衣定位继续依据真实图片边界。

本轮授权及实现依据 `.impeccable/surfaces/studio-workspace.md`，实施证据与限制见 `../../doc/impeccable/工作室层级推广实施记录.md`。`../../output/studio-rollout/` 的真实项目截图、模拟状态矩阵和独立终审分别记录，不能互相替代，也不证明真实后台写入、模型、队列或导出内容。

### Dialog / Menu / Tooltip

Dialog 使用原生 showModal、初始焦点、Tab 约束、Escape 关闭和触发焦点恢复；最大尺寸扣除视口边距与安全区。未保存确认框宽度为 min(480px, 100vw - 32px)，内边距 24px，继续编辑与丢弃并离开分开。Menu 使用 details，外部点击/选择关闭、Escape 返回 summary、方向键遍历。Tooltip 键盘立即显示，鼠标等待 180ms、关闭延迟 120ms；触摸不触发 hover 提示，原生 dialog 内使用同一模态层。

### 设计助手分区

设计助手以浅苔绿工具区、暖杏色引用区、纸白输入区和绿色生成确认区区分任务。`--assistant-tools-surface`、`--assistant-reference-surface` / `ink`、`--assistant-review-surface` / `border` 仅用于助手，不代替成功、警告或错误状态；确认卡仍显示明确状态文字。顶部常驻历史对话、新建对话和设计要求，输入区常驻添加引用和发送需求。发送需求不执行图片生成，生成确认按钮显示实际张数。

引用选择器使用原生 Dialog，支持搜索、多选和最多 16 项，确认后才替换待发送引用。对话草稿仅在当前页面按项目和会话隔离保留；页面刷新不保证恢复。手机输入框限制最大高度，长引用与草稿提示可在输入区滚动，保持确认操作可达。

### 工作区状态与动效

完整流程画布在低缩放时将端口命中区置于节点外，视觉连接点仍贴节点边缘；选中连线临时提升绘制层，使重连手柄可拖动，不改变节点与连线的常态层级。

StudioWorkspace 区分首次 Skeleton、错误 Notice、不可打开 EmptyState、数据内容、刷新中和只读；离开脏草稿走 guard。技术包人工复核缺项有定位入口；异步导出排队后可以离开，不能把草稿保留描述为持久保存。

工作室状态分为页面加载/读取错误、对象选择/编辑草稿、权限、请求进行中/失败、保存修订与复核导出；反馈归属对应层级，区域底色不代替状态。刷新失败保留已有资料并显示错误；主动刷新确认离开后才重载和重建面板。项目选项显示角色，缺少编辑权限时显示只读工作区；模块继续依据 capabilities 控制操作。

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
