# 002 — 修正手机/平板布局状态、输入与安全区

- 状态：已实施，真机验收待补；优先级：P1。最新证据见 [实施记录](IMPLEMENTATION.md)。
- 基线：`5dbd7a6`，2026-10-25。
- 技能：mobile-native、apple-design、emil-design-eng、break-ui。
- 工作目录：`G:/new-fashion-design`。

## 问题与已有能力

`G:/new-fashion-design/apps/web/src/modules/board/workflow/WorkflowCanvas.tsx:658` 在每次 resize 执行：

```ts
if (window.innerWidth > 760 &&
    window.innerWidth < STUDIO_LAYOUT.sidebarMin + STUDIO_LAYOUT.canvasMin)
  setSidebarOpen(false);
```

实际手机 CSS 在 `workflow-canvas.module.css:2505` 使用 max-width:767px。助手视图会隐藏画布，而 aside 又受 `hidden={!sidebarOpen}` 控制；761–767px 的高度变化也会把助手关闭。

当前 `design-system.css:435` 已对 767px 以下输入设置 16px，但宽屏触控不在此规则内。`apps/web/src/app/layout.tsx` 没有 viewport 导出；画布工具栏已有单处 bottom safe-area，但页头、助手输入和消息偏移尚未形成一致规则。

已经有 100dvh、44px touch token、原生 Dialog 和手机画布/节点/助手视图，继续使用这些能力。

## 明确实施决策

1. 在 `apps/web/src/components/ui-config.ts` 的布局配置中增加 `mobileMax:767`、`dockedMin:1100`。这与现有 CSS 的 <=767 单视图、768–1099 覆盖式侧栏、>=1100 并列侧栏一致；960 是最小侧栏320+画布640的容量约束，不再充当手机模式阈值。
2. 使用对应 matchMedia 的 change 事件维护布局模式。视口仅高度变化时不重设用户的助手选择和 sidebarOpen。宽度尺寸变化可重新 clamp 并列侧栏，但不关闭当前活动内容。
3. 手机实际侧栏可见性由 `mobileView === "assistant"` 派生；nodes/canvas 继续沿用现有视图行为。不要同时让 mobileView 和 sidebarOpen 决定手机唯一内容是否存在。
4. 非手机模式保留单独 sidebarOpen 偏好。首次进入 768–1099 默认收起覆盖侧栏，用户主动打开后保持到主动关闭或离开模式；>=1100 使用并列侧栏。由手机助手视图切到非手机时保持助手可见，防止旋转后草稿被藏；非手机侧栏打开时转入手机对应助手视图。其余情况保留最后手机视图。
5. 布局切换不卸载助手/详情草稿，也不更改会话、选中节点、未保存保护。只在原焦点所在表面变隐藏时，将焦点移至新视图对应的可见入口；正常高度变化不移动焦点。
6. RootLayout 保持 Server Component，增加静态 `Viewport` 导出：`width:"device-width"`、`initialScale:1`、`viewportFit:"cover"`、`interactiveWidget:"resizes-content"`、`themeColor:"#fcfbf8"`、`colorScheme:"light"`。不设置 maximumScale 或 userScalable 限制。以安装 Next 类型和本地 generate-viewport 文档检查字段。
7. 保留现有窄屏 16px 规则，并扩展到 `(any-pointer:coarse)` 的可编辑 input/select/textarea（排除 checkbox/radio/range/color）。这样平板横屏及连接鼠标的触屏设备仍覆盖。控件文字保持 >=16px，正文层级不整体放大。
8. 安全区加在边缘所有者：页头承担 top/left/right；手机工具栏、助手 composer、底部视图条分别只承担各自接触屏幕边缘的 bottom；Dialog 的最大高度和内部滚动预留 top/bottom。使用 `env(safe-area-inset-*,0px)`，基础间距加 inset，不在嵌套父子重复累加。
9. Toaster 的 `offset` 与 `mobileOffset` 都使用 per-side CSS calc，bottom 为 `calc(16px + env(safe-area-inset-bottom, 0px))`，left/right 为对应16px+inset；桌面可保留32px基础间距。CSS变更与任务003只保留一个定义点。
10. 普通控件使用 `touch-action:manipulation` 和现有按压反馈；画布与拖拽手柄由 tldraw/指针逻辑拥有手势，不全局覆盖。表单自然滚动；局部侧栏/列表用 `overscroll-behavior:contain` 防止串滚，不在全站 body 上禁用用户滚动。

## 测试与验收

- 760/761/767 宽度，选择助手并输入草稿，仅改变高度；助手、输入和当前视图仍可见。
- 767↔768、1099↔1100、横竖屏反复切换；助手文本、选中节点和未保存状态不丢；至少一个主要工作面可见。
- 768/1024 的 coarse 与混合指针模拟：编辑控件计算字号至少16px，普通操作目标至少44px；桌面鼠标保留现有密度。
- viewport meta 与 theme color 符合导出；没有禁止缩放；文档页与画布都不发生页面级横向溢出。
- 在 iOS Safari、Android Chrome 真机：打开软件键盘、旋转、收放地址栏、聚焦最后字段、点击发送/保存、双指缩放、使用底部工具。验证屏幕边缘无遮挡且页面不因输入聚焦意外缩放。Chrome/WebKit 模拟结果不能替代这一步。

```powershell
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web lint
pnpm exec playwright test tests/e2e/workflow-canvas.spec.ts tests/e2e/workspace-ui.spec.ts tests/e2e/frontend-experience.spec.ts
```

新增边界测试可放在同目录 `mobile-workspace.spec.ts`；不改变既有业务 API fixture。必要的键盘可见区修正以实际设备复现为准：优先自然滚动和现有 scroll 容器，只有复现 composer 被遮挡才在其局部使用 visualViewport，不重写整站高度。

## 完成条件与限制

断点空白问题有自动化回归；各模式状态映射明确；安全区和触屏字号有检查；真机项目单独记录设备/浏览器版本和结果。没有实机条件时，该项验收仍标待验证，不宣称“手机体验已完全验证”。不引入 Expo、原生键盘库或 WebView 包装。
