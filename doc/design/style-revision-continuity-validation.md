# 款式修订与交付连续性验证

日期：2026-11-09，北京时间。基于已完成的导航与织芽优化，继续完成“图片—款式修订—白板改图—更新原款式—技术包/商品展示”的前端路径。本轮没有改动数据库、队列、模型或任务接口。

## 具体变化

1. 款式保存接口返回后立即采用完整对象。后续列表读取失败或返回旧列表，仍保持正确款式和版本，下一次修改使用更新请求。技术包与商品展示采用相同规则，保存后不重复创建文档。
2. 款式修订链接定位准确版本，包括列表中第二款的历史版本。历史资料只读显示，缺失版本提供重载入口；重新读到版本后恢复正确对象。已定稿历史继续修改降为待评审，不覆盖旧记录。
3. 后续操作使用当前查看的修订。技术包与展示资料提供“查看对应款式修订”，返回准确版本。浏览器前进/后退和同页链接同步对象；拒绝离开时保留当前输入。
4. 从款式返回白板会定位并打开主图。旋转、镜像等编辑完成后，图片工作区携带原款式上下文，以“更新款式修订”返回；保存更新同一款式、替换主图对应视图并清除其复核。未改图直接返回不自动产生新修订。
5. 已确认结果按账号与项目隔离。切换账号清理上一账号的页面缓存；迟到的保存响应只合并项目资料，不改新页面的链接、选中对象和未保存保护。
6. 提交前捕获对应本机草稿，成功后清理确切版本，防止表单重建后恢复已保存内容；新草稿和其他版本不被旧回执删除。首次保存失败继续在当前页重试时沿用请求编号。
7. 款式页后续用途收进“继续工作”，白板编辑入口保持可见；精简重复对象说明和长按钮文字。320px首屏不再被六个后续按钮挤满；历史只读视图取消无效的底部保存栏。
8. 展示草稿允许图片说明为空，与现有接口约定一致；完成展示仍要求逐图人工核对，修改说明、视图会清除该图复核。最近素材列表缺少历史主图时，款式使用修订附带的图片地址。

## 检查结果

相关单元测试 **10个文件、58项通过**。覆盖款式保存/冲突/历史、技术包和展示保存、共享表单、草稿回执，以及同一表单工具影响到的品牌、印花、实验、任务入口。最终 Web TypeScript 和18个目标源码/测试文件的 ESLint 检查通过。根目录执行 ESLint 时有既有的 Pages 目录提示，退出码为0，无规则告警或错误。

浏览器使用本机 Chromium，全部单 worker。共 **61个不同用例通过**，重复验证和录屏运行不累加：

| 用例集合 | 数量 | 验证内容 |
| --- | ---: | --- |
| `style-continuity.spec.ts` | 8 | 新建后刷新失败/陈旧、历史往返、桌面/320px改图更新同款、浏览器历史、账号隔离、迟到保存回执 |
| `image-comparison.spec.ts` | 9 | 并排/窄屏比较、从选中版本编辑、历史分页与恢复、响应丢失后续办 |
| `image-orientation.spec.ts` | 6 | 桌面/390/320px方向预览和实际新图片、草稿、重复提交保护、短屏与键盘 |
| `studio-flow.spec.ts` | 4 | 候选选款、实验提交、展示复核与PDF请求、未保存内容保护 |
| `studio-object-first.spec.ts` | 18 | 作品与资料、手机输入、技术包/样衣校验、只读和多宽度布局 |
| `presentation-workspace.spec.ts` | 12 | 1738–390px布局、预览焦点、未核对图片定位、无款式前置条件、只读与导航 |
| `workspace-chrome.spec.ts` 定向 | 4 | 两类导航偏好、跨项目与账号隔离、表单/图片聚焦/离线提示、320/1440px展示模式 |

首次56项回归中，55项通过，一项核对定位用例的数据仍保留第一张图片未核对，却期望定位第二张。修改用例为先核对第一张后，定向复测通过；没有改变生产代码的“定位第一张未核对图片”逻辑。随后增加迟到回执用例并复测6项连续性及4项导航用例，全部通过。

复现主要检查：

```powershell
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web test -- src/modules/studio/StyleLibrary.spec.tsx src/modules/studio/TechPackEditor.spec.tsx src/modules/studio/PresentationSets.spec.tsx src/modules/studio/use-studio-form.spec.tsx src/modules/studio/BrandLibrary.spec.tsx src/modules/studio/PrintWorkbench.spec.tsx src/modules/studio/ExperimentPanel.spec.tsx src/modules/studio/TaskEntry.request.spec.tsx src/components/drafts/use-persistent-draft.spec.tsx src/components/drafts/draft-repository.spec.ts
pnpm exec playwright test tests/e2e/style-continuity.spec.ts tests/e2e/studio-flow.spec.ts tests/e2e/studio-object-first.spec.ts tests/e2e/presentation-workspace.spec.ts tests/e2e/image-orientation.spec.ts tests/e2e/image-comparison.spec.ts --workers=1
pnpm exec playwright test tests/e2e/workspace-chrome.spec.ts --grep '资料和画布分别|创作目录偏好|商品展示三种模式' --workers=1
```

## 展示材料

截图与录屏位于本机忽略目录 `output/playwright/style-continuity/`：

- `historical-1440.png`、`historical-320.png`：历史版本的身份、只读资料与继续入口。
- `edited-image-1440.png`、`edited-image-320.png`：白板编辑生成的新图。
- `updated-style-1440.png`、`updated-style-320.png`：更新同一款式后的页面。
- `confirmed-save.png`：确认保存后面对旧列表仍保留当前结果。
- [款式与交付短录屏](../../output/playwright/style-continuity/style-continuity-short.mp4)：1440×900，11.72秒，展示从款式返回白板翻转主图、更新同一款式为r2、技术包引用与返回款式。原始WebM为14.20秒，仅裁去开头2.48秒的测试准备画面，保留原速及中间页面加载，没有拼接或补绘操作。
- [关键帧核对](../../output/playwright/style-continuity/video-check.png)：抽取短录屏的0.48、3.12、5.32、8.12、9.52和11.60秒，共六帧，已逐帧查看。最后一帧处于刷新后的主图淡入过程；录屏帧率25fps仅是录制格式，不用作页面性能证明。

图片沿用仓库的 `coat-original.png`，方向编辑调用现有本机图像处理函数产生新图片；素材来源说明保留于 `apps/web/public/prototype-assets/impeccable/SOURCE.md`。录屏不是生成模型输出质量的证明。

## 验证边界与后续

本轮浏览器运行真实 Next.js 页面，拦截业务接口并按共享输入约定校验请求；未调用付费服务。真实数据库、Redis队列、MinIO及供应商链路本轮没有验证，旧记录不计入本轮。修订不可变、权限和事务仍依赖已有服务端实现，本轮只验证前端绑定及请求内容。

此记录完成时，共享表单只保证当前页内失败重试的请求编号稳定；同日后续已经补齐款式、技术包和商品展示未确认提交的刷新恢复，以及来源图片缺失时的返回和放回入口，结果单列于[保存恢复与来源主图验收](studio-save-recovery-validation.md)。真实修订事务和导出链路仍待本地服务可用后验证。未增加新动效，因此没有重跑100对象白板性能采样；导航与织芽性能基线见[导航与话语验收](assistant-seed/navigation-dialogue-validation.md)，不能当成本轮实体设备数据。

全平台对标目标继续进行；本轮完成一条创作与交付路径，不代表平台已经达到 Lovart 的全部能力或质量。
