# 织芽接入验证记录

日期：2026-11-08。范围：正式毛绒资源、无限白板与同一聊天接线、项目活动摘要、生命周期、开关回退与性能。现行规格见 [接入说明](integration.md)。

## 已完成的检查

| 检查 | 结果 | 覆盖 |
| --- | --- | --- |
| Web 定向单元／组件测试 | 7 个文件，24 项通过 | 活动优先级、终态基线与去重、重试、多任务、隐藏恢复、旧响应兼容、共享查询、偏好、断点切换、迁移、中文组合输入与流式回复 |
| API 定向单元测试 | 3 个文件，15 项通过 | 参数校验、旧请求兼容、权限前置、计数、终态排序、最多20条、父子任务过滤、分页独立性 |
| PostgreSQL 集成测试 | 5 项通过 | 真实权限与分页、只读能力、活动摘要、历史失败隔离、真实工作流和旧 Agent Run 的图片子任务去重、排队到执行到终态的记录变化 |
| 浏览器交互与界面 | 19 项通过，均为单 worker | 织芽9项、生命周期2项、画面审计1项、关闭开关1项、既有白板与桌面助手回归6项 |
| 性能用例 | 1项，分别在无界面与可见 Chromium 运行并通过 | 100个对象，暂停／创作各30秒，原生帧间隔及指针事件到下一帧 |
| 定向静态检查 | 通过 | 修改文件 ESLint、Web与API类型检查、共享包构建、Git差异空白检查 |

浏览器共20个不同用例，不把重复执行计作新增覆盖。业务API使用受控数据，实际运行的是应用里的聊天、无限白板和正式毛绒渲染器；未使用合成角色。

## 交互与状态证据

- 首次收起无空白侧栏；384px停靠、调宽、开合保持白板中心与缩放。
- 缩放检查先等待已有素材入场动画完成，再记录几何基线，避免把素材自身的短暂缩放误计为相机变化；保留原有误差阈值，修正后的该用例连续三次通过。
- 开合保持同一个输入元素，草稿、选区和阅读位置不丢失；收起时回复继续同步，停止按钮仍调用原取消接口。组合输入与伴生Enter不提交。
- 显式引用与会话链接展开同一聊天；聊天中的结果记录在连续开合后仍可定位回白板，下一条草稿保留。
- 长按、6px移动取消、Escape恢复、落定、越界、位置持久化和透明区域穿透通过。账号／项目切换不串用位置、宽度和开合偏好；手机关闭后切回桌面保持关闭。
- 320px触屏模拟、系统深色偏好、减弱动态通过。平台当前使用统一浅色主题，系统偏好模拟不代表另有一套应用深色主题。触屏打开不自动聚焦输入，减弱动态没有运行中的角色动画；收起聊天后角色网格与白板图片立即恢复可见，状态文字与底部工具条保持间距。
- 排队、实际执行、待确认、成功、失败和断线保留由受控业务状态驱动；取消、重试、多任务、历史恢复和重复响应另有状态测试。角色开合不新增会话或提交生成请求。
- 聊天展开、离屏、失焦和页面隐藏处理停止绘制。三个完整的挂载／卸载周期后，角色追踪到的GPU对象和有效事件信号均回到零；重新挂载恢复正常数量。页面隐藏／失焦分支使用浏览器事件模拟，未把它表述为跨所有系统的后台节流实测。
- WebGL初始不可用、上下文丢失和恢复通过；图片加载失败时普通聊天可用。关闭 `NEXT_PUBLIC_ZHIYA_ENABLED` 的独立前端服务不请求角色图片或旧Live2D模型，聊天草稿照常保留。
- 正式发布21个WebP文件，共278,946字节，SHA-256均与确认样稿相同。未发布未使用的整张参考剪影。原参考和历史模型保留。

本轮修正了首访空白侧栏、分栏调宽引起视野偏移、手机到桌面的旧展开状态、隐藏加载后恢复首帧的位置跳动，以及减弱动态下继承可见性过渡导致的逐层显示延迟。拖动边界同时预留颜文字与最多两行状态文案，避免窄屏下覆盖底部工具条；显示延迟和工具条遮挡均先由回归断言复现，再修复通过。

## 性能实测

使用Windows本机Next开发服务、Chromium 145.0.7632.6、1440×900、DPR 1，白板包含30张图片、60张文本便签、10张色卡。暂停与创作各测30秒，包含真实浏览器指针平移；切换角色可见性触发暂停，白板尺寸保持一致。测量关闭trace，不安装Playwright模拟时钟。

验收目标保持为平均至少58fps、超过33.3ms的帧少于1%，没有放宽阈值。

| 渲染环境 | 织芽状态 | 平均帧率 | 超过33.3ms的帧 | 指针事件到下一帧平均／P95 |
| --- | --- | ---: | ---: | ---: |
| 无界面Chromium，约60Hz调度，SwiftShader | 暂停 | 59.90fps | 0.11% | 2.69／6.20ms |
| 无界面Chromium，约60Hz调度，SwiftShader | 创作 | 59.80fps | 0.22% | 2.88／7.70ms |
| 可见Chromium，RTX 4050 Laptop／D3D11，144Hz显示器 | 暂停 | 142.63fps | 0.05% | 1.27／1.90ms |
| 可见Chromium，RTX 4050 Laptop／D3D11，144Hz显示器 | 创作 | 116.56fps | 0.37% | 4.17／4.40ms |

可见浏览器采集了暂停4,279个、创作3,497个帧间隔。创作存在额外渲染开销，当前设备仍达到本轮阈值。指针响应指标仅是浏览器收到事件到下一个rAF的时间，不是鼠标硬件到屏幕的端到端延迟。高刷新率桌面结果不冒充60Hz设备结果。

第一次尝试继承了视觉夹具的模拟时钟；已确认它会替换rAF，故该组数字无效，保存在 `invalid-simulated-clock.json` 供追溯，不计入验收。随后为夹具增加原生时钟模式和防误用检查，以上两组为重新测量结果。

原始记录位于忽略的输出目录：

- [可见浏览器性能原始数据](../../../output/playwright/zhiya/performance.json)
- [无界面浏览器性能原始数据](../../../output/playwright/zhiya/performance-headless.json)
- [画面裁切审计](../../../output/playwright/zhiya/clipping.json)：默认、悬停、聊天展开、落定、创作均为 `cut=0`、`hidden=0`。
- [白板默认效果](../../../output/playwright/zhiya/whiteboard-idle.png)、[右侧同一聊天](../../../output/playwright/zhiya/docked-same-chat.png)、[创作状态](../../../output/playwright/zhiya/working.png)、[手机与系统深色偏好](../../../output/playwright/zhiya/mobile-system-dark.png)、[100对象白板](../../../output/playwright/zhiya/100-object-working.png)。

## 复验入口

在仓库根目录执行相关检查，不运行全仓检查或CI：

```powershell
$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
pnpm --filter @fashion/shared build
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/api typecheck
pnpm --filter @fashion/web test src/modules/assistant-character/project-activity.spec.ts src/modules/tasks/project-task-source.spec.tsx src/components/workspace-preferences.spec.ts src/modules/board/workflow/use-workspace-layout.spec.ts src/modules/board/workflow/WorkflowMigration.spec.tsx src/components/assistant-ime.spec.ts src/components/StreamingReply.spec.tsx
$zhiyaPreviousDatabaseUrl = $env:DATABASE_URL
try {
  $env:DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:5432/unit'
  pnpm --filter @fashion/api test src/modules/project-tasks/project-task-activity.spec.ts src/modules/project-tasks/project-tasks.service.spec.ts src/modules/project-tasks/project-tasks.controller.spec.ts
} finally {
  if ($null -eq $zhiyaPreviousDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
  else { $env:DATABASE_URL = $zhiyaPreviousDatabaseUrl }
}
pnpm exec playwright test tests/e2e/zhiya-assistant.spec.ts tests/e2e/zhiya-lifecycle.spec.ts tests/e2e/canvas-workspace.spec.ts tests/e2e/desktop-agent-acceptance.spec.ts --workers=1
```

真实PostgreSQL检查使用根目录已有的`.env`，在 `apps/api` 目录执行以下命令。测试创建并清理专用记录，不需要为本功能执行迁移，不启动模型任务：

```powershell
$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
node --env-file=../../.env node_modules/vitest/vitest.mjs run src/modules/project-tasks/project-tasks.integration.spec.ts
```

性能和画面审计单独运行，避免同时编译或执行其他重型检查。`ZHIYA_CLIP_AUDIT` 指向本机现有的完整 `clip-audit.js` 文件；性能默认每组30秒，`ZHIYA_PERF_SECONDS` 可设为10–60秒：

```powershell
$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$env:ZHIYA_PERF='1'
pnpm exec playwright test tests/e2e/zhiya-performance.spec.ts --workers=1 --headed
$env:ZHIYA_CLIP_AUDIT = Join-Path $env:USERPROFILE '.codex/skills/desktop-agent-ui/scripts/clip-audit.js'
pnpm exec playwright test tests/e2e/zhiya-rendering.spec.ts --workers=1
```

关闭开关复验：以 `NEXT_PUBLIC_ZHIYA_ENABLED=false`、隔离的 `NEXT_DIST_DIR` 在另一端口启动Web，在测试进程设置 `ZHIYA_DISABLED_URL` 为该服务地址，然后运行 `tests/e2e/zhiya-disabled.spec.ts`。本轮使用3002端口，验证后已停止独立服务并恢复Next自动生成的类型引用；主开发服务保留。

## 验证边界

真实数据库检查覆盖业务记录、权限和聚合；浏览器中聊天／任务响应受控，因此不代表真实队列、存储和收费供应商端到端生成验收。没有调用收费服务，没有运行完整`pnpm check`、CI、提交或推送。

手机为Chromium触屏和窄屏模拟，中文输入法守卫由composition事件覆盖。未做实体手机软键盘、原生输入法候选窗、Safari、低端设备与长时间续航测试；30秒采样也不等同于10分钟以上的稳定性测试。图片资源的正式视觉与本机桌面渲染已使用真实实现检查。
