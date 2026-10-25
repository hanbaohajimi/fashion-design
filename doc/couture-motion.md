# Atelier 高定工作室动效

Mo.js 负责线迹、裁片、作品揭幕和签章；日常按钮、菜单、数字与绘画等待视频继续使用原有实现。动效只响应真实业务事件，不改变任务状态，不阻塞导航、编辑和下载。

## 场景与时长

| 预设 | 接入位置 | 时长 |
| --- | --- | --- |
| `archive` | 项目首页首次可用时划出裁剪基准线；首屏最多 9 张卡片依次铺开 | 600ms；卡片 260ms，间隔 40ms |
| `signature` | 新项目创建成功后的画布项目名 | 500ms |
| `stitch` | 趋势首次成功加入工作流；使用已有趋势配色 | 420ms |
| `material` | 面料上传成功、新面料节点加入画布 | 360ms |
| `needle` | 服务端接受生成任务或工作流节点进入新的执行阶段 | 420ms |
| `thread` | 同一任务真实的排队、处理中状态切换 | 260ms |
| `reveal` | 新候选的图片加载成功，完成固有尺寸更新后 | 700ms |
| `seal` | 新系列打开、工作室显式保存修订、当前请求的导出文件就绪 | 480ms |

工作室保存回执由工作室页面持有，显示 1.6 秒。即使保存后编辑器刷新、表单滚动较长，成功回执仍可见。自动保存、历史恢复、失败和取消不触发签章。任务提交使用起针回执，不显示保存签章；实验重试按实际返回的 attempt 记录新事件。

## 接入约定

业务组件使用 `useCoutureMotion()` 返回的 `play(effect, { anchor, eventKey, colors })`，由 hook 管理卸载清理。请求完成后调用，不等待动画完成。React 提交成功状态后再测量锚点；返回的句柄提供 `cancel()` 和 `finished`。

跨页面／弹窗的成功事件用短期 `markMotion` 回执，由目标 `MotionReceipt` 消费。回执只保存在内存，10 秒失效，最多 100 个。任务状态通过 `claimTaskMotion` 去重，多个任务视图只播放一次。画布沿用新结果标记，图片错误或消费后移除；历史加载不生成标记。

时间和曲线来源是运行中的 `src/styles/design-system.css`。不启用旧 `motion-tokens.css` 或 `motion-enhancements.css`。Mo.js 的 Burst 会将数组视为逐粒子参数，因此必须将 CSS 贝塞尔坐标转换成 `mojs.easing.bezier()` 函数再传入。

## 生命周期与性能边界

- `@mojs/core` 仅在有资格播放时动态导入；首次加载超过 1 秒则跳过当次效果。
- 最多两个并发效果，每个锚点最多一个；同一事件重复调用或超额事件不排队。
- 单次粒子最多 8 个，粗指针设备减半；图形使用细线和空心几何片。没有循环装饰或声音。
- 等待锚点连续三帧稳定，适配添加面料后的自动定位。播放后锚点位移、缩放、滚动、离开视口、卸载或页面隐藏即停止并清理。
- 装饰 DOM 在画布外独立挂载，`aria-hidden` 且 `pointer-events: none`，不进入画布 SVG／图片导出。
- 减少动态效果时不执行 Mo.js，状态文本与原有反馈保留；绘画视频的暂停、可见性和单实例播放约束保持原样。
- Turbopack 开发模式可能预注册异步 chunk；实际网络拆分需使用生产构建验证。

## 验证与录屏

```powershell
pnpm --filter @fashion/web test --maxWorkers=4
pnpm --filter @fashion/web lint
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web build
$env:ATELIER_PRODUCTION_TEST = "true"
pnpm exec playwright test --config playwright.couture.config.ts
```

专用 Playwright 配置使用端口 3107，避免与其他 UI 检查争用默认服务；录屏、trace 和帧间隔保存在 `output/playwright/couture-results/`，HTML 报告在 `output/playwright/couture-report/`。画布测试额外附有可导入 Chrome Performance 面板的 `couture-performance` trace。

单元测试覆盖真实 Mo.js 的全部八种预设、事件去重、并发限制、卸载、后台、几何变化、失败与减少动态效果。浏览器测试覆盖真实页面的创建、收集、上传、画布到达、系列、保存和下载；不仅检查 SVG 存在，也检查实际播放持续时间。

这些浏览器用例模拟 API，验证前端状态与交互，不代表真实数据库、存储和任务队列链路已验证。录制和自动化运行的帧间隔用于定位问题，不作为所有硬件都能稳定 60fps 的承诺。

2026-10-25 验证记录：Web lint、typecheck 和生产构建通过；全量 Web 单元测试 276 项通过，最终任务衔接修改后的相关测试 32 项通过。最终生产浏览器测试 8 个场景全部通过，录屏分辨率为 1440 × 1000。测试报告入口为 `output/playwright/couture-report/index.html`。

本轮录制采集 356 个动效期间的帧间隔，中位数 16ms、P95 20ms，其中 2 个超过 33.4ms。摘要见 `output/playwright/couture-measurements.json`，原始 Chrome 性能轨迹见 `output/playwright/couture-performance.json`；每次场景回执的图形数量、持续时间和点击穿透属性也保存在报告附件中。
