# 图片输出保护与真实保存链路验证

日期：2026-11-09，北京时间。接续[局部编辑与选区恢复](image-editing-recovery-validation.md)，本阶段验证实际数据库、任务队列和文件存储，并修复扩图像素保护、输出类型与失败说明。

## 实际发现与修复

### 扩图保留原图的透明度

原实现把原图叠加在生成图上，普通不透明图片可以保留；半透明像素会与底层生成图混色，全透明区域会显露生成图并变为不透明。新增像素用例在修复前稳定失败：半透明原像素 `[10,140,210,128]` 变成 `[5,70,232,255]`。

现在先按EXIF方向读取原图和生成图，转换为sRGB RGBA，再按行替换原图矩形内的完整像素，扩展区域继续使用生成内容。修复后原图区域逐字节一致，包含不透明、半透明、全透明像素。输出为PNG，旋转元数据去除，尺寸与扩图画布一致。

保护语义是**原图正向化后的8位sRGB RGBA像素**，不承诺保留原文件编码、元数据、16位精度或原色彩配置。当前局部重绘仍使用供应商蒙版；本次没有把扩图回填宣称为所有蒙版编辑均能逐像素保护。

扩图准备和结果保存共用范围校验，缺失范围、越界或没有增加画布会明确失败。保存时缺少原图不能跳过保护步骤。解码提前限制4000万像素，并对损坏图片严格失败。

### 文件类型与实际编码一致

真实MinIO下载复现：供应商返回JPEG，扩图保护转换为PNG后，存储仍使用供应商的 `image/jpeg`。同样，供应商标签与实际内容不一致时也会写错类型。

现在以保存前解码得到的图片编码决定存储与任务结果中的类型，覆盖PNG、JPEG、WebP和AVIF。扩图PNG不会再以JPEG返回；不为修正类型重新压缩原始结果。实际文件内容、下载响应类型和数据库结果描述分别验证。

### 明确失败，避免自动重复生成

扩图范围和去背景结果的可识别错误，记录为 `IMAGE_EDIT_INVALID_INPUT` 或 `IMAGE_EDIT_INVALID_RESULT`，保存具体中文原因，不再统一变成“生成失败，请稍后重试”。去背景仍要求有效透明区域及可见主体；白底和全透明结果不能成为成功作品。

此类确定的输入/结果错误标为不可自动重试，即使队列允许两次尝试，也只调用一次本地测试模型；用户仍可通过现有入口主动重试。其他网络或存储错误继续使用既有重试处理。失败不创建成功资产，不增加生成计次；成功作业重复投递不会再次生成、写文件或计次。

## 本机环境与定向验证

本次重新检查时Docker引擎已能正常响应，启动既有PostgreSQL、Redis和MinIO容器后均为healthy。使用现有数据卷；没有重置数据或重新初始化存储。Prisma检查显示43项迁移已应用，本次没有新增或执行迁移。

| 检查 | 数量与结果 | 真实依赖及边界 |
| --- | --- | --- |
| `image-edit.spec.ts` | 5项通过 | 真实Sharp像素；透明/半透明回填、EXIF、越界/缺少原图、无效去背景、扩图蒙版 |
| `image-edit.integration.spec.ts` | 9项通过 | 真实PostgreSQL、Redis/BullMQ、MinIO与签名HTTP下载；模型和审核使用本地确定数据 |
| `generation.processor.spec.ts` | 44项通过 | 真实PostgreSQL，既有生成、计次、取消、租约、下载和文件失败行为回归；模型及该文件的存储依赖受控 |
| `image-transform.integration.spec.ts` | 2项通过 | 真实项目权限/工作流服务、PostgreSQL、Redis、Sharp、MinIO；裁剪缩放与旋转镜像，不使用模型 |
| Worker类型检查 | 通过 | `tsc --noEmit` |
| 四个目标文件ESLint | 通过 | 无规则警告或错误 |

**共60个不同测试通过。** 前三文件同一次运行58项，另两个图片变换集成用例独立运行。修复前两项像素/范围用例失败，真实存储的两项类型用例失败；修复后通过。重复运行不增加不同用例数量。

新增真实链路用例检查：

- 扩图准备转为inpaint请求，实际PNG结果保存到私有对象存储，原图透明像素和原文件字节保留；父图、根图、操作类型及尺寸正确。
- 重复Redis作业跳过模型和文件写入，成功计次只有一次。
- PNG、JPEG、WebP、AVIF即使收到错误的供应商类型标签，签名下载响应仍与实际编码一致。
- 有效去背景结果保留透明像素和来源，匿名下载返回403。
- 白底/全透明去背景结果明确失败、不产出资产、不计次、不自动第二次生成。
- 缺失扩图范围在模型调用前失败，并给出具体原因。

每个集成用例创建独立账号、项目、队列和文件前缀，结束时只清理自己的记录、队列和对象。数据库与文件内容没有替换成浏览器夹具。

运行命令：

```powershell
# apps/worker
node --env-file=../../.env.example --env-file-if-exists=../../.env node_modules/vitest/vitest.mjs run src/processors/image-edit.spec.ts src/processors/image-edit.integration.spec.ts src/processors/generation.processor.spec.ts --no-file-parallelism --testTimeout=15000 --hookTimeout=15000

# apps/api
node --env-file=../../.env.example --env-file-if-exists=../../.env node_modules/vitest/vitest.mjs run src/modules/design-assets/image-transform.integration.spec.ts

# 仓库根目录
pnpm --filter @fashion/worker typecheck
pnpm exec eslint apps/worker/src/processors/image-edit.ts apps/worker/src/processors/image-edit.spec.ts apps/worker/src/processors/image-edit.integration.spec.ts apps/worker/src/processors/generation.processor.ts --max-warnings=0
```

## 边界与后续

这次补齐了图片处理的真实队列和存储证据，未运行完整HTTP登录/页面到任务的全链路；既有前端45项浏览器结果是上一阶段证据。没有改动界面，没有新增浏览器性能结论。

模型输入和输出由测试注入，因此不能证明真实供应商对局部结构、服装面料、擦除边缘或扩展内容的生成质量。无实际生成效果或付费服务验收，也未证明平台与Lovart全方位对等。

本次重新访问Lovart官方页面，网页抓取连接失败，浏览器返回 `ERR_CONNECTION_RESET`；没有新增官方页面证据，参考继续沿用[能力对照](lovart-capability-review.md)中同日已保存的官方快照。

后续重点是局部重绘未选区域的实际保护、异常产物在任务中心中的恢复路径，以及编辑准备文件的完整回收周期。当前扩图准备文件仍按现有任务前缀保存；本轮没有改动其生产回收策略。真实供应商质量、完整用户链路与跨设备验收继续单独推进。

未调用付费服务，未运行全仓检查或CI，未提交、推送或部署。整体目标保持进行中。

## 同日 17:05 后续记录

以上 16:14 阶段的局部重绘与临时文件边界保留作为历史。本轮后续已加入普通 inpaint 的服务端完整 RGBA 保护、标准化原图/蒙版输入副本、稳定私有标识，以及写入前登记的独立清理队列；取消、重启和存储异常均新增定向验证。完整变更、239 项不同用例及供应商质量边界见[局部编辑可靠性记录](inpaint-integrity-validation.md)。

直接联网现已取得 Lovart 官方高级编辑帮助页，新的参考依据见[能力对照](lovart-capability-review.md)中的后续记录；先前访问失败是当时观察，不再代表当前无法取得官方资料。
