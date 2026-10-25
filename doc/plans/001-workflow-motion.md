# 001 — 历史画布即时呈现，结果反馈只播放一次

- 状态：已实施；验收证据见 [实施记录](IMPLEMENTATION.md)。
- 基线：`5dbd7a6`，2026-10-25 当前工作树。
- 优先级：P1；技能：animate、animation-performance、improve-animations、review-animations。
- 工作目录：`G:/new-fashion-design`。

## 问题与证据

`G:/new-fashion-design/apps/web/src/modules/board/workflow/workflow-node.module.css:32`：

```css
animation: nodeEnter var(--dur-enter) var(--ease-enter) backwards;
animation-delay: calc(var(--enter-index, 0) * 45ms);
```

其 from 为 `opacity:0; transform:translateY(10px) scale(.985)`。`WorkflowCanvas.tsx` 将深度封顶 6，活动 `--dur-enter` 为 180ms，最深节点等待 270ms 后开始。模型连线端点不跟随这层 CSS 变换。最新工作区已对 candidate/fabric 设 animation:none；风险仍适用于其余使用根入场的节点，不能继续称所有节点都有此问题。

`G:/new-fashion-design/apps/web/src/modules/board/workflow/workflow-connections.module.css:30`：

```css
stroke-dasharray: var(--edge-length, 400);
stroke-dashoffset: var(--edge-length, 400);
animation: edgeDraw 320ms var(--ease-enter) forwards;
animation-delay: calc(var(--edge-enter-index, 0) * 45ms + 180ms);
```

最深连线 770ms 才完整呈现。该文件 `:60` 还对 running/highlighted/selected 一并启用 `edgeFlowMove 1.6s linear infinite`。

提交基线的项目卡片 400ms CSS 入场已由工作区移除。当前新增 `components/motion/use-archive-opening.ts`，在组件首次 ready 时对最多 9 张可见卡片播放 260ms 的位移/轻旋转，间隔 40ms，最后一张于 580ms 完成；opened ref 避免同一次挂载内搜索反复播放。应验证重进页面及首次操作，不将旧 CSS 删除继续列为待办。

`WorkflowNodeShape.tsx` 的旧 280ms WAAPI 图片反馈已改为 consumeResultArrival 后调用统一 play("reveal")，当前 token 为 700ms。`components/motion/runtime.ts` 有可见性、减弱动态、每 anchor 单实例、总并发 2、卸载/移动取消和导入超时保护。presets 的 reveal 含透明纸色遮罩；这需要实际观察是否影响刚生成图像的纹理/颜色判断，不能未经验证认定掉帧或不可用。

## 目标与步骤

1. 移除 `.node` 根部的 nodeEnter 和延迟，使初载、重开、撤销恢复和视口重新挂载都以最终几何状态呈现。选择、状态颜色、静态阴影保留。
2. 普通 `.edgeLine` 改为 `stroke-dasharray:none; stroke-dashoffset:0; animation:none`；删除 edgeDraw。proposed 边保留已有 `4 5` 虚线及不可命中语义；创建新连接也立即显示完整路径。
3. `.edgeFlow` 只由 `data-running="true"` 激活。selected/highlighted 继续使用静态颜色与线宽。保留 1.6s linear 的真实运行反馈，完成/失败立即停；页面隐藏时统一通过工作区可见性标识设置 `animation-play-state:paused`，可见后只恢复仍在运行的边。reduced-motion 下保持无流动，状态文字仍可读。
4. 项目旧 CSS 入场标记为“已由工作区解决”；验证 useArchiveOpening 在搜索、状态筛选、数据重新获取时不重播。首次进页期间立即点击/键盘操作也应可用；若卡片仍在透明或移动状态时影响定位，优先移除内容层入场，保留标题周围的 archive 装饰，而非降低点击响应。
5. 保留 consumeResultArrival 与 SVG export guard，复用统一事件反馈，不恢复旧 WAAPI 形成双动画。隐藏/离屏到达、导入延迟、卸载、偏好改变时不补播；导出不得消费正常用户的到达事件。
6. 品牌 reveal 使用现有 --motion-reveal 和 --ease-enter。用实际图像验证纸色遮罩是否临时改变关键颜色/纹理判断；如有影响，移除覆盖图片区的 mask，保留边缘线条，不简单全局缩短所有品牌时长。新功能若只需轻量图片反馈，可采用 280ms/6px 的既有 result token，二选一。
7. 保留 tldraw shape 的 enterIndex 类型/default 字段以兼容已有投影与快照，本轮不迁移持久数据。已无用途的 CSS keyframes 可删除；不为删除几个字段牵动图存储格式。

新结果动画目的为说明真实到达；其他已接入品牌事件保留其原有用途并单独验证。历史节点、连线和搜索更新应直接可见。图片尺寸的正常加载更新仍走现有模型逻辑，不以 DOM 根变换改变节点坐标。

## 测试与验收

- 扩展 `tests/e2e/workflow-canvas.spec.ts`：0/1/7 层图首个可操作帧拓扑完整；页面可操作后立即拖动节点，不能复制现有 `:798` 等待全部动画 finished 的代码；端口、图片与边一致。
- 覆盖普通、selected、highlighted、running、proposed、失败、完成；只有运行边持续流动。隐藏标签页暂停，返回后不重播历史入场。
- 扩展 `tests/e2e/vitality-flow.spec.ts`：新结果第一次加载一次反馈；同图刷新、视口回收重新挂载、隐藏时到达后返回均不补播；导出不消费用户可见的到达标记。
- 项目库输入/清除搜索、归档筛选快速切换，不重播入场或丢失焦点；首次进入时立即点击首张/末张可见卡片并验证目标稳定。
- 单独验证品牌反馈：动态导入失败不影响业务成功；同时多事件不超过既定并发；路由/查询切换、隐藏、卸载后无残留；Dialog 内关键状态仍由本地文字表达，body 装饰不作为唯一反馈。
- PNG/SVG 导出包含完整节点和连接，导出尺寸与现有契约一致。

```powershell
pnpm --filter @fashion/web test
pnpm exec playwright test tests/e2e/workflow-canvas.spec.ts tests/e2e/vitality-flow.spec.ts tests/e2e/workflow-export.spec.ts
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web lint
```

Feel-check：普通速度与 DevTools 10% 速度观察新结果；根节点与连线从始至终不偏移。切换减少动态时新结果直接出现且仍有完成状态。这里规定的是验收步骤，并非已经测得的结果。

## 范围约束

不改布局坐标算法、任务状态、API、撤销模型、结果计费或数据迁移。若基线代码已变化，先按选择器和状态事件复核，不按行号直接替换。不批量修改兼容 easing token。
