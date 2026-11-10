# 局部编辑保护、稳定输入与临时文件回收

日期：2026-11-09，北京时间。接续[图片输出保护](image-output-integrity-validation.md)，本阶段补齐局部重绘的服务端保护、任务输入恢复和临时文件回收。没有改动页面布局、模型选择或供应商参数定价。

## 本阶段实现

### 未选区域由平台保护

原先普通局部重绘直接保存供应商返回图，未选区域是否保持原样取决于供应商。本轮在保存前读取任务冻结的原图和蒙版，按原图正向化后的坐标处理结果：

- 蒙版 alpha=255：原图完整 RGBA 覆盖结果，包含半透明和全透明像素。
- 蒙版 alpha=0：使用生成结果。
- 中间 alpha：按预乘 alpha 混合，保留柔边，避免透明边缘混入不应出现的暗色。
- 原图、蒙版分别按 EXIF 正向化，正向化尺寸必须一致；结果统一到原图尺寸，以 PNG 保存。生成宽高仍受现有模型请求约束，不将模型输出分辨率当作作品坐标系。

保护精度为**正向化的 8 位 sRGB RGBA**；不承诺保留源文件编码、元数据、16 位精度或原色彩配置。原始文件继续保留。

缺少 alpha、未选择修改区域、尺寸不一致、损坏图片、超过限制的蒙版在调用模型前明确失败。图片解码限制为 4000 万像素，标准化蒙版须小于 4 MiB。源图或蒙版错误标为 `IMAGE_EDIT_INVALID_INPUT`；不可解码的生成结果标为 `IMAGE_EDIT_INVALID_RESULT`，不通过自动重试再次提交生成。

### 输入使用稳定的私有标识

生成接纳时记录 `compiledPrompt.inpaintSource`，包含版本及可确认的原图/蒙版对象键；工作流上传蒙版使用 `s3://` 标识冻结请求，派发时才签发下载链接。

私有链接识别支持已配置存储源的路径式、虚拟主机式和 CDN 前缀，并正确解码中文对象键。识别对象键本身不授予权限：接纳仍核对项目内资产、READY 图片文件及项目访问权限；临时蒙版仅接受执行者自己的随机命名空间。多参考图继续沿用已有项目资产核对。

Worker 在首次调用模型前保存任务专属的原图和蒙版 PNG，之后重试复用这些输入。原接纳链接过期，或者重试时原始素材暂不可读，不会导致同一任务改用另一份输入。有远端任务记录却缺失输入副本时明确失败，避免重复提交或保存未保护结果。

兼容的外部旧链接仍经过既有公网地址、重定向和大小检查，再冻结到任务副本。此次稳定标识改善针对原图和蒙版；额外细节参考图的长队列链接续签没有在本阶段扩展。使用原生 AWS 域名且未配置存储 endpoint 的旧签名 URL 仍走兼容下载路径，不宣称所有历史链接都可恢复。

### 回收独立于生成结果

生产 Worker 增加 `image-edit-cleanup` 队列，并在写入任何临时输入之前先持久登记清理任务。登记失败时遵循原生成任务的重试规则，不先调用模型或写入临时图片。

- 正常结束仍尝试立即回收；清理异常不会把已提交的成功结果改为失败。
- 独立清理检查数据库真实状态。排队、执行中的输入保留；成功、失败、取消、审核失败进入回收。
- 延后清理在终态及登记时间后至少等待 60 秒，让在途文件操作结束；写入每一份输入前重新检查取消和执行权。
- 数据库、对象存储暂时不可用时，清理任务在 Redis 中延后重试，间隔从 1 分钟递增、最多 1 小时；日志最多保留 5 条。生成进程重启不丢失已经登记的清理。
- 只删除任务前缀下的 5 个明确文件名，不接受任意文件路径，也不删除用户原图、上传蒙版或成功产物。业务任务已删除时仍可按独立登记回收其临时输入。
- 生成重试期间不清理；用户重新发起生成会创建新任务标识。任务终态不可逆，独立清理不会复用旧标识作为新生成。

持久性依赖现有 Redis 的正常持久化与保留策略。队列转换故障或 Worker 崩溃使用额外重试并保留最终失败记录；普通存储/数据库故障会持续延后。此改动不追溯扫描升级前没有登记的历史临时文件，也不承担用户上传文件和未提交结果文件的全局回收。

## 定向验证

本阶段最终共 **239 个不同用例通过**，重复运行不累加。Web 没有修改，本轮没有重新宣称新的浏览器或帧率结果。

| 检查 | 结果 | 验证范围 |
| --- | --- | --- |
| `image-edit.spec.ts` | 11 通过 | 真实 Sharp，完全保护/透明/柔边像素、EXIF、尺寸、损坏输入和去背景/扩图回归 |
| `image-edit-cleanup.processor.spec.ts` | 10 通过 | 终态、排队/执行、取消宽限、已删除任务、数据库/存储故障和清理路径限制 |
| `image-edit.integration.spec.ts` | 24 通过 | 实际 PostgreSQL、Redis、MinIO、签名 HTTP；输入复用、远端恢复、失败/取消、部分写入及独立清理重启 |
| `generation.processor.spec.ts` | 44 通过 | 原生成、计次、终态回执、执行权、下载及失败处理回归 |
| `generation.service.spec.ts` | 58 通过 | 生成接纳、多参考图、稳定私有标识、越权/未就绪蒙版拒绝及旧行为 |
| 工作流运行与动作接口集成 | 19 通过 | `workflow-runtime.service.integration.spec.ts`、`workflow-action.integration.spec.ts`；冻结蒙版标识与执行回写 |
| `inpaint-pipeline.integration.spec.ts` | 2 通过 | 服务到队列到实际私有保存再到结果同步；存储源识别边界 |
| 衣架相关 4 个文件 | 71 通过 | 独立本机 schema、已有接纳/队列/Worker/私有图片流程及来源规则回归 |
| API、Worker 类型检查 | 通过 | 两个工作区的 `tsc --noEmit` |
| 改动目标文件 ESLint | 通过 | 未运行全仓 lint |

新贯通测试实际经过 `WorkflowRuntimeService → GenerationService → PostgreSQL → BullMQ → Worker → MinIO → WorkflowRuntimeService.sync`。测试把任务中的原图和蒙版 URL 换成失效链接，依靠已记录的私有键完成处理；保护区与原图逐字节一致，编辑区使用测试生成像素，结果成为同一作品来源链的候选。相同工作流请求再次执行不增加资产或计次。

独立清理测试暂停生成 Worker 后启动清理 Worker，模拟删除失败、清理重启，再恢复文件存储；任务结果保持成功，文件最终回收，模型提交和计次保持一次。另一用例在生成自动重试等待期间取消并移除队列作业，独立清理仍能回收输入。取消发生在第一份输入写入之后的用例确认第二份文件不再写入，也不提交模型。

测试模型和审核返回本地确定数据；衣架图片 HTTP 服务是本机替身。没有调用真实或付费供应商。这些证据证明输入、像素处理、事务、队列和文件流转，不能证明服装结构、面料纹理、文字或扩展内容的生成质量。贯通服务测试没有经过完整 HTTP 登录及页面操作。

## 环境与复现

现有本机 PostgreSQL、Redis、MinIO 正常，保留原数据。本轮没有新增 schema 迁移。衣架验证脚本把已有 43 项迁移应用到新建的隔离 schema `wardrobe_verify_1794214956973`，没有修改原业务 schema；隔离 schema 和忽略目录 `output/wardrobe/` 的验证信息按原脚本保留审计。

```powershell
# apps/worker：本次 45 项图片/清理用例
node --env-file=../../.env.example --env-file-if-exists=../../.env node_modules/vitest/vitest.mjs run src/processors/image-edit.spec.ts src/processors/image-edit-cleanup.processor.spec.ts src/processors/image-edit.integration.spec.ts --no-file-parallelism --testTimeout=15000 --hookTimeout=15000

# apps/worker：既有生成处理器 44 项
node --env-file=../../.env.example --env-file-if-exists=../../.env node_modules/vitest/vitest.mjs run src/processors/generation.processor.spec.ts --no-file-parallelism --testTimeout=15000 --hookTimeout=15000

# apps/api：79 项服务及贯通验证
node --env-file=../../.env.example --env-file-if-exists=../../.env node_modules/vitest/vitest.mjs run src/modules/generation/generation.service.spec.ts src/modules/generation/inpaint-pipeline.integration.spec.ts src/modules/workflow-runtime/workflow-runtime.service.integration.spec.ts src/modules/workflow-runtime/workflow-action.integration.spec.ts --no-file-parallelism --testTimeout=15000 --hookTimeout=15000

# 仓库根目录：衣架定向回归与两端类型
node scripts/manual/verify-wardrobe.mjs
pnpm --filter @fashion/worker typecheck
pnpm --filter @fashion/api typecheck
```

正式启用依赖更新并重启 API 和 Worker，使稳定输入接纳与独立清理同时生效；本阶段没有启动收费生成 Worker、部署、提交、推送、运行全仓检查或 CI。整体优化目标继续推进，下一批功能缺口以[Lovart 能力对照](lovart-capability-review.md)为准。
