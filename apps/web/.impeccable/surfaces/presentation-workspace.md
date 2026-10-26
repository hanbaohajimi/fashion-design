# 商品展示包工作区

Mode: Operate。Primary target: src/modules/studio/PresentationSets.tsx。

## Direction contract

THESIS: 以明确对象、素材整理和人工核对组织工作，取代辅助字段与重复边界支配的长表单。

OWN-WORLD: 沿用森织森林绿、暖中性色、中文无衬线与共享控件。主内容使用纸面，辅助资料直接位于暖色底；保留输入、选择与焦点边界，不给每个区域增加描边或阴影。

STORY: 知道正在整理的展示包，确认关联款式，选择真实素材，核对逐图内容，明确保存草稿与完成修订。无款式时允许临时整理，说明保存前置条件。

FIRST VIEWPORT: 紧凑对象头部；宽幅素材工作面配约 296px 资料列；底部可达的状态和保存操作。窄屏改正常文档流单列，无内部工作面滚动。

FORM: 用户确认的页面级结构，未进行随机概念选择；不推广其他子页。整理与核对共享草稿，资料始终可见。导航层级仅在本页启用。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 边界

不改 API、schema、图片顺序、人工核对、保存及生成语义。无新增排序或封面能力。保留修订历史、下载和 PDF 导出。继承现行 DESIGN.md，不替换全局规范。截图与验证结果写入 output/presentation-redesign/。

## 实施记录（2026-10-26）

已实现整理/逐图核对共享草稿、常驻资料、独立大图预览、显式保存与完成操作；导航层级和 768–1199px 功能选择器修复均由 presentation 属性限定。全局 DESIGN.md、design.json 与产品规范保持原样，本页结构不推广其他子页。详细继承、局部例外、真实截图与 fixture 来源、测试及终审状态见 [商品展示包工作区实施记录](../../../../doc/impeccable/商品展示包工作区实施记录.md)。真实截图中的旧主内容沿用新导航；它们不构成完整旧导航对比或真实保存/导出链路证据。

## 后续授权覆盖（2026-10-26）

样板完成后，用户明确要求“推广”。此前“不推广其他子页”“导航层级仅在本页启用”“DESIGN.md 与 design.json 保持原样”描述的是样板阶段边界，现由 [工作室层级推广契约](studio-workspace.md) 覆盖：同一层级原则扩展至其余 10 页，合计 11 个工作室子功能；共享标题、素材选择、常驻资料和保存状态，但各页按任务保留不同构图。本轮仅将已落地的工作室局部规则合并进 DESIGN.md 和 sidecar，不规定全应用双栏。商品展示包自己的断点、整理/逐图核对共享草稿、人工复核和保存语义继续有效。后续验证及限制见 [工作室层级推广实施记录](../../../../doc/impeccable/工作室层级推广实施记录.md)。
