# 真实供应商服装验证工具

`verify-wardrobe-provider.mjs` 用于已获授权的真实收费验证。默认 `plan` 不发请求；收费命令必须显式带 `--execute-paid`。不修改 `.env`，不改变日常项目或队列，不部署应用。

工具读取现有 AMUX 模型、质量和密钥配置。输出只报告密钥是否存在，不打印密钥。若配置估价为 0，报告实际价格未知；保存供应商 usage 不等于取得最终账单。

## 分阶段使用

```powershell
node scripts/manual/verify-wardrobe-provider.mjs plan --ids top-green-sweatshirt
node scripts/manual/verify-wardrobe-provider.mjs source --ids top-green-sweatshirt --execute-paid
node scripts/manual/verify-wardrobe-provider.mjs prepare --ids top-green-sweatshirt --execute-paid
node scripts/manual/verify-wardrobe-provider.mjs status --ids top-green-sweatshirt
```

`source` 通过实际 AmuxAdapter t2i 生成设计草图，保存原始 PNG。`prepare` 把原图登记到独立本机项目，经过生产 WardrobeService、GenerationService、BullGenerationJobs、实际 worker 和实际 Claude 内容审核生成候选，再保存私有 MinIO / DesignAsset 证据。每个候选额外触发一次真实内容审核请求，不能只按图像请求数估算总调用量。

新设计源须先逐项对照明确设计规格，在单品目录保存 `source-review.json`（`decision:"approved"`、`stage:"source"`、原图 `sha256` 和非空 `reviewChecks`）。源图擅加结构时应拒绝，不可把错误源图当成转换依据。缺少通过记录时，runner 不发起新的付费正面转换。

审核可明确提供归一化 `region:{x,y,width,height}`；runner 将其传给真实单品准备接口执行裁取，不改变完整源文件或其 hash。若需纠正原验证规格中不可见的要求，可另存公开范围说明和 `source-review.scope-v2.json`，使用 `--source-review source-review.scope-v2.json` 显式选取，不能静默覆盖旧拒绝记录。

需要本机 PostgreSQL、Redis、MinIO。首次准备在独立 `wardrobe_provider_*` schema 应用既有迁移，同时设置原生 SQL search_path；使用独立 queue/prefix，队列尝试数为 1，供应商自动重试为 0。不会清空日常数据。证据和隔离项目保留用于检查，不自动清理。

`--ids` 接受逗号分隔的清单 ID；`--concurrency` 只接受 1 或 2。清单默认是 `scripts/manual/wardrobe-provider-cases.json`，可用 `--cases` 指定明确的新设计规格。输出默认 `output/wardrobe-provider/`，`--out` 必须位于工作区 `output/` 子目录。

## 人工复核与侧图

自动 alpha 检查通过并不确认服装合格。核对设计源、正面候选、透明背景及真实承重点后，在对应单品目录写 `review.json`：

```json
{
  "decision": "approved",
  "reviewedBy": "实际复核者",
  "reviewedAt": "ISO时间",
  "sha256": "候选原图的SHA256",
  "anchor": { "x": 0.5, "y": 0.17 },
  "supportWidthRatio": 0.62,
  "reviewChecks": ["实际逐项核对结论"]
}
```

上例挂点只用于说明格式，不可机械套用其他衣物。

```powershell
node scripts/manual/verify-wardrobe-provider.mjs confirm --ids top-green-sweatshirt
node scripts/manual/verify-wardrobe-provider.mjs side --ids top-green-sweatshirt --execute-paid
```

确认命令检查审核记录、当前候选 hash，再通过真实服务保存修订；不会发起生成。侧图只引用已确认正面修订，通过显式 `presentation` 准备入口生成。侧图必须另行核对，并将同结构审核记录写到 `side-review.json` 后执行 `confirm-side`；保留正面试穿素材。

现有已批准图片只需修正挂点或挂具时，使用 `calibrate-front --attempt anchor-v2 --ids ...`，在该 attempt 单品目录写 `anchor-review.json`，包含当前正面图片 hash、批准结论、明确的 `anchor` 和审核信息，可选 `supportWidthRatio` 与 `shelfDepthRatio`（托面后向纵深/托架宽度，范围 `0.08–0.5`）。该命令仅通过 `updatePresentation` 新建展示修订，保存 `anchor-confirmed.json`，不改原图、不发生成、不替换侧图。旧候选审核和历史修订保留；省略深度时保留原设置。

## 返工和中断恢复

```powershell
node scripts/manual/verify-wardrobe-provider.mjs side --ids top-green-sweatshirt --attempt side-v2 --execute-paid
node scripts/manual/verify-wardrobe-provider.mjs confirm-side --ids top-green-sweatshirt --attempt side-v2
```

返工输出写入 `output/wardrobe-provider/attempts/side-v2/`，同一款有新准备记录、请求键、任务及原始图片。默认复用已保存设计源／已确认正面；原始调用记录和失败候选不覆盖。每个 attempt 有独立 manifest，审核前不替换主 manifest。审核通过后才更新主 manifest 的当前展示引用，历史证据保持在原目录。

侧图可显式传 `--pose-reference path/to/pose.png`：第一张已确认正面仍是唯一设计与材质依据，后续图片只指导陈列视角和受力姿态。参考图登记为独立私有导入资产；过小图片只等比放大到宽 256，原文件保留，来源、两份 hash 和处理方式写入 `pose-reference.json`。不得复制姿态图的款式、颜色、印花或挂具。

如果错误发生在设计源本身，需明确写出新的案例规格，并显式重建设计源：

```powershell
node scripts/manual/verify-wardrobe-provider.mjs source --ids onepiece-satin-gown --attempt gown-v2 --new-source --cases output/wardrobe-provider/attempts/gown-v2/cases.json --execute-paid
node scripts/manual/verify-wardrobe-provider.mjs prepare --ids onepiece-satin-gown --attempt gown-v2 --cases output/wardrobe-provider/attempts/gown-v2/cases.json --execute-paid
```

相同目录中的案例被冻结；更改设计不能覆盖旧 `case.json`。调用意图在发请求之前落盘。网络超时、未知结果、失败或已有调用记录均禁止自动重发；不能删除 `*-call.json` 来绕过防重复。已成功源图重跑时按 hash 校验并复用；已成功任务重跑只读取现有结果。重新收费必须使用明确的新 attempt。

后续候选返工可用 `--source-attempt gown-v2 --attempt gown-v3` 继续引用指定历史 attempt 内已批准的源图，避免退回更早的错误设计。需要与该来源相符的 `--cases`。原始 source、候选和审核证据始终保留。

设计源仅有局部结构错误时，可使用 `source --attempt source-edit-v3 --new-source --source-edit-attempt source-v2` 和带独立 `sourceEditPrompt` 的新案例文件。它通过真实供应商 i2i 编辑该历史设计源，在本机私有 MinIO 保存原始参考字节，并记录 `source-edit-binding.json`；不以新 t2i 重做整款，不覆盖 v2 原图、规格或拒绝审核。新源仍须重新进行明确规格审核，才能进入生产单品准备链路。

针对失败成品候选进行独立局部修正时，显式使用 `--source-candidate-attempt transparency-v2 --source-kind isolated --mode extract --attempt alpha-repair-v1`，并提供写明修正目的的新 `--cases`。该分支只接受已有成功任务、独立拒绝审核与文件 hash 一致的单张候选；再次校验同一隔离项目中的真实私有资产字节，直接以其 assetId 调用生产准备接口，不重传成新的设计根。`source-candidate-binding.json` 冻结原任务、parent/rootAssetId、hash 和审核记录；不带旧草图 region、额外参考或 presentation。图像模型修正仍可能改变像素，必须重新核对设计与实际透射，不能宣称逐像素 alpha-only。每张新候选均重置为未审核，不继承旧正面的批准、侧图或挂具比例。

侧图修正使用 `side --side-source-attempt side-support-v2 --attempt side-alpha-repair-v1`：真实来源是原侧候选，经过生产 `presentation.repairPreparationId` 校验绑定正面修订，模式固定 `isolated/extract`，不附加姿态图、region 或其他参考。`source-side-binding.json` 记录父侧图和原设计根，新结果仍保存为 `side.png`，经独立 `side-review.json` 后才能 `confirm-side`，不能混作正面确认。它是显式调用，不会在发现透明失败后自动产生第二次费用。

局部蒙版试验使用 `inpaint --source-candidate-attempt transparency-v2 --attempt lace-inpaint-v1 --mask .../mask.png`。同目录 `mask.json` 必须记录并匹配原候选与蒙版 hash；工具检查 PNG alpha、与源同尺寸、小于 4MB，以及同时存在可编辑和保护区域。蒙版登记为同项目私有资产，原候选和 mask 一起进入真实 DesignStep.sources；通过既有 `GenerationService.createFromAgent`、冻结编译输入、真实 BullMQ/worker、供应商 multipart mask 与内容审核完成生成，不直连供应商绕过系统。原生 inpaint 输出仍可能改变保护区，必须逐图核对；不在本地覆盖候选 alpha 或补贴源像素。候选通过人工审核后，`confirm` 才以生产 `prepare(existing)` 登记入架，保留原生成祖先标记。

原生蒙版修正侧图使用 `inpaint --side-source-attempt side-physical-repair-v1 --attempt puffer-inpaint-v1 --mask .../mask.png`，与正面候选来源参数互斥。它仍创建真实 INPAINT 任务，记录失败侧图及其已确认正面绑定，输出 `side.png`；不会伪造 WardrobePreparation。独立审核通过后，`confirm-side` 先通过生产 `prepare(existing, presentation)` 登记该真实结果，再保存展示修订。登记严格核对冻结的正面 assetId、修订、类别与方向，不能将同一结果错接另一个正面或发布成正面。

native 侧图仅背景透明性不合格时，可明确使用 `side-cutout --side-source-attempt pants-inpaint-local-v3 --attempt 新目录 --cases 新修正说明 --execute-paid`。原侧图审核必须绑定精确 SHA，且独立写明 `structureApproved: true` 和 `eligibleForBackgroundOnlyExtraction: true`；probe、未完成任务、未通过结构或错源一律拒绝。该命令真实调用普通 `Wardrobe.prepare(isolated/extract)`，母资产为 native 结果，不附加参考/蒙版，不冒用 `repairPreparationId`。普通准备 ID 保存在 `cutoutPreparationId` 与 `cutout-preparation.json`；后续透明结果须另行审核，再由 `confirm-side` 真实登记 `prepare(existing, presentation)` 才能采用。普通准备与侧图展示登记是两个不同记录，历史来源和冻结正面绑定都保留。

`inpaint --side-source-attempt` 也可明确引用已有 native 侧图。工具递归核对每层真实成功任务、父资产、私有图片 SHA、实际 wire 第一张源图 SHA、源文件及冻结正面类别/方向，直到真实衣架侧图准备及已确认正面，并保存 `native-side-chain.json`。native 层不存在准备记录时不会伪造 ID。若直接父图是 processing probe，还必须显式 `--allow-probe-parent`，且 `probe-review.json` 精确 hash 的 `approved-as-processing-intermediate` 与 `eligibleForNextStage:true` 齐全；该允许只用于本次新 inpaint，不允许确认 probe，也不自动收费执行下一阶段。新结果依然独立审核。

同一真实 raw 因旧局部目标失败，但经另一次全图检查可用于不同编辑意图时，可以另存审核并显式传 `--side-review whole-candidate-review.json --allow-probe-parent`。旧拒绝文件保留；新审核仍须精确 SHA、处理阶段批准和 `allowedTargets`，案例 `nextStageScope:{file,sha256}` 另行绑定本次源、mask、attempt、`operation:"correction"` 及允许目标子集。来源绑定保存实际审核文件及其 SHA；后续递归不得把首层新审核套给所有祖先。未明确指定文件时仍读旧默认 `probe-review.json`。

native 入口继续只接受真实成功的单张模型任务。若其祖先为合法算法派生，递归另核真实 `existing/isolated` ready 准备、无生成任务的 DesignStep、source/raw/mask 三份私有资产及四份 SHA、raw 的成功 INPAINT 输入、类别/冻结正面和该层处理审核，再沿算法 source 继续。真实父资产始终记录 raw，不把算法 source 冒作直接父资产，也不伪造 `side-task-after.json`。历史 `masked-provider-rgb-preserve-alpha-v1` 与当前 v2 分开核对，目录越界、循环与超长血缘拒绝。

原生生成输入单独保留在 `native-input-preparation.json`；后续 `register-side` 和 `confirm-side` 的真实 existing 准备写到 `registered-side-preparation.json`，确认复用已登记的幂等请求，不覆盖原生 task/source 字段。旧版确认曾合并覆盖工作 `side-preparation.json` 的情况必须另行记录；只允许依据真实数据库任务、compiled 输入、源绑定、实际私有字节及 SHA 重建独立输入，明确标记 `reconstructed-from-recorded-task-and-binding` 和本次重建时间，不能伪称原始采集记录或改写旧文件。血缘优先读取独立输入，再重新验证真实任务与图片。

`audit-native-source --ids ... --attempt 独立核查目录 --side-source-attempt 来源目录 --allow-probe-parent --side-review whole-candidate-review.json` 可在付费前单独核查同一血缘代码。该命令不部署迁移、不创建任务/资产、不启动 worker，输出真实链与零供应商/数据库/存储写入统计；本地运行记录仍保留。它只验证来源，不替代蒙版、结构示意、新编辑范围及结果的独立审核，也不允许把派生图直接作为 native 入口。

保存完成后，运行 `node --env-file=.env.example --env-file-if-exists=.env scripts/manual/audit-wardrobe-provider-state.mjs`，只读核查隔离项目的 29 个真实当前修订、canonical/保存回执、58 张正侧私有图片精确 SHA、挂点/展示元数据、成功任务血缘和队列终态；汇总保留的实际 image/moderation HTTP 回执与技术失败。报告默认写入 `output/wardrobe-provider/final-state-audit.json`，不打印 `.env` 或密钥，数据库/私有存储写入及供应商请求均为 0；仅在本地 `output/` 写核查报告。准备过程中可用 `--allow-pending <caseId>` 显式列出尚未保存侧图的单品；此时报告 `passed:false`，不能充作最终全通过。实际费用仍以供应商账单为准，配置零值不表示免费；历史视觉拒绝记录数与技术请求失败数分别报告。

`prepare --material-reference` 可把案例 `materialReference` 中已审核的同源材质裁片作为第二参考。工具核对完整源及裁片 hash、尺寸和原坐标像素后，将裁片原样登记为私有派生资产，完整设计源仍为第一参考，`prepare.region` 不会被替换成材质 ROI。证据写入 `material-reference-binding.json`；这是设计图自身局部参考，不代表外部真实织物照片。

`inpaint --material-reference` 仅允许当前真实失败母图的原像素裁片作为第二图，完整母图仍为第一图，mask 只对应完整母图。三份输入均先登记为当前项目私有资产；服务端重新验证归属和顺序并签名下载地址，DesignStep 同时保留 edit_source、edit_mask 与 detail_ref。裁片不能代替完整母图或把局部 ROI 当作整件输出，也不会在已有请求上偷偷追加参考。该能力不改变现有 workflow 的参考输入限制。

侧图原生蒙版编辑另可用当前已确认同款正面的原像素结构裁片：需 `reference-review.json` 明确批准该正面与裁片 hash，runner 再核对数据库当前修订、审核状态、类别、实际私有正面字节与侧图绑定。裁片父资产记录为真实正面，并保存正面修订；第一张侧图仍是编辑几何依据。此原生多参考路径按明确 notes 指定两张图的角色，不能套用“唯一参考图”的单源修正说明，不扩展衣架提取接口的参考限制。

`inpaint --structure-guide` 仅用于明确的 native 侧图编辑，可把独立新绘的结构示意作为第二参考；与 `--material-reference`、姿态参考互斥。案例须含 `structureGuide` 的文件、实际 SHA、尺寸、`authored:true`、`structure-guide-only-not-garment-design` 角色及当前正面资产／修订／SHA，独立 review 同时绑定实际蒙版 SHA。工具核对真实数据库及私有正面字节，原样保存示意图为独立根资产，并以 `wardrobe-authored-structure-guide` DesignStep 明确记录人工输入；不会冒充正面裁片或供应商输出。第一张真实侧图仍是款式、材质与几何依据，输出另行审核。

命名 attempt 可用 `--model` 指定已核对的 Sunburst、Flare、`openai/gpt-image-1.5` 或 `openai/gpt-image-2`，仅修改该进程配置。`--match-prompt` 在提交前核对除 model 外的完整实际 wire，包括 prompt、尺寸、质量、背景、格式、mask 与全部参考图字节 SHA。1.5 编辑的官方接口为 [Amux GPT Image 1.5 edit](https://amux.ai/api-reference/images/gpt-image-1-5-edit)；该模型未发送 `input_fidelity` 时默认 low，与 2.x 的固定 high 不同，相同字段不代表等价能力。实际 HTTP 失败、拒绝及未知账单必须单独记录，不以未出图判断模型视觉质量，也不自动重发。

## 证据与验证边界

`material-derive --attempt lace-material-alpha-v1 --material-raw-attempt lace-green-net-v2 --cases ... --ids top-sheer-lace` 是无供应商调用的生产派生验证。它使用真实 INPAINT 任务的原图、中间图和蒙版资产调用 `WardrobeService.deriveMaterialCandidate`，保存真实私有输出与准备记录，核对全部 RGBA 和已审核 gain 0 诊断一致；记录 `material-derived.json` 和独立未确认 manifest。候选明确标记 `materialProcessing` 与 `algorithm-derived`，不伪造新生成任务，不改原始 PNG，不自动确认，也不替换主 manifest。相同请求重放复用原候选并保留同图已有审核状态。

侧图透明派生额外使用 `--material-side-attempt <原侧图准备attempt>`，仍以 `--material-raw-attempt` 指向实际侧图 probe。工具只接受真实 `WardrobePreparation.id`，传服务端 `sidePreparationId` 验证原候选与冻结正面绑定；输出 `side.png`、`side-preparation.json` 和原 `side-front-binding.json`，仅在独立 manifest 的 `sideDisplay` 写入处理 metadata，正面资产不变。可对历史冻结修订派生并重放，最终 `confirm-side` 的版本门禁拒绝过期挂载。原生任务尚无合法侧图准备记录时不能伪造 ID 调用此路径。

原生或 `side-cutout` 结果可先执行无付费 `register-side --attempt <该结果attempt> --cases <原冻结case> --ids ...`。工具验证私有输出字节、alpha、真实任务与完整来源链，再调用 `prepare(existing,presentation=冻结正面与方向)`；新记录独立保存为 `registered-side-preparation.json`，不覆盖原 native/cutout 的任务记录，不确认候选，不合入主 manifest。侧派生会优先读取这份真实登记记录，同请求重放复用同一准备。登记只说明链路成立，不代表材质、结构或展示质量通过。

`material-probe --attempt <新attempt> --material-side-attempt <真实登记母图attempt> --mask <审核PNG> --cases ... --ids ... --execute-paid` 直接验证生产 `WardrobeService.createMaterialProbe`。工具要求母图结构审核与蒙版精确 SHA，先在当前用户临时 mask 命名空间上传，再调用生产 `registerMaterialMask` 保存永久私有输入；同源 `materialReference` ROI 只用于核对像素并计算 `detailRegion`，第二图由生产服务裁取。实际 prompt 由生产服务生成，output 为 opaque 处理中间图、始终 `processingProbe:true`，不得确认。原始父资产、独立准备、mask、任务和实际 wire 证据保留，后续派生仍需另行人工审核。

局部细节修正须在案例项中明确 `operation:"correction"` 并填写 `notes`，同一项用于 `material-probe` 和 `material-derive`。三次生产输入（登记蒙版、probe、derive）冻结该模式；缺省仍是旧的 `transparency`。correction 的来源可以是结构待修图，但须有精确 hash 的 `eligibleForLocalCorrection:true` 来源审核及 `operation:"correction"` 蒙版审核，不能冒称结构已通过。派生前还检查真实任务中的 correction marker、生产接纳 receipt、原图和蒙版资产；不能把旧绿色 probe 重新命名成 correction。

correction 的新派生采用 `masked-provider-rgb-interior-v2`，候选 metadata 为 `kind:"masked-edit"`。只有 source alpha≥240 且周围 2px 范围内均满足该条件的内部像素，才按蒙版权重混合供应商 RGB；半透明边缘、轮廓窄带、整张 alpha 与蒙版外 RGBA 保留原样，记录固定阈值／半径及保护统计。无可编辑内部像素时在付费 probe 前拒绝。它不能伸长裤腿、改变外轮廓或把 RGB 原图变成透明成品。

工具保存实际逐像素审计 `production-pixel-audit.json`，原始供应商图片、输入、三来源与四 SHA 均保留，候选等待独立审核，不能直接发布原 probe。旧 `masked-provider-rgb-preserve-alpha-v1` 输出和算法历史不改写，相同请求键重放保持旧结果；使用同一原始模型结果重新派生 v2 必须采用独立 attempt／请求键，但不产生模型调用。这个路径不要求事先手工生成诊断成品，原图像素保真由实际派生后审计验证。

若本次派生仍只是后续编辑的中间步骤，案例必须写 `derivedProcessingIntermediate:true`。工具在派生 receipt、准备记录和独立 manifest 保留处理中间状态，即使形成了新的真实 DesignAsset 也不能 `confirm-side`。只有精确 hash 的独立 `probe-review.json` 明确 `decision:"approved-as-processing-intermediate"`、`stage:"side-processing-probe"`、`processingProbe:true` 与 `eligibleForNextStage:true` 后，才能在下一次已授权 `material-probe` 显式加 `--allow-probe-parent` 使用它；默认拒绝，不会自动提交下一次付费请求。

后续编辑若明确扩展上一阶段允许范围，在案例 `nextStageScope:{file,sha256}` 中冻结独立的范围审核说明。说明绑定实际母图 SHA、蒙版 SHA、新 attempt、处理模式、审核者、检查结果及允许目标；任何不匹配均在提交前阻断。该说明不覆盖母图旧审核，不把尚未完成的目标标为通过，也不成为自动收费授权。

新 correction 任务由生产服务自动生成同源选区位置参考，实际参考顺序为原图、位置指引、可选的原像素细节。指引算法 `masked-interior-magenta-guide-v1` 只在 v2 有效内部选区按 45%×编辑权重叠加品红，不改 alpha、构图或画出推测结构。指引为独立私有派生资产，不能当成服装确认；真实蒙版仍单独发送。旧任务重放沿用其原有引用，不补图或重复收费。

`wardrobe-correction-guide-preview.ts --source <原图> --mask <蒙版> --out <output内PNG>` 调用同一生产纯函数生成无付费预览，明确 `isRegisteredAsset:false`，不登记假资产。真实调用案例可提供 `correctionGuide:{sourceSha256,maskSha256,guideSha256,reviewFile}`；审核绑定三份精确 SHA，runner 在实际 wire 提交前核对第二参考的真实字节，不一致即阻断。预览与实际登记是两个阶段，实际任务的 guide 来源和资产记录仍须在调用后核对。参考输入通过不代表模型落点或材质效果通过。

普通生成侧图也可使用 `register-side`：必须同时验证数据库真实准备、成功生成任务、私有输出和冻结正面绑定，再新建独立 `existing` 准备；不会将普通生成准备的 `ready` 标志或本地 ID 当作生成成功证据。

`side-cutout` 可显式用 `--side-review side-review.scope-v2.json` 读取来源目录内新一轮范围复核；旧拒绝文件保留，仍需精确图片 SHA、`structureApproved:true` 与 `eligibleForBackgroundOnlyExtraction:true`。这只允许真实背景提取，不把 RGB 中间图直接确认为展示成品。

后续 native 蒙版编辑可将该真实去背景结果作为父资产。递归校验会读取其真正的 `cutoutPreparationId`，要求实际任务为普通 `i2i`、准备为无 presentation 的 `isolated/extract`、原父图及 native 侧图绑定均一致，再继续追溯到确认正面；不会伪称这一步是 INPAINT，也不会伪造侧图准备 ID。

- `run.json`：隔离 schema、项目、队列及安全供应商配置。
- 单品／attempt 目录：冻结案例、原始 source/candidate/side PNG、实际 wire prompt、HTTP 状态及 usage、准备记录、任务前后状态、编译提示、DesignStep 来源和审核记录。
- `manifest.json`：供浏览器视觉验证读取的当前真实图片、类别、挂具、原图像素边界、来源及审核标记。不会把未审核候选标为通过。
- `run-summary.json`：累计真实图像／内容审核请求、HTTP 状态、返回的 token 用量及未知实际账单标记；失败视觉候选也计入真实调用，不能将请求成功数当作验收通过数。

浏览器加载这些真实图片时仍可模拟平台 API；这只证明渲染。真实模型质量由独立图像核对记录说明，不能把 alpha、内容安全审核或任务成功代替服装设计保真验收。

本工具的防重复单元测试为 `node --test scripts/manual/wardrobe-provider-journal.spec.mjs`；生产像素、来源、权限及队列回归仍运行 `pnpm wardrobe:verify`。工具不自动批准结果，不生成侧图之外的新背面或其他视角。
