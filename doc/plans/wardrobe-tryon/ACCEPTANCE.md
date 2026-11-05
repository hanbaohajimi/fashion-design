# 分层验收记录

2026-10-30 开始的真实 API 转换与陈列验收已完成 29 款正面与侧图的确认保存。2026-11-04 重新核对了真实资产与任务，最终 v4 混排六场、触屏 v8 及完整构建通过；独立静态观图和正常动效录像抽帧在实际观察范围内通过，不声称全片原速观看，也不以自动化通过替代效果验收。最新交接及证据范围见 [RESULTS.md](RESULTS.md)、[供应商样本矩阵](PROVIDER-REALISM.md) 和 [透明材质实测](ALPHA-INVESTIGATION.md)。此前照片对照仅见 [REALISM.md](REALISM.md)，不能代替本次真实模型结果。

下方“首轮”记录对应尚未调用收费供应商的业务功能实施。后续真实调用已获用户明确授权，使用独立测试项目、队列、原始响应及逐图审核。测试替身、几何图形与参考拼图仍不能替代真实服装效果验收。

## 真实材质返工后的工程回归

2026-10-30 的增量工作区记录（后续素材审核仍在推进，各命令保留对应日志）：

| 检查 | 结果及证据 |
| --- | --- |
| 完整 `pnpm build` | 含正面／侧挂两种修复、柔边画笔、v2 轮廓保护及同源位置指引的 7/7 工作区成功；最新 `output/wardrobe/correction-guide-build.log`，退出码 0，此前各轮日志保留 |
| Web 完整 Vitest | 局部 RGB 修正完成时 121 文件、668 项通过；`output/wardrobe/masked-correction-web-test.log`；随后柔边变更由下面专项和真实 Canvas 验证覆盖 |
| 衣架、蒙版与设计契约专项 | 最新 17 文件、80 项通过，包括透视托面、宽配件分页、挂点校准、三底比较、正面及侧挂两种修复、操作／请求／版本隔离、每笔宽度及柔和程度、专用上传及取消 |
| v2 修正范围与历史提示 | 3 文件、14 项通过，Web 类型检查及对应 ESLint 通过；新版说明内部／边缘保护范围，v1 历史详情不冒用 v2 说明 |
| 柔边真实 Canvas | 浏览器 1 项通过；254 种中间权重，预览／导出反相逐像素差 0、选区外变化 0，调整参数／关闭恢复／撤销不改变原笔画；`output/wardrobe-provider/inspection/correction-soft-brush/` |
| GenerationService、衣架规则与透明算法 | 3 文件、84 项通过，含多参考局部编辑的项目归属、第一图与父资产一致性、私有签名、来源记录及固定 alpha 算法；使用 `.env.example`，无真实供应商请求 |
| 透明／局部 RGB 像素算法 | 最新 32 项通过；验证原 alpha、保护区 RGBA、v1 历史混合及 v2 半透明／轮廓保护、有效内部像素和软蒙版权重；算法通过不等于供应商视觉结果通过 |
| 选区位置参考与图片处理 | `wardrobe-media.spec.ts` 6 项通过；固定品红权重、原 alpha／非编辑区保留、同输入确定性与基础图片处理，未调用供应商 |
| 最新隔离数据库／队列／存储 | 4 文件、69 项通过；schema `wardrobe_verify_1793339679614`，`output/wardrobe/correction-guide-integration.log`，含两种派生模式及禁止混用、侧挂绑定、v1 历史幂等／v2 新请求、无内部像素收费前拒绝、位置指引的原图优先引用顺序／隐藏／禁止入架，以及 owner/editor 历史任务重放。过期挂载、专用蒙版不可变存储、内部素材空值及权限回归保持；使用本机供应商替身 |
| 真实调用工具门禁 | 最新 19 项通过；独立 attempt、处理中间态、后续范围说明，以及位置指引的原图／蒙版／第二参考精确 SHA 在收费前核对；工具严格类型检查和对应 lint 通过 |
| 类型与 lint | API/Web 类型检查、受影响文件 ESLint、真实调用 runner 严格类型检查及 lint 均通过 |
| 逐件真实 PNG 页面复核 | `output/wardrobe-provider/inspection/render-review.json` 记录 29 款当前 hash、观察截图及未验收状态；浏览器 pass 本身不代表素材通过 |
| 真实来源审计 | `output/wardrobe-provider/real-lineage-audit.json` 校验真实 worker 的父资产／根资产与侧图修正绑定；眼镜侧图更新没有更改试穿正面 |

上述为 2026-10-30 的历史工程检查，当时真实素材尚有未通过项。后续 29 款正侧素材及混排复核已于 2026-11-04 完成，不能把历史未验收状态当作当前结论，也不能把当前素材通过扩展到普通背景、遮挡拆分、整套试穿和本人实时多件效果。

2026-11-04 按部位参考图补验：原实现仅按选入顺序平铺，现已补为按穿着部位分组、组内按层次独立显示，历史参考图保持不变。`wardrobe-media.spec.ts` 8 项、API 类型检查与相关 ESLint 通过；`pnpm wardrobe:verify` 在独立 schema `wardrobe_verify_1793804324911` 中 4 文件、71 项通过，真实数据库／队列／私有存储日志为 `output/wardrobe/body-regions-integration.log`，本轮供应商调用 0 次。另用 12 张已确认真实正面生成并实际查看 `output/wardrobe/body-regions-real-preview.png`：全部单品独立、长款完整，PNG 639636 字节，低于 5 MiB。该图仅验证参考布局，不是实际搭配建议或供应商多件试穿效果。

## 首轮基线

- 工作区已有摄像头会话、SDK、预算、截图和界面调整，均保留。
- 开始时的差异清单、补丁与 HEAD 记录：`output/wardrobe-tryon/baseline/`。
- 另一个摄像头界面任务结束后才追加重叠文件兼容改动；未提交、推送或部署。

## 自动化记录

| 检查 | 当前记录 |
| --- | --- |
| 工作台加入衣架入口 Vitest | 3 项通过：显式操作、重复点击防重、保存拦截、只读、失败重试及卸载迟到回调 |
| 衣架 Playwright | 10 项通过：稳定命中区、连续悬停、聚焦切换／退出、无隐性生成、保存恢复、搜索分组、手机／减弱动态、只读、深链、失败、候选确认、旧结果保留、未验收能力关闭、手机切视图保持摄像头及收起回衣架 |
| `pnpm --filter @fashion/web test` | 111 个文件、612 项通过；衣架目录 6 个文件／21 项，包含准备确认、直接上传、临时快照合并、模式退出迟到隔离、截图切模式保护、改名不重试穿，以及现有 UI 回归 |
| `pnpm lint` | 11 个构建／检查任务全部通过 |
| `pnpm typecheck` | 11 个构建／检查任务全部通过 |
| `pnpm build` | 7 个工作区全部构建成功，Next.js 路由与静态页生成完成 |
| `pnpm wardrobe:verify` | 4 文件、23 条通过；独立本机 schema 应用 42 份迁移，真实 PostgreSQL／MinIO／Redis／GenerationService／worker，含新增 6 条并发状态回归 |
| GenerationService 专项 | 47 项通过，包含静态试穿的显式 on_model 与提取 garment_only 策略 |
| API 工作区完整 Vitest | `node --env-file=.env.example --env-file-if-exists=.env ./node_modules/turbo/bin/turbo run test --filter=@fashion/api`：98 文件、792 项通过；4 文件／19 项条件跳过，其中本轮衣架及实时试穿的 17 项已在各自隔离脚本中另行通过。此后新增的 6 条并发回归由最新衣架隔离验证覆盖 |
| `pnpm tryon:verify --local --browser` | 42 份迁移；46 条后端、62 条前端、7 条浏览器测试通过，原单件入口兼容 |
| Impeccable detector | 对新增 UI 及入口运行一次，结果为 `[]`；报告在 `output/wardrobe-tryon/review/detector.json` |
| CI | 本轮未提交、推送，未触发远程 CI；上述为当前工作区的本地验证 |

首轮发现的衣架宽度、手机分视图、聚焦空间过渡、聚焦尺寸和鞋底挂点均已修正。全量测试发现的动态 CSS 变量默认值缺失和类型检查的返回值问题已修复并复测。独立审查首先要求重拍旧结果状态，已补拍可同时看到当前版本 2 与结果所属版本 1 的截图；随后提出的直接上传、手机保留会话、收起回衣架、模式切换截图保护、模态内边距五项已集中修复并补测试。最终复核将 F1–F5 全部评为 resolved，结论为 ship（UI／工程修复范围），不包含真实服装及供应商效果。报告保留于 `output/wardrobe-tryon/review/finish-review.md`。

后端额外复核发现同请求并发时迟到失败可能覆盖已成功接纳的状态，已通过成功清空错误、失败条件更新和重读当前状态修复。新增 6 条真实隔离数据库测试覆盖提取准备、透明素材准备及模特试穿的两种完成顺序，全部通过。

## 真实基础设施与替身边界

衣架验证经过生产 `GenerationService`、`BullGenerationJobs`、独立 Redis queue/prefix 及实际 `generation.processor`，经真实 Amux 适配器访问本机 HTTP 图片服务，再写入 MinIO 和 DesignAsset。完整三图输入、幂等、计数、来源快照、失败和运行中取消已检查；失败／取消保留旧结果。

本机图片 HTTP 请求 4 次，外部供应商请求 0 次；内容审核使用确定性替身。这证明本地管线正确连接，不证明服装提取或试穿质量。证据：`output/wardrobe/verification.log`、`pipeline-report.json`、`generation-tests.log`。测试通过唯一 schema、原生 SQL search_path 和唯一队列前缀隔离；对日常 public schema 的额外只读审计中，本轮测试用户、任务、资产均为 0。

## 首轮效果验收边界（历史记录）

下表保留首轮工程交付时的边界。之后已获用户授权并执行真实收费草图转换、侧图生成与返工，最新逐款状态以 [PROVIDER-REALISM.md](PROVIDER-REALISM.md) 及对应 hash 审核为准；没有补验的试穿和摄像头项目继续保持未验收。

| 样本／效果 | 当前状态 |
| --- | --- |
| 短上衣、长外套、裤装、连衣裙、鞋、包的透明几何素材 | 用于浏览器布局与交互检查；不是服装素材转换验收 |
| 透明真实单品与已有白底外套 | 原图可读取检查；未经真实入架与生成效果验收 |
| 普通背景去除、模特遮挡、整套目标拆分、草图转换 | 首轮未执行真实供应商调用；草图转换已在后续 29 款矩阵真实执行，其余来源路径不能由该矩阵代替 |
| 内搭＋外套＋下装 | 未执行真实多件试穿；参考图合成只验证文件链路 |
| 连体服、鞋、帽、包及混合组合的试穿 | 未执行真实供应商试穿效果验收；单品素材的后续转换与陈列核对不能代替整套试穿 |
| 本人物理摄像头、持续生成与真实保存画面 | 本轮未执行；沿用单独的实时能力验收边界 |

待真实验收时逐件记录源资产、确认版本、快照、模型配置、任务 ID、费用与结果。任何漏件、颜色／结构偏移、图案丢失或层次错误均记为不合格，不把功能缩成单上衣后宣布多件完成。

## 复查入口

- `pnpm --filter @fashion/web test src/modules/studio/wardrobe src/modules/board/workflow/WardrobeReferenceEntry.spec.tsx`
- `pnpm --filter @fashion/api test src/modules/wardrobe`
- `pnpm wardrobe:verify`：独立本机 schema、私有存储验证，供应商调用为零。
- `pnpm exec playwright test tests/e2e/wardrobe-tryon.spec.ts`
- `pnpm tryon:verify --local --browser`：原有单件与新增兼容的回归，仍不调用供应商。

浏览器截图在 `output/wardrobe-tryon/browser/`；本轮保留的录屏在其 `final-recordings/` 子目录，临时测试录屏和 trace 在 `output/playwright/test-results/`。`video-comparison.mp4` 已生成并抽帧检查：1920×720、30 fps、25 秒，左右分别为第二段源视频和浏览器行为测试。源视频对照依据见 [VIDEO-REFERENCE.md](VIDEO-REFERENCE.md)。
