# 模块说明

## 总览

平台由三块用户可见能力组成：

1. 设计工作台：AI 对话、生图、局部编辑、图案迁移、虚拟试衣、素材沉淀。
2. 趋势分析：抓取时尚资讯、LLM 分析、报告生成、趋势时间线、文章库。
3. 衣橱与资料库：用户画像、设计项目、素材库、衣橱单品和搭配。

## 前端模块

路径：`frontend/src/modules/`

| 模块 | 说明 |
| --- | --- |
| `design-studio/` | 设计工作台，包含聊天、画布、面料编辑和设计输出 |
| `trend-analysis/` | 趋势分析工作区，连接趋势服务报告和流水线 |
| `trends/` | 趋势看板和设计侧趋势浏览 |
| `trends-hub/` | 趋势入口与聚合视图 |
| `tryon/` | 虚拟试衣体验 |
| `wardrobe/` | 衣橱单品和搭配管理 |
| `library/` | 设计资产和素材管理 |

页面入口位于 `frontend/src/pages/`：

- `LandingPage.tsx`
- `AuthPage.tsx`
- `MainApp.tsx`

## 设计服务模块

路径：`services/design/`

| 模块 | 说明 |
| --- | --- |
| `app.py` | FastAPI 应用创建、CORS、中间件和路由挂载 |
| `runtime.py` | 会话状态、认证中间件、工具执行、业务函数、趋势同步 |
| `server.py` | 兼容入口，仅导出 `app` |
| `run.py` | 服务启动器，支持 stub fallback |
| `ai_clients.py` | amux.ai OpenAI-compatible API 封装 |
| `db.py` | SQLite 数据访问，包含用户画像、项目、素材、衣橱等 |
| `routes/` | HTTP 路由拆分 |
| `agents/` | Agent 工具注册、工具定义和调用记录 |
| `presets/` | 试衣预设 |
| `data/` | `profiles.db` 和工具 trace |
| `outputs/` | 生成图片 |

### 设计服务路由

| 文件 | 职责 |
| --- | --- |
| `routes/health.py` | 健康检查 |
| `routes/auth.py` | 注册、登录、会话 |
| `routes/profile.py` | 用户画像、设计项目、趋势绑定 |
| `routes/chat.py` | AI 对话、会话收藏和导出 |
| `routes/images.py` | 上传、图片访问、局部编辑、提示词增强、图片分析 |
| `routes/library.py` | 素材库、合集、标签、相似素材和搭配建议 |
| `routes/tryon.py` | 试衣预设、试衣生成、保存搭配 |
| `routes/wardrobe.py` | 衣橱单品和搭配 |
| `routes/trends.py` | 设计侧趋势缓存、同步和收藏 |

### Agent 工具链

路径：`services/design/agents/`

| 文件 | 职责 |
| --- | --- |
| `base.py` | `BaseTool`、`ToolContext`、`ToolTrace` |
| `registry.py` | `ToolRegistry`，统一注册、运行和回放工具 |
| `tools.py` | 具体工具定义 |
| `trace.py` | JSONL trace store |

当前工具注册在 `runtime.TOOL_REGISTRY`，OpenAI tool schema 由注册表生成。调用记录写入：

```text
services/design/data/tool_traces/tool_calls.jsonl
```

## 趋势服务模块

路径：`services/trend/`

| 模块 | 说明 |
| --- | --- |
| `app.py` | FastAPI 应用创建、CORS、路由挂载和静态页面挂载 |
| `runtime.py` | 调度器生命周期、共享状态、报告和任务辅助函数 |
| `api.py` | 兼容入口，仅导出 `app` |
| `scheduler.py` | 趋势流水线编排 |
| `scraper.py` | Playwright 抓取 |
| `llm_analyzer.py` | LiteLLM 趋势分析 |
| `processor.py` | 文章处理和质量评分 |
| `storage.py` | SQLite 存储 |
| `models.py` | Pydantic 数据模型 |
| `config.py` | 配置，读取根目录 `.env` |
| `routes/` | HTTP 和 WebSocket 路由 |
| `frontend/` | 趋势服务内置静态前端 |
| `site_configs/` | 抓取站点配置 |
| `prompts/` | LLM prompt 模板 |

### 趋势服务路由

| 文件 | 职责 |
| --- | --- |
| `routes/health.py` | 健康检查、元信息、统计 |
| `routes/reports.py` | 报告、文章、趋势、站点和订阅 |
| `routes/pipeline.py` | 任务、触发、暂停、恢复、重试 |
| `routes/websocket.py` | `/ws/pipeline` 实时进度 |

## 统一模型路由

路径：`services/model_router.py`

`ModelRouter` 统一处理：

- 文本模型：`text_model()`
- 视觉模型：`vision_model()`
- 图片生成模型：`image_model()`
- 图片编辑模型：`image_edit_model()`
- 试衣模型：`tryon_model()`
- 趋势分析模型：`trend_model()`
- 失败回退：`fallback_model()`

配置优先级：

1. `MODEL_ROUTES_JSON`
2. `MODEL_<TASK>_PRIMARY` / `MODEL_<TASK>_FALLBACK`
3. 旧环境变量，如 `AMUX_TEXT_MODEL`、`AMUX_IMAGE_MODEL`、`LLM_MODEL`
4. 内置默认值

## 数据库与本地文件

| 路径 | 说明 |
| --- | --- |
| `services/design/data/profiles.db` | 用户画像、会话、素材、衣橱等设计侧数据 |
| `services/design/data/tool_traces/tool_calls.jsonl` | Agent 工具调用记录 |
| `services/design/outputs/` | 设计侧生成图片 |
| `services/trend/storage/fashion_pipeline.db` | 趋势侧文章、任务、报告和图片映射 |
| `services/trend/data/` | 趋势抓取和报告数据 |
| `services/trend/logs/` | 趋势服务日志 |

## 启动与回退

`start.py` 是正式本地平台控制台。它会启动三个进程并打印健康摘要。

`services/_stubs/` 中的 stub 服务只用于真实后端不可用时的回退，不是主要业务实现。
