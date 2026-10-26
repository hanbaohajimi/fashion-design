# Atelier Web：15 个技能的审查与可执行优化方案

新增功能迁移另见 [服装秀迁移与实施](fashion-show-migration/README.md)（2026-10-26）。下文继续保留本次 Web 审查的时间边界。

审查日期：2026-10-25。提交基线：`5dbd7a6`，同时复核了本轮结束前出现的未提交工作区改动，包括新增 `components/motion/`。这是一份有时间边界的代码审查，执行前需检查后续改动。

用户已确定：只用于 Web 平台，允许局部结构重设计。目标是提高服装设计师在画布、资料编辑、面料浏览和结果挑选中的效率、可预测性与恢复能力。

原始审查之后，已按 P1 → P2 顺序实施七项任务。最新实现、测试结果及保留限制见 [七项优化实施记录](IMPLEMENTATION.md)。下文保留审查时的问题证据与实施规格，不能将原始 Before 描述误认为当前代码状态。

## 一、先执行什么

| 顺序 | 任务 | 优先级 | 依赖 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | [001：历史画布即时呈现与结果反馈](001-workflow-motion.md) | P1 | 无 | 已实施 |
| 2 | [002：手机/平板视图、输入与安全区](002-mobile-web.md) | P1 | 无；与 005 协调 WorkflowCanvas 改动 | 已实施；真机待验 |
| 3 | [003：操作反馈、重命名与焦点恢复](003-feedback-and-project-actions.md) | P1 | 无；移动 Toast 偏移沿用 002 安全区规则 | 已实施 |
| 4 | [004：极端数据、技术包数值与图片恢复](004-data-and-media-boundaries.md) | P1 | 无 | 已实施 |
| 5 | [005：侧栏拖拽性能与手势取消](005-sidebar-performance.md) | P2 | 002 的布局模式 | 已实施 |
| 6 | [006：Tooltip 连续浏览与触屏行为](006-tooltip-behavior.md) | P2 | 无 | 已实施 |
| 7 | [007：实验结果挑选的三方向原型](007-result-selection-prototypes.md) | P2 | 001/003/004 的交互约定 | 三个演示已实现；生产方向待选 |

P1 表示可能影响内容可达性、输入正确性或操作可靠性，应先修复；P2 表示可用性和效率打磨。每个任务都规定了文件、目标行为、边界与验收，可单独交给执行者。任务 007 的完成标志是三个可操作原型及比较结果；最终生产布局由用户看过原型后选择。

### 已确认的问题与目标

| Before：当前行为及证据 | After：目标 | Why |
| --- | --- | --- |
| `workflow-node.module.css` 对普通节点挂载播放位移/缩放；最新工作区已排除 candidate/fabric，其余节点仍可能等待 270ms 再播放 180ms | 历史节点首帧显示最终态，新结果反馈不改变根节点几何 | 根节点的 DOM 变换与模型端口坐标不一致；重开画布不应再隐藏内容 |
| `workflow-connections.module.css:30` 普通边挂载后从全长 dashoffset 绘制；最深边完整显示要 770ms | 历史和用户创建的连接立即完整显示 | 连接关系是用户正在读取的功能信息 |
| 同文件 `:60` 对 selected/highlighted/running 都播放无限流动 | 仅真实 running 状态流动；选择和血缘高亮静态表达 | 防止把“选中”误读为“执行中”，减少无意义绘制 |
| `WorkflowCanvas.tsx:666` 用 `>760` 收起侧栏，手机 CSS 用 `<=767` 切换单视图 | 手机阈值统一 767，助手可见性由当前视图决定 | 761–767px 的 resize 可能同时隐藏画布与助手 |
| `ProjectCard.tsx:75` 重命名无请求锁；退出编辑后无显式焦点恢复 | 同一卡片单次在途提交，失败留草稿，结束后回到项目操作入口 | 防止重复 PATCH 和键盘操作失去位置 |
| `ProjectLibrary.tsx:301` 成功、失败共用 `role="alert"`；部分失败同时出现在父级和卡片 | 消息按作用位置、严重程度分配唯一呈现点 | 减少重复播报；短暂成功不打断读屏用户 |
| `TechPackTables.tsx:8` 每次输入即 `Number(value)`，BOM/POM 文本缺少长度限制 | 文本草稿与数值载荷分离，保存前按既有 schema 校验 | 保留小数中间输入；不把非法数值、空值混为一谈 |
| `FabricCard.tsx:345`、`:397` 原生图片没有失败恢复 | 复用已有 ImagePreview，保持图片区尺寸与详情操作 | 私有图片失败不应留下破图或阻断查看资料 |
| `WorkflowCanvas.tsx:1691` 每个 pointermove 更新 React，宽度变量挂在整页根部 | rAF 合并布局写入，结束后提交宽度状态 | 已确认更新路径成本；是否掉帧仍需录制验证 |
| `ui.tsx:522` 每个 Tooltip 独立等待 180ms，pointer enter 不区分触摸 | 工具栏暖机后相邻提示即时打开，触摸不触发 hover timer | 连续辨认工具时减少重复等待和触屏残留提示 |

上表位置均相对于 `G:/new-fashion-design/`。详细方案中提供完整路径。行号用于导航，执行时还应通过组件、选择器和代码片段确认位置。

### 已有实现与排除项

- 活动样式入口是 `globals.css → design-system.css`。旧 `motion-tokens.css`、`motion-enhancements.css` 未接入运行时，不把其中的全局 pulse、hover、stagger 算作现存缺陷，也不重新导入它们。
- 提交基线中的项目卡片 400ms CSS 入场已由最新工作区移除；旧 stagger token 原本为 **0ms**。新的 useArchiveOpening 则对首次可见的最多 9 张卡片使用 260ms 动画和每张 40ms 延迟，需要独立验证，不沿用旧 CSS 结论。
- 工作区新增 Mo.js 事件反馈及 `--motion-*` token，结果 reveal 目前为 700ms。运行时已有可见性、减弱动态、并发上限和取消保护；不得再声称项目没有这套机制，也不以通用时长规则直接删除品牌设计。任务 001 补充了与它协同的审查门槛。
- Sonner、NumberFlow、Virtuoso 已安装并使用；原生 Dialog、Escape、焦点归还、手动激活 Tabs、44px 触控高度、100dvh、单个绘画等待媒体已有实现。
- 最终基线已将 Toast 固定为 light、Tooltip 放入最近的打开 Dialog、767px 以下输入字号提高到 16px。待办是剩余行为与宽屏触控覆盖，不重复执行已经完成的修改。
- 工作室的 11 个模块、配置与结果并列、单项重试、章节导航、修订冲突和人工复核已有实现。任务 007 只探索“同一批次结果如何比较与选择”，不重建全部工作室。
- 当前固定视觉测试关闭动画且使用 reduced motion，只证明静态截图；正常动效和真实触屏体验须单独验收。

## 二、15 个技能逐项应用

### 1. animate：按真实事件定义动画

应用：任务 001、004、007。历史图、搜索过滤、工具切换、键盘焦点移动均直接响应。已有结果反馈沿用工作区事件机制并验证不遮挡内容；任务 007 的新原型可用 280ms、6px 的轻量图片反馈，但不得与已有品牌效果叠加。图片重试成功可使用 140ms opacity 过渡。本轮不再添加动画依赖。

验收：交互不用等待动画；每项反馈能指出触发的真实事件；快速操作、页面隐藏和 reduced motion 均有明确定义。已经存在的反馈不再叠加第二层动画。

### 2. animate-expo：完成适用性判断，排除原生实现

仓库为 Next.js Web、NestJS API 和 Worker，没有 Expo/React Native 应用；用户已明确只做 Web。因此该技能的 Reanimated、Gesture Handler、Expo Router 和触觉 API 不进入实施。可迁移的“触摸即时反馈、手势可取消”原则由任务 002、005 使用浏览器能力实现。

验收：没有新增 Expo 工程、原生依赖、桥接代码或移动应用开发任务。该项状态为“不适用”，不是“已完成 Expo 优化”。

### 3. animation-performance：有原因、有测量的性能优化

应用：任务 001、005。删除静态选择的 SVG 无限流动；侧栏拖动把每次 pointermove 的 React 更新合并到帧；保留宽度变化所必需的布局，不用缩放整列冒充真实 resize。

验收：同设备、同图数据、同操作录制 Style/Layout、长任务、React commits；明确记录优化前后数据。不能仅凭 transform、CSS 或 will-change 声称“已实现 GPU 加速、稳定 60fps”。

### 4. animation-vocabulary：统一描述和验收语言

下列术语取自技能词表，英文释义保持原文；执行任务使用中文场景说明。

| 术语 | 词表原文 | 本项目中的含义 |
| --- | --- | --- |
| Fade in / Fade out | Element appears or disappears by changing opacity. | 重试图片恢复的短淡入 |
| Press / Tap feedback | A subtle scale-down when an element is clicked, so it feels physical. | 普通按钮触摸按压反馈 |
| Origin-aware animation | An element animates out of its trigger, like a popover growing from the button that opened it instead of from its own center which is the default in CSS. | 只有确需动画的菜单才关联触发点；高频菜单可即时显示 |
| Interruptible animation | An animation that can be smoothly redirected mid-flight instead of finishing first. | 连续操作不等待旧过渡完成 |
| Line drawing | An SVG path that draws itself in, like an invisible pen tracing it. | 当前历史连线入场，任务 001 将移除 |
| Number ticker | Digits rolling or counting up to a value. | 已有 CreativeProgress 的 NumberFlow；不扩散到技术尺寸/价格输入 |
| Tabular numbers | Fixed-width digits so numbers don't shift around as they change. Essential for tickers, timers, and counters. | 比较数值、数量、修订号用等宽数字 |

验收：任务描述写具体对象、触发事件、属性、时长和退化行为，避免“高级一点”“更丝滑”这类无法验收的要求。

### 5. apple-design：连续操作和可预测性

应用：任务 002、005、006、007。侧栏从按下位置开始一对一跟随，不跳到指针中心；捕获指针并处理取消；结果挑选保持原图比例和稳定位置；触控操作保持可见入口。

保留 Atelier 的暖纸、深墨、茜草色、材料阴影，不将平台整体改成玻璃界面。原生滚动、表单焦点和现有 Dialog 优先；本轮不引入惯性抽屉、触觉或弹簧导航。

### 6. ask-sonner：统一消息的归属与生命周期

应用：任务 003。保留根布局唯一 Toaster 和 light 主题；添加可关闭的操作消息、稳定操作 ID 和安全区偏移。短操作结果交给 Toast，字段错误留在字段附近，长生成任务使用既有 TaskFeedback 和结果记录。

验收：每次操作只有一个主要消息源；成功以服务端确认为准；重试不复制长任务；打开原生 Dialog 时，关键错误直接显示在 Dialog 内，不靠提高 z-index 解决 top-layer。

### 7. break-ui：用 schema 边界验证，而非随意拉长文本

应用：任务 004。为项目卡、面料卡、技术包和实验结果准备 Demo / Worst case / Empty / One / Large 数据。测试真实长度上限、同名项目、emoji、缺图、403/404、超长供应商、空数值、零公差、小数中间态和混合任务状态。

验收：同一数据入口注入 fixture；320px、实际侧栏宽度、200% 缩放、触摸、正常/减弱动态均有结果。开发开关不进入生产；本轮审查尚未实际渲染这些极端 fixture，不能把所有潜在风险描述为已复现故障。

### 8. emil-design-eng：补齐操作细节

应用：任务 003、004、006、007。统一“操作前/进行中/完成/失败”的连续体验：重命名防重入、错误不丢草稿、焦点有返回点、图片失败仍能看资料、工具提示连续浏览免重复等待。

保留现有主次动作和修订保护。通过 Before / After / Why 表说明问题，再用请求次数、焦点、状态和截图证明改进，而不是重新设置一套颜色和字号。

### 9. find-animation-opportunities：只保留有价值的新增反馈

| 场景与入口 | 当前状态 | 目的/频率 | 精确建议 | 任务 |
| --- | --- | --- | --- | --- |
| ExperimentPanel 的当前可见结果预览 | 结果资产到达后 ImagePreview 直接出现 | 状态变化说明；偶发 | 仅本次观察到的 active→succeeded 结果，opacity 0→1、translateY(6px)→0，280ms，`--ease-enter` | 007 原型验证后再决定生产整合 |
| ImagePreview 的显式重试 | 成功后恢复原图 | 确认恢复；偶发 | 固定图片区内 opacity 0→1，140ms，`--ease-enter`；无位移 | 004 |
| 项目复制/归档的完成反馈 | 复制是页内 alert，归档主要靠列表消失 | 确认操作；偶发 | 单个 Sonner 消息复用库原有堆叠过渡；不自定义 keyframes | 003 |

共同门槛：操作立即生效；页面不可见或 reduced motion 时保留文本/静态状态，跳过装饰运动。Sonner 原有过渡按库自身组件约定保留，不强制改写为通用 180ms。

明确拒绝：历史图依拓扑错峰重播；搜索结果逐卡入场；键盘 Tabs/焦点/画布工具切换动画；BOM/POM 数值滚动变化；持续装饰性背景。原因分别是高频、核心信息可读性或输入精度。

### 10. improve-animations：将审计转成执行任务

应用：完成实际导入链梳理、按区域并行只读审计，并由主线程复核关键代码。任务 001、005、006 包含现状片段、固定目标、测试和 feel-check；本索引给出依赖与优先级。

执行时先检查代码是否仍匹配基线。若问题已修复，标记“已由其他变更解决”并补证据；若行为发生实质变化，更新该任务，不按旧行号盲改。

### 11. mobile-native：覆盖浏览器真实平台行为

应用：任务 002。修正 761–767px 状态冲突；在触屏平板补齐输入字号；补 viewport、边缘安全区和软件键盘验收。保持普通表单自然滚动与画布独立滚动语义。

验收：Chrome/WebKit 的窄屏回归之外，必须有人在 iOS Safari、Android Chrome 上测试键盘、横屏、地址栏和输入缩放。本机目前没有该实机证据，计划保留待验收状态。

### 12. pick-ui-library：优先完成已接入能力

| 需求 | 决策 |
| --- | --- |
| Toast | 使用现有 Sonner，新增薄封装和语义约定 |
| 长面料列表 | 使用现有 VirtuosoGrid；补稳定 computeItemKey、卡片高度和分页边界测试 |
| 数字展示 | 保留 CreativeProgress 中 NumberFlow；不用于测量值、单价或尺寸输入 |
| Dialog、Tabs、菜单 | 沿用当前原生语义及共享组件，本轮不迁移整套 Base UI |
| 简单运动 | CSS/WAAPI；保留并审查工作区新增的 Mo.js 事件反馈，不额外引入 Motion 或 GSAP |
| 原型布局 | CSS Modules 与现有控件，不增加设计系统依赖 |

`react-window` 在当前 apps/packages 中只查到 package.json 声明。可在独立依赖清理中移除并更新锁文件，但不与行为修复捆绑，不把换库视为优化成果。

### 13. prototype：只探索一个高价值局部

应用：任务 007，主体为“色料/细节实验的同批次结果挑选”。输出“矩阵总览”“专注比较”“审阅队列”三个方向，同一数据和动作、不同密度与选择方式。一次全尺寸显示一种，通过固定 picker 切换，支持键盘和 URL 保留选择。

验收：所有按钮有演示行为，成功/失败/运行/只读状态完整；没有真实生成或写入请求。该任务结束时交付可比较候选；选择后生产整合另行限定为选中的方向。

### 14. review-animations：设定合入前的动效审查

当前判定：**需要修复后复审**。阻断项是历史图隐藏拓扑、节点根部位移以及选择即无限流动；侧栏性能目前是已确认的风险路径，不能声称已测得掉帧。

通过条件：高频操作即时；新增动画有明确事件和目的；根节点/边几何关系稳定；重试、快速反向及关闭不等待动画；reduced motion 保留状态信息；桌面录制和实机检查无未解释的异常。Sonner 库内部有文档化过渡，现有 token 有兼容约定，不凭通用检查表强行重写它们。

### 15. write-swift：明确 Web 边界

未发现 Swift 源码、Package.swift 或 Xcode 工程。该技能的 actor、ARC、SwiftUI、Swift Testing 与当前交付无直接实现对象。按用户 Web 范围排除原生代码任务；不把 TypeScript 的异步和状态管理改写成 Swift 概念来凑数量。

验收：该项记录为“不适用”；没有新增 Swift 工具链或原生端路线。

## 三、统一实施约定

### 设计与动效

- 唯一运行时视觉规范继续为 `G:/new-fashion-design/apps/web/src/styles/design-system.css`；现有颜色、字体、36/32/40px 控件与 44px 触控高度沿用。
- 新增轻量结果反馈复用 `--duration-result:280ms`、`--ease-enter:cubic-bezier(0.23,1,0.32,1)`；轻量图片恢复复用 `--duration-fast:140ms`。现有品牌事件的 `--motion-*` 单独按内容可读性、频率与性能评估，不强行映射到 280ms。高频导航及键盘行为 0ms。
- 不批量重写明确保留的兼容别名 `--ease-in-out`。JS 动画读取实际 token，不在每个组件复制新的曲线常量。
- 沿用项目已确定的 reduced-motion 策略：取消装饰位移/循环，保留静态状态、文字、焦点和错误恢复。不为满足技能模板而强加淡入。
- 触屏不依赖 hover。新增 hover 运动必须在 `(hover:hover) and (pointer:fine)` 下；数值、状态和菜单入口仍可通过焦点/点击访问。

### API、数据和兼容性

本轮不改变 HTTP 路由、数据库 schema、队列、存储访问方式或计费。请求仍使用现有 API、expectedVersion、幂等键和权限控制。

新增接口限于 Web 内部：TooltipGroup 的暖机上下文、统一短操作消息函数、技术包编辑用的字符串数值草稿及序列化函数、原型选择状态。公开组件新增属性需为可选，原调用保持兼容。UI 行标识不发送到服务端。

原型及最坏数据入口限定非生产环境；只使用 fixture 和本地交互状态。生产构建必须不能访问原型，也不能触发任何演示用的请求逻辑。

## 四、验证与交付

### 自动化

在仓库根 `G:/new-fashion-design` 执行；只在进入实施阶段后运行。

```powershell
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
pnpm --filter @fashion/web lint
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web test
pnpm test:e2e
pnpm --filter @fashion/web build
pnpm test:e2e:visual --update-snapshots=none
```

先运行各任务指定的定向测试，完成全部修改后跑上述一次完整回归。视觉脚本使用现有固定 Linux Chromium 与 Docker 环境；正常动画须用单独的行为用例/录制测试，不能从关闭动画的截图推断。不要为了通过视觉比较自动覆盖正式基线。

### 场景矩阵

| 维度 | 必测场景 |
| --- | --- |
| 视口 | 320、390、760、761、767、768、959、960、1099、1100、1280、1440；683×384 短高度/缩放回归 |
| 输入设备 | 键盘；精细指针；触摸；带触摸屏且连接鼠标的设备 |
| 网络/媒体 | 快速成功、3 秒延迟、离线/失败、重试、图片 403/404、成功后刷新 |
| 数据 | 空/单条/真实 schema 上限、长中文与 emoji、同名条目、100 行技术表、累计 1000 个面料 fixture |
| 工作流 | 历史图初载、立即拖动、重连、撤销恢复、运行/失败/完成、隐藏标签页、重新进入视口、PNG/SVG 导出 |
| 安全交互 | 未保存离开、权限只读、409 冲突、重复 Enter/点击、gesture cancel、焦点返回 |
| 动态偏好 | 正常动画、prefers-reduced-motion；不新增深色主题，但检查系统深色时页面与 Toast 仍遵守浅色产品设定 |

### 实机和性能

用同一中档设备、同一构建、同一视口比较前后。普通图 fixture 为 12 节点/18 边；压力图为 200 节点/300 边，属于验收数据，不代表产品规模上限。连续拖动侧栏 10 秒并重复 3 次，记录 React commits、Style/Layout、长任务和交互异常。离线或无实机时明确标“未验证”，不填虚构收益。

输出应包括：每个任务的完成状态、改动说明、定向与完整测试结果、正常/减弱动态的录制、关键尺寸截图、实机设备与浏览器版本。截图与性能记录不应包含真实私有设计资料，使用现有测试 fixture。

### 官方行为依据

- 原生 `showModal()` 将 Dialog 放在 top layer，并使文档中其余非后代内容 inert；因此 Dialog 内的关键错误应在 Dialog 内呈现：[MDN showModal](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal)。
- viewport-fit 与 interactive-widget 是浏览器 viewport 提示，不能替代实际设备检查：[MDN viewport](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport)。
- Next.js 的 viewport 导出及客户端边界以仓库安装版本的 `apps/web/node_modules/next/dist/docs/` 为准；Sonner/Virtuoso 的参数以安装版本类型定义为准。
