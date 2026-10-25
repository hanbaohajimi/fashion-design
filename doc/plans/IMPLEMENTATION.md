# 七项优化实施记录

日期：2026-10-25。以当前共享工作区为对象；保留原有以及实施期间出现的其他改动，未执行 reset、stash、提交或推送。

结论：七项实现已落地；P1 与 PNG 最终浏览器回归 7/7 通过，P2 交互与原型测试通过。前端全量单测 297 项通过，最后的 HTTP 兼容性修复另经 19 项技术包回归通过；最后一次 lint 和生产 build（含 TypeScript）于 13:53 前后通过。扩展 105 项 E2E 没有在所有并行改动完成后重新全跑，不能声称全库 E2E 全绿。真机、稳定性能对照和导航视觉基线仍有明确验收边界。

## 实施内容

| 任务 | 已实施行为 | 主要文件 |
| --- | --- | --- |
| 001 / P1 | 移除历史节点根部入场、普通边描线；仅运行边流动，隐藏标签页暂停；保留已有品牌事件反馈 | `apps/web/src/modules/board/workflow/workflow-{node,connections}.module.css`、`WorkflowCanvas.tsx` |
| 002 / P1 | 统一 767/1100 布局模式；助手不再因高度变化被关闭；保持草稿及模式切换焦点；补 viewport、安全区、宽屏触控输入字号 | `use-workspace-layout.ts`、`layout.tsx`、共享和工作区样式 |
| 003 / P1 | 重命名同步请求锁、错误保留草稿、菜单焦点恢复；父子错误去重；复制/归档/恢复确认后发单一 Toast；移除项目时恢复可用焦点 | `ProjectCard.tsx`、`ProjectLibrary.tsx`、`operation-notice.ts`、`ui.tsx` |
| 004 / P1 | 技术表字符串草稿、保存校验、错误字段关联、稳定行 id、复核失效；图片失败恢复；虚拟列表稳定 item key 与固定内容槽；开发用最坏数据入口 | `tech-pack-draft.ts`、`TechPackEditor.tsx`、`TechPackTables.tsx`、`FabricCard.tsx`、`FabricVirtualGrid.tsx` |
| 005 / P2 | 侧栏 pointermove 不提交 React；每帧最多一次局部宽度写入；pointerup 提交，cancel/lostcapture/失焦回滚；键盘和 ARIA 同步 | `use-sidebar-resize.ts`、`WorkflowCanvas.tsx` |
| 006 / P2 | 组内首次 180ms、关闭 120ms、暖机 300ms；触摸不残留提示，键盘即时，提示可悬停阅读；应用到画布缩放工具组 | `tooltip-group.tsx`、`ui.tsx` |
| 007 / P2 | 矩阵总览、专注比较、审阅队列三个完整局部原型；共享选择、来源详情、演示重试、只读状态、URL 选择和键盘 picker | `apps/web/src/prototypes/result-selection/`、`apps/web/src/app/prototypes/` |

技术包只改变 Web 编辑模型，UI id 不进入请求；继续使用原有 expectedVersion、requestKey 和冲突处理。实验原型只操作本地 fixture，不发生成、上传、计费或保存请求。

结果原型入口 `/prototypes/result-selection`；数据边界入口 `/prototypes/ui-boundaries`。两者在生产环境都调用 notFound。最终生产布局仍使用现有 ExperimentPanel，原型方向待用户比较后选择。

## 验证方式

现有 3000 端口服务使用旧版构建，不能用于验收当前源码。新增 `playwright.optimization.config.ts` 使用独立 3010 端口、独立 `.next/optimization` 和测试输出，关闭测试服务的遥测配置；`next.config.ts` 增加可选 NEXT_DIST_DIR，默认构建路径不变。

```powershell
pnpm --filter @fashion/web test --maxWorkers=2
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web lint
pnpm exec playwright test -c playwright.optimization.config.ts tests/e2e/optimization-prototypes.spec.ts tests/e2e/frontend-experience.spec.ts tests/e2e/workspace-ui.spec.ts tests/e2e/workflow-canvas.spec.ts tests/e2e/workflow-export.spec.ts tests/e2e/vitality-flow.spec.ts
```

首次全量单测有一项在并行负载下超过默认 5 秒，限制为两个 worker 后 53 文件 / 260 项通过。随后增加了 Tooltip、拖拽和稳定行身份测试；最终一次全量运行于 13:37（北京时间）开始，62 文件 / 297 项全部通过，耗时 111.49 秒。测试期间还有其他功能用例加入，数量增长不能全部归于本任务。

浏览器截图存放在 `output/playwright/optimization/`。原型图片是自制示意图，不是用户私有设计或模型生成成果。性能录制按需运行：设置 `ATELIER_OPT_PERF=1` 后，以独立 Playwright 配置筛选“优化侧栏性能录制”；输出 `sidebar-performance.json`，普通图 12 节点/18 边、压力图 200 节点/300 边，各三次十秒。

## 验证边界

- iOS Safari / Android Chrome 真机的软键盘、刘海安全区和地址栏变化无法由桌面模拟替代，仍需实机检查。
- 性能测试记录当前构建，若无相同构建条件的修改前样本，不声明速度提升百分比或稳定 60fps。
- 工作区存在并行改动；全局 lint/build/E2E 的结果应附时间与失败来源，不能将其他变更的状态误报为本轮已验证。
- 不自动覆盖视觉基线；有意布局变化需要逐张核对后再更新。

## 最终验证结果

- **最终 P1 + PNG 回归：7 / 7 通过，30.6 秒（13:51 北京时间完成）。** 覆盖重命名防重复与失败恢复、归档焦点、宽屏触控字号/viewport、手机断点与键盘高度、历史图立即呈现、PNG 实际图文内容、技术包章节/错误字段/草稿。报告 `output/playwright/optimization-p1-final-results.json`。之前的导出失败已按当前代码复测通过。
- 前端 lint、typecheck 均通过。类型检查期间发现新增助手上下文 fixture 缺少 currentTask / visualCoverage；补齐测试数据，未改变业务契约。
- 生产构建通过（含最后的 HTTP 行 ID 修复）：在 PowerShell 设置 `$env:NEXT_DIST_DIR='.next/optimization-build'` 后执行 `pnpm --filter @fashion/web build`。独立生产服务 3011 实测 `/login` → 200、`/prototypes/result-selection` → 404、`/prototypes/ui-boundaries` → 404；证据 `output/playwright/optimization/production-routes.json`。核验后已停止本次生产服务。
- 首轮扩展 E2E：105 项，82 通过 / 23 失败，耗时 17.4 分钟，原始报告 `output/playwright/optimization-full-results.json`。其中最后 10 项是测试服务 connection reset/refused；其余包含旧详情面板定位、测试期间变更、旧服务录屏、手机切换新行为及一次草图拖动失败。没有将此轮标为全绿。
- 聚焦复测：13 项，11 通过 / 2 失败，耗时 3.6 分钟，报告 `output/playwright/optimization-focused-results.json`。通过项目包含重命名/归档请求与焦点、原型、320px 极端数据、侧栏拖拽与 Tooltip、手机布局、历史图、草图拖动、窄屏画布及两项技术包流程。两项失败分别是平板测试未等待初始化后的助手入口，以及另一个会话在测试过程中重命名了 PNG 用例（`Test not found in the worker process`）；后续定向复测单独记录。
- 随后两项复测：平板触控输入/viewport 通过；PNG 用例等待已调整的工具状态文字超时。报告 `output/playwright/optimization-rerun-results.json`。该轮同样保留失败结果，不用功能单测替代导出检查。
- 固定 Docker Chromium 视觉检查首轮：项目空态/失败态基线通过；只读技术包暴露 HTTP 非安全上下文缺少 crypto.randomUUID 的实际错误。已将技术表初载和新增行统一改为仅用于 React key 的本地唯一 ID，不影响请求载荷。增加无 crypto API 场景测试，技术包三文件 / 19 项复测通过；只读页面视觉复测另行记录。
- 只读技术包复测：页面正常呈现、只读字段与对比度检查通过；像素基线仍有 2,821 像素差异。已查看 actual/diff，差异集中在工作区并行改动后的左侧导航分组，技术包正文正常；未覆盖旧基线。证据目录 `output/playwright/optimization-visual-retest/atelier-readonly-technical-revision-remains-readable/`。

## 原型比较与交互记录

| 方向 | 已实现并检查的路径 | 适用场景与代价 |
| --- | --- | --- |
| 矩阵总览 | 直接选择 → 打开来源 → Escape 返回触发项 → 保持选择切换版本 | 同时扫视整批候选，适合第一轮筛选；细节需打开大图 |
| 专注比较 | 左右两个预览 → 选定替换侧 → 点击候选替换 → 查看来源/选择 | 适合比较轮廓与细节；手机上下排列，需要滚动对照 |
| 审阅队列 | 保留或跳过 → 下一张 → 撤销恢复之前选中状态 → 从头查看 | 适合逐张审阅；整批横向对照能力较弱 |

共用选择跨版本保留；演示重试后恢复可选；只读时禁用写操作；保存入口明确说明尚未创建正式款式；输入框内数字不切换版本，聚焦 picker 后数字快捷键有效。图片为自制服装示意图，未验证真实材质细节辨识效率。建议先以矩阵筛选、再比较两张的任务观察设计师实际操作，未进行真人测试，不报告效率提升百分比，不选定生产版本。

截图位于 `output/playwright/optimization/`：`result-{1,2,3}-{desktop,mobile}.png`、`boundaries-320.png`、`rename-error.png`、`archive-success.png`、`mobile-assistant-767.png`。已人工查看原型截图并修复图片被裁切及手机 picker 标签换行；最终截图显示完整图片比例和正常单行 picker。

## 性能采样

已运行普通图（12 节点 / 18 边）与压力图（200 / 300），各三次十秒，Chromium 145.0.7632.6、Next 开发构建。原始数据：`output/playwright/optimization/sidebar-performance.json`。

| 图规模 | 每次长任务数 | 每次最长长任务 ms | 每次 rAF 间隔 P95 ms | 每次 Layout 累计 ms |
| --- | --- | --- | --- | --- |
| 12 / 18 | 2、0、0 | 91、0、0 | 16.8、16.8、16.8 | 13.9、115.0、82.0 |
| 200 / 300 | 0、0、2 | 0、0、167 | 16.7、16.8、16.8 | 121.1、136.9、56.7 |

限制：同机其他会话持续修改和测试，采样附近可用内存低至约 336 MiB；首/末样本的宽度写入次数明显少于指针事件，可能存在手势中断，不能当作完整拖动基准。数据用于暴露环境与长任务，不证明性能验收达标。结构层面由单测确认 pointermove 不提交 React、rAF 合并写入；真实浏览器确认提交及取消回滚。稳定机器上仍需生产构建的修改前后对照录制。
