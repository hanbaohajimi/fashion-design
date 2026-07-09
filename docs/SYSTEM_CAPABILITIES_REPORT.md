# AI 时尚设计平台系统能力报告

> 基于当前代码库结构整理
> 项目路径：`fashion-design/`

## 1. 平台定位

AI Fashion Design Platform 是一个本地运行的时尚设计工作台。它把趋势分析、AI 设计生成、素材沉淀、用户画像和衣橱管理放在同一个前端壳层中，通过两个 FastAPI 后端提供能力。

核心目标：

- 让设计师从趋势信息进入创意生成。
- 让 AI 生成的图片、试衣结果和素材进入可管理的资产库。
- 让趋势报告、设计项目和用户画像形成可复用上下文。
- 让 Agent 工具调用可记录、可回放、可追踪。

## 2. 当前系统构成

| 层级 | 路径 | 能力 |
| --- | --- | --- |
| 前端 | `frontend/` | React 工作台、登录、设计、趋势、试衣、衣橱、素材库 |
| 设计服务 | `services/design/` | AI 对话、生图、修图、试衣、画像、素材、衣橱 |
| 趋势服务 | `services/trend/` | 文章抓取、趋势分析、报告、流水线任务、WebSocket |
| 模型路由 | `services/model_router.py` | 统一选择文本、视觉、图片、试衣和趋势模型 |
| 启动器 | `start.py` | 三端启动、本地健康检查、平台控制台输出 |

## 3. 启动能力

`start.py` 是正式启动入口：

```bash
python start.py
python start.py --check-only
```

启动器会检查：

- 前端端口 `3100`
- 设计服务端口 `8001`
- 趋势服务端口 `8002`
- `services/design/data/profiles.db`
- `services/trend/storage/fashion_pipeline.db`
- `AMUX_API_KEY`
- Playwright Chromium

## 4. 前端能力

前端位于 `frontend/src/`，主要模块包括：

| 模块 | 能力 |
| --- | --- |
| `design-studio/` | AI 设计对话、画布、面料/图片编辑 |
| `trend-analysis/` | 趋势服务报告、任务和统计 |
| `trends/` | 趋势看板和设计侧趋势浏览 |
| `trends-hub/` | 趋势入口与聚合 |
| `tryon/` | 虚拟试衣 |
| `wardrobe/` | 衣橱单品和搭配 |
| `library/` | 素材与资产管理 |

前端通过 Vite proxy 访问后端：

- `/api/design/*`
- `/api/images/*`
- `/api/tryon/*`
- `/api/trend/*`
- `/ws/*`

## 5. 设计服务能力

当前入口：`services/design/app.py`

兼容入口：`services/design/server.py`

主要能力：

- 用户注册、登录和会话管理
- 个人画像和设计师项目画像
- AI 对话与工具调用
- 文生图、图片编辑、局部 mask 编辑
- 图片分析和提示词增强
- 虚拟试衣与试衣预设
- 素材库、合集、相似素材和搭配建议
- 衣橱单品和 outfit 管理
- 设计侧趋势同步与收藏

### 设计服务拆分状态

```text
services/design/
├── app.py
├── runtime.py
├── routes/
├── agents/
├── ai_clients.py
├── db.py
├── run.py
└── server.py
```

`app.py` 负责应用创建和路由挂载；`routes/` 负责 HTTP 边界；`runtime.py` 仍承载较多运行时和业务函数，后续可继续拆薄。

### Agent 工具链

Agent 工具链已从散落逻辑收拢为注册表：

```text
services/design/agents/
├── base.py
├── registry.py
├── tools.py
└── trace.py
```

注册表能力：

- 生成 OpenAI-compatible tool schema
- 按工具名执行工具
- 记录结构化调用 trace
- 通过保存的 `input_args` 回放工具调用
- 对未知工具返回结构化错误

工具 trace 默认写入：

```text
services/design/data/tool_traces/tool_calls.jsonl
```

每条记录包含：

- `tool_name`
- `input_args`
- `model_name`
- `input_images`
- `output_images`
- `latency_ms`
- `cost`
- `error`
- `created_at`
- `output`

这为重试、回放、成本统计和设计溯源提供基础。

## 6. 趋势服务能力

当前入口：`services/trend/app.py`

兼容入口：`services/trend/api.py`

主要能力：

- 趋势服务健康检查与元信息
- 全局统计
- 报告列表、详情、导出、对比
- 热门趋势、趋势时间线和维度统计
- 文章列表和原始 HTML 查看
- 站点配置读取
- 流水线触发、暂停、恢复、重试
- 当前任务和任务历史
- `/ws/pipeline` 实时进度推送
- 内置静态趋势 UI

### 趋势服务拆分状态

```text
services/trend/
├── app.py
├── runtime.py
├── routes/
├── scheduler.py
├── scraper.py
├── llm_analyzer.py
├── processor.py
├── storage.py
├── models.py
├── config.py
├── frontend/
└── api.py
```

`routes/health.py`、`routes/reports.py`、`routes/pipeline.py` 和 `routes/websocket.py` 已经承担 HTTP/WebSocket 边界。

## 7. AI 与模型路由能力

模型路由位于：

```text
services/model_router.py
```

它统一处理：

- 设计对话模型
- 视觉模型
- 图片生成模型
- 图片编辑模型
- 试衣模型
- 趋势分析模型
- fallback 模型

设计侧外部 AI 通过 `services/design/ai_clients.py` 访问 amux.ai 的 OpenAI-compatible API。

趋势侧通过 `services/trend/llm_analyzer.py` 使用 LiteLLM，并通过 `ModelRouter` 生成 provider-aware model id。

## 8. 数据能力

| 数据 | 路径 | 说明 |
| --- | --- | --- |
| 用户/设计侧数据 | `services/design/data/profiles.db` | 用户、画像、项目、会话、素材、衣橱 |
| 工具调用 trace | `services/design/data/tool_traces/tool_calls.jsonl` | Agent 工具调用记录 |
| 设计输出 | `services/design/outputs/` | 生成图片 |
| 趋势数据库 | `services/trend/storage/fashion_pipeline.db` | 文章、报告、任务、图片映射 |
| 趋势数据 | `services/trend/data/` | 抓取和报告中间文件 |
| 趋势日志 | `services/trend/logs/` | Loguru 日志 |

## 9. 配置能力

项目使用根目录 `.env` 作为唯一配置文件。`services/trend/config.py` 已指向根 `.env`，不应再依赖 `services/trend/.env`。

关键配置：

- `FASHION_FRONTEND_PORT`
- `DESIGN_STUDIO_PORT`
- `TREND_ANALYSIS_PORT`
- `CORS_ALLOWED_ORIGINS`
- `AMUX_API_KEY`
- `AMUX_TEXT_MODEL`
- `AMUX_IMAGE_MODEL`
- `AMUX_IMAGE_EDIT_MODEL`
- `AMUX_TRYON_MODEL`
- `LLM_PROVIDER`
- `LLM_MODEL`
- `MODEL_ROUTES_JSON`

## 10. 当前边界与建议

### 已具备

- 本地三端一键启动
- 设计服务和趋势服务基础拆分
- Agent 工具注册表和 trace
- 模型路由器
- 设计/趋势 API smoke 可测
- 前端构建可验证

### 仍可改进

- `services/design/runtime.py` 仍偏大，可继续拆成更细的 service 层。
- `services/trend/` 仍有大量裸导入，移动文件前需要统一 import 策略。
- `/api/gateway/*` 只是预留代理，没有独立 Gateway 实现。
- 外部 AI 调用依赖真实 API key，自动化测试应避免默认消耗模型成本。
- 工具 trace 中 `cost` 字段目前是占位，后续可接入真实 token/image 计费统计。

## 11. 重要文件索引

| 类型 | 路径 |
| --- | --- |
| 平台启动器 | `start.py` |
| 前端入口 | `frontend/src/App.tsx` |
| 设计后端入口 | `services/design/app.py` |
| 设计兼容入口 | `services/design/server.py` |
| 设计路由 | `services/design/routes/` |
| Agent 工具链 | `services/design/agents/` |
| 设计 AI 客户端 | `services/design/ai_clients.py` |
| 设计数据库访问 | `services/design/db.py` |
| 趋势后端入口 | `services/trend/app.py` |
| 趋势兼容入口 | `services/trend/api.py` |
| 趋势路由 | `services/trend/routes/` |
| 趋势流水线 | `services/trend/scheduler.py` |
| 趋势存储 | `services/trend/storage.py` |
| 模型路由 | `services/model_router.py` |
