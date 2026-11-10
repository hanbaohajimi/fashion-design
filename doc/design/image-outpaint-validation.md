# 扩图操作、参考输入与真实链路验证

日期：2026-11-09。承接[生成参考排队与重试恢复](generation-reference-recovery-validation.md)。本轮调整扩图前端操作，并验证扩图转换为局部重绘后的参考、蒙版、真实文件和重试一致性。未调用付费模型、启动生产 Worker、提交推送或运行全仓检查/CI。

## 复现与修正

后台先复现三个故障：空结构化参考列表与带用途的参考列表在扩图转为局部重绘时被参数校验拒绝；旧数组中的第一张图仍指向未扩展原图。现在局部重绘请求允许结构化参考，扩图准备统一替换原图别名，实际上传的第一张图为扩展画布，其余参考保留用途、强度和顺序。API重复签名、Worker标准化原图时同步更新旧数组与结构化别名。

浏览器初次检查发现：600×800原图作为默认扩图尺寸既没有扩展区域，也未达到最低像素要求；桌面操作点约22px、320px宽屏只有约12px；进入其他工具后回到尺寸工具会重置范围，刷新也丢失扩图要求。

本次改为：

- 默认计算包含完整原图的四周留白范围，边长按16px对齐；普通原图进入时即可继续设置。超限原图明确要求先缩放，不暗中缩小原图。
- 参数两列排列，提供“四周留白”和“原图居中”；数字完成输入后对齐并限制在原图边界。尺寸太小、过长、无扩展或原图超过上限，在提交前给出中文说明。
- 拖动点实际点击范围固定44px；原图可用方向键移动1px，Shift为10px，边界每次调整16px，Shift为64px。
- 拖动只认一个活动指针，其他指针不能结束或改变它；Escape、失焦、指针取消及捕获丢失撤回本次拖动，卸载清理监听。边界拖动固定原图左上角，避免自动适应窗口造成画面漂移。
- 数字输入与拖动的交接先提交输入，再读取拖动初始范围；已有复现用例证明新输入不被旧闭包覆盖。
- 扩图方式、范围、提示词按现有账号/项目/图片草稿范围保存，关闭前写入；重新进入工具不重置。刷新只恢复输入，不生成新任务。
- 提交中、回执待确认时锁定参数与画面手势，重试沿用原任务编号。任务提交后保留可继续使用的扩图参数。
- 参数区独立滚动、生成按钮固定在侧栏底部。320×568短屏输入聚焦后完整进入可视区域，避免文本框被底部动作区挡住。

## 真实应用链路

`generation-references.integration.spec.ts` 新增正常扩图、签名过期扩图、失败后重试扩图三个场景。当前共12项（既有8项队列/私有文件场景、1项数据库权限，加本次3项）。测试使用真实本地数据库、独立Redis队列、MinIO及Amux请求组装，供应商传输和返回图片受控。

扩图场景原图为256×256半透明RGBA，放入1024×1024画布的(128,256)：

- 实际 multipart 第一张图为扩展画布，面料/细节参考为第二、三张，角色与强度保持正确。
- 蒙版与扩展画布尺寸一致；新增区域alpha为0，原图区alpha为255。
- 最终存储图中的原图区域逐像素恢复RGBA，包括半透明值；周围使用受控新画面。没有将此受控图当作真实生成质量证据。
- 失效签名实际返回HTTP403后，执行时重新获得有效地址，输入字节正确。
- 重试中把母图记录改为其他URL，第二次仍使用接纳时的原图文件，最终仅一份结果、计次一次。
- 临时扩展图与蒙版按既有机制回收，测试清理自身的用户、项目、队列和文件。

## 定向检查

本轮不同检查数量如下；重复运行不累加：

| 范围 | 数量 | 证据与限制 |
| --- | --- | --- |
| API生成服务、Amux组装、参考实际链路、局部重绘实际链路 | 109 | 四个目标测试文件通过，含本次三条扩图实际链路 |
| Worker图片编辑、生成处理器、地址更新与实际队列/存储 | 95 | 四个目标测试文件通过；不启动生产消费者 |
| 前端扩图几何、查看手势、工作区草稿及本机恢复 | 30 | 四个目标测试文件通过 |
| 单worker浏览器功能与录屏 | 29 | 11条扩图、5条编号意见、6条方向编辑、7条局部编辑恢复；最后修正后扩图11条单独重跑 |
| 单独性能测量 | 2 | 原图定位与边界调整；原生时钟、无录屏和trace |

AI包构建、API/Worker/Web包类型检查与目标文件ESLint通过。根目录ESLint打印已有Next Pages目录定位提示，进程退出0且未报告目标文件规则问题。没有据此替代全仓检查。

新增前端测试先复现小操作点、短屏文本框遮挡以及输入后拖动覆盖新尺寸，再针对修正重跑。初期测试对自建Select误用原生select操作，已改为实际radio控件；该错误属于测试入口假设，不计为产品故障。

主要命令：

```powershell
# apps/api；读取本地环境但不输出密钥
node --env-file=../../.env.example --env-file-if-exists=../../.env node_modules/vitest/vitest.mjs run src/modules/ai/providers/amux.adapter.spec.ts src/modules/generation/generation.service.spec.ts src/modules/generation/generation-references.integration.spec.ts src/modules/generation/inpaint-pipeline.integration.spec.ts --no-file-parallelism
# apps/worker
node --env-file=../../.env.example --env-file-if-exists=../../.env node_modules/vitest/vitest.mjs run src/processors/image-edit.spec.ts src/processors/image-edit.integration.spec.ts src/processors/generation.processor.spec.ts src/processors/generation-image-sources.spec.ts --no-file-parallelism --testTimeout 20000 --hookTimeout 20000
# 仓库根目录
pnpm --filter @fashion/web exec vitest run src/modules/board/workflow/image-outpaint.spec.ts src/modules/board/workflow/image-viewport.spec.tsx src/modules/board/workflow/workspace-drafts.spec.tsx src/components/drafts/use-persistent-draft.spec.tsx --no-file-parallelism
pnpm exec playwright test tests/e2e/image-outpaint.spec.ts tests/e2e/image-editing-recovery.spec.ts tests/e2e/image-orientation.spec.ts tests/e2e/image-comment-markers.spec.ts --workers=1
```

## 画面与流畅度

生成物均在忽略的 `output/playwright/image-outpaint/`：

- `final-1440.png`、`final-320.png`：桌面与窄屏当前界面。
- `short-touch-320.png`：320×568短屏输入与生成入口。
- `tour-1440.webm`、`tour-320.webm`：实际界面操作和重新打开恢复，未提交生成请求。
- `performance.json`：原图定位拖动；`boundary-performance.json`：边界调整。

本机60Hz、1440×900、100对象白板仍挂载（30图片/60便签/10色卡）、600×800受控来源图。每段采样30秒：

| 情况 | 平均fps | >33.3ms帧比例 | 输入事件至下一帧P95 |
| --- | --- | --- | --- |
| 扩图静置 | 59.97 | 0.056% | — |
| 原图定位拖动 | 59.60 | 0.224% | 1.70ms |
| 扩图边界调整 | 59.70 | 0.056% | 1.40ms |

两种操作均满足平均≥58fps、长帧<1%的本轮目标。输入至下一帧不等于显示器实际呈现延迟；本机Chromium和受控图片结果不代表所有设备、最大尺寸图或真实手机软键盘。

## 仍需验证

浏览器编辑夹具的派生结果复用原图字节，仅证明请求、重试、草稿和布局；实际扩展画布、蒙版与最终RGBA保护由另一组真实本地链路验证。真实模型对扩展背景、光线衔接、服装边缘及参考用途的理解仍未验收。普通参考没有新增永久字节副本，旧任务和外部参考的长期恢复边界沿用前轮记录。

本轮通过助手远程网络访问Lovart，未返回可核验正文，没有使用本机访问该网站，也没有新增官方能力或产品对等结论。整体优化目标继续进行，语义分层、图片内文字编辑、真正的细节增强，以及跨模块实际产物质量仍需分别建立证据。
