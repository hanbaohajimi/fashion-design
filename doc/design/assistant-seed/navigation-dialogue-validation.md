# 全平台导航与织芽话语验收

日期：2026-11-09，北京时间。范围为前端布局、目录偏好、保存提示、助手入口、织芽话语及相应引导与键盘行为。沿用既有任务接口、聊天组件与正式毛绒资源；未新增模型调用或轮询。

本记录只报告本轮验证。2026-11-08的数据库、项目任务接口和供应商链路结果另见[接入验证记录](validation.md)，不计入本轮结果。

## 实现结果

- 全平台共用目录状态；桌面展开184px，收起释放占位。创作类首次收起，资料与表单类首次展开；账号和类别分别保存，跨项目沿用。小屏改为抽屉，图片与草图全屏编辑暂时退出外层导航。
- 无限白板与流程视图取消整条项目顶栏。项目菜单、任务入口分别放在画布左右上角；业务页把项目操作并入当前页面标题行，保留内容附近的对象、修订与只读信息。
- 移除白板常驻“已保存”。保存中或待保存超过1秒才提示；失败、冲突、只读及断网仍然可见，离线提示不属于可折叠目录。
- 设计助手入口仅在无限白板内；手机聊天提供“返回画布”。目录和聊天开合保留画布中心、缩放、草稿、光标、编辑器实例和表单修改。
- 织芽使用本地三句变体的事件话语，开始类4秒，完成/失败/待处理6秒。空闲安静，工作保留短标签；悬停与键盘聚焦暂停计时。气泡14px、实色底、最多两行/224px，靠顶部自动换边。
- 真实状态优先级、终态去重、历史基线、恢复不补播、取消平静恢复继续有效。只有明确设计或图片任务使用“创作”“这一版”。
- 调整引导锚点；手机账号菜单与目录分别处理Escape，内层退出期间不会连带关闭外层，目录关闭后恢复到展开按钮。

## 功能与静态检查

相关单元测试共 **7个文件、43项通过**：目录偏好、保存提示、角色活动、引导文案、工作区布局、共享任务数据及通用菜单/弹窗动效。覆盖存储损坏与写失败、账号隔离、旧计时器、历史终态、失败与等待、关闭菜单后的Escape传播。

Web TypeScript检查、目标源码ESLint检查通过。单元测试命令在 `apps/web` 执行：

```powershell
pnpm exec vitest run src/components/workspace-navigation-preferences.spec.ts src/modules/board/workflow/CanvasSaveStatus.spec.tsx src/modules/assistant-character/project-activity.spec.ts src/components/feature-guide/guide-copy.spec.ts src/modules/board/workflow/use-workspace-layout.spec.ts src/modules/tasks/project-task-source.spec.tsx
pnpm exec vitest run src/components/interactions/shared-motion.spec.tsx
pnpm exec tsc --noEmit
```

浏览器使用Chromium，所有运行均为 **单worker**。本轮48个不同的功能/界面用例通过，分批执行；修正后的重复运行不累加计数：

| 文件或定向集合 | 数量 | 覆盖 |
| --- | ---: | --- |
| `workspace-chrome.spec.ts` | 9 | 收起/展开、视野、草稿与光标、账号/项目偏好、表单与离开保护、离线、320px抽屉、账号菜单、话语与边界 |
| `unified-navigation.spec.ts` | 8 | 1440/1366/1024/390/375px跨页目录、项目上下文与对比度 |
| `zhiya-assistant.spec.ts` | 9 | 引用、同一聊天、手势、真实状态、终态去重、角色故障回退 |
| `zhiya-lifecycle.spec.ts` | 2 | 隐藏/恢复、减弱动态、WebGL与生命周期 |
| `feature-guide.spec.ts`定向集合 | 13 | 五页面×两宽度、跳过/重播、收起助手入口介绍 |
| Studio对象布局与商品展示定向集合 | 5 | 11个业务页面、320/390/1440px、主操作与修订 |
| `zhiya-rendering.spec.ts` | 1 | idle/hover/chat-open/landed/working的裁切与遮挡检查 |
| `zhiya-disabled.spec.ts` | 1 | 关闭新版开关，普通聊天可用、草稿保留，不加载角色或旧模型 |

关闭开关在3002端口以独立构建目录启动验证服务，设置 `NEXT_PUBLIC_ZHIYA_ENABLED=false`；结束后已停止该服务，并核对恢复 `next-env.d.ts` 的自动生成路径。主开发服务3000保留。清理结果见 `output/playwright/workspace-chrome/disabled-verification.json`。

裁切审计五种状态均为 `cut=0`、`hidden=0`，原始数据为 `output/playwright/zhiya/clipping.json`。

## 性能测量与修正

使用100个对象：30图片、60文字便签、10色卡。三组分别采样30秒：角色暂停、角色工作、角色工作并加入四次目录开合和状态话语变化。采用原生rAF、`performance.now`和实际指针平移；不使用模拟时钟、录屏帧率或仅动画函数耗时充当性能指标。浏览器性能测试未与编译、其他测试或视频编码并行。

验收目标保持为平均至少58fps，超过33.3ms的帧少于1%。指针指标记录事件分发至下一rAF的等待时间，不能等同于真实设备的输入至屏幕显示延迟。

**最终复测：2026-11-09 00:46:29，Windows，Chromium 145.0.7632.6，1440×900、DPR1、16逻辑线程，无界面浏览器，SwiftShader软件WebGL。** 实测帧周期接近60Hz；它不是实体60Hz显示器或手机实测。

| 状态 | 平均FPS | 帧间隔p95 | 超过33.3ms | 指针至下一帧p95 |
| --- | ---: | ---: | ---: | ---: |
| 角色暂停 | 59.80 | 16.7ms | 0.17% | 7.3ms |
| 角色工作 | 59.60 | 16.8ms | 0.56% | 8.4ms |
| 目录开合＋话语 | 59.27 | 16.8ms | 0.90% | 8.8ms |

本轮性能用例通过，原始逐帧数据：[performance-headless.json](../../../output/playwright/workspace-chrome/performance-headless.json)。

保留了未通过记录：首次30秒无界面测量中，目录与话语组为57.47fps、长帧1.80%。进一步10秒诊断记录到目录点击引起约110ms的React事件处理。原因是编辑器的聚焦控制读取了完整目录状态，开合连带刷新整个白板；布局变量也继承给全部后代。修正为独立的稳定控制上下文，并将尺寸样式限于实际使用的元素。最终目录与话语组未记录到超过50ms的主线程动画帧。未调整验收门槛。

修正前原始记录为 `performance-headless-before.json`，定位记录为 `performance-diagnostic-before.json`，均在本轮输出目录。前一组有窗口高刷新率测量记录于 `performance.json`：暂停142.26fps、工作128.83fps、目录/话语122.93fps，对应长帧0.05%/0.05%/0.35%；使用RTX4050 Laptop。该组是性能修正前的高刷新率环境记录，不冒充60Hz结果。

复测命令从仓库根目录执行：

```powershell
$env:ZHIYA_PERF='1'
pnpm exec playwright test tests/e2e/zhiya-performance.spec.ts --workers=1 --project=chromium
```

## 视觉材料

生成物统一位于忽略的 `output/playwright/workspace-chrome/`。主要文件：

- [画布目录收起](../../../output/playwright/workspace-chrome/canvas-collapsed.png)、[画布目录展开](../../../output/playwright/workspace-chrome/canvas-expanded.png)。
- [业务页精简布局](../../../output/playwright/workspace-chrome/studio-collapsed.png)、[320px业务页](../../../output/playwright/workspace-chrome/studio-mobile.png)。业务页截图等待目录退出完成后采集。
- [思考](../../../output/playwright/workspace-chrome/zhiya-thinking.png)、[等待](../../../output/playwright/workspace-chrome/zhiya-waiting.png)、[完成录屏截帧](../../../output/playwright/workspace-chrome/zhiya-complete-video.png)、[三状态局部对照](../../../output/playwright/workspace-chrome/zhiya-states.png)。
- [18秒话语录屏](../../../output/playwright/workspace-chrome/zhiya-dialogue-short.mp4)、[画布导航录屏](../../../output/playwright/workspace-chrome/canvas-navigation.mp4)。话语录屏从真实操作记录裁取思考、等待、完成三段，每段6秒，保持原播放速度；原始WebM一并保留。

这些画面使用正式角色资源与受控业务测试数据。服装几何图是测试占位素材，不能作为实际生成作品。三状态对照只裁切、拼接真实界面，没有重新绘制气泡或角色。

## 验证边界

- 本轮没有调用付费模型，未以受控API数据代替真实供应商、队列或数据库的端到端证明。
- 320px与手机交互为浏览器视口模拟；尚无实体手机和实体60Hz桌面显示器测量。
- 系统深色偏好已检查，平台现行设计仍是固定浅色主题，未宣称提供独立完整深色皮肤。
- 没有运行全仓检查、CI、提交、推送或生产部署。保留既有无关改动。

## 同日接续复核与边界修正

本次接续从现有实现出发核对用户确认的导航与话语方案，保留已完成的导航、图片编辑和草稿改动，未开展款式/交付的新重构。

补齐两处可复现问题：

- 旧接口没有 `activity` 时，原状态基线始终未完成，后续排队及聊天状态没有短句。现在有效旧任务列表能建立话语基线；终态使用独立基线，后续首次收到摘要时吸收历史结果。增加三项单元用例，覆盖新变化、摘要上线和隐藏恢复。
- 鼠标或键盘进入气泡时，若4秒/6秒计时已结束且120ms退出正在播放，原逻辑无法暂停消失。现在取消退出并恢复完整不透明度；离开后继续退出，新事件独立计时。浏览器用例暂停原生退出动画在中点，分别验证悬停和键盘聚焦、新事件覆盖、最终保留状态标签。

修复前定向用例确实复现失败，修复后通过。相关单元测试为7个文件、46项；Web类型检查和目标文件ESLint检查通过。未增加接口、轮询、模型调用或数据库更改。

本次另行复测 **30个不同的浏览器功能用例**，均为Chromium、单worker：`unified-navigation.spec.ts` 8项、`workspace-chrome.spec.ts` 11项、`zhiya-assistant.spec.ts` 9项、`zhiya-lifecycle.spec.ts` 2项。与上方初次48项存在重叠，不将两次数字相加。含修复后的气泡悬停/键盘聚焦，以及引用、会话链接、中文组合输入、停止回复、结果定位、触屏、无WebGL、上下文恢复和反复挂载清理。

本次复测命令：

```powershell
pnpm --filter @fashion/web exec vitest run src/components/workspace-navigation-preferences.spec.ts src/modules/board/workflow/CanvasSaveStatus.spec.tsx src/modules/assistant-character/project-activity.spec.ts src/components/feature-guide/guide-copy.spec.ts src/modules/board/workflow/use-workspace-layout.spec.ts src/modules/tasks/project-task-source.spec.tsx src/components/interactions/shared-motion.spec.tsx
pnpm exec playwright test tests/e2e/unified-navigation.spec.ts tests/e2e/workspace-chrome.spec.ts tests/e2e/zhiya-assistant.spec.ts tests/e2e/zhiya-lifecycle.spec.ts --workers=1 --project=chromium
pnpm --filter @fashion/web typecheck
```

浏览器按导航批次和最终角色批次运行；修复后的重复运行不累加计数。此次未重新运行真实API、数据库、队列和模型供应商验证，受控页面数据不代表实际生成效果。正式素材、实际页面布局与本机动画为真实渲染。

### 本次独立性能复测

2026-11-09 **13:19:17，北京时间**。100个对象、每组30秒；Windows、Chromium 145.0.7632.6、1440×900、DPR1、16逻辑线程，无界面浏览器、SwiftShader软件WebGL。测试期间没有并行浏览器测试、编译检查或视频编码。仍用原生rAF/指针记录，未使用模拟时钟，验收门槛没有变化。

| 状态 | 平均FPS | 帧间隔p95 | 超过33.3ms | 指针至下一帧p95 |
| --- | ---: | ---: | ---: | ---: |
| 角色暂停 | 59.90 | 16.7ms | 0.11% | 6.5ms |
| 角色工作 | 59.80 | 16.8ms | 0.28% | 7.4ms |
| 目录开合＋话语 | 59.57 | 16.8ms | 0.62% | 6.6ms |

工作与目录/话语两组均达到平均至少58fps、长帧少于1%的门槛。[此次原始报告](../../../output/playwright/workspace-chrome-review/performance.json)独立保存；上方初次测量及其他编辑功能的历史报告未被替换。结果不等同于实体手机或实体60Hz显示器上的输入至屏幕延迟。

### 本次展示材料

位于 `output/playwright/workspace-chrome-review/`，已查看桌面/320px截图、三状态局部对照，并抽取短录屏的四个关键帧检查。气泡截图等待入场结束后采集，保留实际字色和完整不透明度。

- [目录收起](../../../output/playwright/workspace-chrome-review/canvas-collapsed.png)、[目录展开](../../../output/playwright/workspace-chrome-review/canvas-expanded.png)。
- [业务页精简布局](../../../output/playwright/workspace-chrome-review/studio-collapsed.png)、[320px业务页](../../../output/playwright/workspace-chrome-review/studio-320.png)。
- [思考](../../../output/playwright/workspace-chrome-review/zhiya-thinking.png)、[等待确认](../../../output/playwright/workspace-chrome-review/zhiya-waiting.png)、[完成](../../../output/playwright/workspace-chrome-review/zhiya-complete.png)、[局部对照](../../../output/playwright/workspace-chrome-review/zhiya-states.png)。局部对照只裁切拼接真实截图。
- [18秒导航与话语录屏](../../../output/playwright/workspace-chrome-review/navigation-dialogue-short.mp4)，从本次33.12秒原始WebM裁取三段，保留原速；[关键帧核对](../../../output/playwright/workspace-chrome-review/video-check.png)。

服装图复用仓库的 `apps/web/public/prototype-assets/impeccable/coat-original.png`，既有来源见同目录 `SOURCE.md`。仅用于受控页面展示，没有生成新图；页面任务及技术资料为测试数据，不代表真实用户款式。录制脚本和配置放在上述忽略目录，不进入应用运行路径；该展示运行不计入30项功能回归数量。

### 最终交接复核（2026-11-09 16:28，北京时间）

再次按已确认的“全平台导航精简与织芽话语优化方案”核对当前工作区实现。本次保留此前完成的功能，没有重新实施导航、聊天或图片编辑；仅补记交接验证。当前源代码中的目录默认值与账号隔离、画布操作位置、保存提示、全屏编辑、画布内助手入口及事件话语均与方案一致。

- 相关单元测试 **8个文件、48项通过**：上方7个文件，加上 `WorkspaceChrome.spec.tsx` 的2项恢复验证，确认账号先于工作区恢复时桌面和窄屏均保留原输入、光标及焦点。
- `workspace-chrome.spec.ts` **11项浏览器测试全部通过**，Chromium、单worker，耗时2.7分钟。覆盖目录开合与视野、聊天草稿和光标、跨项目及账号偏好、未保存表单、离线提示、320px入口、长项目名、气泡计时和新旧事件。与历史复测有重叠，不累加为新的独立用例总数。
- Web类型检查通过；11个导航、角色及保存提示目标文件的ESLint退出码为0。ESLint仍打印仓库根目录无Pages目录的配置提示，未产生目标文件告警。
- 本次浏览器原始录屏保存在 `output/playwright/navigation-final-review/test-results/`，桌面与窄屏截图更新于 `output/playwright/workspace-chrome/`。已查看并核对上方 `workspace-chrome-review/` 的展示截图、三状态对照与短录屏关键帧，继续作为效果展示材料。
- 本次未修改动画与布局代码，也未重新测量帧率；性能证据仍为上方 **13:19:17** 的100对象、三组各30秒独立实测。未新增付费调用、轮询、接口或数据库更改；未运行全仓检查、CI、提交或推送。
