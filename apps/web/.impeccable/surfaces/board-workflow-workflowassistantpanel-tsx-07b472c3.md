---
version: 1
slug: "board-workflow-workflowassistantpanel-tsx-07b472c3"
primary_target: "apps/web/src/modules/board/workflow/WorkflowAssistantPanel.tsx"
related_targets: ["apps/web/src/components/WorkspaceSplit.tsx","apps/web/src/modules/board/workflow/assistant-redesign.module.css"]
---

# 画布设计助手

Mode: Operate. 面向在桌面画布持续创作的服装设计师；手机保留查看、输入和关键操作。用户已明确选择代码实现、现有暖白深绿体系、图标工具栏、默认浮窗并支持停靠。

## Direction contract

THESIS: 同一个助手随创作位置展开，直接描述、明确引用、查看真实结果。信息围绕当前对话组织，重复头部和低频管理退出主流程。

OWN-WORLD: 继承森织暖白表面、深绿主动作、现有中文无衬线字体。18px/1.5px线性图标，透明工具按钮，轻分隔和克制阴影。

STORY: 从织芽展开同一会话，在输入框描述服装；通过加号与技能补充素材；执行状态简短可展开，结果图保持完整比例并可继续修改。

FIRST VIEWPORT: 右下400×640px浮窗，16px安全边距。一行标题与四个图标工具，中部单句欢迎与三条起步，底部独立输入框。切换右侧停靠保持草稿、引用、光标、消息锚点。

FORM: 用户指定LibTV式操作界面，code-led。方向来源是本会话用户原话“我希望你能够仿照liblibtv的助手设计”，随后明确选择保留浅色、直接创作、首次浮窗并记忆，并完整批准实施方案。依据 new-work.md 的 “a user- or brief-pinned direction beats the roll, always”，本轮由用户锁定方向替代概念抽签，不宣称运行过 concept-seed，也不伪造 seed reference。校准材料为用户首张 LibTV 截图及实际浏览器中核实的双形态界面。署名交互为持续挂载的浮窗/停靠切换；拖动与缩放只操作外壳，支持取消、键盘和减弱动态。

2026-11-14 用户追加的明确要求：引用采用其第二张 LibTV 截图中的小图片缩略图与角标序号，替换名称/类型大卡片。当前实现使用48px缩略图、顺序编号、横向滚动；名称与类型放在悬停及辅助技术说明中，手机从预览移除，桌面另有悬停移除入口。参考图：C:/Users/朱奕玮/AppData/Local/Temp/codex-clipboard-50518488-a971-4282-aea1-9a642f6906d7.png。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

2026-11-14录屏与动效接续：用户指定本机16.7秒录屏、LatticeLoader、RefineFrame、VoicePill三个源码参考，并明确语音采用点击开始／结束、文字进入草稿。新增交互为悬停图片预览、双击临时定位（保持选择／草稿）、返回原视野、缩略图 `@` 插入图号；已在用户LibTV页面核实双击与 `@` 的区别。动效与胶囊继承森织色彩、真实任务和真实麦克风采样，不新增图标库。代码实现的局部扩展，无新世界或生成设计稿；证据记录在 `doc/design/assistant-motion-voice-validation.md`，动态素材放于忽略的 `output/assistant-motion/`。

验收：1920/1440/1366/390/320及短屏；多图引用、历史、上传恢复、技能不覆盖、既有任务续办。保留业务API、权限、真实执行与当前工作区无关改动。不调用付费模型、不提交推送或CI。

2026-11-14完成记录：实现与产品行为已合并到 `apps/web/DESIGN.md`、`apps/web/PRODUCT.md`，证据与边界见 [画布助手改版验证](../../../../doc/design/assistant-redesign-validation.md)。分批去重后63项Vitest、89项单worker浏览器用例通过，类型检查与目标lint通过；独立复核在编号引用、弹窗内距、44px手机历史入口、方向来源四项修正后给出 `ship`，不扩大为整个表面的全面批准。生产位图仅复用既有 `sprout.webp`；本轮为既有视觉系统的局部扩展，保留 `.impeccable/design.json` 的已有内容和改动。

同日动效／语音接续完成：45项Vitest、50项不同浏览器用例分批通过，旧流程视图夹具1项失败单列于新验证记录。独立复核指出展开创作框语音反馈的顶部越界，改为框内滚动并完成1440／390补测后，该项verdict pass为 `ship`，仅覆盖所列修复。没有新增生产位图或改写全局token侧文件。
