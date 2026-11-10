# 官方 Cubism Web 运行时（本地构建）

历史工具：正式无限白板已切换到织芽毛绒助手，此目录用于保留旧 Live2D 路线的制作与检查方法。以下生产身份、门禁和制作步骤属于原阶段记录，不会随当前应用启动，也不代表待继续执行的正式角色任务。

`audit-core-native-package.mjs --occlusion-plan <冻结组合JSON> --occlusion-plan-sha256 <SHA> --order-baseline-audit <实际r17审计>` 是新的显式遮挡组合入口，与两种旧 Front 顺序入口互斥。它仅接受已批准的 Front 4项逆遮罩、Cape 8项逆遮罩、12层固定绘制序及 Front57/Lower12/Back17 精确局部 Form/拓扑计划；其他70层几何、61层顺序和所有源采样保持冻结契约。全部73层实际 Core 遮罩仍逐项核对，密集 Hat×三头轨迹核对整数绘制序与稳定 render rank。原生 Float32 坐标按字节 SHA 严格相等，不把 Java 最短十进制与完整 Double 文本差异误认作几何变化。该工具不写模型，也不授予视觉通过。

此目录包含官方播放器、资源检查、真实 PNG 分层 PSD 组装及程序编曲草稿工具。工具不会生成或伪造 Cubism 的 cmo3 / moc3 导出。当前产品身份为 `forest-spirit-front-v8`，schemaVersion 仍为 1，资源清单保持 `awaiting-production-assets`。旧 v1/v2、SproutProof 和 Haru 都不能通过正式角色门禁；技术验证不能填写正式角色视觉审核清单。

`capture-fullbody-playback.mjs --raw-frame-evidence` 可在原有显式模型/动作/物理参数之外，逐实际完成帧保存280px全角色及大画布固定肩肘ROI的原始透明PNG。PNG与状态在同一完成draw内同步冻结，`raw-frame-manifest.json`记录参数、frameCounter、实际wall/draw时刻、dt、路径与SHA；每个选定帧都必须存在，达到2400帧上限直接失败，不静默丢帧。默认关闭，观察开销不能用于性能评分。

`encode-raw-playback.py --capture <该轮目录> --out <新目录>` 读取上述真实PNG，按实际wall间隔编码VP9 lossless/yuv444p视频。保留DragHold暂停间隔，1ms时基，最后一个重复帧明确只表示末帧保持的终点；不插帧、变速或补造动作。报告校验编码帧数/时间戳及源PNG哈希。视频白底合成及RGB→YUV转换另行声明，原PNG仍是像素证据；保留原Playwright VP8录屏以便检查编码差异。

`audit-core-native-package.mjs` 的新动态顺序实验必须同时显式提供 `--front-dynamic-order-plan <批准计划> --front-dynamic-order-plan-sha256 <冻结SHA> --order-baseline-audit <实际r16 Core审计>`，与旧 `--front-order-plan` 互斥。它严格要求Front19个整数order键、native Form/Grid及父组织契约，另加载经原实际审计绑定的r16 MOC，在全部键/中间值/257点Hat网格与三种头Z上逐态比对Core实际顺序：Front位于Lower之后、其他72网格raw order与相对rank保持。合法整数键可能使两者之间插入其他原层，紧邻情况、插入ID及发生参数另行报告供真实穿插检查，不擅加“永远紧邻”门槛。不猜测Core对小数drawOrder的取整规则；旧默认和恒定StageB门槛不变。此验证只证明顺序契约，不授予视觉通过。

v8 的原生画布是 971×1620，72 个 P0 部件、17 参数、6 组物理；没有铃铛，`ParamFSScarfSway` 仅控制围巾下圈。旧侧身版本文件保留，v8 生成物写入独立目录。先按新规格生成草稿与 CSV：

完整模型诊断默认严格要求 72 个原 ID。若同一上臂生产层拆为前后两个网格，`capture-fullbody-rig-diagnostic.mjs`、`capture-fullbody-playback.mjs` 和 `diagnose-workspace-wip.mjs` 可显式传入 `--drawable-map <JSON路径>`：`schemaVersion:1`、`characterId:"forest-spirit-front-v8"`、`sourceLayerCount:72`、`drawableCount:73`、`sourceMetadataSha256` 和完整 `sourceToDrawables`。唯一允许的新增映射为 `Arm_R_Upper:["Arm_R_Upper","Arm_R_Upper_Front"]`，其他 71 项仍为 `[原ID]`；缺源、重复或任意其他新增网格都会失败。报告保存映射文件及工具哈希，连续播放逐帧核对全部 ID。此声明只规定应当出现哪些网格；真实来源、分片互斥与并集、UV、共享边和原生导出仍需独立审计，不能据此自动批准模型。

`audit-core-native-package.mjs` 默认仍要求 Front 的 500 恒定绘制序位于 BraidTie 后、Bangs 前。已审定的侧发遮挡修复必须同时传 `--front-order-plan <冻结JSON>` 与 `--front-order-plan-sha256 <SHA256>`，并保留 `--drawable-map`、`--source-metadata` 和 `--verify-masks`。该显式入口只接受 `Hair_Side_R → Arm_R_Upper_Front → Hair_Side_L`、恒定 500、无动态绘制序键的计划；计划哈希会写入报告并参与输入不变检查。它不修改历史报告，不放宽中性、UV、纹理、拓扑、源对应或视觉门槛。

```powershell
node scripts/manual/forest-spirit/author-motion-drafts.mjs --spec doc/design/forest-spirit/production/front-v8/layers.json --output-root output/forest-spirit-production-v2/front-v8 --csv-template output/forest-spirit-production-v2/validation/editor-default-parameters.csv
node scripts/manual/forest-spirit/author-physics-draft.mjs --spec doc/design/forest-spirit/production/front-v8/layers.json --output-root output/forest-spirit-production-v2/front-v8
```

草稿为真实 motion3 / physics3 格式，但没有创建形变绑定，也不是 Editor 导出。CSV 来自已实际导出的表头，空 GUID 用于新的无绑定模型；四动作 60fps、6 / 1.8 / 0.3 / 0.55 秒，必须在真实绑定后导入 Editor、调试、保存 can3 并重新导出。生产 PSD 必须等真实美术通过检查，头部阶段只能使用明确标注的诊断 PSD：

```powershell
node scripts/manual/forest-spirit/build-production-psd.mjs --spec doc/design/forest-spirit/production/front-v8/layers.json --output-root output/forest-spirit-production-v2/front-v8 --stage head-stage --revision v1 --metadata output/forest-spirit-production-v2/front-v8/face/head-stage.metadata.json
```

组装保留逐层原始 RGBA、层名、稳定 ID、显隐和相同原点，写入后回读校验；临时合成层只能出现在诊断 PSD。逐层像素一致不代表 Cubism 堆叠、补画质量或实际姿态已通过。`--spec` 指向新版本时必须明确 `--output-root`，不能覆盖旧根目录。

从仓库根目录运行（仅使用已有本地 SDK 和 Vite，不安装、不下载、不付费）：

```powershell
node scripts/manual/forest-spirit/prepare-runtime.mjs --sdk output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5 --toolchain output/live2d-proof-20261105
node --test scripts/manual/forest-spirit/asset-preflight.spec.mjs
```

输出为忽略目录 `output/forest-spirit-runtime/`：官方 Core、打包的 Framework + 适配器、原版 GLSL、许可文件以及每个文件的 SHA-256 清单。固定 SDK `5-r.5` 与 Framework revision，不从第三方 CDN 加载 Core。构建脚本不把任何文件复制进网站、不改部署配置、不启用 feature flag。部署人员需要确认适用许可后将整个目录作为同源静态资源提供，保留 `shaders/` 相对位置，并在已审核的资源清单中填写 `coreUrl` 和 `runtimeModuleUrl`。当前没有执行部署或商业授权判定。

真实模型交付必须包括 model3 引用的 moc3、纹理和非空 physics3；四个独立、实际含参数曲线且内容不同的动作 `idle` / `hover_greet` / `drag_hold` / `put_down` 必须既出现在 model3 的 Motions 中，也由产品清单给出同源完整路径。动态变化的动作曲线不允许与物理输出控制同一参数；该版本由动作文件拥有眨眼与呼吸，不额外叠加自动眨眼或呼吸控制器。物理输出、动作参数必须在实际 moc3 中存在。文件检查不代表动作或人物视觉验收。

运行时最多 30fps，后台/隐藏暂停 RAF，reduced-motion 保持中性静帧，恢复不追赶暂停期间时间；DragHold 禁用动作与参数曲线的淡出，结束后保持最终帧，作者必须提供真正的持起末帧，Hover 与 PutDown 完成后回 Idle。支持中止加载、WebGL 丢失报错及实例资源销毁。Core/Framework 初始化共享；R5 的 ShaderManager 缺少公开的按 GL 释放接口，因此只在独立运行时中封装固定版本 `_shaderMap` 清理，升级 SDK 必须重新审查该兼容点，不调用全局 Framework.dispose。SDK 导出的静态中性曲线可与物理输出重合，物理拥有最终值；真正变化的动作曲线与物理输出重合时拒绝加载。

构建同时执行独立 TypeScript 检查，包含适配器和 SDK 源码；由于官方 Framework 的类型与继承字段约定，使用 SDK 兼容的 `strict:false` / `useDefineForClassFields:false`，不是用 Vite 转译替代类型检查。Next 应用侧 wrapper 仍受项目严格检查。

可在构建后运行 `node scripts/manual/forest-spirit/serve-technical-diagnostic.mjs`，打开 `http://127.0.0.1:4189` 查看官方原版 Haru 的独立技术诊断。只绑定本机，不读取密钥、不调用服务、不挂入产品；页面明确注明不是用户角色，四通道映射仅用原版四个不同动作验证播放器，不能用作正式悬停/拖动/放下动作交付。

服务运行时可另开终端执行 `node scripts/manual/forest-spirit/verify-technical-browser.mjs`；它使用已安装的 Playwright 浏览器库进行本地 headless Chromium 检查，不调用测试运行器或 CI，不下载浏览器。JSON 与截图写入 `output/forest-spirit-runtime/technical-evidence/`，明确记录 SwiftShader 软件 WebGL，不能据此宣称硬件性能达标。完成后结束诊断服务。

测试范围应分开记录：资源规则单元测试不证明 WebGL；真实技术模型播放不证明正式角色；正式模型缺失时不得记录正式四动作、物理或视觉验收通过。

`diagnose-workspace-wip.mjs` 的隔离工作台入口使用 `ForestSpiritResourceHost` 读取 `/__forest_wip/review-candidate.json`，随后通过共用的 Core 脚本加载、runtime import 和实例生命周期启动真实模型。候选固定为 `status:"diagnostic-candidate"`、`productionApproval:false`、视觉与命中轮廓 `approved:false`；正式 `ForestSpiritHost` 与官方工厂仍拒绝该候选。诊断不预注入 Core，报告分别记录 manifest 请求及 Core→runtime→model 的实际加载顺序。四动作引用仅组合到明确标记的本地诊断 routing 副本，原始 Editor 文件保持不变；业务读取仍为 fixture，不能等同正式资源已批准或后端验收。

v8 中性截图使用独立的 `createNeutralDiagnosticRenderer`，固定 971×1620、DPR 1、fit 1，并将真实 moc3 参数设为其默认值；不加载、推进或稳定化动作和物理。产品工厂继续使用 fit 0.96 和完整四动作 / 物理检查。诊断允许真实小样没有动作和物理文件，但必须有实际 moc3 与纹理，而且模型画布必须匹配原生尺寸。实际 Editor 导出之后才运行：

```powershell
node scripts/manual/forest-spirit/prepare-runtime.mjs --sdk output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5 --toolchain output/live2d-proof-20261105 --out output/forest-spirit-runtime/front-v8
node scripts/manual/forest-spirit/capture-neutral-diagnostic.mjs --spec doc/design/forest-spirit/production/front-v8/layers.json --output-root output/forest-spirit-production-v2/front-v8 --model <真实导出的model3.json路径>
```

捕获命令只启动临时本机服务器，完成后关闭，写入 PNG、真实资源哈希和状态报告；两次中性绘制必须相同。它不会渲染参考 PNG、复用 Haru，或启用产品。生成截图仍需与原图进行像素/视觉检查，不能据截图存在就宣称模型或动作验收通过。

完成真实眼睛绑定后，可在上述捕获命令追加 `--eyes --capture-id eyes-r1`。工具采样默认中性及双眼、仅左眼、仅右眼的 0 / 0.25 / 0.5 / 0.75 开合值，共 13 个状态，随后还原中性并验证像素完全复原。每态都枚举实际 Core 参数和 Drawable，记录透明度、纹理索引与对应 PNG、顶点数、原始顶点坐标/哈希及相对中性位移；缺失参数不会通过 Framework 的虚拟索引机制补出。初次无绑定模型的扫值失败属于真实诊断结果，不能改写为通过。

若另行获准检查第三方程序导出的研究草稿，必须显式追加 `--export-origin program`；报告与扫值证据会标记 `officialEditorExport:false`。这不会绕过官方 Core 一致性检查，不代表 Editor 兼容，更不会把产品 manifest 改为 ready。正常官方导出保持默认 `--export-origin editor`。

增量绑定后还可用 `node scripts/manual/forest-spirit/compare-core-packages.mjs --baseline <原官方model3路径> --candidate <新官方model3路径> --out output/forest-spirit-production-v2/front-v8/validation/<独立对照目录>` 检查实际 Core 中的参数、Drawable、默认顶点、UV、三角索引与纹理 PNG。该检查独立于渲染截图；UV/纹理/拓扑或默认姿态差异会失败，不以“能打开”代替保真验收。

默认要求六个眼部 Drawable ID 与层 ID 相同：`Eye_L_Open` / `Eye_L_Closed` / `Eye_L_Cross` 及对应右眼，并核对 `Brow_L` / `Brow_R` / `Nose` / `Mouth` 在扫值时不变。若 Editor 使用自动 ID，请从实际导出的对象表取得映射，再通过 `--drawable-map <JSON路径>` 提供 `{ "left": { "open": "实际ID", "closed": "实际ID", "cross": "实际ID" }, "right": { ... }, "preserve": ["实际眉/鼻/嘴ID"] }`；不得猜测 ArtMesh 序号。结构检查通过仍保持 `visualAcceptance:false`、`productionApproval:false`，需实际看全闭帧是否只有干净弧线且没有睫毛。扫值检查失败退出 2，加载或捕获错误退出 1；每次迭代使用新的 `--capture-id` 保留失败证据。
