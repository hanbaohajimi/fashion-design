# 004 — 极端数据、技术包数值与图片恢复

- 状态：已实施；优先级：P1。最新证据见 [实施记录](IMPLEMENTATION.md)。
- 技能：break-ui、emil-design-eng、animate、pick-ui-library。
- 工作目录：`G:/new-fashion-design`；基线：`5dbd7a6` 加已复核工作区。

## 证据与边界

`apps/web/src/modules/studio/TechPackTables.tsx` 的 nullable 每次输入立即调用 Number，数值输入没有独立字符串草稿；表格文本没有对应 schema 的长度约束，行 key 使用 index。`FabricCard.tsx` 缩略图和详情图直接用 img，未接失败恢复。`FabricVirtualGrid.tsx` 没有给虚拟列表外层提供 computeItemKey，但内部 FabricCard 已使用 fabric.id；不能据此声称已复现“编辑了错误面料”。

以下是审查时已读取的契约，应在实施时再次以 schema 为准：

| 对象 | 有效边界 | fixture |
| --- | --- | --- |
| 项目名称 | 3–80，沿用服务端长度计数 | 最短、最长、同名、无空格、中文和 emoji |
| 面料名称/编号/分类 | 120/80/80 | 长中文与不可断开的编号 |
| 供应商/供应商编号 | 160/100 | 长公司名、缺失可选值 |
| 成分/标签 | 成分最多 12；标签最多 12、每项最多 30 | 全量成分与标签、零标签 |
| 面料数值 | 克重不超过 10000、幅宽不超过 1000；价格/MOQ 0–100000000 | 零值、上限、缺失值、不同单位 |
| 技术表 | BOM/POM 各最多 100 行 | 0/1/100 行、相邻同行名、删除中间行 |
| 技术表文本 | name/unit 120；material/supplier 2000 | 最大合法值、超过上限的无效输入 |
| 技术表数值 | quantity/value 为有限正数或 null；tolerance 为有限非负数或 null | null、0 公差、0.0001、负数、非有限值、编辑中的 `1.` |

有效数据必须满足真实 schema；无效数据用于验证错误路径并明确标记。累计 1000 条面料是分页累积 fixture，不向分页 API 传 limit=1000。

## A. 数值编辑与人工复核

1. 在 `TechPackEditor.tsx` 所在模块引入本地编辑模型和纯转换函数。数值字段使用字符串，行包含仅 UI 使用的稳定 id；模型只服务 Web，不改共享请求类型或数据库。
2. 初载把服务端 number/null 转为字符串/空串。输入中保留原始文本；不在每次 onChange 中 Number 化。若采用 text 输入，配置合适的 inputMode，并明确定义只接受现有服务端支持的数值语义；不能把逗号直接替换成小数点而改变输入含义。
3. 保存时逐字段解析并校验有限性、正负约束与文本长度。空串转 null；不能把无法解析的输入当 null 或退回上次有效数字。quantity/value 必须大于 0，tolerance 允许 0；不要继续用 min=.001 拒绝合法的 0.0001。
4. `1.` 在编辑过程中保持原样；提交时按明确的数字解析规则转换为 1。单独的负号、小数点、不完整指数均报错。保存后采用规范化数据重建基线，避免显示“保存成功”但 dirty 仍然不一致。
5. 每次编辑，包括无效中间输入，都使对应行 reviewed 和总体 reviewConfirmed 失效，状态回到 DRAFT；dirty 基于完整草稿。保存验证不通过时不能发送旧数字、不能发布，并定位到错误所在章节和字段。
6. 使用稳定 UI 行 id 作为 key；删除第二行不能把其数值草稿/焦点转移到第三行。章节切换保留草稿，避免卸载导致输入丢失。序列化必须剥离 UI id，保持请求字段、expectedVersion、requestKey 和 409 冲突处理。
7. 本地编辑模型可作为既有 useStudioForm 的泛型输入；不要为这一张表重写所有工作室表单。保留工作区正在接入的保存成功事件反馈。

## B. 图片与虚拟列表

1. 复用 `apps/web/src/components/ui.tsx` 中已有 ImagePreview。缩略图使用 cover、固定图片区尺寸、retryable=false，避免给整个可拖拽卡片新增嵌套重试按钮；详情图 contain、允许显式重试，错误状态仍保留面料名称与资料动作。
2. ImagePreview 已有 failedSource/attempt/retrying 状态。优先复用同 URL 重试机制；若业务确需刷新数据，连接现有 onRetry 和真实查询。面料图片是受保护的 `/api/fabrics/:id/image` 路由，不假定为过期签名 URL，不通过拼随机参数绕过权限。
3. 只有用户明确重试并成功加载时，图片可在固定尺寸内做 140ms opacity 反馈；初载、滚动回收和 src 改变不反复播放。为内部 onLoad 记录显式重试状态即可，不强制扩大公共 API。reduced motion 和隐藏页面直接呈现最终态。
4. VirtuosoGrid 使用 data=fabrics 和 computeItemKey 绑定 fabric.id，保留 endReached/overscan 与已有分页防重逻辑。对长标题、标签和供应商限制卡片展示行数，完整值放在详情中；保持网格卡片尺寸可预测。
5. 不替换已在运行的虚拟列表库。用真实数据测量是否需要调整 overscan，不能只凭“200 看起来较小”修改。空、单条、累计多页以及删除/插入/筛选后的滚动位置都需验证。

## C. 最坏数据演示入口

在非生产的独立原型入口提供 Demo / Worst case / Empty / One / Large 切换，复用同一展示组件和数据注入路径。可与任务 007 共用开发入口框架，但每种 fixture 单独定义，固定 id，结果可复现。数据只保存在本地，不调用上传、生成、保存或计费接口。生产访问返回 404；不能只隐藏导航链接。

覆盖项目卡、面料卡、技术包、结果卡：320px 手机、320px 真实侧栏、1366×768、200% 缩放、键盘与触摸。核对横向溢出、被裁切动作、错误文字、空态、图片 403/404、长中文、英文无空格和 emoji。

## 验收与测试

- 为纯转换函数测试有效/无效/边界，重点验证 0 公差与小于 .001 的合法值；往返转换不漏字段、不泄漏 UI id。
- 组件测试覆盖连续输入 `1`→`1.`→`1.2`、删除成空串、无效时保存、删除中间行、切换章节、复核失效和 409 后草稿保留。
- 图片失败尺寸不跳动，资料仍可查看，重试成功可恢复；虚拟回收不会让错误状态附着到另一张面料。
- 100 行表和累计 1000 面料 fixture 可以访问到末项；焦点不进入不可见的旧元素，分页不重复请求。
- 必须实际渲染最坏数据后记录“已复现/已通过”；本文件中的静态风险不等于已经观察到布局破坏。

```powershell
pnpm --filter @fashion/web test
pnpm exec playwright test tests/e2e/workspace-ui.spec.ts tests/e2e/frontend-experience.spec.ts
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web lint
```

交付：fixture 清单、每个失败案例的修复前后截图、数值转换测试与生产入口隔离证据。
