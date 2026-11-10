# 创作起步与光标引用验收

日期：2026-11-09，北京时间。延续全平台导航与织芽优化，改进首次打开空白项目和准备需求时的体验。本轮不新增模型调用、业务接口、轮询或收费工具；长期目标仍在推进。

## 实际变化

- 空白白板提供“描述设计想法”“上传参考图”“绘制草图”。三条入口分别使用原聊天、原上传选择器和原草图编辑器。点击描述只打开已有聊天，触屏不强制聚焦；只读空白项目仅展示说明。
- 聊天提供三个经过本地编写的服装设计起点。草稿已有任何内容时禁止覆盖；已有引用时，“分析参考素材”替换“小系列规划”。选择示例仅填写草稿，用户明确发送后才进入原执行链路。
- `@`候选以光标位置为准，可以在正文中间替换引用。保留前后文字、换行与标点；上下键切换，Enter/Tab确认，Escape仅关闭候选；没有匹配项时Enter不误发。
- 中文正文可以紧邻`@`，常见邮箱不被识别为引用。解析、预览与清除采用一致边界；同名对象保留显式标识消歧，沿用最多16项和失效引用校验。
- 组合输入期间不选择引用、不发送，组合结束伴生Enter仍由共用输入守卫处理。
- 候选通过独立浮层显示，跟随输入框、容器滚动和可视视口；不挤动输入框。手机触屏点选仍保留焦点；关闭聊天后清除浮层和监听。
- 修正手机目录按钮遮挡聊天标题，以及空聊天自动滚动到欢迎区底部的问题。删除欢迎区重复步骤，保留任务示例和发送规则说明。
- 同步产品说明、界面规范和本地操作帮助。已过时的“保留项目顶栏”“顶部保存状态”等描述已修正。

## 定向验证

单元测试3个文件、14项通过：光标范围、插入与清除、中文相邻文本、邮箱、多词标题、同名对象、长度限制拒绝、空候选、键盘与组合输入。

浏览器使用Chromium、单worker、本地受控接口；不同用例不重复计数。

| 集合 | 结果 | 覆盖 |
| --- | --- | --- |
| `canvas-creative-start.spec.ts` | 10项通过 | 1440/390/320px起步；640×450px横屏引用；触屏点选；上传文件选择器；草图进入退出；只读；草稿/光标；零自动提交；候选实际可点击 |
| `workflow-canvas.spec.ts`定向5项 | 5项通过 | 引用选择、草稿切换与显式发送；等待回复可继续写；引用失败恢复和清除；提案确认；同名分支 |
| `canvas-workspace-recovery.spec.ts`定向2项 | 2项通过 | 空白便签、回执重试与保存；只读便签/色卡 |
| `zhiya-assistant.spec.ts`定向2项 | 2项通过 | 同一聊天、阅读位置、画布中心；中文输入、停止回复及隐藏期间同步 |

合计19个不同浏览器用例，另有1项100对象性能用例通过。后续录屏运行和修正后的复测不累加。目标文件ESLint通过；Web类型检查通过。

初次验证暴露了真实裁切：候选列表原本在可滚动的输入区内，窄屏仅能看到尾部。改为独立浮层后，增加活动候选的可视范围与实际命中检查；不是仅依赖DOM可见性。旧聊天测试还依赖首次默认展开，已在相关用例中明确设置“返回用户展开偏好”；首次收起由新起步与织芽用例独立验证。

主要命令：

```powershell
# apps/web目录
pnpm exec vitest run src/modules/board/workflow/discussion-references.spec.ts src/modules/board/workflow/AssistantMentionInput.spec.tsx src/components/assistant-ime.spec.ts
pnpm exec tsc --noEmit

# 仓库根目录；其他回归通过--grep选择表中相关用例
pnpm exec playwright test tests/e2e/canvas-creative-start.spec.ts --workers=1 --project=chromium
$env:ZHIYA_PERF='1'
pnpm exec playwright test tests/e2e/zhiya-performance.spec.ts --workers=1 --project=chromium
```

## 100对象复测

测量完成：2026-11-09 11:42:40，北京时间。Windows、Chromium 145.0.7632.6、无界面浏览器、SwiftShader软件WebGL、DPR1、16逻辑线程。30图片、60文本便签、10色卡；每组30秒，使用原生rAF、performance.now和真实指针事件。测试期间没有并行编译、其他测试或视频编码。

| 状态 | 平均FPS | 帧间隔p95 | 超过33.3ms | 指针至下一帧p95 |
| --- | ---: | ---: | ---: | ---: |
| 角色暂停 | 59.94 | 16.7ms | 0.06% | 5.9ms |
| 角色创作 | 59.94 | 16.8ms | 0.06% | 7.0ms |
| 目录开合与话语 | 59.57 | 16.8ms | 0.67% | 6.9ms |

全部达到平均至少58fps、超过33.3ms的帧少于1%的既定门槛。这是软件浏览器的60Hz节奏，不是实体60Hz显示器结果，指针至下一rAF也不等于设备端到端延迟。原始逐帧记录保留于 [performance.json](../../output/playwright/creative-start/performance.json)。该用例测量角色与目录，不能单独作为所有图片编辑工具或真实模型执行性能的证明。

## 视觉材料与边界

截图、短录屏和本轮原始结果位于 `output/playwright/creative-start/`。桌面与手机空白页、聊天示例和光标引用均由真实页面操作生成，使用正式角色资源。

- [桌面空白白板](../../output/playwright/creative-start/empty-1440.png)、[320px空白白板](../../output/playwright/creative-start/empty-320.png)。
- [桌面聊天示例](../../output/playwright/creative-start/assistant-1440.png)、[320px聊天示例](../../output/playwright/creative-start/assistant-320.png)。
- [桌面光标引用](../../output/playwright/creative-start/references-1440.png)、[320px引用浮层](../../output/playwright/creative-start/references-320.png)、[640×450px横屏引用](../../output/playwright/creative-start/references-640.png)。
- [11.5秒创作起步录屏](../../output/playwright/creative-start/start-tour.mp4)、[9.4秒光标引用录屏](../../output/playwright/creative-start/reference-tour.mp4)。保留原速，录制时为阅读留出短暂停顿，原始WebM按视口命名保留。

图片节点中的服装几何图是受控占位素材，不证明模型产物质量。上传用例只验证打开文件选择器，草图用例只验证进入退出编辑器；不冒充真实文件存储或供应商执行验证。手机与横屏是浏览器模拟，未完成实体手机和软键盘实测。本轮没有运行全仓检查、CI、提交、推送或生产部署。
