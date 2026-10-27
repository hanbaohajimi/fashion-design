# 设计助手流式消息

2026-10-27。保持现有结构化模型校验、会话权限、clientRequestId 幂等与工作流提案确认流程。

## 接口与状态

旧版 `POST /agent-conversations/:id/messages` 和新版 `POST /agent-conversations/:id/workflow-messages` 保持原 JSON 请求体。API 设置 `ASSISTANT_STREAMING_ENABLED=true` 且请求声明 `Accept: text/event-stream` 时协商 SSE；否则返回原 JSON。

共享契约位于 `packages/shared/src/assistant-stream.ts`。事件包含 `eventId`、`attemptId`、`messageId`，类型为 accepted、phase、message.delta、message.reset、message.completed、message.failed、message.canceled、snapshot。delta 仅含正文新增文本；phase 只报告分析、补读、校验。reset 使旧候选失效；只有 completed 中经过校验和事务保存的消息可以开放提案确认。原始工具参数及内部推理不进入事件。

`GET /agent-conversations/:id/message-streams/:clientRequestId/events?after=<eventId>` 是只读恢复入口。首次恢复使用 snapshot，不重播逐字动画；有效游标可补读后续事件。游标过期或被裁剪时恢复快照；最终消息以数据库为准。会话所有权和项目权限先校验，持续恢复连接定期复核权限。

## 模型与保存

Amux Claude 客户端保留 generateJson，并新增 streamJson。流式请求启用严格工具输出与 `eager_input_streaming`，解析 input_json_delta，仅提取根级 message 字符串，并将完整工具输入交给原 schema 校验。拒绝、截断、异常 EOF 不能成为成功回复。

上游协议依据：[Claude流式消息](https://platform.claude.com/docs/en/build-with-claude/streaming)、[细粒度工具输入流](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)。实际配置网关另由手工冒烟验证，不根据上游文档推定兼容性。

工作流助手保留原调用预算、补读循环、修复次数、意图版本及数据库租约；read 轮次不展示正文。修复时清除失效候选，不为展示另增模型调用。旧版助手仍由原生成任务幂等键创建任务。

Redis 使用独立的 assistant-stream 前缀保存24小时事件流与快照，每条请求最多10000条事件；请求指纹阻止同一请求编号被用于不同内容，运行锁防止重复发起模型请求。每次尝试采用独立标识，旧生产者不能覆盖新快照。缓存失败不重复调用模型，最终消息仍保存到PostgreSQL；只读恢复可回到数据库终态。

浏览器断线携带after游标重新GET订阅，不自动重发POST；按attempt和eventId去重，退役attempt与迟到事件不能覆盖当前终态。明确失败后的用户重试使用新的clientRequestId；传输结果未知保留原请求身份查询恢复。账号切换沿用private-fetch取消生命周期。浏览器关闭不会将已受理的模型请求改成新的请求。API进程退出继续沿用现有超时恢复，不提供队列级持久执行保证。

## 发布和验证

先部署兼容API，再部署Web，最后在API启用流式开关。关闭开关使新请求恢复JSON响应，既有流正常收尾；取消能力需要增量迁移`20261027080000_assistant_cancel`，新增CANCELED枚举。详见[项目任务与助手取消](project-tasks.md)。

- 模型单元测试检查任意字节分包、中文/emoji/转义、根级字段过滤、拒绝和截断。
- assistant-streams.integration.spec.ts 使用真实PostgreSQL、Redis和HTTP，受控模型在第一段正文后暂停，检查PENDING期间已收到增量、跨实例恢复、重复请求、请求指纹冲突、访问拒绝、旧版流式与JSON回退。
- 已启动Web时，设置 `ASSISTANT_PROXY_ORIGIN=http://127.0.0.1:3000` 可额外验证Chromium通过真实Next.js代理在模型结束前收到正文；该测试使用3001作为隔离测试API端口。
- `scripts/manual/verify-assistant-stream.mjs` 对配置网关发起一次短文本请求，记录实际网络分块与首段时间。它会调用文本模型，不由普通设计截图测试自动触发。

截图模拟资料只能证明布局和交互；受控模型联调证明平台链路；真实网关冒烟证明配置网关支持所测协议。三者不替代真实用户体验或图像生成质量验证。
