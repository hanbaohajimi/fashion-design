# 项目任务聚合与助手取消

2026-10-27。对应 `packages/shared/src/project-tasks.ts` 与 `apps/api/src/modules/project-tasks/`。

## 项目任务

`GET /projects/:projectId/tasks?group=active&limit=30&cursor=...`

- group：active（默认）、running、attention、ended。limit 默认30，范围1–100。
- 返回 `items`、`counts.running`、`counts.attention`、`nextCursor`。游标包含创建时间与领域ID；同一时间戳仍保持稳定分页。
- ProjectTaskView 包含领域、原始状态、显示状态/分组、对象和会话关联、创建/更新时间、结果定位 href，以及领域操作 actions。
- 聚合 generation、workflow execution/proposal、旧 Agent Run、runway、export、assistant reply。已关联 workflow attempt 或 Agent Run attempt 的图片任务不重复计数。
- 运行数和待处理数独立于当前分页。列表与计数是实时读取，不承诺跨领域事务快照；刷新期间的短暂计数差异不代表任务丢失。
- GET只读取领域数据。没有第二套调度器、状态复制表或全局事件总线。每种操作均委派既有服务；导出不展示停止能力。
- ProjectAccessPolicy 校验项目读取权限。只读成员的 actions 为空；操作接口再次执行领域鉴权。
- 列表查询只读取任务展示和操作所需字段，不拉取完整会话正文、提示词或执行快照。分页合并与游标边界使用一致的字符串比较，游标日期规范化为 UTC。
- 展示稿和技术包导出按来源文档类型定位，并携带款式修订；单图导出携带素材 ID。来源文档不可用时回到项目工作室，不猜测文档类型。

前端 ProjectTaskCenter 按账号、项目共享 React Query 缓存；活跃任务3秒刷新，空闲15秒，隐藏页面暂停，恢复可见重新读取。读取失败保留上次数据。分页与筛选分别管理，上传只列入当前标签页的本机活动区。

## 助手停止

`POST /agent-conversations/:id/message-streams/:requestId/cancel`

requestId为原用户消息clientRequestId。返回权威status、messageId、canceled、providerStopped（当前为null）和scope=assistant_reply。尚未受理返回404，客户端读取消息后再操作；重复停止保持幂等；已经完成返回真实完成状态。

取消先锁定会话并提交数据库终态。工作流路径同时撤销AgentTurn租约、推进intentEpoch，最终提交使用相同会话锁与lease/epoch检查；旧助手完成路径也在事务内再次检查PENDING。取消后不能创建迟到提案或图片任务。此前已明确确认的图片任务保持独立。

提交取消后通知本实例AbortController，并写入Redis通知标记。其他实例每750ms串行读取数据库终态；Redis不是唯一取消依据。供应商支持时沿调用链传入AbortSignal；不支持时取消系统后续处理并隔离迟到结果，不承诺供应商已停止或退费。

流式正文在Redis快照中持续保存，并以最多每250ms一次的频率检查点写入仍为PENDING的数据库消息。终态条件保护防止检查点覆盖完成或取消。停止显示已收到的部分正文并标明未完成，未经最终校验的文本不形成确认卡。

## 迁移与发布

新增迁移：`packages/db/prisma/migrations/20261027080000_assistant_cancel/migration.sql`，给AgentMessageStatus增加CANCELED。执行 `pnpm db:deploy`，随后生成客户端并构建共享包。

先发布识别canceled状态的读取端和后端，再启用停止按钮。关闭停止功能时仍保留状态读取兼容；不要删除已写入的取消记录或回写旧迁移。原文件、款式、技术包和服装秀结构没有整体迁移。

## 验证入口

- assistant-streams.integration.spec.ts：真实PostgreSQL、Redis和HTTP，受控模型；含跨实例取消、迟到且忽略AbortSignal的模型响应、部分正文保留与终态隔离。
- project-tasks.integration.spec.ts：同时间戳分页、去重计数、只读能力、项目隔离和无效游标。
- `pnpm verify:desktop-ui`：独立数据库schema与临时Redis容器下执行db:deploy和pnpm check，不清理既有业务数据，不调用付费供应商。

本轮实际结果与未验证项目见[实施记录](../plans/desktop-agent-ui/IMPLEMENTATION.md)。
