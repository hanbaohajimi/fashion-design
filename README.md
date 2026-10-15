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

- `anthropic/claude-sonnet-4-6`：图片角色识别、提示词增强、系列 DNA、生成结果内容审核及工作流 Agent。
- `openai/gpt-image-2.5-sunburst`：实际生成与编辑图片，可通过 `AMUX_IMAGE_MODEL` 覆盖。

首次配置只需要在 `.env` 中填写：

```env
AI_PRIMARY_PROVIDER=amux
AMUX_API_KEY=在这里填写你的令牌
AMUX_BASE_URL=https://gateway.amux.ai/v1
AMUX_CLAUDE_MODEL=anthropic/claude-sonnet-4-6
AMUX_CLAUDE_TIMEOUT_MS=600000
AMUX_IMAGE_MODEL=openai/gpt-image-2.5-sunburst
AI_PROVIDER_TIMEOUT_MS=600000
GENERATION_TIMEOUT_MS=720000
```

Amux 令牌需要有上述两个模型的调用权限。Claude 通过原生 Anthropic `/messages` 接口，并使用强制
`tool_choice` 与 `strict input_schema` 返回结构化结果；系统使用 `/images/generations` 生成图片，使用
`/images/edits` 处理参考图和透明蒙版。`openai/gpt-image-2.5-sunburst` 按原生格式返回
`b64_json`；Worker 只在内存中短暂接收并立即写入私有 MinIO，不会把 Base64 图片写入
任务数据库。送审时，系统会把该 Data URL 转换为 Anthropic 原生 `base64` 图片源，
避免 Amux 静默忽略图片并返回普通文字。

Amux 在平台侧按模型权限路由，请求体不额外发送渠道字段。Provider 最长等待 10 分钟，
Worker 总任务最长等待 12 分钟，额外两分钟用于内容审核、对象存储和缩略图处理。
带参考图的文生图、图片编辑与局部重绘使用 `/images/edits`，调用失败时保留错误，
不会改为无参考图的生成。Provider 内不再叠加重试，队列层仍会重试一次。

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

## 节点设计工作台

项目现在默认打开节点设计工作流：中央画布显示“素材 → 工具 → 结果”，底部提供
素材与工具菜单，右侧设计助手根据当前图和明确引用的节点提出下一步。
可以手动添加需求、参考文字、色卡、上传图片或绘制草图，也可以引用趋势和面料库。
每条输入连线有明确槽位；非法连接、循环、跨项目引用与过期保存会由 API 拒绝。
上传图与草图沿用视觉角色识别，设计师可手动指定角色；角色仅表示参考用途，不成为
硬性设计要求。独立趋势档案保留周报、主题、原文与摘要，可以直接加入当前工作流。

推荐体验路径：添加设计需求和参考 → 请求下一步建议 → 查看虚线节点及理由 → 确认加入
画布 → 主动执行需求分析 → 查看设计约束 → 生成候选 → 连接约束与候选进行评估 →
`@候选` 提出修改并确认新分支。建议本身不会调用图片生成。已执行输入与结果保持历史，
调整需要创建新节点或分支；拖动只更新布局，不使 Agent 建议失效。

候选详情保留大图、生成变体、蒙版局部重绘、版本恢复、单图导出和系列入口。变体、
局部重绘与恢复结果会回到工作流成为新分支；系列关联保存在候选节点中。普通聊天、
历史会话、旧 Agent 运行只读详情和原有系列工作台仍可使用。
“历史白板”是旧自由白板的只读视图，可以导出或把选中资料加入新工作流；新设计不再
写入旧白板快照。旧来源缺失时保持不完整标记。

图、提案和每次执行尝试保存在服务端，刷新可恢复。重复提交和结果回填按请求与资产 ID
去重；失败重试保留旧尝试。生成仍使用现有额度、队列、Worker 和私有图片存储。
需要执行 `pnpm db:deploy` 应用 `20261013000000_workflow_graph`，并重启 API、Web 和 Worker。
主要接口位于 `/projects/:projectId/workflow`：读取／图变更、`sync` 结果恢复、提案接受／拒绝、
节点执行、历史和决策。候选设计路径也优先读取此图的真实来源。

真实模型与队列验收脚本会创建独立临时项目，分析需求与参考、实际生成 A/B、逐候选评价、
确认修改建议并生成新分支，检查母图与重复执行，完成后清理测试记录：

```bash
pnpm --filter @fashion/worker exec tsx src/index.ts
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json scripts/verify-workflow-pipeline.ts
```

结果图片和脱敏图记录保存在 `output/workflow-verification`。该检查会消耗已配置模型的调用额度；
模型不可用、基础设施中断或内容审核失败都会明确报错并以失败状态退出。

## 设计路径与选择记录

在候选详情中点击“设计路径”，可查看“输入来源 → 设计操作 → 输出结果”。
新建的项目生成任务会保存便签、色卡、素材角色、面料描述和执行提示词的副本，
后续修改白板不会覆盖这些记录。导入素材与版本恢复也会记录独立步骤。
已有资产按原有血缘展示，并标注缺失的历史快照。

Agent 修改选中的设计时会绑定来源资产，创建图片编辑任务；生成新方案时仍使用文生图。
“选定此方案”“否决此方案”“保留比较”会追加选择与理由记录；结果在工作流中投影一次，
候选中的设计路径用于回溯输入、操作和选择。

新增接口：`GET /design-assets/:id/path`、`POST /design-assets/:id/decisions`。
升级后需执行 `pnpm db:deploy` 应用 `20261010000000_design_process` 迁移。

## 历史 Agent 设计工作流

以下描述保留旧版运行的机制与接口。新版项目通过上述节点设计工作台执行，旧运行记录
继续可查，不与主画布形成第二套可编辑图。

旧串行 `AgentRun` 把目标规划成最多六个生成或编辑步骤，要求前序候选经人工采用后
进入下一步。它的简报、步骤提示词、尝试、领域报告、采用与否决记录继续保留。
主工作流不再用旧编辑弹窗建立新计划，也不会把旧绘图箭头解释成执行依赖。

计划、执行状态和采用记录保存在服务端，刷新后可恢复。运行时保存每次执行的请求
与编译快照；入队失败可用原执行编号恢复，生成失败后重试则保留旧尝试并创建新尝试。
计划支持暂停与取消，并通过版本号拒绝过期修改。暂停不会中断已经提交的图片生成；
取消会请求停止当前任务。当前依赖可以形成多个分支，但仍按节点顺序逐步执行；
尚不支持并行执行或自动运行整个计划。

规划接口为 `POST/GET /agent-conversations/:id/plans`；读取、修改、执行和确认接口
位于 `/agent-runs/:id` 下。升级需执行 `pnpm db:deploy`，应用
`20261010010000_agent_runs` 迁移，然后重启 API、Web 与 Worker。
节点图保存使用 `PATCH /agent-runs/:id/plan`，结果否决使用
`POST /agent-runs/:id/reject`；本次节点编辑与执行历史更新无需额外数据库迁移。

新计划先由上下文整理 Agent 提取带来源的服装设计简报，再由规划 Agent 生成节点
及验收项。简报区分明确要求、解释性偏好和未知项；节点显示处理哪些约束，未绑定项
会提示。历史决策只读取本次选中设计的记录，不能自动变成跨项目偏好。

候选等待审核时可主动发起领域 Agent 检查，对实际图片逐条件给出“符合、存在问题、
无法判断”。尺寸、真实面料成分等需要测量或规格资料的条件不能仅凭图片判定。
否决或失败后可请求修订建议，先查看修改与保留项，再应用到已保存的节点提示词，
最后主动执行新尝试；建议不会自动生成或替用户采用结果。

领域动作使用 `POST /agent-runs/:id/agent-actions`，应用修订使用
`POST /agent-runs/:id/agent-actions/:actionId/apply`。动作与报告持久化并校验版本，
人工操作会使正在分析的动作失效，旧报告不能覆盖新输入。本轮无需额外数据库迁移。
具体职责、论文依据、权限边界和技术壁垒的验证方案见 [Agent 架构设计](./AGENT_ARCHITECTURE.md)。

新项目请使用上方“节点设计工作台”的体验路径。升级前的运行可能没有领域简报，
历史记录按实际保存的信息展示；不能补造旧执行来源或评价。浏览器加载新版代码需要
重新启动 API 与 Web。

## 质量检查

```bash
pnpm audit:all
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

本地 `pnpm check` 与 CI 都会审计生产和开发依赖，发现低危及以上漏洞即失败。
仅检查生产依赖可运行 `pnpm audit:prod`。CI 还会执行私有文件流水线验证。

Braces 的 `GHSA-vfj7-8cjw-p6xm` 尚无官方修复发布，本仓库通过
`patches/braces@3.0.3.patch` 限制解析与 AST 遍历深度，并拒绝循环 AST。
`pnpm audit:all` 必须先通过实际安装包的补丁校验和恶意输入回归测试，再审核
审计 JSON，接受这一项已修补的包；报告异常、其他漏洞或未修补副本均失败。
直接 `pnpm audit` 仍会按原版本报告它，不能仅凭版本扫描判断补丁效果。
`sprintf-js` 的 `CVE-2026-97058` 已被 CNA 正式撤销，对应公告的例外依据为
[CVE 官方记录](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/97xxx/CVE-2026-97058.json)。

对象存储需预置 `S3_HEALTHCHECK_OBJECT_KEY` 指向的私有哨兵对象；本地
`minio-init` 会自动创建它，readiness 只需对象级读取权限，无需
`ListBucket`。
