# 本轮修改文件

起始工作区干净。本清单覆盖本次源码、配置、锁文件、测试和交接文档；生成物均在忽略的output/或现有构建目录。没有Git提交。

## 现有文件

- `.env.example`：默认关闭、内部名单、服务端密钥、模型确认、费率/预算与限制配置。
- `package.json`：tryon:doctor / tryon:verify。
- `pnpm-lock.yaml`：精确SDK及其依赖。
- `apps/web/package.json`：@decartai/sdk 0.2.14。
- `apps/api/src/app.module.ts`：注册试穿模块。
- `packages/shared/src/index.ts`：导出纯共享契约。
- `packages/db/prisma/schema.prisma`：会话/截图持久结构。
- `packages/db/src/client.ts`：PrismaPg显式采用连接URL的schema。
- `apps/web/src/app/[projectId]/studio/page.tsx`：读取实时展示模式。
- `apps/web/src/modules/studio/StudioWorkspace.tsx`：现有商品展示模式切换与深链。
- `apps/web/src/modules/board/workflow/WorkflowAssetWorkspace.tsx`：候选作品试穿入口。
- `apps/web/src/modules/board/workflow/WorkflowNodeDetails.tsx`：原始上传参考图入口。
- `doc/README.md`、`scripts/README.md`：文档与工具索引。

## 新增后端与数据库

- `packages/shared/src/realtime-tryon.ts`
- `packages/db/prisma/migrations/20261029090000_realtime_tryon/migration.sql`
- `apps/api/src/modules/realtime-tryon/realtime-tryon.module.ts`
- `apps/api/src/modules/realtime-tryon/realtime-tryon.controller.ts`
- `apps/api/src/modules/realtime-tryon/realtime-tryon.service.ts`
- `apps/api/src/modules/realtime-tryon/realtime-tryon.service.spec.ts`
- `apps/api/src/modules/realtime-tryon/realtime-tryon-session.repository.ts`
- `apps/api/src/modules/realtime-tryon/realtime-tryon.config.ts`
- `apps/api/src/modules/realtime-tryon/realtime-tryon.config.spec.ts`
- `apps/api/src/modules/realtime-tryon/decart-token-provider.ts`
- `apps/api/src/modules/realtime-tryon/decart-token-provider.spec.ts`
- `apps/api/src/modules/realtime-tryon/realtime-tryon.integration.spec.ts`

## 新增浏览器与资产接入

- `apps/web/src/modules/studio/realtime-tryon/RealtimeTryOnPanel.tsx`
- `apps/web/src/modules/studio/realtime-tryon/RealtimeTryOnPanel.module.css`
- `apps/web/src/modules/studio/realtime-tryon/RealtimeTryOnPanel.spec.tsx`
- `apps/web/src/modules/studio/realtime-tryon/realtime-tryon-types.ts`
- `apps/web/src/modules/studio/realtime-tryon/realtime-tryon-machine.ts`
- `apps/web/src/modules/studio/realtime-tryon/realtime-tryon-machine.spec.ts`
- `apps/web/src/modules/studio/realtime-tryon/realtime-tryon-api.ts`
- `apps/web/src/modules/studio/realtime-tryon/decart-realtime-adapter.ts`
- `apps/web/src/modules/studio/realtime-tryon/decart-realtime-adapter.spec.ts`
- `apps/web/src/modules/studio/realtime-tryon/camera-controller.ts`
- `apps/web/src/modules/studio/realtime-tryon/camera-controller.spec.ts`
- `apps/web/src/modules/studio/realtime-tryon/capture-output-frame.ts`
- `apps/web/src/modules/studio/realtime-tryon/tryon-asset-flow.ts`
- `apps/web/src/modules/studio/realtime-tryon/tryon-asset-flow.spec.ts`
- `apps/web/src/modules/board/workflow/TryOnReferenceEntry.tsx`
- `apps/web/src/modules/board/workflow/TryOnReferenceEntry.spec.tsx`

## 新增验证工具与文档

- `scripts/manual/verify-realtime-tryon.mjs`
- `tests/e2e/realtime-tryon.spec.ts`
- `tests/e2e/realtime-tryon-live-fixture.spec.ts`
- `tests/e2e/fixtures/realtime-tryon-harness.ts`
- `tests/e2e/fixtures/realtime-tryon-harness.tsx`
- `doc/plans/realtime-tryon-api/PLAN.md`
- `doc/plans/realtime-tryon-api/IMPLEMENTATION.md`
- `doc/plans/realtime-tryon-api/ACCEPTANCE.md`
- `doc/plans/realtime-tryon-api/FILES.md`
