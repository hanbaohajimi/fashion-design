# 生产入口与覆盖

本轮基线68131c2。相对导入审计：10个路由/布局入口，276个可达源码或样式文件，50个生产CSS模块。可复核清单由 `node scripts/manual/audit-desktop-ui.mjs` 输出到 `output/desktop-agent-ui/production-imports.json`。此清单含按需兼容组件；并不把文件内所有旧选择器都视为实际渲染。

## 页面与交互归属

| 入口 | 主要实现 | 滚动/对象边界 | 本轮接入 |
| --- | --- | --- | --- |
| 项目库 `/` | ProjectLibrary、ProjectGrid、ProjectCard、ArchiveNavigation | 文档流，搜索与归档筛选 | 统一字号、hairline、账户菜单、失败保留旧结果 |
| 设计工作台 `/:projectId` | WorkflowCanvas、DesignWorkbench | 作品默认，流程同级 | WorkspaceSplit、任务入口、草稿与结果到达提示 |
| 完整流程画布 | WorkflowCanvas、workflow-node、tldraw | 独立视口，保留世界坐标 | 去彩条、图像outline几何、低缩放既有披露 |
| 助手 | WorkflowAssistantPanel、ProposalReview、StreamingReply | 独立会话与阅读锚点 | 统一Composer、IME、停止、简短结果入口 |
| 素材与详情 | WorkflowNodeDetails、WorkflowMaterialDialogs、WorkflowAssetWorkspace | 以原节点/资产为草稿owner | 本机草稿、明确丢弃、图片反馈与引用 |
| 面料库 `/fabrics` | FabricVirtualGrid、FabricCard、FabricStructuredFilters | 保留虚拟滚动与返回上下文 | 固定搜索结构、统一尺度、裁切修复 |
| 趋势档案 `/trends` | TrendArchive、TrendBoardPickerDialog | 来源与日期、摘要按需展开 | 字号收敛、无彩条通知、项目定位 |
| `studio?tab=tasks` | TaskEntry | 需求与参考素材 | 进入统一工作台前只准备引用与草稿，不执行生成 |
| `styles` | StyleLibrary | 当前款式与修订，完整图优先 | 对象级useStudioForm草稿、统一外框与资料层级 |
| `experiments` | ExperimentPanel | 结果工作面、参数辅助区 | 独立草稿、真实任务状态、保留手机锚点 |
| `patterns` | PrintWorkbench | 平铺画布、参数分层 | 本机可序列化草稿、单位和人工复核保持独立 |
| `presentation` | PresentationSets | 有序图片、逐图核对、撤销 | 对象草稿、页头与保存状态、完整图 |
| `runway` | RunwayPanel | 播放器/阶段产物、参数 | 保留阶段、配对、分叉/取消与独立草稿 |
| `planning` | PlanningBoard | 看板与位置编辑 | 原位置ID草稿，保持版本冲突保护 |
| `tech` | TechPackEditor、TechPackTables | 章节、内容、发布检查 | 数值字符串、手机条目、对象草稿 |
| `samples` | SampleRounds | 完整图片、标注、问题索引 | 保留坐标体系与双向定位、对象草稿 |
| `team` | CollaborationPanel | 作品、修订、成员与意见 | 评审和成员表单各自草稿，权限独立 |
| `trends` | TrendBriefPanel | 当前简报与来源资料 | 独立草稿、摘要与当前修订 |
| `brand` | BrandLibrary | 规则、来源、当前资料 | 对象级草稿、统一标题/字号 |
| 登录 `/login` | LoginPage、forest-login.module.css | 独立访客页面 | 四档展示字号、错误恢复、焦点、完整标识 |
| 登录确认 `/auth/confirm` | ConfirmPage | 独立访客页面 | 延续品牌与错误恢复 |
| 公共分享 `/share/:token` | SharePage、SharedImage | 完整图片、失败恢复 | 保留访客结构与只读权限 |

所有工作室URL值和深链保持；没有引入Electron、Tauri、托盘或原生窗口。

## 兼容与原型

BoardAgentPanel、AgentWorkflowPanel、LegacyAssetTools、旧设计运行历史仍保留兼容读取；旧助手也使用IME守卫、本机草稿与服务端停止。工作台已不引用useSidebarResize，旧hook及其测试已移除；新分栏由库与浏览器行为测试覆盖。

`/prototypes/desktop-agent-ui` 是隔离结构预览，支持作品、技术包、项目库三种内容及1440/900/390px模式，不访问项目业务或付费模型。旧prototype、未导入的历史动效CSS不作为当前生产问题，也不重新接入运行时。

## 状态证据

正常入口六视口采集见desktop-agent-ui.spec.ts；空数据、只读、长内容、刷新失败与保存保护复用并回归workspace-ui、studio-object-first、presentation-workspace、frontend-experience、runway-workspace等场景。加载/失败不会用空内容覆盖已有数据。新草稿、任务能力、分栏、IME、多状态裁切有独立测试文件。

每种页面并未对所有状态做人工点击穷举；Windows真实输入法、物理滚轮、系统缩放和实际供应商验证单列在[实施记录](IMPLEMENTATION.md)，不以fixture截图宣称通过。
