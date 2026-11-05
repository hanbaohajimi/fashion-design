# 实时试穿分层验收

日期：2026-10-29。真实供应商调用未获授权，本轮不签发真实 Decart 凭证、不执行推理或深度探针。

| 层级 | 当前边界 |
| --- | --- |
| 模拟验证 | Fake adapter、假相机、模拟应用API证明代码行为；截图标注 Mock，不能证明换装效果 |
| 真实本地依赖 | 隔离 PostgreSQL schema、真实 Redis/BullMQ/worker 缩略处理与私有 MinIO；供应商仍 Mock |
| 真实供应商 | 未执行。缺独立真实调用/预算授权及账号模型确认；用户真实摄像头和网络未验证 |

## 实际执行

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm view @decartai/sdk version`、versions；安装包离线模型解析 | 已发布/安装精确版0.2.14，lucy-vton-3.6定义存在；未核实账号权限 |
| `pnpm infra:up` | 通过，本机 PostgreSQL/Redis/MinIO healthy，bucket维持私有 |
| `pnpm tryon:doctor` | 通过；默认关闭、未配置Decart Key、无允许名单；SDK版本一致，本机三依赖TCP可达，供应商请求0 |
| `pnpm tryon:verify --local --browser` | 通过：40迁移部署到唯一schema；后端4文件41测试（34 Mock + 7真实本地）；前端6文件52测试；Chromium5测试 |
| `pnpm exec playwright test tests/e2e/studio-flow.spec.ts tests/e2e/workflow-canvas.spec.ts --grep '款式候选\|实验保存\|商品展示包\|商品展示草稿\|候选的大图\|布局保存失败阻止'` | 实际匹配5项，全部通过：款式候选、实验显式提交、展示包复核导出、作品详情入口、画布保存失败离开保护 |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 均通过；最后源码稳定后又顺序执行，日志见output/realtime-tryon/final-*.log |
| `pnpm db:validate` | 通过 |
| `node --check scripts/manual/verify-realtime-tryon.mjs`、`git diff --check` | 通过 |
| Nest生产产物试穿模块加载 | 配置现有本机环境后require成功，无ERR_REQUIRE_ESM；不启动供应商会话 |
| Web生产静态JS/source map canary扫描 | 服务端专用假密钥canary未出现。SDK自身含环境变量名称/缺密钥提示文本，不代表实际凭证被打包 |
| `pnpm test` | 聚合退出1：Web574通过；Worker135通过/1跳过；API775通过/3失败/9跳过。失败均位于未修改的assistant-streams.integration.spec.ts |
| 上述SSE文件独立复测 | `node --env-file=.env.example --env-file-if-exists=.env ./apps/api/node_modules/vitest/vitest.mjs run src/modules/agent-conversations/assistant-streams.integration.spec.ts --root apps/api`：5通过、1跳过。未定位聚合运行失败根因，未修改SSE代码，不能将整批测试记为全绿 |

最新真实依赖验证schema：`tryon_verify_1793287978169`，记录在`output/realtime-tryon/local-environment.json`；早期验证schema也保留作证据。未向配置数据库的public schema部署本轮迁移。测试用户/对象按测试清理，schema本身不自动删除。

## 已覆盖的实质行为

后端覆盖无配置/禁用/未确认模型/非法配置、内部名单、跨账号/跨项目/只读权限、重复及并发创建、响应丢失后禁止重签、未知签发保守保留、Decimal预算、客户端结束不退费、累计观察去重/乱序/越界、截图归属/像素/幂等和授权重读。真实依赖测试使用实际FilesService、签名PUT、隔离BullMQ队列和真实缩略worker处理器、MinIO与Prisma；供应商token始终Mock，显式阻断外网fetch。

浏览器覆盖相机拒绝/无设备/不安全环境、晚授权、双启动、停止后晚token/connection/remote回调、设备断开、首帧与更新后新帧门槛、合并切换、无新帧/会话/连接超时、SDK重连拦截、原尺寸截图、保存重试和画布去重。测试专用esbuild页面复用生产Panel/controller，以controllerFactory注入Fake；它由Playwright请求拦截提供，不存在生产测试路由、URL绕过或自动Fake回退。

## 截图证据

- `output/realtime-tryon/mock-disabled-desktop.png`：真实Next页面、模拟项目与API，功能关闭状态。
- `output/realtime-tryon/mock-disabled-mobile.png`：390px宽，同上；横向溢出断言通过。
- `output/realtime-tryon/mock-live-capture-desktop.png`：真实Panel/controller，Canvas模拟960×720远端媒体，明确标注模拟。PNG头与像素尺寸已验证，保存失败后重试没有重复上传。

三张截图均经过视觉复核；没有任何图片可作为真实Decart换装效果证据。本轮没有调用用户物理摄像头。

## 未验证项与开放条件

- 真实供应商：缺真实调用/预算授权、Key与账号模型确认。未测试网络、真实首帧/FPS/端到端延迟、模型效果、真实账单及供应商停止行为；未开通或购买资源。
- 公开上线：继续禁止public模式。Token可能被重用或用于并发/更高计费档位；内部应用预留不能成为供应商全局硬费用上限。条款、训练/留存/保密安排、日志采集和账单监控仍需组织核实。
- 原始画布上传参考图的快捷按钮使用现有`canEditPayload`保守控制，被执行工具冻结的原参考会禁用；可改从项目资产或本地上传选图。候选作品入口不受这项节点冻结限制。
- 不支持无项目个人模式、多件叠穿、自动付费清理、录制、体尺或尺码推荐。不承诺复杂服装细节、文字/左右结构还原。
- `pnpm test:e2e`全套、`pnpm check`依赖审计全套及真实生产环境验收未执行；执行了以上定向浏览器回归和构建/静态检查。
- 真实效果验收与商业开放属于后续外部配置/授权阶段；当前交付是已实现且有无收费验证的内部接入，默认关闭。

配置、人工smoke及停用步骤见[IMPLEMENTATION](IMPLEMENTATION.md)，逐文件清单见[FILES](FILES.md)。没有提交、推送或部署。
