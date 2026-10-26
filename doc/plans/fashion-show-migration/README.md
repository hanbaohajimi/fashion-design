# 服装秀迁移方案与实施入口

确认日期：2026-10-26。源目录：`G:/学校/顾晓玲老师项目/服装秀/`，只读保留；本系统根目录：`G:/new-fashion-design/`。

## 已确认的产品约束

- 工作室内新增与商品展示并列的「服装秀」，使用阶段式原生界面。
- 迁入需求、模特/服装/背景生成、配对、试衣、分镜、逐图修改、视频、拼接、配乐、历史与重跑。
- 支持项目已有款式修订、生成图和上传图，执行输入建立不可变快照。
- 不迁旧会话、SQLite 或历史成果；不将旧目录作为运行依赖。
- 保留旧模型链路；不可用时记录受阻，不自动换模型或供应商。
- 服装秀不增加额度、扣费和计费逻辑；现有图片额度行为不变。
- Windows 本地一键启动与 Linux 容器可部署；实际生产上线另行安排。

## 架构和接口

浏览器 → NestJS（认证、项目权限、草稿、命令、事件、私有媒体）→ PostgreSQL；独立 Python Worker 从持久化命令表领取工作，执行 LangGraph 与 FFmpeg，检查点位于独立 PostgreSQL schema，成果进入私有 MinIO。

Python 不暴露公网接口，不操作 BullMQ 内部协议。现有 Node Worker 与队列继续承担原业务。新模块的所有数据库结构通过增量 Prisma migration 管理。

页面：`/[projectId]/studio?tab=runway&showId=...&runId=...`。

API 前缀：`/api/projects/:projectId/runway`。包括 shows 列表/创建/更新、作品 runs 创建、run 详情/actions/forks/cancel/events、media content 与 capabilities。命令使用 requestKey，状态修改使用 expectedVersion，中断恢复绑定 interruptId。

运行状态：QUEUED、RUNNING、WAITING_INPUT、SUCCEEDED、FAILED、NEEDS_ATTENTION、CANCELED。任务领取使用数据库锁、租约与执行代次校验。人工等待释放执行槽；远端状态不明不自动重新生成。取消保留成果并停止后续阶段；历史重跑建立分支。

默认关闭功能；普通测试使用模拟供应商。模拟成果有明确来源，不能当作真实模型验收。

## 分阶段交付

| 阶段 | 交付 | 通过条件 |
| --- | --- | --- |
| 0 基线 | 源码哈希、许可证、能力对照、已有改动记录 | 源目录未变，凭据未迁入 |
| 1 环境 | Python3.11/bookworm、uv.lock、适配器、doctor | 冻结安装可重复，离线模拟测试通过 |
| 2 持久化 | Prisma、API、命令、检查点、事件 | 重启可恢复，幂等与项目隔离通过 |
| 3 图片 | 生成、配对、试衣、分镜、修改 | 三类起步路径与单图重试通过 |
| 4 视频 | 视频任务恢复、FFmpeg、配乐、分支 | 部分失败保留成果，重跑不覆盖历史 |
| 5 界面 | 原生导航、素材选择、审核、播放、历史 | 桌面/手机/键盘/只读/刷新通过 |
| 6 验收 | 启动、CI、真实基础设施、供应商小样 | 分别报告模拟、基础设施、真实模型结果 |

每阶段的实际结果见 [实施记录](IMPLEMENTATION.md)。源文件的路径、大小与 SHA256 见 [source-manifest.json](source-manifest.json)。已有未提交变更的原始状态与 diff 位于忽略的 `output/runway-migration/baseline/`。

日常配置、启动、隔离测试、服务器部署及恢复见 [运行手册](OPERATIONS.md)。

## 模型可用性边界

旧代码使用 OpenRouter 文本/视觉、自定义 Google 协议图片网关、即梦首帧视频与 MiniMax music-2.6。旧代码中的硬编码密钥不得进入迁入副本、日志或测试。部署配置应更换曾写入源码的凭据。

截至本次方案核查，即梦3.0文档标注「下线中」；MiniMax 音乐 API 限制新账户接入。执行时以账户实际响应为准，不能将存在密钥记为验证成功。

- [即梦官方接口文档](https://docs.volcengine.com/docs/JimengAI/JimengAI-VideoGeneration30720P-InterfaceDocumentation?lang=zh)
- [MiniMax 官方音乐文档](https://platform.minimax.cn/docs/api-reference/music-generation)
- [LangGraph 中断及幂等说明](https://docs.langchain.com/oss/python/langgraph/interrupts)

## 发布与回退

迁移、检查点初始化和模拟链路通过后再启用 RUNWAY_ENABLED。回退关闭入口与新命令接纳、停止 Python Worker，保留业务表、检查点与成果，不删表回滚。备份同时覆盖 PostgreSQL 和 MinIO。引用中的媒体不得由临时缓存清理任务删除。

完整迁移完成必须包含真实供应商闭环；外部服务受阻时，本记录继续保留未完成项。
