# Repository Guidelines

## 项目结构与模块组织

本项目是基于 pnpm workspace 与 Turborepo 的 AI 服装设计平台。

- `apps/web/src/app/`：Next.js 路由；`src/modules/`：业务组件；`src/styles/`：共享样式。
- `apps/api/src/modules/`：NestJS 业务模块；`apps/worker/src/processors/`：BullMQ 异步任务。
- `packages/ai/`、`billing/`、`shared/`：模型适配、计费、共享类型；`packages/db/prisma/`：数据库 schema 与迁移。
- 测试通常与源码同目录；浏览器测试在 `tests/e2e/`，辅助脚本在 `scripts/`，设计资料在 `doc/`。上传图片存储于私有 MinIO。

## 构建、测试与本地开发

使用 Node.js ≥22.12、pnpm 11.9 和 Docker Desktop，在仓库根目录运行：

- `pnpm install --frozen-lockfile`：按锁文件安装依赖。
- `pnpm local:start`：Windows 一键安装、启动基础设施与认证、应用迁移并启动开发服务。
- `pnpm dev`：构建内部包并启动开发服务；Web 默认端口 3000，API 为 3001。
- `pnpm build`：构建全部工作区。
- `pnpm lint`、`pnpm typecheck`：执行 ESLint 与 TypeScript 检查。
- `pnpm test`、`pnpm db:test`：运行应用测试与数据库集成测试。
- `pnpm test:e2e`：运行 Playwright；首次先执行 `pnpm exec playwright install chromium`。
- `pnpm check`：执行依赖审计、静态检查、数据库校验、测试与构建；不包含浏览器测试。

## 代码风格与命名

沿用 TypeScript 严格模式、两空格缩进、双引号和分号。React 组件使用 PascalCase，如 `TrendCard.tsx`；工具文件使用 kebab-case，NestJS 文件采用 `*.service.ts`、`*.controller.ts`。样式使用 `*.module.css`，共享契约放入 `packages/shared`。遵守根目录 ESLint 配置；仓库已安装 Prettier，但未定义统一格式化脚本。导入路径大小写必须与文件一致。

## 测试规范

使用 Vitest；组件测试结合 Testing Library 与 jsdom。单元测试命名为 `*.spec.ts` 或 `*.spec.tsx`，集成测试为 `*.integration.spec.ts`。例如，运行 `pnpm --filter @fashion/web test` 可检查前端。

集成测试前配置根目录 `.env`，执行 `pnpm infra:up`、`pnpm db:deploy`。为行为变更补充正常、失败与边界场景；当前配置未设置覆盖率百分比门槛。Playwright 会模拟平台 API，不能替代真实队列、数据库及存储链路验证。

## 提交与 Pull Request

每次 Git 保存的提交主题和正文必须使用中文，可保留 feat、fix 等类型、scope 和必要的代码标识符。详见 CONTRIBUTING.md。

沿用 Git 历史中的 `feat(scope): ...`、`fix(scope): ...`、`test(scope): ...` 或 `chore: ...`，例如 `fix(canvas): correct node positioning`。保持提交聚焦。

PR 应说明问题、变更行为、验证命令与结果，关联相关 issue；界面修改附截图或录屏，迁移和配置变更说明升级步骤。提交前运行相关检查，并确保 CI 通过。

## 配置与 Agent 注意事项

以 `.env.example` 为配置模板，不提交密钥或 `.env`。数据库改动同时维护 schema 与迁移，不改写已应用的迁移。修改前端前先阅读 `apps/web/AGENTS.md` 及其中指定的本地 Next.js 文档。保留工作区已有的无关改动。
