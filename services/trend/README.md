# Trend API 服务说明

`services/trend/` 是 AI Fashion Design Platform 的趋势分析后端，运行在端口 `8002`。

它负责抓取时尚资讯、分析趋势、生成报告、管理流水线任务，并通过 WebSocket 向前端推送进度。

## 当前入口

| 文件 | 说明 |
| --- | --- |
| `app.py` | 当前 FastAPI 应用入口 |
| `api.py` | 兼容入口，导出 `app`，可直接运行 |
| `runtime.py` | 生命周期、调度器、共享状态和辅助函数 |
| `routes/` | HTTP 和 WebSocket 路由 |
| `scheduler.py` | 流水线编排 |
| `scraper.py` | Playwright 抓取 |
| `llm_analyzer.py` | LiteLLM 趋势分析 |
| `processor.py` | 文章处理与质量评分 |
| `storage.py` | SQLite 存储 |
| `models.py` | Pydantic 数据模型 |
| `config.py` | 配置，读取项目根目录 `.env` |

## 目录结构

```text
services/trend/
├── app.py
├── runtime.py
├── api.py
├── routes/
│   ├── health.py
│   ├── reports.py
│   ├── pipeline.py
│   └── websocket.py
├── scheduler.py
├── scraper.py
├── llm_analyzer.py
├── processor.py
├── storage.py
├── models.py
├── config.py
├── frontend/
├── prompts/
├── site_configs/
├── storage/
├── data/
└── logs/
```

## 启动

推荐从项目根目录启动整个平台：

```bash
python start.py
```

单独启动趋势服务：

```bash
cd services
python trend_runner.py
```

或：

```bash
cd services/trend
python api.py
```

## 配置

趋势服务读取项目根目录 `.env`，不要在 `services/trend/` 下创建单独 `.env`。

常用配置：

| 变量 | 说明 |
| --- | --- |
| `TREND_ANALYSIS_PORT` | 服务端口，默认 `8002` |
| `CORS_ALLOWED_ORIGINS` | 允许的前端来源 |
| `LLM_PROVIDER` | LiteLLM provider，如 `deepseek`、`openai`、`anthropic`、`local` |
| `LLM_MODEL` | 趋势分析主模型 |
| `LLM_FALLBACK_MODEL` | 趋势分析 fallback 模型 |
| `LLM_BASE_URL` | 可选 API base URL |
| `API_KEY` | LLM provider API key |
| `QWEN_API_KEY` | 可选搜索能力 API key |
| `MODEL_ROUTES_JSON` | 统一模型路由配置 |

模型选择会经过 `services/model_router.py`。

## API

### 健康与元信息

- `GET /api/health`
- `GET /health`
- `GET /api/meta`
- `GET /api/stats`

### 报告、趋势、文章

- `GET /api/reports/filters`
- `GET /api/reports`
- `GET /api/reports/latest`
- `GET /api/reports/{report_id}`
- `GET /api/reports/{report_id}/export`
- `GET /api/reports/{left_id}/compare/{right_id}`
- `GET /api/trends/hot`
- `GET /api/trends/timeline`
- `GET /api/trends/dimension-stats`
- `GET /api/articles`
- `GET /api/articles/{unique_key}/raw-html`
- `POST /api/subscribe`
- `POST /api/articles/dedupe`
- `GET /api/sites`

### 流水线

- `GET /api/tasks`
- `GET /api/tasks/{run_id}`
- `GET /api/tasks/current`
- `POST /api/pipeline/trigger`
- `GET /api/pipeline/state`
- `POST /api/pipeline/pause`
- `POST /api/pipeline/resume`
- `POST /api/pipeline/retry/{run_id}`

### WebSocket

```text
ws://localhost:8002/ws/pipeline
```

## 内置前端

`app.py` 会把 `services/trend/frontend/` 挂载到：

- `/`
- `/static/*`

修改 `services/trend/frontend/app.js` 后应运行：

```bash
node --check services/trend/frontend/app.js
```

## 数据文件

| 路径 | 说明 |
| --- | --- |
| `services/trend/storage/fashion_pipeline.db` | 文章、报告、任务、图片映射 |
| `services/trend/data/` | 抓取数据、报告 JSON、图片等 |
| `services/trend/logs/` | 服务日志 |
| `services/trend/site_configs/` | 站点配置 |

## 注意事项

- 当前趋势模块仍大量使用裸导入，如 `from config import settings`。`trend_runner.py` 会把 `services/trend/` 加入 `sys.path`。
- 不要把单个趋势模块随意移动到其他目录，除非同步更新 import。
- `api.py` 是兼容入口，新路由应添加到 `routes/`。
