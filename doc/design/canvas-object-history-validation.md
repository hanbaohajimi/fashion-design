# 画布图片历史入口与版本往返验收

日期：2026-11-10。本阶段承接[生成文件浏览](generated-files-validation.md)，让画布内图片直接回看已有版本、比较差异、查看设计路径，再进入原图片工作区恢复。沿用现有资产血缘和恢复流程，没有新建一套版本数据库、调度或模型调用。

## 用户路径

1. 选中一张有资产身份的图片，在所选对象操作区点击“查看历史”；也可打开对象目录，点击图片条目的历史按钮。便签、分组及没有资产身份的图片不显示图片历史入口。
2. “图片版本”读取该资产的既有血缘，支持分页和比较；“设计路径”查看执行时的来源、条件和产物。两处只读，不提供“选定/否决”或直接恢复写入。
3. 桌面比较采用等高、等宽图片区域，完整展示原比例；手机切换当前图/历史版本。比较时收起暂时不用的页签和底部操作，保留返回与缩放。
4. 需要恢复时，从“在图片工作区恢复版本”进入既有图片工作区的历史面板。此操作只打开界面；用户再点击原恢复按钮才创建新版本，原记录继续保留。成功后选中恢复产物。

隐藏、锁定图片仍可查看历史，阅读本身不取消隐藏或锁定、不更改选择/引用，也不移动白板视野。对象目录和搜索值在弹窗背后保留，关闭回到原触发按钮。只读画布没有进入恢复的按钮。图片关联已经变化时保留旧历史并说明，不能把旧目标恢复到另一张图片。

## 实现契约

- `CanvasObjectHistory` 使用现有原生模态和主题，通过 portal 放在界面层；不继承画布层的鼠标穿透规则。弹窗打开暂停织芽，关闭恢复。
- `CanvasTools` 提供所选图片入口，`CanvasObjectsPanel`提供逐图片入口。目录投影只增加资产身份；坐标、缩放和尺寸仍不进入投影，版本切换会更新真实资产身份。
- 手机条目的历史操作位于第二行，保留深层名称宽度和44px显隐/锁定/历史操作区。桌面维持紧凑图标。
- `VersionTimeline`增加只读模式，使用账号隔离查询键、取消信号及显式重读；卸载中止读取，不新增轮询。失败保留已读页，可继续重试失败页。
- 恢复入口重新核对节点及资产身份；打开请求包含资产和递增编号，不重建已挂载的编辑器。等待原草稿初始化后才切到历史，未提交旋转草稿保持。
- 比较视图区分“查看历史”和“恢复历史”，只读比较不显示无效操作或暗示会写入。来源查看复用只读设计路径。
- 系列来源链接的首次展开改为可取消的首次绘制回调，以符合现有React检查规则；两个系列来源浏览器用例重测通过。

## 验证结果

| 范围 | 结果 |
| --- | --- |
| 前端单元 | 25项通过：VersionTimeline 4、canvas-objects 9、DesignPathPanel 4、use-asset-restore 8 |
| 数据库集成 | 4项通过：血缘分页和反向恢复、重复恢复只创建一次、越权读取拒绝、当前画布修改/移除后仍按执行快照读取历史；同文件其余6项未选中，不计入通过数 |
| 新历史入口浏览器 | 最终9项通过，单worker |
| 原有图片比较/恢复 | 9项通过：桌面/390/320px比较、分页恢复、两步响应丢失续办、读取失败、多方案与方向草稿、短屏键盘 |
| 原对象目录回归 | 12项最终分批通过，含撤销重做、父级保护、保存失败、深层分组、短屏与触摸滚动 |
| 系列来源接续 | 2项通过，有效系列及删除后提示；这两项与生成文件阶段重叠 |
| 独立画面 | 2项通过：1440×900和320×568，截图、录屏与四态裁切检查 |
| 独立性能 | 1项通过，100画布对象、60项历史，各30秒，见下表 |
| 静态检查 | Web类型、目标文件ESLint及目标diff空白检查通过；根目录ESLint仍有既有Next pages路径提示，退出码0 |

本阶段29项不同单元/集成检查、32项不同浏览器功能用例分批通过；重复运行不累加。最后9项历史入口包括：画布/聊天草稿与光标、只读比较、隐藏锁定图片、恢复后定位新结果、窄屏、失败重试与取消、账号切换、关联变化，以及复用已挂载编辑器保留方向草稿。

真实数据库测试使用隔离记录并清理；签名实现是受控测试替身，未请求真实模型、未完整贯穿页面到真实存储恢复。浏览器历史和恢复使用受控接口，服装图片沿用仓库已有原型图片（来源见 `apps/web/public/prototype-assets/impeccable/SOURCE.md`），不证明新的生成质量。完整来源、权限撤销、事务与存储端到端仍应在后续场景中单列。

## 发现与修复记录

- 首轮弹窗在画布内部继承鼠标穿透规则，部分操作不可点击。移至页面界面层并明确pointer-events后通过真实点击验证。
- 新历史图标挤压320px八层分组名称至48px。改为手机第二行历史动作，原≥56px名称宽度和44px点击区域回归通过。
- 首轮只读比较的两栏因底部单侧操作而高度不同，影响“适合窗口”比例。移除只读比较里重复的底部返回按钮，两栏等高，浏览器新增等高断言。
- 初始单元测试同步模拟rAF导致焦点检查早于React提交，改为异步rAF后通过；画布图片点击改为实际可见边界的鼠标点击。上述测试适配与产品修复分别记录。

初始失败截图和trace保存在 `output/playwright/canvas-object-history/initial-failures/`。

## 性能与画面

2026-11-10北京时间12:59，Windows、Chromium 145.0.7632.6、无头、DPR=1、16逻辑线程。原生时钟/rAF、单worker，无录屏/trace和并行检查；API/图片受控，每场景30秒。

| 场景 | 平均fps | >33.3ms帧 | 输入至下一帧P95 |
| --- | ---: | ---: | ---: |
| 打开历史前平移白板 | 59.87 | 0.111% | 6.6ms |
| 滚动60项图片历史 | 60.00 | 0% | 0.3ms |
| 关闭历史后平移白板 | 59.87 | 0.167% | 5.6ms |

三项均达到≥58fps、长帧<1%目标。操作至首批10项显示254ms。输入延迟是事件至下一次rAF，不是显示器实际呈现时间；不推及生产网络、超大文件和实体手机。原始数据：`output/playwright/canvas-object-history/performance.json`。

同目录含 `objects-*`、`history-*`、`compare-*`、`path-*` 图片及 `tour-1440.webm`、`tour-320.webm`。`clip-1440.json`、`clip-320.json`记录默认、悬停、比较展开、路径稳定四态，均cut=0、hidden=0。扫描只遍历dialog后代；原生模态自身另查视口边界，不虚报自身投影被扫描。

320px在系统暗色偏好和减弱动态下验证，平台仍使用暖白主题；没有据此认定完整深色主题或实体触控验收。

## 复测

```powershell
# 仓库根目录，单worker
pnpm exec playwright test tests/e2e/canvas-object-history.spec.ts tests/e2e/image-comparison.spec.ts tests/e2e/canvas-objects.spec.ts --workers=1

# apps/web
pnpm exec vitest run src/modules/board/generation/VersionTimeline.spec.tsx src/modules/board/workflow/canvas-objects.spec.ts src/modules/board/generation/DesignPathPanel.spec.tsx src/modules/board/workflow/use-asset-restore.spec.tsx

# apps/api，真实数据库，仅指定四项
node --env-file=G:/new-fashion-design/.env G:/new-fashion-design/apps/api/node_modules/vitest/vitest.mjs run src/modules/design-assets/design-assets.service.integration.spec.ts --testNamePattern '分页显示完整血缘|版本恢复请求重放|用户不能读取其他用户|新画布被修改或移除'
```

性能：在仓库根目录设置 `OBJECT_HISTORY_PERF=1` 后单独运行 `tests/e2e/canvas-object-history-performance.spec.ts`。

本阶段未调用付费服务、启动正式Worker、运行全仓检查/CI或提交推送；保留其他本地改动。生成文件阶段的Docker自动恢复事件见其记录，不抹去历史事实。Lovart仅沿用已存公开材料，当前fetch工具核实为本机Python服务，遵守用户限制未调用；本阶段没有新的助手侧远程正文。整体能力对齐仍在进行，图片历史入口不等于所有对象属性均已有持久化时间线，也不代表登录后Lovart体验已对等。

## 13:09真实恢复链路接续

上文“完整真实恢复尚未贯穿”是初次界面阶段边界。接续增加 `asset-restore-pipeline.integration.spec.ts`，经过实际 Nest HTTP、PostgreSQL、MinIO及白板绑定投影，5项通过。测试使用隔离账号/项目、有效32×48半透明PNG，结束删除测试记录与文件；身份注入和请求限流为测试替身，不代表认证系统与限流端到端验收。没有运行正式Worker或调用生成服务。

真实检查发现并修复：

1. 归档历史可创建恢复资产，但工作流接入随后用“仅活动资产”的规则检查历史来源，返回400。接入现允许读取同项目已归档历史来源，新恢复产物仍须为活动资产；原历史继续保持归档状态。
2. 项目归档后，恢复接口仍允许创建新资产。资产写入权限检查现拒绝归档项目；工作流接入在入口及事务内重新检查权限/归档。读取历史继续允许。

5项覆盖：HTTP恢复归档历史并接入白板，签名原文件字节逐字相同、两个来源均保留；两步重复请求仅一个资产、执行回执和摆放；只读成员不能恢复，编辑权限撤销阻止第二步且保留第一步记录；归档项目拒绝恢复和接入；两步之间来源节点变化拒绝接入且保留恢复记录。测试核对没有新生成任务。

另有24项原路径/访问规则单元检查和1项已有工作流真实事务回归通过。既有工作流回归含恢复接入的重复编号、异参冲突和事务回滚；其生成结果受控，不证明模型画质。API类型及目标ESLint通过。以上新增30项不同单元/集成，与此前29项无重叠，本阶段累计59项；浏览器仍为32项，不把API复测计入浏览器。

复测在 `apps/api` 运行：

```powershell
node --env-file=G:/new-fashion-design/.env G:/new-fashion-design/apps/api/node_modules/vitest/vitest.mjs run src/modules/design-assets/asset-restore-pipeline.integration.spec.ts src/modules/studio/legacy-project-access.spec.ts src/modules/design-assets/design-path.service.spec.ts
node --env-file=G:/new-fashion-design/.env G:/new-fashion-design/apps/api/node_modules/vitest/vitest.mjs run src/modules/workflow-runtime/workflow-runtime.service.integration.spec.ts --testNamePattern 'runs analysis, two candidates'
```

浏览器与上述实际HTTP链路仍分别运行，尚未从真实登录页面完成全程录屏。源文件物理缺失时的主动恢复拦截、对象被并发删除，以及生产网络仍需独立验收；未把已通过的字节验证扩大为这些结论。

13:13继续补齐私有原图缺失：在新建恢复记录前和首次接入画布前通过存储head确认原文件为非空图片；失败返回503并保留记录，恢复后允许同一编号继续。已经成功创建的幂等恢复回执仍可读取，避免重复新建；第二步未完成时继续检查原图。任意外部历史URL不在此处抓取，仍沿用旧行为，不宣称外部源可用性已验证。

新增2项实际MinIO丢失/恢复场景及2项文件校验单元检查，最新真实恢复文件7项全部通过；与2项校验和1项既有工作流事务回归共10项复测通过，12项未选中跳过。API类型、目标ESLint与diff检查通过。既有事务夹具补上head响应以适配新校验；它仍为存储替身，不算真实文件证据。图片历史阶段累计63项不同单元/集成，32项浏览器不变。物理缺失这一边界已由本接续验证，但head后文件再次变化、外部源可用性、生产网络及真实登录页面完整串联仍未证明。
