# 服装秀执行器

Python 3.11、LangGraph 0.6 与 FFmpeg 的独立执行器。只通过平台 PostgreSQL 领取持久化命令，成果写入私有 S3/MinIO；没有公网接口、Django 或额度代码。

## 启动

从仓库根目录使用 `pnpm runway:doctor`、`pnpm runway:up`。容器构建使用固定 uv 版本与 `uv.lock`，不依赖 Windows 全局 Python。

开发时在本目录运行 `uv sync --frozen`，再运行 `uv run python -m runway doctor --config-only`。数据库迁移由平台 Prisma 管理；首次需运行 `uv run python -m runway init-checkpoints`。Worker 启动不会静默创建内存检查点。

命令：`python -m runway worker | doctor [--config-only] | init-checkpoints | health | smoke --provider llm|image|video|music`。

`RUNWAY_ENABLED=true` 才会运行 Worker，`RUNWAY_PROVIDER_MODE=mock` 生成带 MOCK / TEST ONLY 标识的有效媒体。live 模式分别读取 `RUNWAY_LLM_*`、`RUNWAY_IMAGE_*`、`RUNWAY_VISION_*`、`RUNWAY_VOLC_AK/SK` 和 `RUNWAY_MUSIC_*`。示例配置见仓库 `.env.example`。密钥不进入运行快照、数据库事件或日志。

`doctor` 只检查配置、数据库、检查点、存储和媒体工具，不调用生成模型。`smoke` 是显式生成操作；live 模式可能产生供应商消耗。

## 测试

`uv run pytest -q -m "not integration"`。真实数据库和 MinIO 测试要求 `RUNWAY_INTEGRATION=1`，再执行 `uv run pytest -q -m integration`；只用 mock 外部模型，真实运行 PostgreSQL saver、S3 与 FFmpeg。

Worker 默认一个执行槽位，每 10 秒续约一次，租约 60 秒。人工确认不占槽位。视频任务 ID 在轮询前落库；同步调用中断且结果不明确时进入 `NEEDS_ATTENTION`，只有用户明确重试才发起新尝试。重跑通过平台创建新的运行和媒体快照，不覆盖历史。

临时媒体放在 `RUNWAY_TEMP_DIR`，完成节点前上传私有对象存储；检查点只保存运行 ID，业务状态只引用媒体 ID 与对象键，不依赖本地路径。数据库、检查点 schema 与对象存储必须一并备份。

## 迁移来源

提示词和供应商语义来自旧 `服装秀/runway/src/react_agent/` 项目的 `graph.py`、`agents/tryon.py`、`agents/multi_image_agent.py`、`agents/video_agent.py` 和 `agents/music.py`。旧项目为 MIT 模板衍生作品，保留许可证于本目录 LICENSE。新实现提取提示词和生成语义，替换 Django 会话、本地路径和内存持久化。没有迁入旧 `.env`、SQLite、历史输出或源码凭据。源文件哈希和完整能力对照由仓库迁移实施记录保存。

真实模型可用性以单项冒烟记录为准。即梦 3.0 与 MiniMax 旧账户可能受到接口下线或账户权限影响，执行器不自动切换供应商。
