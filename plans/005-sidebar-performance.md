# 005 — 侧栏拖拽性能与取消语义

- 状态：已实施；优先级：P2；依赖：任务 002 的布局模式定义。测量边界与证据见 [实施记录](IMPLEMENTATION.md)。
- 技能：animation-performance、apple-design、improve-animations。
- 工作目录：`G:/new-fashion-design`。

## 当前实现

`apps/web/src/modules/board/workflow/WorkflowCanvas.tsx` 的侧栏分隔条在每个 pointermove 调用 resizeSidebar/setSidebarWidth；`--studio-sidebar-width` 挂在整页 main。`workflow-canvas.module.css` 的网格列宽和分隔条位置受其影响。

已存在 pointer capture、键盘步进 16px 和 ARIA 语义，应保留。代码证明更新路径较宽，尚无性能录制证明实际掉帧。本任务目标是减少无效提交并完善手势生命周期，不承诺未经测量的帧率收益。

## 实施步骤

1. 仅在任务 002 定义的 docked 模式（宽度至少 1100px）启用拖动分隔条。读取实际工作区可用宽度，合法侧栏范围为 320 到 min(480, 可用宽度减 640)；若无法同时容纳两栏，应进入对应 overlay/mobile 模式而非产生反向范围。
2. pointerdown 只接受主指针和主按钮，记录 pointerId、clientX、开始宽度与最后草稿宽度，设置 capture。宽度基于位移增量，不将边缘瞬移到指针中心。
3. pointermove 只更新 ref 中的最新目标值；最多挂一个 requestAnimationFrame，在帧回调中计算并写入局部工作区的 CSS 变量。禁止每次 move setState；禁止 read→write→read 的交错布局查询。
4. 将宽度变量缩小到网格/侧栏/分隔条共同祖先。需要真实改变布局的宽度继续改变布局，不对整栏 scaleX，也不给宽度加 transition 或 spring。
5. pointerup 刷新最后坐标，取消未执行帧，提交一次 React 宽度和既有持久化，再释放 capture。pointercancel 回到本次手势开始宽度；意外 lostpointercapture 同样取消。正常 pointerup 后的 lostpointercapture 不得二次回滚。
6. 模式切换、卸载、窗口失焦时结束手势并清理监听/帧，不能残留禁止选中文本的状态。若切换模式导致原宽度不可用，在新模式中统一 clamp 后保存合法状态。
7. 键盘 Arrow 使用原有 16px 步长直接更新；Home/End 若当前支持则保留，新增时同步测试。aria-valuemin/max/now 与实际范围一致；拖动中的 now 可在同一 rAF 更新，不为更新 ARIA 触发整个画布 React 提交。
8. 控制指针交互期间的 user-select/touch-action 仅限分隔条和必要局部容器；不要全局禁用触摸滚动。保持 44px 触控命中面积但不扩大可见分隔线。

## 测量方法与通过条件

使用同一设备、构建、视口、数据和浏览器配置；普通 fixture 为 12 节点/18 边，压力 fixture 为 200 节点/300 边。优化前后各拖动 10 秒，重复 3 次，保存 DevTools Performance 和 React Profiler 记录。

记录：pointermove 数、rAF 写入数、React commits、Style/Layout 总时间、超过 50ms 的任务及其归因。通过条件是每帧最多一次拖动写入、move 不导致逐次 React 提交、结束一次提交且最终宽度正确；若长任务仍出现，必须定位而非声明优化成功。

行为测试覆盖：拖到边界外、快速往返、pointercancel、lostcapture、拖动中 resize、组件卸载、键盘调宽、从 1099 到 1100px 切换。画布节点和连线不得出现由假缩放造成的比例失真。

```powershell
pnpm --filter @fashion/web test
pnpm exec playwright test tests/e2e/workflow-canvas.spec.ts
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web lint
```

交付包含原始录制与前后对比，不仅是平均 FPS 截图。当前审查未运行这些测量。
