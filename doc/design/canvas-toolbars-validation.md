# 画布上下文工具栏与图标入口

日期：2026-11-14。基于用户本轮提供的 LibTV 选中图片截图，以及所贴 React Bits `WarmTooltip` 源码适配；延续森织暖白、深绿体系。上轮统一画布的数据与执行规则见[架构说明](../architecture/unified-creation-canvas.md)，本轮为该界面的交互与视觉调整。

## 设计与实现

- 图片上方采用紧凑横向工具条，主编辑动作使用图标和短名称；历史、下载、预览及助手等辅助操作为图标，细分隔线区分两组。工具条最大720px，圆角14px。手机与短屏收起名称和次要直达项，更多菜单仍可访问；320px同时收起直接预览图标。
- 下方创作框最大660px，圆角20px，手机18px。上方为上传/画布参考入口，中间保留完整参考缩略图和原始提示词；底部显示真实比例、质量和张数，右侧使用圆形生成箭头。模式名称为信息，不模拟不存在的模型选择器。
- 参数从底部摘要上方向上展开，避免压到画布底栏。键盘打开后进入参数，Escape关闭并恢复触发器焦点；展开创作框保留文字、引用和参数。中文组合输入、Ctrl+Enter及语音会话的键盘归属继续保留。
- 首页、任务、连接开关、全部功能等常驻入口，以及多选对象和空白画布动作使用纯图标。项目/图片名称和参数值仍显示，菜单与表单保留可读标签。可访问名称、当前展开/选中状态和任务数量不依赖可见文字。
- `WarmTooltip` 按用户源码适配为 TypeScript 与 CSS Modules，复用已安装的 `motion@14.14.0`。首次悬停400ms，同组300ms内连续查看无需重复等待；标签移动180ms、轻微出现160ms，使用 transform/opacity，不引入模糊、倾斜或画布指针捕获。键盘聚焦及减弱动态立即显示。
- 触屏长按500ms说明图标，移动超过10px取消长按；成功长按松手后保持名称，抑制该次操作点击，下一次轻触正常执行。提示在可视区边缘翻转/限位，Escape、外部点击和离开时正确清理。

主要源码位于 `apps/web/src/components/WarmTooltip.tsx`、`warm-tooltip.module.css`，以及 `apps/web/src/modules/board/workflow/` 下的 `CanvasAction`、`CreationWorkspace`、`CreationComposer`、`CanvasTools` 和对应 CSS Modules。`ProjectTaskCenter` 仅在画布使用 iconOnly 模式，其余页面保持原入口。

## 定向检查

测试与截图位于 `output/canvas-toolbar/`，最终统计以该目录的 `verification.json` 为准。

- 38个去重 Vitest 用例通过，覆盖提示的延迟/快速切换、原 aria-describedby 合并、触屏长按抑制、离开取消、上传期间草稿、布局、任务数据源及共用菜单/选择控件。
- Web 类型检查通过。17个目标 TypeScript 文件 lint 通过，0错误、0警告；框架从仓库根目录查找pages目录的提示为现有配置提示，不代表新增文件错误。
- 最终单worker Chromium 19/19通过，验证1440、1280、390、320px，包含主视图、参数上浮、展开/收起、键盘提示、减弱动态与空画布。真实浏览器触控事件验证长按松手不触发动作、标签保留及下一次轻触打开目录。
- 继续回归现有创作流程和桌面/手机9个图片工具入口，确认图标化不直接提交任务。发现参数Escape被tldraw处理为取消选择后，已改为在参数/展开面板内先处理Escape；发现重试回执后立即刷新可能赶在草稿防抖写入前，已在提交前checkpoint当前草稿。
- 参数展开后使用视口断言，避免仅有DOM可见性却实际位于屏幕之外的误判。`clip-{1440,1280,390,320}.json` 与截图共同检查裁切。

独立 Impeccable 审查的初次结果为fix，提出长按松手时错误关闭提示，以及DESIGN旧圆角/阴影规则未同步两项。实现和规范均已修正，最终两项均评分resolved，disposition为ship；该评分仅覆盖两项修正，记录于 `output/canvas-toolbar/finish-review.md`。随后整批19项浏览器检查完成并全部通过，单独记录在 `verification.json`。

## 证据与范围

主要截图：`selected-{1440,1280,390,320}.png`、`settings-{1440,1280,390,320}.png`、`warm-tooltip.png`、`touch-tooltip-390.png`、`empty-mobile-reduced.png`。图片使用仓库照片，浏览器使用隔离 API 夹具；本轮验证界面与已有执行交接，没有调用付费模型或评估生图画质，触控为 Chromium 原生事件模拟，未作手机真机验证。

没有触发CI、完整 `pnpm check`、提交或推送。保留工作区其他并行改动，未重置无关文件。
