# 006 — Tooltip 连续浏览与触屏行为

- 状态：已实施；优先级：P2。最新证据见 [实施记录](IMPLEMENTATION.md)。
- 技能：emil-design-eng、apple-design、improve-animations、review-animations。
- 工作目录：`G:/new-fashion-design`。

## 当前行为

`apps/web/src/components/ui.tsx` 的 Tooltip 每次 pointer enter 独立等待 180ms；pointer enter 未区分触摸。键盘 focus 已即时打开，Escape 已关闭；portal 已定位到最近的打开 Dialog，否则 document.body。后两项是已有正确行为，不重写。

`apps/web/src/components/ui-config.ts` 定义 tooltipOpen=180、tooltipClose=120。本任务增加工具栏组内的短暂免等待行为，不替换共享 UI 库。

## 行为规格与实现

1. 新增可选 TooltipGroup 上下文，作用域只包住一个相关工具栏。未包裹时保持现有独立行为，避免公共组件破坏性升级。
2. 第一个 pointer hover 延迟 180ms；只有实际显示过的提示才能使组进入暖机状态。在同组提示关闭后 300ms 内进入另一个提示，打开延迟为 0；超过或等于 300ms 恢复 180ms。进入后又提前离开、从未显示的提示不能激活暖机。
3. 关闭延迟维持 120ms，用于跨越触发点和提示之间的小间隔。提示自身 pointerenter 取消关闭计时，pointerleave 才继续关闭；文本可保持阅读。若提示包含交互动作，应改用合适的 Popover，不将 Tooltip 变成菜单。
4. 组上下文用 ref 保存时间和活动项，避免计时器触发整个工具栏重渲染。组间完全隔离；打开新项关闭旧项；单项卸载、组卸载、Escape、路由离开均清理相关 timer。
5. 忽略 pointerType=touch 的 hover。用输入来源区分触摸导致的 focus 和键盘 focus，避免移动点击后出现残留浮层；键盘/辅助技术 focus 仍即时打开。不能只用 `(pointer:fine)` 排除混合触摸设备的鼠标。
6. Escape 后在本次焦点/悬停周期保持关闭，下一次有意进入才重新开启。键盘焦点、提示出现和相邻提示切换均不添加位移动画。
7. 保留原有 aria-describedby 合并、唯一 id、role=tooltip、Dialog portal、定位翻转与视口裁切逻辑。需要重定位时复用现有路径，不另做全局追踪器。

## 验收

使用假计时器测试首次 179/180ms、暖机截止 299/300ms、关闭 119/120ms；测试时间应从实际关闭点计起。覆盖快速划过不暖机、A→B、组 A→组 B、Escape、触发点到提示、卸载时仍有 timer。

真实浏览器覆盖：Tab/Shift+Tab 即时提示、Escape 关闭且焦点不移动、Dialog 内提示可见、触摸点击无 hover 残留、混合设备鼠标可正常使用、窄视口不超出屏幕。

```powershell
pnpm --filter @fashion/web test
pnpm exec playwright test tests/e2e/frontend-experience.spec.ts tests/e2e/workflow-canvas.spec.ts
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web lint
```

Feel-check：连续辨认一组图标不再为每项重复等待；键盘无等待；离开工具栏后再次回来恢复首次保护。交付测试结果，不以“感觉丝滑”代替行为证据。
