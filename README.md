# AI 服装设计平台

基于 pnpm 与 Turborepo 的 Monorepo 工程骨架。

## 工程结构

```text
apps/
  web/       Next.js 前端
  api/       NestJS API
  worker/    BullMQ Worker
packages/
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
pnpm db:migrate
pnpm dev
```

启动完成后：

- Web：http://localhost:3000
- API Health：http://localhost:3001/health
- PostgreSQL：localhost:5432
- Redis：localhost:6379

`pnpm dev` 会同时启动 Web、API、Worker 和 shared watch。修改
`packages/shared/src` 后，依赖该包的应用会自动重新编译或重启。

## 端口冲突

`pnpm infra:up` 会在启动容器前检查 PostgreSQL 和 Redis 端口。如果端口已
被占用，命令会指出需要修改的环境变量。修改 `.env` 中的
`POSTGRES_PORT` 或 `REDIS_PORT` 后，同时更新 `DATABASE_URL` 或
`REDIS_URL`。

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

一次执行全部检查：

```bash
pnpm check
```
