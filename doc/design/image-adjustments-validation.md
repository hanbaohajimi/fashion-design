# 图片色彩与明暗验证

日期：2026-11-09（北京时间）。接续编号意见，实现整张图片的直接色彩调整。保留森织现有图片工作区、暖白深绿界面、原始图片及版本来源，不增加模型调用。

## 实现

- 图片工具新增“色彩与明暗”：亮度、对比度、饱和度和冷暖，每项 −100 至 100，0 为原值。支持滑块、数值输入、键盘、查看原图、返回预览和复位。
- 对整张图片生效，不承诺只替换某件衣服或选区颜色。保存沿用 `transform_image`，产生新资产与来源记录，生图额度不增加。
- 预览使用 sRGB 颜色矩阵，保存使用同一矩阵处理直通 RGBA 像素；保留透明度。冷暖采用通道增益，避免向黑色额外加入有色亮度。零值不额外处理像素。
- 执行顺序为 EXIF 正向、原图坐标裁剪、旋转、屏幕轴镜像、缩放、色彩调整。新的 `adjustments` 参数可选，旧尺寸/方向请求继续生效。
- 参数按账号、项目、图片保存本机草稿。关闭前写入快照；刷新恢复，复位不复活旧参数。提交待确认时锁定，重试保留原指令和操作编号。确认成功后清理本次参数，避免在原图上误重复应用。
- 预览只改变作品图片；编号和画面标注在调色模式隐藏，保存不把标注烘入作品。随时查看原图时仍保留正在调整的参数。
- 桌面侧面板与手机下方参数区保持独立滚动，保存操作可见。无持续动画或轮询，拖动使用现有图片工作区和草稿注册机制。

## 验证结果

本阶段 **51 项不同单元/集成用例通过**：

| 范围 | 用例数 | 证明的内容 |
| --- | ---: | --- |
| Worker `image-adjustments.spec.ts` | 14 | 亮度、对比、饱和度、冷暖的已知像素；非法值拒绝、透明度、零值兼容、旋转与实际保存、黑色及亮度最低边界 |
| Worker `transform-image.spec.ts` | 16 | 已有旋转、镜像、裁剪、缩放、EXIF、透明补边回归 |
| Web `image-viewport.spec.tsx`、`image-orientation.spec.ts`、`use-persistent-draft.spec.tsx` | 18 | 手势画框、方向行为、草稿初始化/冲突/清理及 checkpoint 回归 |
| API `image-transform.integration.spec.ts` | 3 | 实际工作流服务、PostgreSQL、Redis、Sharp、MinIO、来源与幂等；新增调色保存的红色转灰像素正确，生图计次保持 0 |

Chromium **22 项不同功能用例全部通过，单 worker，组合运行约 2.1 分钟**：调色 6 项、旋转 6 项、编号意见 5 项、原图片工作区 5 项。随后改善冷暖算法保留黑色，重新执行调色 6 项全部通过（约 33 秒）及 Worker 像素 30 项全部通过；重复用例不累计。

新增浏览器覆盖：

- 1440×1100 桌面、320×900 窄屏、390×650 短屏上的预览、原图比较、保存可见性、横向溢出、新版本及参数清理。
- 关闭/刷新恢复、复位后刷新、无效数值阻止提交。
- 待确认时锁定、刷新后沿用原操作重试、仅产生一个结果。
- 四种已知色块的实际浏览器预览截图与 Worker 保存 PNG 对照，每个 RGB 通道误差不超过 2 个色阶。

浏览器首轮的三个失败经核查属于测试等待/取样问题：恢复后的面板已经自动展开，测试再次点击切换按钮把它收起；命令已进入时实际图片尚未处理完；浏览器截图边界因小数坐标向外取整多 1 px。测试改为等待明确的面板状态与结果，并按归一化色块中心取样，未添加固定延迟或放宽色值容差。

Web、API、Worker 类型检查、共享包构建和目标文件 ESLint 通过。ESLint 沿用既有的 Pages 目录提示，退出码为 0。没有执行全仓检查或 CI。

主要命令：

```powershell
pnpm --filter @fashion/shared build
pnpm --filter @fashion/web test src/modules/board/workflow/image-viewport.spec.tsx src/modules/board/workflow/image-orientation.spec.ts src/components/drafts/use-persistent-draft.spec.tsx
# apps/worker 目录
node --env-file=../../.env.example --env-file-if-exists=../../.env node_modules/vitest/vitest.mjs run src/processors/image-adjustments.spec.ts src/processors/transform-image.spec.ts --no-file-parallelism --testTimeout=15000
# apps/api 目录
node --env-file=../../.env.example --env-file-if-exists=../../.env node_modules/vitest/vitest.mjs run src/modules/design-assets/image-transform.integration.spec.ts --no-file-parallelism --testTimeout=15000 --hookTimeout=15000
# 仓库根目录
pnpm exec playwright test tests/e2e/image-adjustments.spec.ts tests/e2e/image-orientation.spec.ts tests/e2e/image-comment-markers.spec.ts tests/e2e/image-workspace.spec.ts --workers=1
```

## 单独性能测量

2026-11-09 18:23（北京时间），Chromium 145.0.7632.6，无头模式，1440×900视口，600×800 原图；图片工作区覆盖已挂载的 100 个白板对象（30 图片、60 便签、10 色卡）。使用原生时钟与 requestAnimationFrame，各测量30秒；拖动饱和度时没有同时运行其他测试或提交图片处理任务。

| 指标 | 结果 |
| --- | ---: |
| 静止平均帧率 | 60.00 fps |
| 拖动平均帧率 | 59.60 fps |
| 拖动中 >33.3 ms 帧 | 0.17% |
| 输入到下一帧 P95 | 9.6 ms |

达到本阶段目标：平均 ≥58 fps，>33.3 ms 帧少于1%。原始间隔、输入响应、浏览器与设备信息留在 `performance.json`，性能用例单独计为1项，不混入22项功能用例。本次不代表任意图片尺寸、后台负载或实体手机都达标。

```powershell
$env:IMAGE_ADJUSTMENTS_PERF = '1'
pnpm exec playwright test tests/e2e/image-adjustments-performance.spec.ts --workers=1
```

## 画面与证据范围

生成物在忽略目录 `output/playwright/image-adjustments/`：

- `preview-1440x1100.png`、`preview-320x900.png`、`preview-390x650.png`：实际调色预览。
- `desktop.mp4` / `.webm`、`mobile.webm`：真实浏览器调色、比较和保存操作。
- `performance.json`：单独记录的原生帧间隔与输入响应测量。

服装是已有素材，颜色处理实际执行本地算法，没有借用固定“成功图”代替调色。浏览器接口仍为受控夹具；后端另有真实服务—队列—存储验证，二者合起来不等同完整认证 HTTP 页面到存储的验收。

调色属于确定性的整图处理，不代表超分辨率、语义换色、图层分离、图片文字编辑或真实模型质量验证。不同色彩配置、显示器校准和实体手机仍未覆盖；当前沿用平台已有主题。上线需协调发布前端、API、Worker 和共享构建产物，本次保留本地改动，没有提交、推送或部署。
