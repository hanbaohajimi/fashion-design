# AI 服装设计平台

基于 pnpm 与 Turborepo 的 Monorepo 工程骨架。

## 工程结构

```text
apps/
  web/       Next.js 前端
  api/       NestJS API
  worker/    BullMQ Worker
packages/
  ai/        AI Provider 抽象、重试与成本估算
  billing/   生成额度与计费原子操作
  shared/    跨应用共享类型与常量
  db/        Prisma schema 与迁移
```

## 环境要求

- Node.js 22.12 或更高版本
- pnpm 11.9
- Docker Desktop

## 本地启动

Windows 可直接双击仓库根目录的 `start-platform.cmd`。脚本会检查 Node.js、pnpm 与
Docker，必要时启动 Docker Desktop、创建 `.env`、安装依赖，并依次启动基础设施、
Supabase、数据库迁移、Web、API 与 Worker；页面就绪后会自动打开浏览器。

也可以在终端中使用可选参数启动：

```powershell
.\start-platform.cmd -NoBrowser
.\start-platform.cmd -SkipInstall
```

手动启动流程如下：

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm auth:start
pnpm db:migrate
pnpm dev
```

启动完成后：

- Web：http://localhost:3000
- API Liveness：http://localhost:3001/health/live
- API Readiness：http://localhost:3001/health/ready
- PostgreSQL：localhost:5432
- Redis：localhost:6379
- Supabase API：http://127.0.0.1:54321
- 本地邮件箱：http://127.0.0.1:54324

`pnpm dev` 会构建内部包并同时启动 Web、API、Worker 与包级 watch。修改
`packages/shared`、`packages/ai` 或 `packages/billing` 后，依赖应用会自动
重新编译或重启。仓库根 `.env` 会由 API、Worker、Prisma 与 Web 配置统一加载。

## Amux 模型渠道配置

系统不再依赖 fal.ai，也不再需要单独的 OpenAI Key。图片理解与生图使用同一个
Amux 令牌，但按模型明确分工：

- `special/anthropic` 下的 `claude-opus-5`：图片角色识别、提示词增强、系列 DNA、生成结果内容审核。
- `premium/openai` 下的 `gpt-image-2-official`：只负责实际生成与编辑图片。

首次配置只需要在 `.env` 中填写：

```env
AI_PRIMARY_PROVIDER=amux
AMUX_API_KEY=在这里填写你的令牌
AMUX_BASE_URL=https://api.amux.ai/v1
AMUX_CLAUDE_MODEL=claude-opus-5
AMUX_CLAUDE_TIMEOUT_MS=20000
AMUX_IMAGE_MODEL=gpt-image-2-official
AI_PROVIDER_TIMEOUT_MS=600000
GENERATION_TIMEOUT_MS=720000
```

Amux 令牌需要同时包含 `special/anthropic` 和 `premium/openai` 分组，并且模型列表中
确实存在上述两个模型。Claude 通过原生 Anthropic `/messages` 接口，并使用强制
`tool_choice` 与 `strict input_schema` 返回结构化结果；系统使用 `/images/generations` 生成图片，使用
`/images/edits` 处理参考图和透明蒙版。`gpt-image-2-official` 按原生格式返回
`b64_json`；Worker 只在内存中短暂接收并立即写入私有 MinIO，不会把 Base64 图片写入
任务数据库。送审时，系统会把该 Data URL 转换为 Anthropic 原生 `base64` 图片源，
避免 Amux 静默忽略图片并返回普通文字。

Amux 分组由令牌在平台侧路由，请求体不额外发送渠道字段。Provider 最长等待 10 分钟，
Worker 总任务最长等待 12 分钟，额外两分钟用于内容审核、对象存储和缩略图处理。
带参考图的文生图会优先使用 `/images/edits`；若 `premium/openai` 对该请求返回 5xx，
系统会保留已编译的文字设计要求并降级到 `/images/generations`。真正的图片编辑与局部重绘
不会降级，以免错误修改整张图片。Provider 内不再叠加重试，队列层仍会重试一次。

当前画布只向用户展示 GPT Image 2 支持的尺寸、质量和输出格式。`CFG`、采样步数与
原生 `strength` 不会作为 Amux 参数发送；它们继续保留在通用生成契约中，供后续接入
Stable Diffusion Provider。参考图“变化程度”会转换成文字约束并写入编辑提示词。

参考图片只允许从受信任的对象存储来源下载。系统会自动允许 `S3_ENDPOINT` 和
`ASSET_CDN_ORIGIN`；生产环境如使用其他签名图片域名，可追加：

```env
AI_REFERENCE_IMAGE_ALLOWED_ORIGINS=https://assets.example.com
```

百炼 Provider 已注册但默认不启用。取得北京地域 API Key 和业务空间 ID 后，可填写：

```env
AI_FALLBACK_PROVIDER=dashscope
DASHSCOPE_API_KEY=在这里填写百炼密钥
DASHSCOPE_BASE_URL=https://你的WorkspaceId.cn-beijing.maas.aliyuncs.com
DASHSCOPE_IMAGE_MODEL=wan2.7-image-pro
```

备用渠道只在主渠道限流、超时或持续不可用时触发，不会绕过内容审核。当前百炼适配器
支持文生图和参考图编辑；精确蒙版重绘仍固定由 Amux 处理。

## 本地邮箱登录

首次启动 Supabase 后，运行 `pnpm auth:status`，把输出中的 API URL 与
publishable/anon key 写入 `.env` 的 `SUPABASE_URL` 和
`SUPABASE_PUBLISHABLE_KEY`。认证接口只把访问令牌和刷新令牌写入
HttpOnly Cookie，浏览器脚本不会读取或持久化 JWT。
登录、会话与退出响应均使用 `Cache-Control: private, no-store`；项目库的
“退出登录”会调用 `POST /auth/logout` 并同时清除两枚会话 Cookie。

魔法链接邮件模板需要把一次性 TokenHash 发回平台确认页。在 Supabase
Dashboard 的 Authentication → Email Templates → Magic Link 中使用：

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">
  登录 AI 服装设计平台
</a>
```

本地邮件不会真实发送，可在 `http://127.0.0.1:54324` 查看并打开链接。
线上环境必须把 `APP_ORIGIN` 设置为固定 HTTPS 域名，并设置
`SESSION_COOKIE_SECURE=true`。

## 端口冲突

`pnpm infra:up` 会在启动容器前检查 PostgreSQL、Redis 和 MinIO 端口。如果端口已
被占用，命令会指出需要修改的环境变量。修改 `.env` 中的
`POSTGRES_PORT` 或 `REDIS_PORT` 后，同时更新 `DATABASE_URL` 或
`REDIS_URL`。开发容器默认只绑定 `127.0.0.1`，数据库、Redis、原图和
缩略图不会匿名暴露到局域网。

## 设计路径与选择记录

在候选详情中点击“设计路径”，可查看“输入来源 → 设计操作 → 输出结果”。
新建的项目生成任务会保存便签、色卡、素材角色、面料描述和执行提示词的副本，
后续修改白板不会覆盖这些记录。导入素材与版本恢复也会记录独立步骤。
已有资产按原有血缘展示，并标注缺失的历史快照。

Agent 修改选中的设计时会绑定来源资产，创建图片编辑任务；生成新方案时仍使用文生图。
“选定此方案”“否决此方案”“保留比较”会追加选择与理由记录；把候选放上白板
仍按原有方式保存放置状态。候选中的节点视图用于回溯输入、操作和选择。

新增接口：`GET /design-assets/:id/path`、`POST /design-assets/:id/decisions`。
升级后需执行 `pnpm db:deploy` 应用 `20261010000000_design_process` 迁移。

## Agent 设计工作流

白板设计助手中的“设计工作流”支持把目标规划成最多六个节点。当前接入新建设计
与图片编辑两种工具；编辑节点可以引用本次选中的设计，或前序节点实际采用的结果。
先查看并修改尚未执行节点的提示词，再点击执行；每次只运行一个节点，生成完成后
选择候选并填写采用理由，才会开放下一步。结果继续使用现有生成队列与白板落图流程。

计划、执行状态和采用记录保存在服务端，刷新后可恢复。运行时保存每次执行的请求
与编译快照；入队失败可用原执行编号恢复，生成失败后重试则保留旧尝试并创建新尝试。
计划支持暂停与取消，并通过版本号拒绝过期修改。暂停不会中断已经提交的图片生成；
取消会请求停止当前任务。尚不支持自由拖动连线、并行节点或自动执行整个计划。

规划接口为 `POST/GET /agent-conversations/:id/plans`；读取、修改、执行和确认接口
位于 `/agent-runs/:id` 下。升级需执行 `pnpm db:deploy`，应用
`20261010010000_agent_runs` 迁移，然后重启 API、Web 与 Worker。

## 质量检查

```bash
pnpm audit:prod
pnpm lint
pnpm typecheck
pnpm db:validate
pnpm test
pnpm db:test
pnpm build
```

一次执行上述代码、数据库和生产构建门禁（先运行 `pnpm infra:up`）：

```bash
pnpm check
```

浏览器契约测试使用 Playwright 验证真实页面交互，但会 mock 平台 API；它不能替代
API → Redis → Worker → PostgreSQL/MinIO 的真实链路验证：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

CI 还会执行生产依赖审计和私有文件流水线验证。

对象存储需预置 `S3_HEALTHCHECK_OBJECT_KEY` 指向的私有哨兵对象；本地
`minio-init` 会自动创建它，readiness 只需对象级读取权限，无需
`ListBucket`。
