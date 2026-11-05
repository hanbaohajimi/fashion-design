# 变更索引

此清单描述衣架功能的改动边界；工作区中已有摄像头任务的文件仍属于此前交付，不把它们重新计作本次新增。

| 位置 | 本次职责 |
| --- | --- |
| `packages/shared/src/wardrobe.ts` | 单品、准备、正式搭配、临时快照、结果及能力契约 |
| `packages/shared/src/realtime-tryon.ts` | 兼容 `outfitSnapshotId` 和完整搭配观察／截图来源 |
| `packages/db/prisma/schema.prisma`、`src/client.ts` | 新模型与导出，摄像头会话快照关联 |
| `packages/db/prisma/migrations/20261030010000_wardrobe/` | 单品、版本、准备、搭配、快照、试穿和幂等记录 |
| `packages/db/prisma/migrations/20261030011000_wardrobe_trial_snapshots/` | 临时试穿与正式保存的区分 |
| `apps/api/src/modules/wardrobe/` | Controller、Service、素材合成、规则、单元与真实管线测试 |
| `apps/api/src/modules/generation/generation.service.ts` 及测试 | 衣架显式业务入口、冻结完整引用、明确展示策略、现有任务链路 |
| `apps/api/src/modules/realtime-tryon/` | 原会话框架上增加快照校验、应用绑定历史及全部来源 |
| `apps/api/src/app.module.ts`、`apps/api/package.json` | 注册模块、将实际运行使用的 sharp 放入运行依赖 |
| `apps/web/src/modules/studio/wardrobe/` | 衣架浏览、素材确认、搭配、双模式输入和相关测试 |
| `packages/ai/src/material-alpha.ts` 及 API 像素测试 | 透明材质派生、局部 RGB 修正与版本化边缘保护；真实原始模型结果和来源不改写 |
| `apps/web/src/modules/studio/wardrobe/RepairTransparentMaterial.tsx`、`use-material-repair.ts`、`MaterialProcessingDetails.tsx` | 正面／侧挂两种局部处理、显式收费与无收费派生、来源及版本隔离、候选核对 |
| `apps/web/src/modules/board/generation/MaskCanvas.tsx` 及测试 | 每笔独立宽度与柔和程度，预览／导出一致的选区软边，原工作台默认行为兼容 |
| `apps/api/src/modules/studio/studio.service.ts` | 私有内部蒙版、裁片和模型处理中间图从普通素材列表排除，旧空值记录保持可见 |
| `apps/web/src/modules/studio/StudioWorkspace.tsx`、`StyleLibrary.tsx` | 商品展示内部模式、资产及款式快捷入口 |
| `apps/web/src/modules/board/workflow/WardrobeReferenceEntry.tsx` 及测试 | 上传引用登记后进入素材准备，沿用离开保存保护 |
| `apps/web/src/modules/board/workflow/WorkflowAssetWorkspace.tsx`、`WorkflowNodeDetails.tsx` | 工作台图片入口 |
| `apps/web/src/components/WorkspaceSplit.tsx` | 可选侧栏可访问名称，原默认值保留 |
| `apps/web/src/modules/studio/realtime-tryon/` | 完整搭配加载、描述编译、串行更新、准备期间截图保护 |
| `tests/e2e/wardrobe-fixture.ts`、`wardrobe-tryon.spec.ts` | 明确标注的模拟素材与浏览器行为验证 |
| `.env.example`、`package.json`、`pnpm-lock.yaml` | 分层启用、独立验证入口与依赖锁定 |
| `scripts/manual/verify-wardrobe.mjs` | 隔离 PostgreSQL/search_path、私有存储和 Redis 队列验证，无收费请求 |
| `scripts/manual/compare-wardrobe-video.mjs` | 保持原速的双视频对照输出 |
| `scripts/manual/verify-wardrobe-provider.mjs`、`wardrobe-provider-runner.ts`、`wardrobe-provider-journal.mjs` 及测试 | 真实供应商调用、单次意图锁定、独立重试、来源和审核门禁、处理中间态及生产派生留证 |
| `scripts/manual/audit-wardrobe-provider-state.mjs` | 只读核对29个当前修订、58张正侧图片的本地/canonical/私有SHA、保存元数据、真实成功祖先任务和队列；输出累计请求及失败，不打印环境密钥，不写数据库/存储或调用供应商，显式待确认状态不能标为最终通过 |
| `scripts/manual/wardrobe-provider-cases.json`、`wardrobe-provider.md` | 29 款代表性设计输入与真实验证工具说明，有限矩阵不等于所有自由设计均可靠 |
| `scripts/manual/wardrobe-correction-guide-preview.ts` | 用生产同一函数预览选区位置参考，输出尚未登记资产的明确标记及来源摘要，不调用供应商 |
| `tests/e2e/wardrobe-provider-realism.spec.ts`、`wardrobe-preview-background.spec.ts` | 真实 PNG 在生产组件内的桌面／手机、挂点、三底与透明修复流程验证；界面 fixture 不替代真实任务和保存证据 |
| `tests/e2e/wardrobe-provider-groups.spec.ts` | 三组全部 29 款真实保存版本的混排，逐页逐件邻接／边缘、反向、聚焦导航与返回，以及正常动效录屏；显式开关启用，视觉结论另行审核 |
| `tests/e2e/wardrobe-touch.spec.ts` | 独立触屏模拟，使用 tap 验证明确查看／加入、前后导航和返回；持续检查触摸环境与零隐性生成，不替代物理设备或素材效果验收 |
| `apps/web/.impeccable/surfaces/wardrobe-workspace.md` | 继承现行设计系统的局部方向与素材来源 |

文档入口为 `doc/README.md`；测试、截图、录屏、审查与基线输出均在忽略的 `output/`。本次没有 Git 提交、推送或部署。
