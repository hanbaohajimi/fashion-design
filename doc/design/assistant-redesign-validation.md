# 画布助手改版与编号引用验证

日期：2026-11-14。范围为无限白板中的设计助手、浮窗/停靠外壳及相邻图片引用入口。现行规范见 [DESIGN.md](../../apps/web/DESIGN.md)、[PRODUCT.md](../../apps/web/PRODUCT.md)；用户批准的方向与追加要求保存在 [表面契约](../../apps/web/.impeccable/surfaces/board-workflow-workflowassistantpanel-tsx-07b472c3.md)，机器检查汇总位于 [verification.json](../../output/assistant-redesign/verification.json)。

本轮采用用户指定的 LibTV 式简洁助手、图标工具栏、直接对话创作、默认浮窗与一键停靠，继续使用森织暖白/深绿体系。引用按用户第二张参考图改为“小缩略图＋角标编号”。方向由用户锁定，没有运行概念抽签，也没有新增或替换全局视觉系统。

## 已实现行为

| 部分 | 当前行为与边界 |
| --- | --- |
| 浮窗与停靠 | 首次展开为右下400×640px浮窗，16px边距；桌面宽360–600px、最小高440px，超出可用区域时受视口约束。停靠保留至少640px画布和6px分隔区；空间不足回到浮窗，手机全屏。位置、大小、呈现、停靠宽度与展开状态按账号/项目恢复。拖动、缩放与键盘调整支持取消，切换保留同一聊天实例、光标、草稿、引用、阅读锚点、流式回复与画布视野。 |
| 标题与工具 | 合并重复头部；标题打开可搜索、分页追加的历史。新建对话、停靠/浮窗、更多、收起/返回画布为具名图标。手机和粗指针下标题历史入口与主要图标命中区至少44px。 |
| 空态与输入 | 一张静态嫩芽、欢迎句、三条起步行；起步仅预填草稿或打开上传，不发送、不创建生成任务，已有正文不被覆盖。加号提供上传/引用，技能卡片打开技能，圆形上箭头发送，方形图标停止回复。短屏保留输入和发送操作，中文输入法守卫继续生效。 |
| 编号引用 | 48×48px图片使用contain保持完整比例，18px角标按明确引用顺序编号，单行横向滚动。名称/类型在Tooltip、预览和屏幕阅读器说明中呈现；文字/色卡使用紧凑类型图标和详情预览。桌面悬停/聚焦可移除，键盘支持Delete；手机打开预览后通过44px动作移除，关闭后焦点回到剩余引用或加号入口。失效引用保留到用户明确清除，新引用不会静默丢弃旧项。 |
| 引用与摆放 | 多选、粘贴、拖入、私有上传和草稿恢复沿用既有链路。点击引用只预览；只有 `reference_image` 的“放入画布”调用已有 `place_reference_image` 命令，其他素材预览不借用该命令。没有自动摆放或自动生成。单图工具栏恢复“引用到助手”和“取消选择”图标，普通画布选择仍不自动引用。 |
| 技能 | 内置、个人、工作区技能使用原权限和缓存机制。非空草稿先预览，再明确追加、替换或取消；引用保持，超长时显示就地错误并保留原正文。技能预览和已有任务弹窗使用桌面24px、手机20px内距。 |
| 既有任务 | 更多菜单保留“设计要求”、可用时的“本轮结果”、“历史任务”及浮窗位置恢复。主助手不提供新建定时委托、独立规划模式或项目暂停开关；原组件通过 `allowCreate=false` 与只读保护继续管理旧任务。已有暂停项目可由有编辑权的用户在输入区恢复，后台接口没有移除。 |
| 执行与结果 | 折叠摘要来自真实任务状态，详情可展开。停止回复与停止已提交图片任务分别处理。结果图完整展示，以图标预览、继续修改和比较；回执固定历史资产身份，部分失败保留有效图片。既有自然语言执行、权限、幂等、SSE、本机草稿和未知回执机制继续使用。 |
| 阅读与恢复 | 历史分页、阅读锚点、回到最新和发送后草稿连续性保留；非模态阅读区显式处理Home/End。浮窗手势只更新外壳，不逐帧重建聊天或画布。 |

实现依据：窗口规则见 [assistant-window-geometry.ts](../../apps/web/src/components/assistant-window-geometry.ts)、[WorkspaceSplit.tsx](../../apps/web/src/components/WorkspaceSplit.tsx) 与 [AssistantWindow.tsx](../../apps/web/src/components/AssistantWindow.tsx)；输入、引用及菜单见 [WorkflowAssistantPanel.tsx](../../apps/web/src/modules/board/workflow/WorkflowAssistantPanel.tsx)、[助手局部样式](../../apps/web/src/modules/board/workflow/assistant-redesign.module.css) 与 [AssistantReferenceViewer.tsx](../../apps/web/src/modules/board/workflow/AssistantReferenceViewer.tsx)。

## 本地验证

共63项不同Vitest用例、89项不同浏览器用例通过。浏览器使用单worker，结果来自分批执行；同一用例的修正后重跑不重复累加。最后一次集中Vitest复跑为10个文件、63项通过（9.74秒），因此没有把这次复跑再加到总数中。

| 检查 | 结果与范围 |
| --- | --- |
| Vitest | 63项通过：窗口几何/偏好兼容、布局、起步、执行取消、结果、旧委托、提及、中文输入法、指引文案与模型。 |
| 浏览器 | 89项通过：助手改版15、历史12、上传18、执行10、结果11、多素材引用11、织芽桌面/触屏定向2、明确摆放10。原77项加新增编号引用2项和摆放10项；最近11项编号引用/弹窗定向检查属于复测。 |
| 类型检查 | 最新 `@fashion/web` 类型检查通过。`ImageShape.tsx` 中一处不可达分支做了最小修正以恢复类型检查，没有预期行为变化。 |
| 目标ESLint | 改版目标检查零警告通过；最后编号引用更新后的面板/预览/查看器、偏好/布局/几何测试和ImageShape分别复查通过。 |
| 差异检查 | 目标 `git diff --check` 通过；已有换行风格提示不构成错误。 |

参考摆放的10项覆盖桌面/窄屏、未知回执、失败续办、摆放期间关闭、只读、图片加载失败/移除、保存失败，以及320×400下的键盘焦点。新增2项编号引用检查覆盖1440px与390px布局、完整比例缩略图、编号、预览移除及焦点恢复。

在仓库根目录执行的集中单元验证命令：

```powershell
pnpm --filter @fashion/web test src/modules/board/workflow/AssistantStarters.spec.tsx src/modules/board/workflow/AssistantExecutionStatus.spec.tsx src/modules/board/workflow/AssistantResultGallery.spec.tsx src/modules/board/workflow/AssistantDelegationsPanel.spec.tsx src/modules/board/workflow/AssistantMentionInput.spec.tsx src/modules/board/workflow/use-workspace-layout.spec.ts src/components/assistant-window-geometry.spec.ts src/components/assistant-ime.spec.ts src/components/feature-guide/guide-copy.spec.ts src/components/feature-guide/guide-model.spec.ts
pnpm --filter @fashion/web typecheck
```

最终更新后的目标静态检查命令：

```powershell
pnpm --filter @fashion/web exec eslint src/modules/board/workflow/WorkflowAssistantPanel.tsx src/modules/board/workflow/AssistantReferencePreview.tsx src/modules/board/workflow/AssistantReferenceViewer.tsx --max-warnings=0
pnpm --filter @fashion/web exec eslint src/components/workspace-preferences.ts src/modules/board/workflow/use-workspace-layout.ts src/components/assistant-window-geometry.spec.ts --max-warnings=0
pnpm --filter @fashion/web exec eslint src/modules/board/shapes/ImageShape.tsx --max-warnings=0
```

浏览器记录按上表批次统计，可用以下命令复查相应完整文件；织芽只计入本轮两项定向用例，不把整个旧测试文件的数量加入本轮总数：

```powershell
pnpm exec playwright test tests/e2e/assistant-redesign.spec.ts tests/e2e/assistant-history.spec.ts tests/e2e/assistant-image-uploads.spec.ts tests/e2e/assistant-execution.spec.ts tests/e2e/assistant-results.spec.ts tests/e2e/canvas-assistant-references.spec.ts tests/e2e/assistant-reference-placement.spec.ts --workers=1
```

## 独立复核与截图

独立finish-reviewer首轮结论为 `fix`；针对编号引用缩略图、弹窗内距、44px手机历史入口、方向来源契约四项评分问题修正后，复核结论为 `ship`，四项均解决。该结论仅覆盖这四项修正，不代表整个助手表面的全面批准。机械设计检测最初运行一次返回 `[]`，最终修正后没有再次运行，不将初次结果表述为最终二次检测。

| 证据 | 说明 |
| --- | --- |
| [1920px空态](../../output/assistant-redesign/screenshots/empty-1920.png)、[1440px空态](../../output/assistant-redesign/screenshots/empty-1440.png)、[1366px空态](../../output/assistant-redesign/screenshots/empty-1366.png) | 桌面浮窗、画布空间与起步层级。 |
| [390px空态](../../output/assistant-redesign/screenshots/empty-390.png)、[320px空态](../../output/assistant-redesign/screenshots/empty-320.png)、[助手近景](../../output/assistant-redesign/screenshots/assistant-closeup.png) | 手机全屏、图标输入和静态嫩芽。 |
| [1440px停靠](../../output/assistant-redesign/screenshots/docked-1440.png)、[结果](../../output/assistant-redesign/screenshots/results-1440.png)、[更多菜单](../../output/assistant-redesign/screenshots/more-menu-1440.png) | 形态切换与低频操作、结果完整比例。 |
| [技能预览](../../output/assistant-redesign/screenshots/skill-preview-1440.png) | 非空草稿的追加/替换选择与修正后的弹窗内距。 |
| [1440px编号引用](../../output/assistant-redesign/screenshots/numbered-references-1440.png)、[390px编号引用](../../output/assistant-redesign/screenshots/numbered-references-390.png)、[缩略图近景](../../output/assistant-redesign/screenshots/numbered-reference-strip.png) | 最终编号缩略图样式，以这组三张为引用外观依据。 |
| [320×400短屏](../../output/assistant-redesign/screenshots/references-320x400.png) | 记录短屏附件/输入空间；最终引用样式以上一行最新截图为准。 |

## 素材、兼容与证据边界

生产位图仅复用仓库已有的 [sprout.webp](../../apps/web/public/assistant/zhiya/assets/sprout.webp)，在聊天空态静态展示，不新增角色循环。它来自已接入的织芽素材集，沿用[正式接入说明](assistant-seed/integration.md)与[形象探索历史](assistant-seed/README.md)的来源记录。本轮没有生成新位图、引入外部生产素材或调用付费模型。截图中的服装图和浏览器路由/API均为测试夹具，只证明本轮布局、交互和恢复边界，不证明真实模型输出或完整队列、数据库、存储链路。

通用 `WorkspaceSplit` 的初始面板尺寸与旧偏好读取默认在本轮之前即有差异；保留既有源码行为，助手通过独立配置使用400px默认、360–600px范围。旧偏好读取器的通用384px及320–480px约束没有全局改写。已有无关工作区改动保留。

本轮只局部合并DESIGN/PRODUCT及表面契约，没有重建全局token或改写 `.impeccable/design.json`；其已有内容和改动保留。DESIGN.md现有中文章节及缺少YAML token前置区属于既有格式偏差，本次没有顺带迁移。未新增业务API、数据库迁移，未运行CI、完整 `pnpm check`，未提交或推送。

本轮没有新的真实供应商生成、生产服务联调、真实用户反馈或独立性能基准；也没有将四项终审扩大为全表面的可访问性或视觉全面验收。既有历史验证文档继续作为各自日期和范围内的证据。
