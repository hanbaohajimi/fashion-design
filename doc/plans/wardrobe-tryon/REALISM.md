# 衣架材质与真实服装比例返工

记录日期：2026-10-30。本文补充本轮质感返工的实现、素材及验证边界；前一轮业务链路见 [IMPLEMENTATION.md](IMPLEMENTATION.md)，原视频理解见 [VIDEO-REFERENCE.md](VIDEO-REFERENCE.md)。

## 本轮目标与结果

用户要求衣服、挂具和杆子的呈现接近参考视频中的真实材质，并保留森织系统的整体界面风格。只验证几何占位图，或者只把测试图片换成照片，均不能充分证明这一要求得到处理。本轮同时调整实际渲染、透明素材尺寸计算、挂点预览和草图生成候选的生产提示。

独立视觉复核结论为：**通过本轮限定的渲染材质与所测素材验收**。这表示所测真实 T 恤、木衣架和金属杆已达到与参考视频同类的真实感，不是原作逐像素复刻声明，也不代表所有服装品类或生成模型已通过验收。完整意见保存在 `output/wardrobe-realism/final-review.md`。

## 渲染与挂点修正

| 部位 | 最终处理 |
| --- | --- |
| 银色圆管与墙座 | 杆体增加圆柱高光、暗部反射和接触阴影；两端墙座具有厚度、连接部和固定细节。避免只用一条平面灰线表达承重杆。 |
| 胡桃木挂具 | 独立 SVG 表现木纹、肩部厚度、边缘光和金属挂钩。木架主要位于衣领后，尺寸随真实服装主体计算；挂具仍是 UI，不进入服装原图或试穿参考图。 |
| 挂点对齐 | 修正 SVG 静态定位受按钮文字对齐影响而产生的横向偏移；统一杆、挂钩及各挂具的坐标基准，再用单品挂点定位图像。 |
| 透明留白与服装比例 | 使用真实 alpha 主体边界计算服装显示尺寸和挂具比例，不以包含透明边距的整张 PNG 宽度代替衣服宽度。原图不裁剪、不拉伸、不调色。 |
| 短上衣高度 | 普通衣架视图的 `top` 主体高度上限为 190 px，按等比缩放同时满足宽高限制；聚焦大图使用独立上限。此值用于当前短上衣场景，不能推断长衣或其他品类已经校准。 |
| 名称位置 | 标签随实际可见下摆位置更新，响应尺寸变化；避免图片透明留白使标签远离衣服。 |
| 挂架预览 | 复用同一服装与挂具渲染，按服装 alpha 主体与挂具的联合范围整体缩放、居中；调整挂点后重新计算，不分别挪动衣架和衣服来掩盖错误。 |

关键实现为 `GarmentDisplay.tsx`、`RackHardware.tsx`、`WardrobeRack.tsx`、`GarmentMountPreview.tsx` 及同目录样式，均位于 `apps/web/src/modules/studio/wardrobe/`。预览只帮助核对当前候选和挂点，不创建生成任务，也不代替明确确认入架。

## alpha 边界契约与兼容

共享契约新增可选 `WardrobeImageBounds`，修订视图字段为 `imageBounds`：

```ts
{
  width: number;
  height: number;
  x: number;
  y: number;
  contentWidth: number;
  contentHeight: number;
}
```

所有值均为原图像素：`width`、`height` 是整图尺寸，其余值是 **alpha > 16** 像素的最小包围盒。服务端确认时实际读取私有图片并计算，将结果写入既有修订 `payload` JSON，随固定搭配快照保留。无 alpha、完全不透明或没有超过该阈值的可见主体均拒绝；原始图像字节保持不变。这个检查只验证图片及主体范围，不判断服装结构是否完整。

为候选预览和历史修订提供只读接口：

```text
GET /projects/:projectId/wardrobe/assets/:assetId/bounds
```

响应直接为上述边界对象。每次请求先验证项目读取权限、素材属于当前项目且未归档；无权访问返回 403，项目／素材缺失、跨项目素材或已归档素材返回 404，不符合有效透明主体要求返回 400。有限的 64 项进程缓存合并同素材并发读取，失败条目移出缓存；命中缓存仍重新检查权限与素材状态。

前端通过已确认元数据或按需 GET 取得边界。候选就绪及旧修订缺少字段时才补齐，不依赖浏览器跨域 canvas 读取私有签名图片；失败时保留既有整图显示。服务端 summary 不逐轮读取全部大图。GET 不创建任务、不生成素材、不写入修订。

旧修订缺少 `imageBounds` 仍可使用。本轮边界信息存入现有 JSON，**无需新增数据库迁移**，也不改写已经应用的迁移。

## 真实照片对照与来源

最终密集陈列样本使用三款透明、无人台、正面真实服装照片：黑色 CREAM 印花 T 恤、麻灰 T 恤、白色 T 恤。十个显示位置由这三款原图重复组成，**不是十个独立款式**。缺少合适的白色印花 T 恤和深绿宽松圆领卫衣仍作为缺项保留，没有使用不透明预览、荧光色或连帽款替代。

| 参考 | 原图与来源 |
| --- | --- |
| 黑色印花 T 恤，1200 × 1200 | `output/wardrobe-realism/matched-candidates/tshirt_PNG5446.png`；[PNGimg 来源页](https://pngimg.com/image/5446) |
| 麻灰 T 恤，893 × 1024 | `output/wardrobe-realism/public-reference/tshirt_PNG5448.png`；[PNGimg 来源页](https://pngimg.com/image/5448) |
| 白色 T 恤，1443 × 1520 | `output/wardrobe-realism/public-reference/tshirt_PNG5435.png`；[PNGimg 来源页](https://pngimg.com/image/5435) |

精确下载 URL、尺寸、alpha 检查、文件 SHA-256、署名及许可记录在 `output/wardrobe-realism/manifest-matched.json`；初期较广的候选清单在 `output/wardrobe-realism/public-reference/manifest.json`。站点标示许可为 [CC BY-NC 4.0](https://pngimg.com/license)，未识别原始摄影师。图片仅保存在忽略的 `output/` 中用于本地视觉对照，未调色、未伪造印花或标识，不随产品打包发布，也不作为用户项目资产入库。

独立审查截图目录为 `output/wardrobe-realism/review-v5/`；最终输出在 `output/wardrobe-realism/final/`，最后仅减少窄屏邻近位移以保留边缘服装空间，已重新录屏和复测。`references.json` 记录清单来源、3 款／10 位重复、原图未修改及供应商调用为 0。独立审查直接查看了其中六张图：

- `real-scene-default.png`：默认密集侧挂场景。
- `real-scene-black.png`：黑色印花 T 恤转正及杆、钩、衣领关系。
- `real-focus-black.png`、`real-focus.png`：黑色与麻灰 T 恤聚焦细节。
- `real-mobile.png`：手机视图及比例。
- `real-mount-preview.png`：候选挂架预览与挂点校准。

同目录还保留完整页面和其他悬停截图。`final/wardrobe-realism.webm` 是原始浏览器录屏；`final/video-comparison.mp4` 是与用户第二段视频的并排对照（1920×720、30 fps、25 秒）。两侧保持原速、操作时间轴独立，短片段停留末帧；JSON 记录来源及素材说明。已经抽帧核对，不能用早期几何占位录屏替代本轮结论。

## 草图转换的生产提示

`apps/api/src/modules/wardrobe/wardrobe.rules.ts` 仅在 `sourceKind="sketch"` 且用户明确选择 `mode="complete"` 时要求生成照片级独立服装陈列候选：真实织物表面、缝线、自然褶皱与垂坠，表现依据来自原图和附加参考。

提示同时要求严格保留已给廓形、比例、领口、衣袖、门襟、闭合方式、颜色及印花（含原有文字）的内容、尺度与位置；不自行指定未提供的材质工艺，不自编品牌、款式、背面或不可见结构。输出要求有效透明背景，无人物、人台、衣架、杆子及其他陈列道具，不能把挂具烘焙进服装图片。结果明确属于生成转换候选，必须人工对照原设计核对后确认。

`extract` 继续保留草图表达，只提取有依据的结构；原始设计资产始终保留。新增定向规则测试验证条件分支和限制，但本轮没有调用真实生成模型，因此这些提示的实际保真效果仍需独立验收。

## 本轮验证状态

| 检查 | 已记录结果与范围 |
| --- | --- |
| `pnpm wardrobe:verify` | 4 文件、29 项通过：规则 7、像素处理 5、真实数据库／存储集成 14、真实队列及 worker 管线 3。隔离 schema 为 `wardrobe_verify_1793296424356`；日志 `output/wardrobe/verification.log`。 |
| API 类型与 ESLint | `pnpm --filter @fashion/api typecheck` 及本轮 6 个文件定向 ESLint 通过；日志 `output/wardrobe/image-bounds-typecheck.log`、`image-bounds-eslint.log`。 |
| 前端衣架单元测试 | 29 项通过，含边界读取、缓存、旧版本补齐、候选与挂架预览回归。 |
| Web 类型与 ESLint | Web 类型检查与本轮前端定向 ESLint 通过。 |
| Playwright | 12 项通过：10 项衣架交互回归和 2 项材质／真实图片对照。实际 PNG 测试使用本地清单，平台 API 为测试替身，不能替代生产业务验收。 |
| 完整 Web 测试 | `pnpm --filter @fashion/web test`：112 个文件、620 项全部通过。 |
| 完整构建 | `pnpm build`：7 个工作区全部成功，Next.js 生产编译、类型检查与页面生成通过。 |
| 独立视觉审查 | `output/wardrobe-realism/final-review.md`：通过本轮限定的渲染材质与三款实测素材范围。 |

后端新增测试覆盖非对称透明留白、alpha 阈值、原图字节不变、确认与快照存储、旧修订补齐、并发只读缓存，以及缓存后仍拒绝越权和归档素材。现有真实管线继续使用独立 PostgreSQL schema、私有 MinIO、唯一 Redis 队列及实际 worker，调用本机 HTTP 图片替身；本轮外部供应商调用为 0。

本地复查真实材质时设置 `WARDROBE_REALISM_MANIFEST=G:/new-fashion-design/output/wardrobe-realism/manifest-matched.json`，再运行 `pnpm exec playwright test tests/e2e/wardrobe-realism.spec.ts`。可以用 `WARDROBE_REALISM_OUTPUT` 指定输出目录。未提供本地清单时，真实照片案例明确跳过，挂点几何断言仍执行；CI 跳过不能算作视觉验收。无需开启任何生成能力。

## 交接边界

本轮没有修改既有生成／计费／取消管线，没有新增迁移，没有开启默认关闭的收费能力；当前工作区尚未提交、推送或部署。前述原有衣架迁移仍属于基础功能升级要求，本轮“无需新增迁移”不等于新环境可以跳过已有迁移。

视觉结论仅覆盖三款 T 恤及所测桌面、手机、聚焦和挂点预览。长外套、裤裙、连体服、鞋、包、帽和其他配饰仍需逐项以真实素材校准。去背景、草图转换、遮挡结构补全、多件服装生成保真、本人摄像头持续生成及完整生产流程，均不能由照片陈列或本机替身测试推断为已验收。
