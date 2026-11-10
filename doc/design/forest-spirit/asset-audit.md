# 森林精灵资产审计

审计日期：2026-11-05。范围：桌面交接包、原角色与细节参考、本次外观修正候选、本机 Cubism、既有 SDK 和旧技术验证资产。前端实现及其运行检查以本次接入报告为准；本文件不把代码单元测试或旧角色播放当成正式角色验收。

## 当前结论

| 层次 | 真实状态 | 可核查证据 |
| --- | --- | --- |
| 参考资料 | 完整。原包 55 个文件已原样归档；28 张参考图，其中 25 张裁图与母图逐 RGBA 像素一致 | [原交接入口](handoff-v1/CODEX_START_HERE.md)、`output/forest-spirit-audit/archive-integrity.json`、`pixel-crop-check.json` |
| 外观修正 | 原先星形 v1 候选已被否定。用户已确认 v2 的小浅色十字、新帽型与服装轮廓，并授权继续拆层准备 | [修正规格](visual-amendment.json)、[已确认透明母图](production/master/forest-spirit-approved-v2.png)、[母图哈希与状态](production/master/metadata.json) |
| 生产美术 | 部分完成：已确认平面透明母图；未完成独立部件、可编辑拆层 PSD、Cubism 导入 PSD 或遮挡补画 | [v2 生产说明](production/README.md)、[逐层交付计划](production/layers-v2.json)、`output/forest-spirit-audit/summary.json` |
| 正式角色模型 | 未制作。没有该角色的 `.cmo3`、`.can3`、`.moc3`、纹理集或四组动作导出；正式 `forest_spirit.model3.json` 入口缺失 | [模型交付目录原始说明](handoff-v1/deliverables/live2d/README.md)、`output/forest-spirit-audit/production-runtime-missing.stdout.txt` |
| Cubism Editor | 本机已存在安装程序和编辑器可执行文件；无需重复安装。旧制作记录为 5.3.04 FREE；本次核查文件存在及安装包签名，未重新运行编辑器建模 | `C:\Program Files\Live2D Cubism 5.3\CubismEditor5.exe`、`output/forest-spirit-audit/local-files.json`、`installer-signature.json` |
| 官方 Web SDK | 本机已存在 `CubismSdkForWeb-5-r.5`、Core 与 Framework。原交接包未内置 SDK；“原包缺失”不等于“本机没有” | `output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5/cubism-info.yml`、`Core/live2dcubismcore.min.js`、`Framework/src/live2dcubismframework.ts` |
| 前端接入 | 本次已制作接入代码与资产门禁；正式角色播放仍被生产美术和导出缺失阻塞。不能使用旧 SproutProof 顶替；资源未就绪时不开启精灵 | [前端接入记录](frontend-integration.md)、`output/forest-spirit-validation/report.md`、`tests/e2e/forest-spirit-assistant.spec.ts` |
| 本次资产检查 | 参考完整性 PASS，检查器单测 7/7，正式模型缺失检查按预期 FAIL；未进行正式角色 Core 或浏览器播放验收 | `output/forest-spirit-audit/check-runs.json`、`checker-tests.stderr.txt`、`summary.json` |

## 已实际查看的图片与视觉结论

本次主 agent 与资产审计实际打开并检查了 `00_approved_board.png`、`01_primary_character.png`、`02_face_master.png`、`04_boots_and_socks.png`、`05_tools_pouch_on_character.png`、`06_tools_pouch_detail.png`，并查看了用户眼部修正附件、透明候选 v1、透明候选 v2，以及旧 SproutProof 预览。

- 原母图为 1254 × 1254 概念板；主角色裁图为 605 × 987，脸部仅 177 × 158。参考图是带场景、遮挡和光照的合成平面图，不能直接重命名为部件或靠放大恢复未给出的细节。
- 主脸为圆润织物面，棕色竖椭圆绣眼，原有小眉毛、鼻子与小嘴。母图主脸没有睫毛；部分辅助表情出现的小外翘线不得照抄。
- 短靴为棕色织物/绒面质感，浅色鞋底缝线、翻口、木扣，搭配乳白罗纹袜。工具袋在观者右侧，棕色缝制袋体、植物刺绣、金色剪刀及纸卷，不能镜像到另一边。
- 用户最初眼部参考已另存为 [原始附件](amendments/star-eyes-user-reference.png)，母图未被改写。后续明确的十字形要求覆盖早先“星星眼”措辞及旧规格内不带亮点的约束，仅在棕眼内部增加指定装饰。
- v1 可见多射线星形，用户已否定，不可继续拆层。v2 可见棕眼内的浅色 `+`，低圆顶短波浪帽檐和短披肩/花瓣裙片；未见明显睫毛，保留小眉毛。用户已明确确认 v2，可继续拆层准备。其织纹、袋面刺绣、靴子细节和局部比例经过生成重建，不是逐像素仅改眼饰；批准的是此 v2 外观，不代表已经具备隐藏像素、分层或模型。

## 需求优先级与未决事项

[visual-amendment.json](visual-amendment.json) 记录本次用户最新要求：已确认 v2 新帽型与衣服轮廓；固定原脸型、棕绣眼、原眉毛、浅金头发、棕短靴、工具袋等角色身份。所有动作与表情仍禁止睫毛。v2 外观已确认，可以继续拆层，无需再次请求同一确认；在实际分层补画完成前不能宣称已绑定或导出正式模型。

眼内十字必须是两笔交叉的浅色缝线 `+`，不是五角星、六/八射线星芒或发光效果。建议增加独立 `Eye_L_Cross`、`Eye_R_Cross` 部件，随对应棕色开眼形变，始终处于眼内。闭眼时十字与棕色开眼形共同消失，使用原规格的独立 `Eye_L_Closed`、`Eye_R_Closed` 干净弧线；不能残留眼饰、开放眼椭圆、外翘短线，也不能用贴肤色矩形盖住眼睛。

原始 `layers.manifest.json` 的 69 层（66 个 P0、3 个可选 P2）是生产计划，未绘制完成。独立 [v2 清单](production/layers-v2.json) 已按批准图规划 76 层（73 个 P0、3 个 P2）：增加左右十字、短腰片与裙瓣，移除旧尖帽 `Hat_Tip`，将帽冠与橄榄绿衣片改为低圆顶帽冠和上身结构。这些全是待交付像素计划，不是实际拆层。原包保持不变以维持审计哈希可比。

## 下一环节的具体交付要求与阻塞原因

1. **已完成：归档批准的透明母图。** v2 已获用户确认，原像素复制为 `production/master/forest-spirit-approved-v2.png`，实际尺寸、alpha 范围和 SHA-256 见同目录 `metadata.json`。它是全身平面透明图，不是分层文档。3072 × 4096 是原方案建议尺寸，不是现有母图尺寸，也不能把放大称为重绘完成。
2. **补画与真实拆层。** 交付可编辑 `forest_spirit_separation.psd`、RGB/8 bit/sRGB 的 `forest_spirit_import.psd`，以及按需交付同画布对齐 PNG 部件和图层顺序/来源说明。需补完整无五官底脸、帽檐后的额头和发根、发丝遮挡下的耳颊颈部、抬手后的袖内及躯干、袋后衣服、袋内被遮挡的剪刀和纸卷、裙下腿袜与靴口连接。新帽弧面与新衣片按审定图拆开，蕾丝、发丝、铃铛绳、带子不带场景边缘。部件复合图应能还原母图；浅、白、深绿背景检查透明边缘。
3. **Cubism 真实建模。** 在编辑器中完成真实 ArtMesh、变形器、头身及呼吸参数、左右开闭眼与独立十字消隐，保持眉毛与五官不漂移；帽/发/铃铛/围巾/裙片/袋子分配合适物理输出。剪刀、木扣和纸卷保持刚性，袋口在正确绘制层级遮住工具下端。交付 `.cmo3` 与动作工程 `.can3`，记录实际 Editor 版本与许可模式。不能将文字参数表当作绑定成品。
4. **四组 P0 动作与真实导出。** 至少导出 `Idle`、`Hover`、`DragHold`、`PutDown` 四组 `.motion3.json`，加真实 `forest_spirit.moc3`、`forest_spirit.model3.json`、纹理、`.physics3.json` 与 `.cdi3.json`。Idle 原建议 6 秒低幅呼吸；Hover 约 1.8 秒单次回应；DragHold 约 0.3 秒进入提起姿态；PutDown 约 0.55 秒落定。这些时长是制作建议，当前没有对应正式导出。新帽无尖顶时需重新设计其局部动作，不能声称旧参数已适配。
5. **正式模型播放与交互验收。** 执行 Core 一致性检查及真实网页渲染，输出开/闭眼、十字消隐、四动作、脸/鞋/袋、透明边缘、桌面和移动尺寸证据；检查悬停一次、左键打开既有完整对话且隐藏精灵、长按拖动不误点击、关闭后位置与会话恢复、失焦取消、不可见暂停、加载失败可回原助手，以及卸载后的资源释放。不得把整张 PNG 的 CSS 运动或其他角色 SDK 样例算为通过。

目前首要阻塞是真实分层/遮挡补画缺失；外观确认已经完成。Cubism 与官方 SDK 已在本机，安装不是当前阻塞；能够继续完成前端桥接、缺失资源处理与交互逻辑，但这些工作不能替代美术和 Cubism 绑定。

本次新增的 `apps/web/public/live2d/forest-spirit/asset-manifest.json` 是状态门禁，内容为 `awaiting-production-assets`、`flatMasterApproved: true`、模型 `visualReview.approved: false`。它不是 Cubism 的 `.model3.json`；前端模拟运行时测试用于验证交互契约，不构成真实模型播放结果。最新具体测试数量与证据以 [前端接入记录](frontend-integration.md) 及本地验证报告为准。

## 旧 SproutProof 的明确边界

`output/live2d-proof-20261105/` 保留先前技术验证：`SproutProof.psd`、`.cmo3`、`.can3`、16,128 字节 `.moc3`、纹理及 `Recorded.motion3.json` 实际存在，旧报告记录 Core 一致性和浏览器播放等 10 项通过。当前已重查文件及其 SHA-256；没有重跑该旧浏览器验证，旧报告不能当作本次新角色结果。

实际打开 `source/sprout-preview.png` 后确认它是红发、绿衣、简化四部件的另一形象，没有用户确认的浅金发织物精灵、棕靴、工具袋。它只证明曾有过编辑器到网页的技术链路，禁止移入正式角色交付路径或默认启用。其 `.model3.json` 只引用 MOC、纹理和显示信息，没有正式四组动作和物理引用；通用引用检查通过，项目严格检查按预期报缺少 `DragHold`、`Hover`、`Idle`、`PutDown`。

SDK 的 `Samples/Resources` 还包含 Haru、Hiyori、Mao、Mark、Natori、Ren、Rice、Wanko。它们是官方样例，不是本角色模型。已存在的安装包签名为 `Valid`，签名者 `Live2D Inc.`；SDK 的版本记录为 `5-r.5`。当前本地文件存在不自动代表未来商业发布的授权状态，发布时仍应按原交接要求核对实际用途与许可；本次未付费购买或部署。

## 实际执行与复核方式

```powershell
python scripts/manual/forest-spirit/audit-assets.py --source "C:\Users\朱奕玮\Desktop\forest_spirit_codex_handoff_v1\forest_spirit_codex_handoff_v1" --output "G:\new-fashion-design\output\forest-spirit-audit"
```

该脚本先比较源与归档的文件集合/字节数/SHA-256，再用 Pillow 比较 25 张裁图实际像素，调用原检查器，并把本机文件哈希及 stdout/stderr 保存至 `output/forest-spirit-audit/`。它只读原包和归档，检查器运行禁用 bytecode 写入，未覆盖桌面原有 `validation_report.json`。

| 实际检查 | 结果 | 范围与限制 |
| --- | --- | --- |
| 原包与归档 | 55/55 个文件完全一致 | 不包含外部新增修正文件 |
| 裁图像素比较 | 25/25 完全一致 | 证明裁图来源，不证明生产美术可用 |
| `check_handoff.py` | PASS，28 张参考图 | 仅参考包完整性 |
| `test_checks.py` | 7/7 通过 | 测试夹具包含刻意的 `NOT_A_REAL_MODEL`，只测试校验器；未复制到交付目录 |
| 正式入口 `check_runtime.py` | FAIL，退出码 1，符合预期 | `.model3.json` 不存在，不能宣称模型完成 |
| 旧 SproutProof `--generic` | `REFERENCES_OK_NOT_CORE_VALIDATED` | 不解析 MOC，不是新模型验证 |
| 旧 SproutProof 项目严格检查 | FAIL，退出码 1，符合预期 | 缺少四组 P0 动作引用，不能代替正式角色 |

生成候选由主 agent 执行，记录在 `output/forest-spirit-art/candidates/`；本资产审计未生成或改绘图片，未使用生产服务、未调用收费 API、未提交、推送或运行 CI。
