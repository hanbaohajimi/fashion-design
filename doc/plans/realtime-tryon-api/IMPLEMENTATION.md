# 实时摄像头试穿实施与配置

核查日期：2026-10-29。基线：`node-interaction`，`0ee814172aa8243bc90443b047558ec940ecdc30`；开始时工作区干净。Node v24.14.0，pnpm 11.9.0。仅增量接入当前 Next/Nest/tldraw，不创建独立产品。

## 入口与复用

| 环节 | 本轮实现/复用 |
| --- | --- |
| 产品入口 | 款式与交付 → 商品展示 → 实时试穿；`/:projectId/studio?tab=presentation&mode=realtime` |
| 所选图片 | 工作台所选图片工具栏“实时试穿”，以资产 ID 深链进入同一面板 |
| 画布原始上传图 | 参考图片详情“实时试穿这张图片”，用户点击才通过现有幂等导入登记资产，再经原有保存保护跳转 |
| 本地上传 | 既有 `signImageUpload → putOriginal → completeUpload → waitForThumbnail → importDesignAsset` |
| 权限 | 全局 AuthGuard/OriginGuard，ProjectAccessPolicy 的 edit 权限；项目内有权限图片；首版需项目，不自动创建项目 |
| 媒体 | 浏览器官方 SDK 直接连接 Decart；不经 BullMQ 逐帧上传；原始预览始终标为本地 |
| 保存 | 用户主动截取远端 video 原生像素，经既有私有文件管线上传、后端 capture 登记并记录 AI 来源 |
| 画布 | 已保存资产通过现有 workflow patch 增加 candidate，作品区与流程画布共用同一资产 |
| API 前缀 | Nest 控制器为 `/realtime-tryon`；Web 的 `/api/*` 由现有 Next rewrite 转发，不重复加前缀 |
| 持久计量 | 新 RealtimeTryOnSession / RealtimeTryOnCapture 表；PostgreSQL 事务 advisory lock 串行化跨实例签发与预算决策 |

浏览器文件集中在 `apps/web/src/modules/studio/realtime-tryon/`；服务端在 `apps/api/src/modules/realtime-tryon/`；共享契约在 `packages/shared/src/realtime-tryon.ts`。新增兼容迁移见 `packages/db/prisma/migrations/`。未替换旧图片生成、服装秀试衣、草稿保护或导航。

本轮真实依赖验证发现现有 PrismaPg 适配器未显式采用连接 URL 的 schema，已在 `packages/db/src/client.ts` 传入 adapter schema 选项；未指定时仍采用 public。这使隔离测试确实访问唯一验证 schema，避免测试落到默认库表。

## 官方版本核查

`pnpm view @decartai/sdk version` 与 versions 列表确认 npm 已发布 **0.2.14**，Web 以精确版本安装并更新 pnpm 锁文件。安装包 `models.realtime("lucy-vton-3.6")` 离线可解析为 1280×720、理想/最高 30 FPS；这只是模型定义，不是实测输出保证。也支持显式 3.5，不使用 latest，不按调用失败自动回退模型。

服务端根据该包 `dist/tokens/client.js`、`dist/shared/request.js`、`dist/create-client.js` 核实的 REST 边界调用 `https://api.decart.ai/v1/client/tokens`，使用 `X-API-KEY`、`expiresIn`、`allowedModels`、`allowedOrigins`、`constraints.realtime.maxSessionDuration`；避免将 ESM 媒体 SDK 引入 Nest CommonJS 产物。永久密钥只在服务端，响应仅含短期凭证，no-store，凭证不写数据库。

浏览器按需加载 SDK，使用完整 initialState 和每次 `image + prompt + enhance:false` 更新。0.2.14 的 `retries:0` 只限制初次连接，因此另外使用一次性凭证提供函数并在 reconnecting 时断开，不刷新令牌、不自动新建会话。禁用 SDK telemetry，使用 noop logger，不启用 Fast。首次可呈现远端帧才进入 live；换装接受后需新帧才开放截图。

核查来源：[官方 SDK](https://github.com/DecartAI/sdk/tree/main/packages/sdk)、[VTON](https://docs.platform.decart.ai/models/realtime/virtual-try-on)、[Client Tokens](https://docs.platform.decart.ai/getting-started/client-tokens)、[SDK Direct](https://docs.platform.decart.ai/integrations/sdk-direct)。账号是否支持模型仍需管理员核实。

## 安全与费用边界

默认禁用，仅内部名单。public 配置保持不可用，直到供应商凭证重用、并发和 Fast 等计费选项的约束已得到独立证明。应用的预算预留是风险控制，不能限制已交付凭证被恶意并行重用的全部费用。

创建请求必须有 Idempotency-Key；已有请求统一返回 `SESSION_ALREADY_ISSUED`，不会重复签发或保存 Token 响应。签发超时/不确定结果保留预留。金额以 Prisma Decimal 计算，每日预算以 UTC 日界统计，并包含跨日仍有风险的预留；结束和客户端观察不退款、不提前释放并发风险。风险期涵盖令牌请求超时、最后建连时刻、供应商会话上限和时钟余量。

观察值以单调序号去重、累计秒数取最大值，标为 client-observed；它们不是供应商账单或已停止证明。截图来源同样记录客户端观察性质、会话、模型、服装及修订、原生像素、时间和 AI 标记。应用不默认录制视频或上传原始相机帧。

2026-10-29 官方价目页列 VTON 3.6 标准 720p **$0.02/生成秒**、Fast $0.04/秒。本轮未将该价格自动写为可用配置；管理员仍需核实账号费率与预算。[价格来源](https://docs.platform.decart.ai/getting-started/pricing)

开始前明确告知相机和服装发送至第三方。现有 PostHog 禁用自动采集及 session replay，只允许指定事件属性；该功能不新增媒体/令牌分析事件。SDK 原始错误、供应商响应体和凭证不向界面或日志转发。上线前仍需核实组织的日志、代理、Sentry 和供应商合同；不能承诺未发布设计绝对保密、绝不训练、真实尺码拟合或完全免费。[供应商 API 条款](https://docs.platform.decart.ai/resources/api-terms)

## 配置与启动

以根 `.env.example` 的 `REALTIME_TRYON_*` 段为唯一配置模板，在服务器环境配置；不要将密钥写入 NEXT_PUBLIC、聊天或版本库。

1. 安装锁定依赖，执行 `pnpm db:generate` / `pnpm build:packages`。升级目标数据库前按现有流程备份并审查新迁移，再执行 `pnpm db:deploy`；本轮验证只部署到唯一隔离本机 schema。
2. 默认 `REALTIME_TRYON_ENABLED=false`、`REALTIME_TRYON_ACCESS_MODE=internal`、预算 0。未配置仍可手动预览本地相机。
3. 内测管理员准备服务端 DECART_API_KEY、精确模型 DECART_REALTIME_MODEL、内部用户 ID、无路径/尾斜杠的 origin 白名单、费率与核验日期、正数日预算、TTL/单次时长/并发上限。确认账号模型权限后才设 `REALTIME_TRYON_MODEL_CONFIRMED=true`。
4. `pnpm tryon:doctor` 检查配置与安装 SDK，对本机 PostgreSQL/Redis/MinIO 做有限 TCP 连通检查（不证明业务链路）；非本机地址不探测。`--require-ready` 可将不可用状态作为失败退出。它不探测供应商、不签发令牌、不打印配置凭证。
5. 运行现有 `pnpm infra:up` 和开发服务。浏览器需 HTTPS 或 localhost、摄像头与可达供应商网络。
6. 只有另行明确授权真实调用与预算后，才由管理员启用功能、让名单用户手动进入面板、选服装、开相机、同意费用并开始。

`RUN_LIVE_TRYON_TESTS=1` 或环境存在 Key 都不构成授权；默认测试没有收费 smoke 入口，doctor 不运行 SDK deep connectivity probe。

## 验证与人工 smoke

`pnpm tryon:verify` 只跑共享/数据库构建和试穿相关 Mock 测试；`--local` 在 loopback PostgreSQL 新建 `tryon_verify_<时间>` schema，部署全部迁移并执行真实依赖集成，保留 schema 供审计；不会 drop 用户数据库。`--browser` 添加 Playwright fixture 测试。结果目录 `output/realtime-tryon/` 不提交。

真实 smoke 待授权后采用一次连接、最多20秒、两张有权使用的服装及同意出镜者。供应商 `maxSessionDuration`、应用单次时长与保守预算须同时调低；人工确认费率和凭证重用风险。测试连接、运动、换装、原生帧保存与停止；记录SDK/模型、浏览器、网络、输出分辨率、首帧和观察生成时长，并与供应商账单核对。单次 smoke 不足以声明 p95 延迟或效果达标。

关闭 `REALTIME_TRYON_ENABLED` 可拒绝新签发；已有媒体仍需客户端停止及供应商时限兜底，关闭开关不能撤销已发凭证。保留兼容表与用户截图，不通过删资产回滚。当前限制与执行结果见 [ACCEPTANCE](ACCEPTANCE.md)。
