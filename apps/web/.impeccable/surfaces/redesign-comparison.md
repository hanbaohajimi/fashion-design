# 全平台设计方向比较

状态：用户已在 Impeccable 选择页选择 A「织物档案」，buildPath=code，无额外 steer。2026-10-25。保留 B/C 作为比较记录；生产推广以 A 为准。模式 Operate；应用界面 code-led。

## Grounded directions

1. 作品展台：服装陈列空间的白场、炭色字、赭色动作与完整轮廓；大图主视区、底部联系表、轻导航，选中作品在修改和交付之间保持。
2. 视觉识别手册：瑞士图形规范的严格对齐、蓝色与白色；固定栅格与统一对象标题，约束强于表现。
3. 织物档案：面料样本档案的青绿目录、暖白纸面、清晰索引；标准侧栏、并排方案、右侧资料，引用标签随对象附着。
4. 展览导览：空间导视的清晰区划与深紫信号；分区导航、固定定位和明确返回路径。
5. 时装编辑联系表：红褐标记与紧凑照片序列；批量比较、保留和选择有稳定位置。
6. 季节配色集：深蓝与砂色分类；颜色仅表达材料、状态和选择，资料按类别递进展开。
7. 秀场准备顺序：按准备状态排列的作品序列；任务、修订和交接清晰，状态变化保持行位置。

## Seed and challenger decisions

seed:b6415eb982199897，assigned 3。先展示织物档案，再展示作品展台（首选候选）和任务接力（competitive challenger）。用户明确要求3个可交互候选，因此原型数量固定为3；其他种子候选只记录比较结论，不增加原型。

- boarding-pass-and-gate-board：competitive。中性色、琥珀变更信号、稳定行身份和按优先级组织信息适用于任务接力。产品标准导航和按钮保留；不出现登机牌、条码或机场装饰。
- Japanese high-density web：declined。密集扫描可借鉴，但极小字和多层导航不利中文长文本与新手识别。提升织物档案的密度纪律：元信息聚合，正文与控件保持可读字号。
- zoo garden map：declined。形态与越界色域弱化服装轮廓及表单任务。提升区域辨识纪律：导航、作品与资料分区明确。
- character catalog：declined。可爱角色与人气排序不符合专业设计决策；学习稳定单元选择反馈，保留真实图片颜色。
- timetable slide rack：declined。倾斜面板降低长时阅读和表单效率；借鉴固定状态位置和数字对齐，不采用倾斜或玻璃。
- variable font specimen：declined。字体调节不是服装任务；借鉴当前对象即时反馈，在方案与技术包中保持相同对象。

## Direction contract

THESIS: 比较已完成方向选择，采用 A「织物档案」：稳定的深青绿目录、暖白工作面、并排服装与右侧助手；作品、资料和交付持续显示同一对象与修订。

OWN-WORLD: 织物档案以深青绿侧栏、暖白内容、青绿动作组织信息；作品展台以浅砂背景、炭色顶部与赭色动作突出完整服装；任务接力以深蓝队列、冷白工作面与蓝色动作区分步骤。所有方案采用清晰中文无衬线、标准按钮和表单。

STORY: 用户选择项目，引用同一素材、确认修改方案、选择服装结果，保存款式后继续技术包；对象、草稿和修订始终可定位。原型所有提交明确为模拟。

FIRST VIEWPORT: 顶部固定的比较控件不超过两个紧凑行。A为项目侧栏、并列方案和资料面板；B为顶导航、主服装大图与可切换资料；C为待办列表、当前任务与当前作品摘要。主操作置于实际操作区域，不在多处重复强调。

FORM: grounded 3 / 1 + competitive task-relay，seed:b6415eb982199897。三者均1440×900及390×844可用；首屏先给作品或待办，不添加宣传hero。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Boundaries

选择之前仅实现隔离原型；用户选择 A 后，已授权按原计划推广到生产前端。原型仍不得调用真实项目或模型。生产实现沿用现有 API、计费、权限、人工确认和修订规则，保留工作区原有修改及旧深链。此文不打包到浏览器。原型的参考尺寸为模拟，不用于生产。

## Selected evidence

选择页 ANSWER：optionId=archive，html=.impeccable/mocks/decision/archive.html，buildPath=code，buildPathFlipped=false，steer为空。所选 HTML 为组成结构参考；没有生成或获批 comp。三个候选的 27 张截图、审查和独立 verdict 位于 output/impeccable-redesign/；三个手机问题的修订被评为 resolved。该 verdict 只评价原型修订，不是全平台验收。
