# 局部编辑与选区恢复验证

日期：2026-11-09，北京时间。本轮接续图片方向、比较和款式保存恢复，完善局部重绘、擦除、移除背景的编辑连续性。导航与织芽继续沿用已确认方案；本轮额外修复回归中实际发现的工作区首次恢复错误。

## 实现与复现依据

- 局部重绘的笔触此前只保存在编辑器内存中，刷新会保留说明但丢失选区。现在通过既有本机草稿仓库保存笔触、画笔与图片尺寸，按账号、项目和图片隔离。正常关闭、重新打开与刷新均可恢复；清空后不恢复旧选区。格式无效或图片尺寸改变时不套用旧选区。
- 提交前读取已有持久操作，连续点击共用提交锁。上传和任务确认期间，选区、说明与工具保持锁定；重试使用原操作编号及原蒙版。刷新只提供确认或重试，不自动提交。旧版局部重绘入口也接入绘制锁定。
- 绘制手势只接受一个活动指针。第二触点不抢占；失焦、取消、捕获丢失和卸载释放手势。坐标限制在画布内；锁定同时约束指针和撤销、清空、中央选区命令。
- 原图读取失败可在编辑器内重试。选区上传失败明确说明保留选区与修改说明，不再显示“原图直传失败”。
- 原图显示“查看编辑结果”“对比编辑结果”，派生图片显示“返回来源图片”“对比来源图片”。比较候选合并同批结果、来源图和派生版本，并按资产去重。用户明确打开新图，完成任务不会自动切走正在编辑的原图。
- 局部重绘、擦除和变体编辑隐藏重复的底部工具栏，保留返回图片。历史模式仍提供原有工具。选区图片限制高度，桌面和320px视口的选区说明均完整可见。

浏览器进一步复现了一处草稿假冲突：旧白板记录与原基线只有视野、选中对象和记录排序差异，任务完成后却与新增结果冲突。现在对白板草稿只比较真实文档内容，忽略会话视野及键顺序；持久化仍保留原始会话数据。内容等同原基线的旧记录不覆盖新结果，正常写入按记录修订清理。真实的对象或文字修改继续保留冲突；技术包表格原有的行身份规则保持有效。

最终扩展回归还发现款式页刷新时的页面恢复错误：账号先于工作区恢复，条件渲染的离线提示外框与服务端页面不一致。两项组件测试在修复前稳定失败；连接提示外框改为稳定结构后，验证页面节点、输入内容、光标、焦点均保留，登录后的离线提示及退出后的清理正常。没有通过忽略浏览器错误或隐藏警告绕过问题。

## 定向验证

前端 **13 个文件、100 项单元测试通过**，分两批运行：图片编辑、命令、本机草稿、款式和交付表单共82项；工作区恢复、目录偏好和共享交互共18项。新增的两项工作区恢复测试有明确的修复前失败、修复后通过记录。

本阶段先前已运行 Worker `image-edit.spec.ts` 两项检查，覆盖透明结果有效性和扩图原图像素保护；本次接续没有修改该处理器，也没有重复运行。它们不证明供应商的生成质量。

最终 Chromium 浏览器 **45 个不同用例全部通过，单 worker，耗时5.1分钟**。中间一次34项运行有32项通过、2项因页面恢复错误失败；修复后将工作区与织芽纳入同一次完整定向复测，最终全绿。更早的27项检查曾发现短屏历史工具栏误隐藏，收窄编辑模式后已修复，最终45项中包含该历史回归。重复运行不叠加不同用例数量。

| 测试文件 | 不同用例数 | 验证内容 |
| --- | ---: | --- |
| `image-editing-recovery.spec.ts` | 7 | 1440/320px选区和说明恢复、清空、锁定、原操作重试、选区上传失败、去背景、原图重读与账号隔离 |
| `image-orientation.spec.ts` | 6 | 旋转/镜像、方向草稿、未确认提交、短屏和键盘 |
| `image-comparison.spec.ts` | 9 | 多版本比较、返回继续编辑、历史恢复、两个步骤回执丢失和短屏历史工具 |
| `canvas-style-source.spec.ts` | 5 | 来源主图明确放回、重复确认、权限、实际白板对象缺失 |
| `studio-save-recovery.spec.ts` | 7 | 款式、技术包与商品展示的原操作确认、后续草稿、修订与差异保护 |
| `workspace-chrome.spec.ts` | 11 | 目录开合与偏好、草稿和视野保留、窄屏、离线提示、织芽话语/计时/焦点/去重 |

Web TypeScript 与目标文件 ESLint 通过。根目录 ESLint 输出既有的 Pages 目录定位提示，退出码为0，目标文件没有规则错误或警告。

主要命令从仓库根目录执行：

```powershell
pnpm --filter @fashion/web test src/modules/board/generation/MaskCanvas.spec.tsx src/modules/board/workflow/use-canvas-command.spec.tsx src/components/drafts/draft-repository.spec.ts src/components/drafts/use-persistent-draft.spec.tsx src/modules/board/workflow/workspace-drafts.spec.tsx src/modules/studio/studio-save-recovery.spec.ts src/modules/studio/use-studio-form.spec.tsx src/modules/studio/StyleLibrary.spec.tsx src/modules/studio/TechPackEditor.spec.tsx src/modules/studio/PresentationSets.spec.tsx
pnpm --filter @fashion/web test src/components/WorkspaceChrome.spec.tsx src/components/interactions/shared-motion.spec.tsx src/components/workspace-navigation-preferences.spec.ts
pnpm --filter @fashion/web typecheck
pnpm exec playwright test tests/e2e/image-editing-recovery.spec.ts tests/e2e/image-orientation.spec.ts tests/e2e/image-comparison.spec.ts tests/e2e/canvas-style-source.spec.ts tests/e2e/studio-save-recovery.spec.ts tests/e2e/workspace-chrome.spec.ts --workers=1 --project=chromium
```

## 画面与验证边界

本机生成物位于忽略目录 `output/playwright/image-editing-recovery/`：

- `restored-1440.png`、`restored-320.png`：刷新后恢复的真实浏览器选区与修改说明。
- `result-links-320.png`：窄屏原图、编辑结果与比较入口。
- `compare-1440.png`：来源图与派生结果的比较操作。
- `draft-conflict-before.json`：修复前仅视野变化导致的草稿冲突证据。
- `hydration-before/`：修复前两个浏览器失败的截图、上下文和轨迹。

上传测试在浏览器实际绘制并导出PNG，解码验证尺寸600×800与原图一致，保护区域不透明、中央选区透明。关闭、刷新前后选区画布像素一致。前端约束验证不替代后端的图片处理和存储检查。

**受控结果复用同一张原始服装图片。** 比较截图用于证明版本入口、结果定位和往返流程，不能作为局部重绘、擦除或移除背景效果的证据。测试模拟服务端已接受但回执丢失，并验证原操作重试、单次蒙版上传、请求去重和原图字节保留；真实PostgreSQL、Redis、MinIO和供应商链路本轮未验证。

桌面和320px为Chromium浏览器视口；多指、失焦和捕获中断由组件事件验证，尚非实体手机测试。本轮没有新增循环动画或重新测量100对象白板帧率，既有性能数字不计入本轮结论。界面继续沿用平台当前浅色主题。

公开参考沿用[能力对照](lovart-capability-review.md)中同日官方页面证据。先前再次访问超时，没有新增登录后能力或生成质量证据。未调用付费服务，未运行全仓检查或CI，未提交、推送或部署。整体产品目标仍在进行中。
