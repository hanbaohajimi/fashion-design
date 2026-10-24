# 画布视觉重构：从「流程图」到「裁缝台」

> 执行者：Opus 5.5 ｜ 方向：Atelier 裁缝台 ｜ 深度：重构节点视觉语言（不改交互范式、不改数据模型）｜ 动效：克制而有生命
> 本文是一份可直接执行的施工说明书。每一节都给出「为什么改 / 改成什么 / 改在哪个文件 / 怎么验收」。

---

## 一、为什么现在没有 Lovart 那种创意感、灵动感、舒适感、技术感

先把问题说透。四种感受不是四种装饰，而是四根独立的支柱，现在四根全都缺：

| 感受 | 它的真实来源 | 本系统现状 |
| --- | --- | --- |
| **创意感** | 画面上有「作品」，且作品被当成展品对待 | 节点是数据卡片，图片被塞进 256px 的缩略框里 |
| **灵动感** | 界面会回应你的手，且回应是可预期的 | 只有 hover 变色，没有任何跟随、生长、流动 |
| **舒适感** | 眼睛有落点、有呼吸、有层次，信息有静区 | 一片均匀米色 + 等大卡片，眼睛无处停留 |
| **技术感** | 对齐精确、比例严谨、信息可溯源 | 尺寸各自为政，标签中文「素材 · 设计约束」很散 |

拆成 9 个可验证的具体缺陷（全部有代码或像素证据）：

### 缺陷 1：没有主角，眼睛没有落点

画布可用区约 1060×830，而一张图的节点最大只有 `340px` 高（`workflow-graph.ts:41-52` 的 `maxImageHeight = 340 - captionHeight`）。服装图实际渲染约 210×250，占画布 **不到 1%**。其余 78% 是空米色。

用户看到的是「三张小卡片漂在一片没有边界的米色里」。空 ≠ 舒适；**空而没有焦点 = 未完成**。Lovart 的画布永远有一个大尺寸的主体在发光。

### 缺陷 2：所有节点长得一模一样

文本文节点、工具节点、图片节点：同宽 258px、同白底、同 1px 边框、同圆角、同 14px 加粗标题。
三种类别的全部差异是：
- 一个 `opacity: 0`、**只有 hover 才出现**的 12px 灰色 eyebrow（`workflow-node.module.css:88-102`）；
- 一条 2px 的顶部色线（`workflow-node.module.css:10-12`）——在 14px 边框的噪声里几乎不可见。

**信息在没有层级时等于零。** 「不明显」的第一个根因就在这里：类型标识是隐藏的，尺寸是相同的。

### 缺陷 3：节点里没有「作品」，只有占位

「设计约束」节点是标题 + 约 60px 空白。它不承载任何可看的东西，也不能被欣赏。
创意工具的核心是**让用户想截图分享**；现在没有任何一个节点值得截图。

### 缺陷 4：连线是「线」，不是「关系」

`stroke-width: 1.25`、`opacity: 0.58`、`--color-ink-tertiary`、箭头只有 5px（`workflow-connections.module.css:17-29`、`WorkflowEdgeShape.tsx:65-68`）。

它读起来像电路板走线，而不是「从这个到那个」的工序。没有流动、没有重量、没有活跃路径的强调。

且 `flowData` 动画作用在 `.edgeLine::after`（`workflow-connections.module.css:34-42`）——**SVG `<path>` 不支持 `::after`**，这段动画从来没有生效过。这是一处死代码，也是「灵动感」缺失的直接证据。

### 缺陷 5：深度被主动删除了（最关键的一条）

`workflow-node.module.css:299-305` 这几行覆盖了上面所有的材质设计：

```css
.node { animation: none; box-shadow: none; border-radius: var(--radius-lg); font-family: var(--font-sans); }
```

`box-shadow: none` 让节点彻底贴在画布上——`--shadow-material-1` 白写了。
`animation: none` 杀掉了入场动效。
`font-family: var(--font-sans)` 杀掉了衬线标题。

同文件第 20 行的注释写着「明确的层次感：节点从画布浮起」，第 299 行把它关掉了。**这是全仓库性价比最高的单点修复。**

### 缺陷 6：画布没有材质，也没有尺度参照

`background-color: #F1EFEA` + 0.7px、11% 透明度的 28px 点阵（`workflow-canvas.module.css:168-175`）。
单一密度、无暗角、无二级网格。放大缩小时，用户无法感知自己在哪一层、东西有多大。

### 缺陷 7：配色被锁死在低对比的暖灰里

底色 `#F1EFEA`、纸面 `#FCFBF8`、surface `#E9E6DF` —— 三者亮度差约 3%。整屏没有**深色锚**，也就没有视觉重心。
强调色只有一条 2px 的 mauve 线。全页唯一有颜色的是用户自己的图。

暖灰本身是对的（这是「墙/纸」的定位），缺的不是换色，是**引入一个深色锚 + 让强调色真正被使用**。

### 缺陷 8：排版对比度太平

界面只有一个字重档、一个 14px 档在承担几乎所有信息。类型标签是中文「素材 · 设计约束」，散、且不含信息（用户看不出「约束」和「需求」有什么区别）。
缺少等宽字体标注（metadata 的专业感来源）、缺少大字号标题（画面重心来源）。

### 缺陷 9：浮层互相打架

同时存在三个浮动控件：左下 `＋添加素材 / ＋添加工具`、右下 `− 查看全图 100% ＋`、左侧角落「设计轨迹」。
三者视觉权重相同，都是灰边框胶囊。真正的主操作（添加）和一个低频操作（缩放）**没有区分**。

---

## 二、设计纲领：四条硬法则

后续所有改动都必须服从这四条，否则就是「换了个皮，还是乱的」。

### 法则 1：每屏必须有一个「大」的东西

画布上必须有一个节点占据**至少 22% 的画布高度**，且一眼看出它是主角。层级靠尺寸建立，不靠边框颜色。

### 法则 2：类别靠「位置 + 颜色 + 字形」三重编码

同一信息用三种独立通道重复编码，扫视 300ms 内可辨：
- **位置**：类别色条永远在最左侧（垂直），而不是顶部 2px 线；
- **颜色**：每类一个染料色，作为 3px 实色条 + 同色淡底；
- **字形**：类别用等宽大写小字（`MATERIAL` / `TOOL` / `RESULT`），与中文标题形成对比。

### 法则 3：深度必须真实存在

任何躺在画布上的东西都必须有：边框（hairline）+ 近距阴影 + 远距环境影。
hover 再抬升 2px。禁止 `box-shadow: none`。

### 法则 4：动效只出现在「有事情发生」的时刻

入场（错峰）、连线生长、运行中流动、完成落定、hover 抬升。
禁止：常驻动画、装饰性循环、与操作无关的呼吸。所有动画 200–400ms，全部尊重 `prefers-reduced-motion`。

---

## 三、Token 改造（第 1 阶段地基）

### 3.1 颜色：新增深色锚 + 让染料色真正上场

改 `apps/web/src/styles/design-system.css` 的 `:root`。

**新增：**

```css
/* 木/墨：唯一的深色锚，用于画布上的「重量级」物件 */
--color-ink-strong: #16130F;      /* 深墨：大标题、主按钮底、选中导览条 */
--color-walnut: #2B231C;          /* 胡桃木：画布边缘暗角、标签底 */

/* 画布新表面：墙 / 台 / 纸 三层，亮度差已拉开到可辨 */
--color-canvas: #EFEBE3;          /* 原 #F1EFEA，略深半档，让纸浮起来 */
--color-canvas-edge: #E4DFD5;     /* 新增：画布暗角外圈 */

/* 类别染料（沿用现有色板，只调用途） */
--accent-primary: var(--swatch-indigo);    /* 选中、连线、可放置 */
--accent-active:  var(--swatch-madder);    /* 运行中、活跃流动 */
```

**修改：**

| Token | 原值 | 新值 | 为什么 |
| --- | --- | --- | --- |
| `--image-stage-background` | `#E5E5E5` | `#EAE5DB` | 冷灰在暖底上发脏，是「图看起来廉价」的直接原因 |
| `--color-border` | `rgba(31,29,26,.14)` | `rgba(31,29,26,.16)` | 边框要能撑住 3px 类别条 |
| `--color-divider` | `rgba(31,29,26,.07)` | `rgba(31,29,26,.09)` | 分隔线太虚 |

### 3.2 阴影：三层真实深度

```css
/* 纸片：贴附在台面上，近距阴影极浅，环境影很淡 */
--shadow-material-1: 0 1px 1px rgba(31,29,26,.04), 0 2px 6px rgba(31,29,26,.06), 0 8px 18px -8px rgba(31,29,26,.10);

/* 选中：三层叠加，第二层是 1px 的亮色内描边，模拟纸的切边 */
--shadow-material-2: 0 1px 2px rgba(31,29,26,.05), 0 6px 16px -4px rgba(31,29,26,.12), 0 18px 40px -12px rgba(31,29,26,.16);

/* 拖拽中：抬离台面 */
--shadow-material-3: 0 2px 4px rgba(31,29,26,.06), 0 14px 32px -6px rgba(31,29,26,.18), 0 32px 64px -24px rgba(31,29,26,.22);
```

阴影统一带暖调（基色 `31,29,26`），不要用纯黑 `rgba(0,0,0,.1)`——纯黑阴影会让米色底发灰。

### 3.3 字号：建立三档对比

| 用途 | 值 | 备注 |
| --- | --- | --- |
| 节点标题（大节点） | `19px / 1.25` serif `600` | 新的视觉重心 |
| 节点标题（标准） | `15px / 1.3` serif `600` | 原 14px 加粗 |
| 类别元数据 | `10.5px / 1 mono 600` `letter-spacing: .14em` `uppercase` | 技术感的主要来源 |
| 节点正文 | `13px / 1.6` sans `400` | 原 14px |
| 芯片/徽章 | `11px` mono `500` | |

等宽字体标签是「技术感」最便宜也最有效的开关。中文标签放在等宽英文之后作为副标：
`MATERIAL · 约束`、`TOOL · 生成方案`、`RESULT · 候选方案`。

### 3.4 间距

沿用现有 `--space-*`（4px 栅格），但节点内边距改为统一 `20px`（原 12px/14px），标题与正文间距 `10px`。理由：padding 12px 是「表单」，padding 20px 是「版面」。

---

## 四、节点重构（核心，第 2 阶段）

### 4.1 节点解剖（自上而下）

```
┌──────────────────────────────┐
│▌ MATERIAL · 约束           ⋯ │  ← 左侧 3px 类别色条贯穿整卡；右侧省略号菜单
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │      作品 / 图像区      │  │  ← 4:5 或 3:4，`object-fit: cover`（有主图时）
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  藏蓝通勤外套                 │  ← serif 19px，2 行截断
│  深藏蓝羊毛混纺，宽松直身…    │  ← sans 13px，2 行截断，ink-secondary
│                              │
│  ┌ 已完成 ┐       ○ ○        │  ← 状态芯片 + 端口（黄铜环）
└──────────────────────────────┘
```

要点：
- **类别色条**：`border-left: 3px solid var(--cat-color)`，从顶到底，整卡高度。不要只在顶部。
- **类型标签常驻**：`opacity: 1` 永远可见（删除 `:hover` 才显示的规则）。这是法则 2 的前提。
- **图片用 `cover` 而非 `contain`**：`cover` 让服装填满框，更有「展品」感；`contain` 让图变小、露出灰底，是现在「图小、空、廉价」的直接原因。若担心裁切服装细节 → 提供「适应/填充」切换，默认 `cover`。
- **图片框底色**：`--image-stage-background`，且加一层内阴影 `inset 0 0 0 1px rgba(31,29,26,.06)`，像被压进纸里。

### 4.2 尺寸层级（法则 1 的落地）

改 `apps/web/src/modules/board/workflow/workflow-graph.ts:41-78`：

| 节点 | 旧尺寸 | 新尺寸 | 说明 |
| --- | --- | --- | --- |
| `candidate` / `reference_image` / `sketch` | 宽 256/320，高上限 340 | **宽 340–400，高上限 460** | 主角档。4:5 竖版服装图在 1440×900 下高约 440，占画布 45% 高 |
| `fabric` | 同上 | 宽 300，高上限 380 | 载体档 |
| `brief` / `reference_text` / `constraint` | 258×172 / 196 | **300×200** | 标准档 |
| 工具节点 | 258×186 | **300×168** | 工具是「过程」，应该比素材矮——用高度差表达「工具服务于素材」 |
| `swatch` | 258×148 | **236×236** | 改成正方形色卡，像布料样本 |
| `evaluation` | 258×196 | **300×220** | |

**并新增一条规则**：`candidate` 若为当前选中节点，渲染放大 8%（通过 tldraw shape 的 `w/h` 直接改，不做 CSS scale，避免坐标错位）。

### 4.3 卡片样式（改 `workflow-node.module.css`）

**第一步：删除第 299–305 行的整体覆盖块。** 它覆盖了入场动画、阴影、圆角与衬线标题。删掉后逐条重写：

```css
.node {
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--cat-color, var(--swatch-linen));
  border-radius: 10px;
  padding: 18px 18px 14px;
  background: var(--color-paper);
  box-shadow: var(--shadow-material-1);
  animation: nodeEnter var(--dur-enter) var(--ease-enter) backwards;
  animation-delay: calc(var(--enter-index, 0) * 45ms);   /* 错峰入场 */
  transition: box-shadow var(--dur-standard) var(--ease-state),
              transform var(--dur-standard) var(--ease-state);
}

.node:hover {
  box-shadow: var(--shadow-material-2);
  transform: translateY(-2px);
}
```

类别色通过 `data-type` 映射：
```css
.node[data-kind="tool"]            { --cat-color: var(--swatch-mauve); }
.node[data-type="candidate"],
.node[data-type="reference_image"],
.node[data-type="sketch"]          { --cat-color: var(--swatch-indigo); }
.node[data-type="evaluation"]      { --cat-color: var(--swatch-madder); }
.node[data-type="fabric"]          { --cat-color: var(--swatch-turmeric); }
.node[data-type="constraint"]      { --cat-color: var(--swatch-sage); }
```

选中态：
```css
.node[data-highlighted="true"] {
  box-shadow: 0 0 0 3px var(--swatch-indigo-wash), var(--shadow-material-2);
  border-color: var(--swatch-indigo);
  border-left-color: var(--swatch-indigo);
}
```

**`--enter-index` 的注入**：在 `WorkflowProjection`（`WorkflowCanvas.tsx:181-352`）里，按节点到图起点的 BFS 深度写入 shape 的 meta 或一个 `enterIndex` prop，让「上游先落、下游后落」。这是「灵动感」的核心节奏。

### 4.4 端口：从 6px 圆点改成黄铜环

```css
.interactivePort > span:first-child {
  width: 11px; height: 11px;
  border: 1.5px solid var(--color-ink-tertiary);
  background: var(--color-paper);
  box-shadow: inset 0 0 0 2px var(--color-paper);   /* 制造双环（黄铜环）效果 */
  opacity: .45;
}
.node:hover .interactivePort > span:first-child { opacity: 1; }
```
在 `WorkflowNodeShape.tsx:274-317` 的结构上改样式即可，DOM 不动。
触屏仍保持 44px 命中区（`@media (pointer: coarse)` 已有，保留）。

---

## 五、连线系统（第 3 阶段）

改 `workflow-connections.module.css` + `WorkflowEdgeShape.tsx`。

### 5.1 从「线」变成「工序」

```css
.edgeLine { stroke-width: 1.5; opacity: .72; stroke-linecap: round; }
.edge:hover .edgeLine,
.edge[data-highlighted="true"] .edgeLine { stroke-width: 2; opacity: 1; stroke: var(--swatch-indigo); }
```

### 5.2 修好流动动画（现在完全没生效）

`::after` 对 SVG 无效。正确做法是在 `EdgeView` 里叠第二条 path：

```tsx
<path className={styles.edgeLine} d={curve.d} />
<path className={styles.edgeFlow} d={curve.d} />   {/* 新增 */}
```

```css
.edgeFlow {
  fill: none;
  stroke: var(--swatch-indigo);
  stroke-width: 2;
  stroke-dasharray: 2 14;
  stroke-linecap: round;
  opacity: 0;
  pointer-events: none;
  vector-effect: non-scaling-stroke;
  transition: opacity var(--dur-standard) var(--ease-state);
}
.edge[data-highlighted="true"] .edgeFlow,
.edge[data-selected="true"] .edgeFlow,
.edge[data-running="true"] .edgeFlow {
  opacity: .85;
  animation: edgeFlowMove 1.6s linear infinite;
}
@keyframes edgeFlowMove { to { stroke-dashoffset: -32; } }
```

`data-running` 由 `WorkflowEdgeShapeUtil` 从「源节点 status === running」推导（在 `WorkflowProjection` 里投影时写入 props，已有 `highlighted/proposed` 两个布尔 prop 的成熟模式可复用）。

### 5.3 连线生长入场

节点落下后，连线从源到目标「生长」出来：
```css
.edgeLine { stroke-dasharray: var(--len); stroke-dashoffset: var(--len); animation: edgeDraw 320ms var(--ease-enter) forwards; animation-delay: calc(var(--enter-index) * 45ms + 180ms); }
@keyframes edgeDraw { to { stroke-dashoffset: 0; } }
```
`--len` 由 `curvePath` 返回的 `points` 长度近似（`workflow-curve.ts` 已经在返回采样点，可直接累加段长）。注意：`stroke-dasharray` 与 5.2 的 `edgeFlow` 同时存在时，**只给 `edgeLine` 加生长动画，`edgeFlow` 不参与**，否则两个 dash 会互相干扰。

### 5.4 箭头

现有 5px 箭头太小。改成 8px、`stroke-linejoin: round`，并且始终可见（现在 `opacity: .58` 时几乎看不到）。可改为在终点画一个小三角 `path` 填充，比两段线更清晰。

---

## 六、画布表面（第 4 阶段）

改 `workflow-canvas.module.css:168-227`。

```css
.canvasSection {
  background-color: var(--color-canvas);
  background-image:
    /* 二级网格：每 5 格加一个稍重的点，提供尺度参照 */
    radial-gradient(rgb(66 62 55 / 18%) 1px, transparent 1px),
    radial-gradient(rgb(66 62 55 / 10%) 0.8px, transparent 0.8px),
    radial-gradient(ellipse 75% 60% at 50% 45%, transparent 55%, rgb(43 35 28 / 6%) 100%);
  background-size: 120px 120px, 24px 24px, 100% 100%;
  background-position: center, center, center;
}
```

三层的意义：
1. **120px 重点阵** → 给了尺度参照，放大时知道自己在第几层；
2. **24px 细点阵** → 提供了「这是工作面」的暗示；
3. **暗角** → 把视线收拢到中心，直接消除「空而无焦点」的感觉。

同时把空状态（`workflow-canvas.module.css:230-268`）改成有重心的构图：主标题 32px serif + 一条细分割线 + 一个实色主按钮（`--color-ink-strong` 底、米色字）。

> ⚠️ 暗角是 `background-image`，**不会进入 tldraw 的 SVG 导出**。导出 PNG 时节点自带阴影即可，画布底保持纯色。这一点符合预期，无需额外处理。

---

## 七、浮动控件收敛（第 5 阶段）

改 `workflow-canvas.module.css` 的 `.bottomMenu` / `.zoomControls`，以及 `WorkflowCanvas.tsx:781-806`。

**合并为一个底部居中控制条**：

```
┌────────────────────────────────────────────┐
│  ＋ 添加 ▾   │  ⊞ 节点   │ ⊖ 100% ⊕  ⤢ 适配 │
└────────────────────────────────────────────┘
```

- 主操作「＋ 添加」用 `--color-ink-strong` 实底 + 米色字，高度 40px，左右 20px 内边距；
- 其余为 ghost 按钮；
- `缩放` 与 `适配` 留在同一条里，去掉右下角的独立 zoom dock；
- `?` 帮助收进「＋ 添加」旁的溢出菜单；
- 左侧「设计轨迹」标签删除或弱化为 `12px` 的 `ink-tertiary`——画布上不需要一个标签告诉用户这是画布。

视觉重量：控制条用 `--shadow-material-2` + `--color-paper`，圆角 `14px`，与节点采用同一套阴影语言（现在工具栏和节点是两套语言）。

---

## 八、动效规格（贯穿，第 6 阶段）

全部用 CSS 实现，**不引入任何动画库**（仓库当前无动画依赖，保持）。

| 场景 | 规格 | 实现位置 |
| --- | --- | --- |
| 节点入场 | `translateY(10px) + opacity 0→1`，200ms `ease-enter`，按 BFS 深度每层 +45ms | `workflow-node.module.css` + Projection 注入 `--enter-index` |
| 连线生长 | dashoffset 320ms，晚于源节点 180ms | `workflow-connections.module.css` |
| 运行中流动 | `edgeFlow` dash 位移 1.6s linear infinite | 同上 |
| 运行中节点 | 状态芯片的 dot 脉冲（现有 `statusPulse` 保留，只用在 running） | `workflow-node.module.css` |
| 完成落定 | 芯片 `scale .92→1` + 背景 wash 闪一次，180ms | 新增 `data-status="completed"` 的一次性 keyframe |
| hover 抬升 | `translateY(-2px)` + `shadow-material-1 → 2`，180ms | `workflow-node.module.css` |
| 拖拽中 | `shadow-material-3` + `scale(1.02)`，120ms | 现有 tldraw 拖拽态可加 `data-dragging` |
| 联动高亮 | 非血缘节点 `opacity .45`，200ms | 已有 `highlighted/muted` props，配 `transition: opacity` |
| 缩放降级 | `< 0.85` 时隐藏 summary（现有 `data-compact` 逻辑保留），并隐藏类别英文、只留色条 | `workflow-node.module.css:31` |

**`prefers-reduced-motion` 必须全部降级为静态**：现有规则只关了 transition，需要补 `animation: none` 并让 `edgeFlow` 不显示。

---

## 九、执行顺序与文件清单

按顺序做，每阶段结束跑一次验收（见第十节）。**不要一次性全改，否则视觉基线无法归因。**

### 阶段 1 — Token 地基
- `apps/web/src/styles/design-system.css`：新增墨/胡桃木/图像台色，重写 `--shadow-material-1/2/3`，改 `--color-border/divider`。
- `apps/web/src/styles/motion-tokens.css`：如有缺失补 `--dur-*`（已够用，预计不改）。

**验收**：其他页面（面料库/趋势）不出现明显视觉退化——它们复用同一批 token。

### 阶段 2 — 节点解剖与尺寸层级
- `apps/web/src/modules/board/workflow/workflow-graph.ts:41-78`：重写 `imageNodeSize` / `nodeSize` 的尺寸常量。
- `apps/web/src/modules/board/workflow/workflow-node.module.css`：**先删 299-305 行**，再按 §4.3 重写 `.node`、`.eyebrow`、`.nodeHeader strong`、`.imageFrame img`（`contain → cover`）、`.toolStatus`、端口样式。
- `apps/web/src/modules/board/workflow/WorkflowNodeShape.tsx:200-272`：eyebrow 内容改为 `MATERIAL · 约束` 形式（英文类别 + 中文类型），图片帧可加一个「适应/填充」切换按钮。
- `apps/web/src/modules/board/workflow/WorkflowNodeShape.tsx:166-170`：`getIndicatorPath` 的 `roundRect` 半径从 12 改为 10，与 CSS `border-radius` 对齐。

**验收**：1440×900 下 `candidate` 节点高度 ≥ 340px；三类节点在不 hover 时即可区分。

### 阶段 3 — 连线
- `apps/web/src/modules/board/workflow/workflow-connections.module.css`：按 §5 重写。
- `apps/web/src/modules/board/workflow/WorkflowEdgeShape.tsx:33-90`：加 `edgeFlow` path；箭头改 8px。
- `apps/web/src/modules/board/workflow/WorkflowEdgeShape.tsx:16-30`：props 增加 `running: boolean`（tldraw shape props 需在 `RecordProps` 里加 `T.boolean`）。
- `apps/web/src/modules/board/workflow/WorkflowCanvas.tsx` 的 `WorkflowProjection`：投影 edge 时计算 `running`（源节点 status）。
- `apps/web/src/modules/board/workflow/workflow-curve.ts`：导出 `curveLength(endX, endY, detourY)`（对现有 `points` 累加），供生长动画使用。

**验收**：选中一条边，能看到流动的点在动；缩放画布时线宽不变（`non-scaling-stroke` 保留）。

### 阶段 4 — 画布表面
- `apps/web/src/modules/board/workflow/workflow-canvas.module.css:168-227`：三层背景。
- 同文件 `:230-268`：空状态重构。

### 阶段 5 — 控件收敛
- `apps/web/src/modules/board/workflow/workflow-canvas.module.css:272-360`：合并 `.zoomControls` 进 `.bottomMenu`。
- `apps/web/src/modules/board/workflow/WorkflowCanvas.tsx:781-806`：调整 DOM 顺序与按钮层级。

### 阶段 6 — 动效与可访问性收口
- 补齐 `prefers-reduced-motion` 分支。
- 全量跑视觉回归。

---

## 十、验收标准（可测量）

1. **主角**：1440×900 下，`candidate` 节点高度 ≥ 340px，占画布可视高度 ≥ 22%。
2. **可辨**：截断截图后，在 300ms 内可说出三种节点的类别（不看 hover、不看文字细节）。
3. **深度**：节点与画布之间有可见阴影；`getComputedStyle(node).boxShadow !== "none"`。
4. **连线**：选中边的 `edgeFlow` 有非零 `animation-duration`；`prefers-reduced-motion: reduce` 下为 0。
5. **可访问性**：`tests/e2e/review-accessibility.ts` 的 `contrastFailures` 与 `controlFontFailures` 均为空；触屏控件 ≥ `--control-height-touch`。
6. **回归**：`tests/visual/atelier.spec.ts` 的基线需要重新生成（`studio-desktop.png`、`sketch.png`、`studio-*-touch.png`），**但只允许更新画布相关基线**；面料库、趋势、登录等不应变化——若发生变化，说明 token 改动影响了非目标页面，必须回退。
7. **导出**：`导出画布 PNG` 的产物中节点仍有阴影与类别色条（tldraw SVG 导出走 `exportStyle`，已带 `animation: none`，需确认新加的 `edgeFlow` 在导出时不渲染）。

**验证命令：**
```bash
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web test
pnpm exec playwright test tests/visual/atelier.spec.ts --update-snapshots
pnpm exec playwright test tests/visual/atelier.spec.ts
```

---

## 十一、边界与风险（务必遵守）

- **不改** 数据模型（`workflow-api.ts` 的类型）、端口连接规则（`packages/shared/src/workflow-connections.ts`）、布局保存队列（`workflow-layout-save.ts`）、导出逻辑。
- **不改** tldraw 的坐标体系。所有尺寸改动都必须同时更新 `workflow-graph.ts` 的尺寸函数，因为 `WorkflowProjection` 用同一套尺寸写 shape 的 `w/h`；只改 CSS 会导致端口、连线和坐标错位（仓库历史上已有同类回归：`fix(canvas): refresh viewport bounds before capturing drag origins`）。
- **禁止** 在 `.edgeLine` 与 `.edgeFlow` 上同时挂 `stroke-dasharray` 动画。
- **禁止** 使用纯黑阴影。
- `--image-stage-background` 从冷灰改为暖灰会影响所有图片节点，属预期改动，但需在视觉基线里确认不是「整体发黄」。
- 触屏（390px）下画布只剩约 390px 宽，§4.2 的大尺寸会把节点撑满屏幕——**移动端必须回退到标准档尺寸**（在 `nodeSize` 里按视口宽度分支，或保持 258/300 档）。
