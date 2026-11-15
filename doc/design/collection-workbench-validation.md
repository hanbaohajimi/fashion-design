# 系列工作台合并

日期：2026-11-15。

用户确认将“系列规划”合并到“系列工作台”，保留“款式档案”和“商品展示”独立，原有功能与数据继续使用。

## 入口与行为

- 画布“全部功能”只展示一个系列工作台入口，支持搜索旧名称“系列规划”；旧最近使用编号仍对应工作台。
- 工作台内的设计方向、款式规划、系列扩展共用同一个系列。切换分区保留表单，画布关闭重开保留系列、分区、滚动与草稿；切换系列先保护已有修改。
- 方向定义、核心款类型、生成扩展款、参考相似度、PDF导出继续使用原组件与API；核心图上传和从项目第一张设计图创建系列仍可用。
- 款式规划继续维护品类、角色、进度、设计要求、所属系列和确切款式修订。只显示当前系列的位置，保存后立即采用返回的文档，失败或过时的列表读取不撤回已确认修订。
- 旧 `/<projectId>/studio?tab=planning` 地址保留，进入工作台的款式规划分区。图片和导出来源打开的系列也具备同样的三个分区。

## 数据与草稿

没有数据库迁移或删除操作。Collection、COLLECTION_SLOT文档、历史修订、关联的styleRevisionId、候选和导出记录均保留原编号。

已有位置草稿继续使用原账号、项目、`studio:planning`、文档编号；新位置按 `new:<collectionId>` 隔离。旧版 `new` 草稿属于当前系列时继续读取原键，不迁移、删除或覆盖。关闭工作台也会等待方向自动保存及本机草稿写入。

## 验证范围

定向检查包括Web类型检查、修改文件ESLint、PlanningBoard组件测试与单worker Playwright验证。覆盖正常与失败保存、相同编号重试、确切款式修订、过时列表、跨系列草稿隔离、旧草稿与旧链接、只读、空系列创建、读取失败恢复、桌面与手机布局、原系列生成及导出。

截图保存在忽略目录 `output/collection-workbench/`，包含1440px和390px的三个分区。浏览器接口使用隔离夹具，不调用付费模型，不将浏览器回归视为真实模型、队列或存储链路验证。本次未触发CI，也未提交或推送。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @fashion/web typecheck` | 通过 |
| 修改的17个前端TS/TSX文件执行ESLint，`--max-warnings=0` | 通过 |
| `pnpm --filter @fashion/web exec vitest run src/modules/studio/PlanningBoard.spec.tsx` | 5项通过 |
| `collection-workbench.spec.ts` | 7项通过，含1440px/390px截图、滚动后固定标签不遮挡输入 |
| `canvas-all-functions.spec.ts` | 18项通过，含款式档案、项目面板与画布连续性 |
| `collection-consistency-flow.spec.ts` | 1项通过，含方向保存、锁定、两次扩展生成与PDF导出 |
| `studio-object-first.spec.ts` 中系列位置；`frontend-experience.spec.ts` 中旧规划链接；`generated-files.spec.ts` 中两项系列导出来源；`workspace-chrome.spec.ts` 中画布与聊天连续性 | 5项通过 |
| 定向 `git diff --check` | 通过 |

浏览器验证使用 `pnpm exec playwright test <对应文件> --workers=1`，既有大文件通过 `--grep` 选择上述相关用例。累计31个不同用例最终通过，重跑不重复计数。旧测试的过时候选DOM和侧栏入口已改为现有系列来源链接、画布全部功能与返回画布流程。

截图：[桌面规划](../../output/collection-workbench/planning-1440.png)、[手机规划](../../output/collection-workbench/planning-390.png)、[手机位置编辑](../../output/collection-workbench/planning-editor-390.png)。
