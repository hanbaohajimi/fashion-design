# 保存恢复与来源主图验收

日期：2026-11-09，北京时间。接续款式与交付连续性工作；本轮修改前端保存恢复、草稿基线及白板来源入口，复用原有Studio去重和Canvas命令接口，没有改动数据库、队列或付费模型配置。

## 使用结果

- 款式、技术包、商品展示提交前，在账号/项目/编辑器/对象范围内保存完整参数、请求编号、预期版本和当时草稿。重载页面只显示确认入口，用户点击后重放原操作，不生成新请求编号。
- 当旧保存尚未确认时，后续不同内容不能覆盖它。确认完成保持当前输入；打开已保存资料时，后续草稿转到该对象，继续保存使用原对象ID和新版本。
- 服务端后来有新修订时，以原提交的资料作为草稿基线，打开后显示差异，不自动覆盖较新资料。若目标本机草稿本身另有不同内容，也不覆盖双方。
- 技术包保留数值中间态，如`1.`，以及表格行身份；行身份重建不制造假冲突。
- 从款式返回白板的主图不存在时，显示名称、准确修订和返回入口。点击“放入白板继续编辑”使用已有图片建立放置，不生成图片、不改款式；流程中仍有记录但实际白板已移除的情况同样处理。
- 主图放置回执丢失后，刷新只提供继续确认入口，使用原命令编号。只读、来源不匹配不提供导入动作。

## 发现并修正

1. 深化刷新测试时发现，读取本机草稿后、React恢复值提交前，初始化的干净表单会删除该记录。新增恢复中保护与延迟恢复单测；桌面/320px的连续两次刷新验证通过。
2. 仅检查流程节点会漏掉“节点存在，实际白板放置已移除”。现从实际编辑器的文档状态判断图片是否在场，仅订阅文档变化；没有逐帧刷新全白板。
3. 联合回归的两项来源用例发现编辑器就绪通知先于外层编辑器引用更新，导致放回按钮缺失。就绪句柄现携带准确编辑器实例，最终42项回归全部通过。

## 检查证据

最终相关前端单元测试：**11个文件，77项通过**。覆盖完整提交恢复、未知/明确失败、并发点击、账号与项目隔离、存储失败、草稿搬移冲突、初始化恢复时序，以及共享表单影响到的其他编辑器。

现有Studio服务单元测试：**22项通过**，包括创建/更新去重、请求编号换参数拒绝、版本冲突和项目资产校验。首次运行因缺少`DATABASE_URL`在收集阶段停止；随后为该进程提供不可连接的测试占位地址，运行使用模拟数据库的用例通过。没有连接真实数据库，不将此计为集成测试。

Web类型检查与20个相关源码/测试文件的定向ESLint通过。ESLint根目录运行出现既有的Pages目录配置提示，退出码0，无规则错误或告警。

接续收尾核对：清理Studio和白板样式文件末尾的多余空行，相关改动的 `git diff --check` 通过。核对本记录、款式连续性、导航话语和能力对照四份文档中的38个本机链接，均可找到对应文件。此步骤仅调整空白与验证说明，没有改动运行逻辑，未重复运行已经通过的整组测试。

Chromium浏览器测试均单worker；**42个不同用例通过**，重复验证不累加：

| 集合 | 数量 | 覆盖 |
| --- | ---: | --- |
| `studio-save-recovery.spec.ts` | 7 | 桌面/320px刷新续办、新建后续草稿、更新不重复修订、技术包与展示恢复、表格中间态、服务端后续修订 |
| `canvas-style-source.spec.ts` | 5 | 桌面/320px缺失主图、放置回执丢失、只读/不匹配、流程有记录但实际白板已移除 |
| `style-continuity.spec.ts` | 8 | 保存响应、旧列表、历史往返、白板改图更新同款、浏览器导航、账号隔离与迟到回执 |
| `studio-flow.spec.ts` | 4 | 候选选款、实验草稿/执行、展示复核、未保存保护 |
| `studio-object-first.spec.ts` | 18 | 对象页面、技术包校验、手机输入、只读、八个宽度下的布局 |

主要复现命令：

```powershell
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web test -- src/modules/studio/studio-save-recovery.spec.ts src/modules/studio/use-studio-form.spec.tsx src/modules/studio/StyleLibrary.spec.tsx src/modules/studio/TechPackEditor.spec.tsx src/modules/studio/PresentationSets.spec.tsx src/components/drafts/draft-repository.spec.ts src/components/drafts/use-persistent-draft.spec.tsx src/modules/studio/BrandLibrary.spec.tsx src/modules/studio/PrintWorkbench.spec.tsx src/modules/studio/ExperimentPanel.spec.tsx src/modules/studio/TaskEntry.request.spec.tsx
pnpm exec playwright test tests/e2e/canvas-style-source.spec.ts tests/e2e/studio-save-recovery.spec.ts tests/e2e/style-continuity.spec.ts tests/e2e/studio-flow.spec.ts tests/e2e/studio-object-first.spec.ts --workers=1 --project=chromium
```

## 实际页面

位于本机忽略目录`output/playwright/studio-save-recovery/`：

- [待确认保存，桌面](../../output/playwright/studio-save-recovery/pending-1440.png)、[320px](../../output/playwright/studio-save-recovery/pending-320.png)。
- [恢复后继续更新同一款式，桌面](../../output/playwright/studio-save-recovery/confirmed-1440.png)、[320px](../../output/playwright/studio-save-recovery/confirmed-320.png)。
- [主图不在白板，桌面](../../output/playwright/studio-save-recovery/source-1440.png)、[320px](../../output/playwright/studio-save-recovery/source-320.png)。

画面来自实际Next页面、正式角色资源和仓库既有服装素材。业务数据受控；没有调用图像生成模型，不证明供应商生成质量。

## 边界与后续

- 本次刷新恢复明确覆盖款式、技术包和商品展示；其他Studio模块未接入这套提交记录，不扩大完成范围。
- 持久化依赖当前浏览器的本机存储，不是跨设备同步；退出账号按现有规则清理该账号本机记录。
- 真实PostgreSQL、Redis、MinIO、供应商执行及生产部署未在本轮验证。服务单测和受控浏览器不能替代真实事务、文件存储和导出结果验收。
- 未新增循环动画，未重新采样100对象白板性能；旧性能结果不算本轮实测。320px是浏览器视口模拟，未宣称实体手机通过。
- 本轮未运行全仓检查、CI、提交或推送。整体产品对标仍在进行，下一步继续核查图像局部编辑的真实工作链路及交付。
