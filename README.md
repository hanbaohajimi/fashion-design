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
