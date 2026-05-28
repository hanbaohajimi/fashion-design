# Avant-Garde PRFAQ

## PR
The current fashion design system still behaves like a conventional SaaS workspace: fixed grids, rigid panels, and utility-first navigation. That model is efficient for record keeping, but it flattens the creative state that fashion work actually depends on. A designer editing fabric, color drift, texture layering, or silhouette nuance late at night does not think in boxes. They think in tension, sequence, atmosphere, and resonance. When the interface forces every object into a standard card, it compresses intent into administration.

This redesign replaces the management-table mindset with an immersive, fluid, curatorial space. The interface becomes a living field rather than a dashboard. Assets can be assembled as floating clusters, colors can diffuse across the surface through mouse motion, and the portfolio can unfold as a parallax stage instead of a static gallery. The result is not decoration for its own sake. It is a different cognitive frame: the system starts to behave like a studio that listens, adapts, and reveals context gradually.

The product now has three dominant creative paths.

First is the infinite mood-board weaving path. Instead of snapping everything to a grid, reference images, tags, swatches, notes, and project fragments can drift, collide, and settle into a responsive composition. The user can place inspiration as a soft spatial field, then pull meaning out of arrangement rather than from form-filling.

Second is the liquid color-field path. Color is no longer a chip in a palette drawer. It becomes a responsive atmospheric layer. Pointer movement can create diffusion, reveal accent trails, and subtly shift the perception of nearby surfaces. This gives the system a tactile link between the hand and the material language of fashion.

Third is the parallax theater path. Trend boards, design iterations, and material sequences can be staged horizontally with depth. Instead of jumping between pages, the user glides across a curated narrative of work. The system becomes easier to present to clients, collaborators, and internal reviewers because it turns process into spatial storytelling.

The architectural shift is simple: keep the data API, but replace the visual grammar. The result is a studio space that feels more like an exhibition installation than a management console.

## FAQ

### Why not keep the current grid layout and just polish the colors?
Because the problem is structural, not cosmetic. A grid-first SaaS layout optimizes density, not imagination. For fashion work, density alone creates visual fatigue and hides relationships between material, color, and mood.

### Will this slow down core work?
Not if the fluid layer is implemented as progressive enhancement. The studio still needs fast controls, keyboard access, and predictable fallbacks. The difference is that the interface gains a second mode of meaning-making for creative exploration and presentation.

### Is this just visual novelty?
No. The goal is to better match the mental model of the user. Fashion creators frequently work with ambiguity, atmosphere, and gradual refinement. A fluid interface supports that process by allowing composition to emerge.

### What stays unchanged?
The underlying data API, user/account flow, and production services remain intact. The transformation is concentrated in the front-end experience layer.

### What should success look like?
Users should spend less time fighting the interface and more time exploring ideas. The system should feel cinematic, but still precise. It should be presentable in a client review and still efficient enough for daily studio work.

## 隐性创作者场景

### 1. 情绪板无限编织路径
深夜创作者往往不是从“新建项目表单”开始工作，而是从一种模糊的视觉冲动开始：一块湿润的缎面、一张暗调摄影、一段廓形记忆、一个来自趋势报告的词。新版原型把这些对象组织为可漂浮、可拖拽、可碰撞的空间资产。用户进入情绪板后，不需要先分类；系统允许参考图、材质词、色彩和注释在同一个无界平面上并置。拖拽的动作本身就是思考动作。资产之间的轻微漂移暗示它们不是静态文件，而是正在形成关系的创作材料。

### 2. 液态色域漫延路径
颜色不再只是一个色板中的值，而是影响界面气氛的场。用户移动鼠标时，光晕、渐变和组件边缘的激活态会随坐标扩散。这个设计让色彩选择从“点击选项”变为“捕捉气氛”。当创作者尝试面料、材质和渐变演化时，界面不会打断其感受，而是把鼠标运动转译为可见的光场反馈。

### 3. 视差动态剧场路径
设计汇报通常需要把过程讲成故事。传统素材库只能展示结果，无法表达从趋势、情绪板、材质到成衣图的连贯性。视差动态剧场把作品横向展开，形成类似展览动线的叙事空间。用户可以沿着横向舞台浏览不同 look、材质阶段和输出结果，适合内部评审、客户展示和阶段汇报。

## MoSCoW 架构重组

### Must
- 保留底层数据 API，不改后端服务。
- 建立沉浸入口、情绪板、液态色域、视差剧场四个核心体验区。
- 使用真实图片源、线性图标、无 Emoji 的语义化 HTML。
- 提供鼠标光场、拖拽、视差、主题切换和 reduced motion 回退。

### Should
- 将现有设计工作台中的资产、趋势和素材库映射到无界空间。
- 为 iPad Pro 等触控设备保留至少 44px 控件热区。
- 使剧场模式可用于阶段汇报和作品集展示。

### Could
- 后续接入真实项目数据，将静态原型升级为 React 路由中的实验模式。
- 增加 WebGL 或 Canvas 粒子层，进一步增强 Mesh Gradient 的流体质感。

### Won't
- 不在这一版重写现有业务接口。
- 不破坏当前 SaaS 工作台的生产可用性。

## 重构前后信息架构图

```text
Before
Landing
  -> Auth
  -> Tool Selector
  -> Main Shell
       -> Design Studio: Canvas + Chat + Modal
       -> Trend Analysis: iframe
       -> Library: Grid + Drawer
       -> Trend Board: Cards + Drawer

After
Immersive Entry
  -> Fluid Creative Field
       -> Moodboard Weaving: assets float, collide, and cluster
       -> Liquid Chromatic Field: pointer-driven color diffusion
       -> Parallax Theater: horizontal narrative and presentation
       -> Live Console: state, controls, light/dark exhibition mode
```

## 高保真骨架说明

### 沉浸入口
首屏不再以工具列表为中心，而以巨型展示字体、动态光场和实时状态面板建立空间感。左侧是情绪宣言，右侧是策展状态与摄影预览，形成“进入展厅”的第一印象。

### 情绪板无限编织
页面使用 12 列流体栅格，但卡片内部摆脱格子锁定。参考图被 JS 转换为可拖拽的浮动资产，漂移和碰撞暗示材质之间的关系尚未固定。

### 视差动态剧场
剧场区横向滚动，每个作品卡片都占据大面积视口。图片随滚动和 hover 产生轻微缩放与位移，模拟策展空间中的景深。

## 灵感大师转译矩阵

| 灵感大师 | 方法论 | CSS / Web API 转译 |
|---|---|---|
| Refik Anadol | 数据化流体、动态梦境、机器视觉景观 | 全局 radial mesh gradient、`mix-blend-mode: screen`、噪点 overlay、CSS 变量驱动色场 |
| Zaha Hadid | 非线性空间、斜切流线、建筑纵深 | 大圆角与非对称跨列、纵深 `z-index`、错位网格、舞台式层叠 |
| Olafur Eliasson | 光感知、观者参与、空间衍射 | `--mouse-x` / `--mouse-y` 驱动光晕、pointermove 监听、交互式色域扩散 |
| Teenage Engineering | 微型精密控制、等宽参数美学 | JetBrains Mono、微型 console、紧凑状态芯片、44px 控件 |

