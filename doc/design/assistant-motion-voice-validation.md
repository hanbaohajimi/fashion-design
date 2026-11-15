# 助手引用操作、动效与语音接入验证

日期：2026-11-14。接续当前助手重构与统一创作画布，保留暖白、深绿、浮窗／停靠和有序编号引用。没有提交、推送或触发CI。

## 参考和实现边界

- 交互来源为用户录屏 `C:/Users/朱奕玮/Desktop/屏幕录制 2026-11-14 175517.mp4`（16.7秒、1910×936），分帧材料存于 `output/assistant-motion-reference/`。另在用户授权的LibTV项目独立浏览器标签中核实：悬停查看大图、双击定位、角上 `@` 插入图号。临时标签已经关闭，临时输入已清空。
- 思考来自用户提供的 LatticeLoader，生成来自 RefineFrame，语音外观来自 VoicePill。适配为TypeScript与CSS modules，复用现有SVG图标，不引入Hugeicons；语音按用户确认采用点击切换，不启用长按／滑动取消模式。
- 助手和画布创作框都使用48px编号缩略图。定位保存最初相机，在连续查看后仍返回最初视野，不改变选择、输入草稿或引用。无法定位的历史资产打开准确原图；明确放入画布仍使用既有命令。
- 思考、生成与结束按实际任务状态显示；RefineFrame只在新结果到达时显现，历史结果不补播。小画布缓冲按完整比例绘制，最大600px；离屏、后台与减弱动态停止循环，截图与导出不把动效当成结果。
- 点击麦克风后，由浏览器SpeechRecognition识别中文，实际麦克风采样驱动波形。停止后文字进入原选区；录音期间编辑了正文则追加。取消、收起助手／关闭创作框和切换目标丢弃本段录音；超限保留文字供再次加入／复制／放弃。发送由用户确认，录音中Enter也不能误发。
- 浏览器可能使用在线语音服务；只有已安装且可用的本地中文模型才走本地模式，不自动下载。浏览器不支持、权限拒绝、网络失败等有明确中文反馈，不伪装成功。不保存音频，不新增平台转写服务或付费模型调用。
- 旧painting-loaders组件、9项公开媒体和环境开关删除；用户桌面原始目录未改动。制作脚本移到 `scripts/manual/archive/render-painting-loaders.mjs`，只向忽略的 `output/painting-loaders-archive/` 输出，来源记录归档到 [历史来源](../history/painting-loaders-source-2026-11-14.md)。原服装秀缓冲测试改用既有独立媒体夹具。

## 验证

当前验证包含前端类型检查、目标文件lint、相关Vitest、单worker Playwright。测试和截图使用隔离API、模拟SpeechRecognition与合成音频采样；没有打开真实用户麦克风，也没有调用真实模型、队列或存储链路。

本轮按不同用例去重：**45项Vitest通过，50项单worker浏览器用例通过**。此前助手改版的63项单元和89项浏览器验证属于上一阶段，不并入本轮计数。Web类型检查、目标文件lint通过；机械设计检测一次返回 `[]`，之后不重复运行或声称二次检测。

| 检查 | 本轮结果 |
| --- | --- |
| `browser-voice`、`refine-frame-state`、`TaskFeedback`、`use-reference-navigation`、`CreationComposer`、`guide-model` | 6文件，45项Vitest通过。包括停止／取消／迟到权限／单录音所有者／断网和结束超时恢复，以及任务状态、导航和草稿边界。 |
| `assistant-motion.spec.ts` | 11项通过。缩略图三种操作、连续定位／返回、原编辑目标和草稿；Lattice离屏／减弱动态；1440／390／320语音；键盘防误发、拒绝、取消、收起和超限恢复；生成真实状态与结果。 |
| `assistant-redesign.spec.ts` | 15项通过。既有浮窗、停靠、图标、缩放取消、技能、历史任务、1920／1440／1366／390／320与320×400短屏回归。 |
| `assistant-reference-placement.spec.ts` | 10项通过。桌面／手机预览、摆放、未知回执、失败与只读、焦点恢复。桌面预览测试改为Enter，保持与新交互语义一致。 |
| `canvas-assistant-references.spec.ts` | 11项分批通过。旧外层节点不接收指针，测试改为在图片实际坐标点击；窄屏“引用到助手”补入更多图片操作。修正过程中失败的3项分别重跑通过，未计作新增用例。 |
| `assistant-voice-expanded.spec.ts` | 独立复核后新增2项通过。1440与390展开创作框中，长语音状态、取消、停止与超限加入／复制／放弃均可达。 |
| `runway-workspace.spec.ts` 的本地媒体缓冲检查 | 1项通过。使用既有独立MP4夹具，不依赖被删除的绘画视频。 |

另额外运行了 `frontend-experience.spec.ts` 中“日常任务使用简洁状态反馈，完成后不再提供重复执行”，**未通过，未计入上述50项**。该旧用例依赖 `sessionStorage` 进入旧流程视图，当前统一画布已不再读取该入口；其画布请求未隔离而回落到本地API并收到401，因找不到旧工具节点而退出，没有测到TaskFeedback。未为通过旧用例恢复废弃入口或修改无关画布架构。TaskFeedback本身的3项单测和新画布生成状态的浏览器检查通过；旧流程详情入口仍不构成本轮已验证范围。

## 画面证据

- `output/assistant-motion/screenshots/reference-hover.png`：小缩略图与悬停大图。
- `output/assistant-motion/screenshots/reference-located.png`：定位、原编辑对象与返回入口。
- `output/assistant-motion/screenshots/thinking.png`：实际待回复状态的网格。
- `output/assistant-motion/screenshots/voice-1440.png`、`voice-390.png`、`voice-320.png`：语音胶囊、计时、实时识别文字和草稿，波形由测试合成音频驱动。
- `output/assistant-motion/screenshots/generation-queued.png`、`generation-complete.png`：排队占位与完整比例结果。
- `output/assistant-motion/screenshots/expanded-voice-1440.png`、`expanded-voice-390.png`、`expanded-recovery-1440.png`、`expanded-recovery-390.png`：独立复核所列展开态语音反馈位置修正后的长文字／恢复场景。
- `output/assistant-motion/reference-interaction.mp4`、`thinking.mp4`、`voice-input.mp4`、`image-generation.mp4`：本轮隔离浏览器的实际操作录屏，源WebM位于 `recordings/`。

本轮没有新增生产位图；服装照片仅为本地测试夹具。独立复核首轮结论 `fix`，仅列展开创作框的语音反馈定位越过顶部一项。改为框内流式布局及限高滚动，补齐两尺寸长识别／超限恢复截图和操作测试后，verdict pass 为 `ship`、该项 `resolved`。这只覆盖已列修复项，不是对整个表面的全新批准，也不能将静态截图和浏览器模拟解释为真实中文识别准确率验证。
