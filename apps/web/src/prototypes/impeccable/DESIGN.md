---
name: "Atelier · 三个未选定的开发原型"
description: "仅记录隔离比较原型的候选实现；不属于生产主题，不代表用户已选择方向。"
colors:
  archive-canvas: "#f5f4ee"
  archive-paper: "#fffefa"
  archive-ink: "#20332e"
  archive-muted: "#586a60"
  archive-line: "#d8ddd3"
  archive-accent: "#286452"
  archive-accent-hover: "#1c4c3d"
  archive-tint: "#e7eee2"
  archive-rail: "#183f35"
  archive-rail-ink: "#f2f6ec"
  archive-rail-muted: "#c2d6c9"
  archive-focus: "#2b7058"
  gallery-canvas: "#f1eee8"
  gallery-paper: "#fffdfa"
  gallery-ink: "#332d28"
  gallery-muted: "#736358"
  gallery-line: "#dcd4c9"
  gallery-accent: "#963c25"
  gallery-accent-hover: "#78301d"
  gallery-tint: "#f4e5da"
  gallery-rail: "#2d302b"
  gallery-rail-ink: "#fff9ef"
  gallery-rail-muted: "#d6cec2"
  gallery-focus: "#963c25"
  relay-canvas: "#eef2f5"
  relay-paper: "#fcfdff"
  relay-ink: "#213448"
  relay-muted: "#586c7e"
  relay-line: "#d5dee7"
  relay-accent: "#275e98"
  relay-accent-hover: "#1b4878"
  relay-tint: "#e3edf7"
  relay-rail: "#1b3047"
  relay-rail-ink: "#f2f6fc"
  relay-rail-muted: "#c0cedf"
  relay-focus: "#275e98"
  control-border: "#89958b"
  on-action: "#fff"
  review-ink: "#24312f"
  review-border: "#d4dcd8"
  review-canvas: "#f7f9f8"
  review-focus: "#146b62"
typography:
  headline:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans SC\", system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans SC\", system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  section:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans SC\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans SC\", system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.55
  task-title:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans SC\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  label:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans SC\", system-ui, sans-serif"
    fontSize: "12px"
rounded:
  square: "0"
  chip: "4px"
  control: "5px"
  candidate: "6px"
  project: "8px"
spacing:
  s4: "4px"
  s6: "6px"
  s8: "8px"
  s10: "10px"
  s12: "12px"
  s16: "16px"
  s18: "18px"
  s20: "20px"
  s24: "24px"
  s28: "28px"
  s32: "32px"
components:
  archive-primary:
    backgroundColor: "{colors.archive-accent}"
    textColor: "{colors.on-action}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  archive-primary-hover:
    backgroundColor: "{colors.archive-accent-hover}"
  archive-input:
    backgroundColor: "{colors.archive-paper}"
    textColor: "{colors.archive-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  gallery-primary:
    backgroundColor: "{colors.gallery-accent}"
    textColor: "{colors.on-action}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  gallery-primary-hover:
    backgroundColor: "{colors.gallery-accent-hover}"
  gallery-input:
    backgroundColor: "{colors.gallery-paper}"
    textColor: "{colors.gallery-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  relay-primary:
    backgroundColor: "{colors.relay-accent}"
    textColor: "{colors.on-action}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  relay-primary-hover:
    backgroundColor: "{colors.relay-accent-hover}"
  relay-input:
    backgroundColor: "{colors.relay-paper}"
    textColor: "{colors.relay-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  archive-secondary:
    backgroundColor: "{colors.archive-paper}"
    textColor: "{colors.archive-ink}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  archive-navigation:
    backgroundColor: "{colors.archive-rail}"
    textColor: "{colors.archive-rail-muted}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  archive-reference-tag:
    textColor: "{colors.archive-accent}"
    rounded: "{rounded.chip}"
    padding: "0 4px 0 8px"
  archive-project:
    backgroundColor: "{colors.archive-paper}"
    textColor: "{colors.archive-ink}"
    rounded: "{rounded.project}"
---

# Design System: Atelier · 未选定开发原型

## Overview

**Creative North Star: "同一服装任务的三个未选定结构"**

这是一份候选实现记录，不是生产设计规范。A「织物档案」、B「作品展台」、C「任务接力」共用服装、项目及任务数据，以不同的作品、资料与任务布局供用户实际比较。默认显示 A 只是初始化顺序；没有任何方向已经获得最终选择。上级 `../../../DESIGN.md` 及 `../../../.impeccable/design.json` 继续描述现行生产系统。

范围仅限 `/prototypes/impeccable` 开发路由、本目录组件和局部 CSS。用户须比较后在聊天中确认方向，才能开展全平台推广；页面“记录偏好”只改变当前内存中的提示，不触发推广、保存偏好到服务器或选择正式主题。

**Key Characteristics:**

- 三种结构使用同一组真实来源样图与明确模拟的数据。
- 对象、已保存方案和款式修订在工作台与技术包之间绑定。
- 手机比较工具折叠，作品、素材、助手分区切换。
- 无持久化业务数据；刷新重置，网络与模型执行均不在原型范围。

本记录依据当前 `comparison.module.css`、`ImpeccableComparison.tsx`、`prototype-data.ts`，以及 `../../../.impeccable/surfaces/redesign-comparison.md`。实现优先于方向意图；YAML 只记录已存在的实际值。三个 palette 以方向前缀平铺，以兼容 DESIGN.md token schema；它们不是一个混用的主题。CSS 中共享尺寸多数为字面值，本文 spacing / rounded 名称是文档索引，不宣称源码已有同名 CSS 变量。

开发路由 `../../app/prototypes/impeccable/page.tsx` 在 production 先调用 notFound，再按开发路径动态导入原型。原型不读取真实用户项目；这项代码边界不代表正式功能权限已经完整验证。

完成审查的初版报告 `../../../../../output/impeccable-redesign/finish-review/report.md` 曾为 fix，指出手机比较工具、C 重复导航、B 素材面板三项问题。本快照已从源码核对三个修正分支；本文件不替代审查者最终 verdict，也不将代码检查冒充重新截图或真实用户验证。

## Colors

### Primary

A 使用暖白、青绿动作与深青绿目录；B 使用浅砂、赭色动作与炭色顶栏；C 使用冷白、蓝色动作与深蓝顶栏。12 个主题角色逐项保留原值，具体值只在 YAML；表格为使用映射：

| 角色 | A 织物档案 | B 作品展台 | C 任务接力 |
| --- | --- | --- | --- |
| canvas | `colors.archive-canvas` | `colors.gallery-canvas` | `colors.relay-canvas` |
| paper | `colors.archive-paper` | `colors.gallery-paper` | `colors.relay-paper` |
| ink | `colors.archive-ink` | `colors.gallery-ink` | `colors.relay-ink` |
| muted | `colors.archive-muted` | `colors.gallery-muted` | `colors.relay-muted` |
| line | `colors.archive-line` | `colors.gallery-line` | `colors.relay-line` |
| accent | `colors.archive-accent` | `colors.gallery-accent` | `colors.relay-accent` |
| accent-hover | `colors.archive-accent-hover` | `colors.gallery-accent-hover` | `colors.relay-accent-hover` |
| tint | `colors.archive-tint` | `colors.gallery-tint` | `colors.relay-tint` |
| rail | `colors.archive-rail` | `colors.gallery-rail` | `colors.relay-rail` |
| rail-ink | `colors.archive-rail-ink` | `colors.gallery-rail-ink` | `colors.relay-rail-ink` |
| rail-muted | `colors.archive-rail-muted` | `colors.gallery-rail-muted` | `colors.relay-rail-muted` |
| focus | `colors.archive-focus` | `colors.gallery-focus` | `colors.relay-focus` |

`accent` 负责主操作及选择，`accent-hover` 负责主按钮 hover；`focus` 负责 surface 内键盘轮廓。`tint` 负责资料摘要与浅色选中底，不是成功状态的证明。

### Neutral

`canvas` 承托页面，`paper` 承托资料与控件，`ink` / `muted` 建立文字层级，`line` 构成边界。`rail-ink` / `rail-muted` 对应深色区域文字。三主题文字输入共用 `control-border`，主操作字色共用 `on-action`。

比较工具外壳另有 `review-*` 颜色；它不属于任一候选产品 palette。源码还包含局部状态、导航、头像和材料色，不将所有一次性字面量扩大成通用设计 tokens。Sidecar 的八级 OKLCH ramp 仅为合成色板预览，不新增生产或原型 CSS 值，亦不宣称完成对比度认证。

**The Candidate Scope Rule.** A、B、C 的 tokens 仅在各自 data-direction 局部容器生效，不能提升为生产规范。

## Typography

**Body Font:** YAML 保留中文无衬线栈，以 PingFang SC / Microsoft YaHei / Noto Sans SC / system-ui 回退，未借用生产 Inter 栈。正文 14px、1.55 行高；标题与任务文字角色按当前选择器记录。CSS `font: inherit` 位于更高 specificity 的 `.comparison button`，按钮在层叠后继承父级文字；因此常规按钮样本使用 body，不把 `.button/.primary` 的 13px/600 声明误记为计算值。YAML task-title 对应任务队列内实际生效的 strong（13px/600），sidecar 按真实层叠还原按钮。

最多 760px 时 h1 降为 24px、h2 为 19px；输入、select、textarea 为 16px 且最小高度 44px。标准按钮的局部声明为 13px，主要字号仍须以真实层叠结果验证。页说明常用 13px，元数据含 10/11/12px；这些小号片段如实保留在实现，未提升为全平台最低字号。

Georgia 仅用于斜体小写 a 品牌标记（桌面 35px、手机 32px），不是候选 display 字体。没有新增系统 display 角色、宣传 hero 或排版装饰规则。

## Layout

| 候选 | 项目与导航 | 工作台 | 技术包 |
| --- | --- | --- | --- |
| A archive | 204px 深色左目录；项目行与首项大预览 | 并排候选 + 300px 右侧助手 | 188px 对象摘要 + 编辑区，间隔 28px |
| B gallery | 顶导航；桌面 3 列作品，1000px 内 2 列，手机 1 列 | 默认一个大图与联系表；330px 资料区，最大宽 1440px；比较时并排 | 250px 对象栏 + 编辑区，间隔 40px，最大宽 1120px |
| C relay | 顶导航 + 260px 任务队列，项目为紧凑记录 | 并排方案 + 262px 助手；1200px 内助手下置 | 编辑区 + 180px 右侧已保存对象，间隔 24px |

通用项目页最大宽 1500px。1200px 内 A 左目录降为 176px、C 队列为 220px、A 助手为 270px。1000px 内 A/B 助手下置，技术对象改为上方缩略摘要。最多 760px 所有主壳成为纵向布局，内容左右 16px，主要控件 44px；没有根据生产断点推断候选断点。

手机比较栏默认收为身份/操作入口加三个方向按钮两行；测试状态、重置与偏好位于“比较设置”展开区，`aria-expanded` / `aria-controls` 与 `data-expanded` 对应。比较说明另行按需展开。C 手机隐藏重复的顶部应用导航，由三个任务按钮继续提供项目、工作台、技术包入口；项目选择器与步骤简述压缩，不移除任务跳转能力。

工作台手机导航为“作品 / 素材 / 助手”，使用 `data-mobile-panel`：
- `designs`：显示作品与当前操作，隐藏素材和助手。
- `materials`：只显示素材，隐藏助手及作品区其他直接子项。
- `assistant`：隐藏作品区，显示助手。
- 添加素材引用后转到助手；移除引用不强制切换。B 的 `display:block` 现在仅在 materials 条件下生效，不能重新覆盖 designs 的隐藏规则。

手机普通作品单列 330px 图台，并排比较为两列 190px 图台；完整图通过 contain 适应尺寸。B 自己的图片高度选择器有较高 specificity，比较模式高度最终须以其层叠结果为准，不能仅用通用比较值描述所有方向。章节导航重排两列；C 手机首屏紧凑化是本轮实现事实，实际首屏是否满足目标由最终截图审查裁定。

## Elevation & Depth

当前局部 CSS 不声明 box-shadow；层级来自深浅表面、边线、内外留白与所选对象轮廓。未引入玻璃、织物纹理或材料拟物。三个候选各自的深色导航不能误作暗色生产主题。

**The Complete Silhouette Rule.** 服装 raster 使用 object-fit: contain 保留完整轮廓，模拟编辑复用已标明来源的样图。

两张 raster 的来源记录为 `../../../public/prototype-assets/impeccable/SOURCE.md`，由现有 smoke 输出复制；未为本比较重新调用模型。sidecar 不复制远程图片或添加未经证实的视觉素材。

## Shapes

共享观察尺度见 YAML：标签与联系表小圆角、控制与输入圆角、A/C 候选轮廓、A 项目容器圆角。B 项目与主候选为直角并弱化卡片外壳；C 项目记录也为直角底分割。头像与任务编号使用 50% 圆形，属于功能标记而非全局圆角 token。圆角与 spacing 索引仅供复现现有候选，不增加新的运行时主题层。

## Components

### Buttons / Fields / References

Action 渲染原生按钮，primary 或 secondary，触控 manipulation；primary 用主题 accent/白字，hover 用 accent-hover；secondary 白纸底、line 边框，hover 用 tint/accent 边框。disabled 改用 canvas/muted/line；未定义独立 active 位移。焦点由比较容器设 2px、偏移 3px，surface 改为该方向 focus，深色导航另有浅色焦点。

输入使用同一控制边界，read-only 换 canvas 底，textarea 最小 100px、纵向缩放；placeholder 使用 muted 且 opacity=1。引用 chip 有名称和移除 SVG 按钮，素材添加用 aria-pressed。状态与选中带文字或 SVG，不依赖色点。

### Navigation / Project / Candidate

三项应用按钮保留 screen 状态；A 是纵向目录，B/C 为顶部导航。C 任务队列以当前 screen 高亮，完成标记由打开项目日志、savedStyle、published 推导，仍可自由返回已有步骤。项目 card 既能点击图像，也能点击名称与继续设计。候选按钮更新 candidateId；选择轮廓、名字和修订共同标识对象，B 联系表与大图保持同步。

### Workflow Bindings

1. `trials` 以 `direction:projectId` 为键；各方向的活动项目独立。screen、prompt、references、candidateId、compare、chapter、草稿及操作记录保留在对应 Trial。切换方向会重挂载其 surface，局部 mobilePanel 重置为 designs；切换屏幕后搜索/面板这类局部 UI 状态也不保证保留。
2. 整理计划要求非空 prompt 且非只读，设置 proposal；确认模拟生成再检查 prompt、readonly、running、proposal。900ms 后复用已有 cuff 样图，设置 generated、candidateId=cuff；不是新增模型图像。
3. 保存款式绑定 savedCandidateId；首次保存或换方案递增 styleRevision，并清除 checked、published、exportState，进入技术包。技术包始终读取 savedCandidateId，不跟随尚未保存的新选择；未保存款式时有返回选定方案入口。
4. 技术包四章共享一份 Trial 草稿。编辑任一字段撤销复核与发布，重置导出状态。保存校验标题和数值；失败切到对应章。源码检查衣长大于 0 且最多 250，公差 0–10；UI 错误文案写 1–250，两者不完全相同，不将该差异合理化为生产校验标准。
5. 发布按钮只在非只读、无未保存修改、人工勾选且尚未发布时启用。下载要求 published 且无 dirty，通过 Blob/临时 object URL 输出当前资料 TXT，不是正式 PDF、后台发布或真实导出队列。
6. 重置清空 Trial、场景、活动项目和偏好，并取消 timer。页面刷新同样丢失全部内存草稿；没有 localStorage、sessionStorage 或后端持久化。

### States / Mobile Disclosure / Motion

测试场景为 normal、loading、error、empty、long、image-error、readonly。loading 与 error 替换主要内容，保留 Trial；结束加载/重试仅切回 normal。empty 项目可打开空白项目；搜索无结果可清空。真实图片 onError 显示资料与重试，强制 image-error 场景则按场景模拟失败。readonly 禁用引用、生成、保存和发布；切回只读前已模拟发布的资料仍可下载。

消息使用 role=status / aria-live=polite，错误面板 role=alert，加载面板 aria-busy。候选选择、引用数量、发布与已保存文字都是内存状态，不能据此推出真实权限或执行结果。

动效仅在 prefers-reduced-motion:no-preference 时启用：候选边界与按钮背景/边界 160ms ease-out，Skeleton 1.4s ease-in-out infinite alternate、opacity 0.55→1。无首屏入场时间轴；900ms 模拟生成延迟是业务演示计时，不能与视觉动画 token 混淆。

## Do's and Don'ts

### Do:

- Do 用同一项目和任务顺序比较三个方向，保持对象与已保存修订绑定。
- Do 读取当前 CSS 的实际候选值，先取得最终选择再推广生产主题。
- Do 在手机分别检查 designs、materials、assistant 三个面板和可展开比较设置。
- Do 明确标注模拟生成、人工复核与 TXT 交付，保留数据和素材来源。

### Don't:

- Don't 把默认 A、“记录偏好”或完成审查解释为用户最终选定方向。
- Don't 覆盖上级生产 DESIGN.md 或将候选局部 CSS 导入生产主题。
- Don't 声称刷新后保留草稿，或声称本页调用真实项目、模型、计费、队列和正式发布。
- Don't 把小号元数据、Georgia 品牌字母或现存实现局限升级为新的全平台规范。

**未规范化、未修复：** 极小元数据、按钮 font:inherit 的层叠差异、B 比较图高度覆盖、数值边界文案与实现差异均不被包装成通用设计原则；此记录不修改 UI。三个手机修正按源码记录，不提前签署最终视觉 verdict。候选通过检查也不等于最终选定、全平台实现或真实设计师认可。
