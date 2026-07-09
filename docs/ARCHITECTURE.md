# 系统架构说明

## 1. 总体架构

AI Fashion Design Platform 是一个本地运行的三进程平台：

```text
React / Vite frontend              http://localhost:3100
        │
        ├── /api/design/* ───────▶ Design API  http://localhost:8001
        ├── /api/images/* ───────▶ Design API
        ├── /api/tryon/* ────────▶ Design API
        ├── /api/trend/* ────────▶ Trend API   http://localhost:8002
        └── /ws/* ───────────────▶ Trend API WebSocket
```

正式启动入口是：

```text
start.py
├── services/design/run.py
├── services/trend_runner.py
└── frontend npm run dev
```

`start.py --check-only` 只做本地检查，不启动长驻进程。

## 2. 启动器职责

`start.py` 负责：

- 加载根目录 `.env`
- 读取端口配置
- 启动设计服务、趋势服务和前端
- 检查 `profiles.db`
- 检查 `fashion_pipeline.db`
- 检查 `AMUX_API_KEY`
- 检查 Playwright Chromium
- 输出平台控制台摘要
- Ctrl+C 时停止所有子进程

端口默认值：

| 服务 | 变量 | 默认端口 |
| --- | --- | ---: |
| Frontend | `FASHION_FRONTEND_PORT` | `3100` |
| Design API | `DESIGN_STUDIO_PORT` | `8001` |
| Trend API | `TREND_ANALYSIS_PORT` | `8002` |

## 3. 前端架构

路径：`frontend/`

前端使用 React 19 + Vite + TypeScript + Tailwind CSS v4。主要目录：

```text
frontend/src/
├── App.tsx
├── pages/
│   ├── LandingPage.tsx
│   ├── AuthPage.tsx
│   └── MainApp.tsx
├── modules/
│   ├── design-studio/
│   ├── library/
│   ├── trend-analysis/
│   ├── trends/
│   ├── trends-hub/
│   ├── tryon/
│   └── wardrobe/
└── components/
```

Vite proxy 负责把开发环境请求分发到两个后端。`/api/gateway/*` 当前只是预留代理；仓库没有独立 Gateway 服务，`start.py` 不会启动端口 `8000`。

## 4. 设计服务架构

路径：`services/design/`

当前主入口是 `app.py`：

```text
services/design/
├── app.py
├── runtime.py
├── server.py
├── run.py
├── ai_clients.py
├── db.py
├── routes/
├── agents/
├── presets/
├── data/
└── outputs/
```

`server.py` 仅是兼容入口：

```python
from app import app
```

不要把新业务逻辑加回 `server.py`。

### 路由层

`app.py` 挂载：

- `routes/health.py`
- `routes/auth.py`
- `routes/profile.py`
- `routes/chat.py`
- `routes/images.py`
- `routes/library.py`
- `routes/trends.py`
- `routes/wardrobe.py`
- `routes/tryon.py`

### 运行时层

`runtime.py` 保留当前设计服务的大部分运行时状态和业务函数，包括：

- 登录认证中间件
- 会话状态
- AI 对话流
- 工具执行
- 图片输出路径
- 趋势同步
- 试衣预设加载

后续继续拆分时，应从 `runtime.py` 中按职责迁移到更小的 service/repository 模块。

### Agent 工具系统

Agent 工具链位于 `services/design/agents/`：

```text
agents/
├── base.py
├── registry.py
├── tools.py
└── trace.py
```

工具通过 `ToolRegistry` 注册，挂载在 `runtime.TOOL_REGISTRY`。每个工具提供：

- `name`
- `description`
- `input_schema`
- `output_schema`
- `run(args, context)`

每次工具调用都会记录到：

```text
services/design/data/tool_traces/tool_calls.jsonl
```

记录字段包括：

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

这些记录支持回放、失败重试、成本统计和设计溯源。

## 5. 趋势服务架构

路径：`services/trend/`

当前主入口是 `app.py`：

```text
services/trend/
├── app.py
├── runtime.py
├── api.py
├── routes/
├── scheduler.py
├── scraper.py
├── llm_analyzer.py
├── processor.py
├── storage.py
├── models.py
├── config.py
├── frontend/
├── prompts/
└── site_configs/
```

`api.py` 仅是兼容入口。直接运行 `api.py` 仍可启动服务，但新路由应放在 `routes/`。

### 路由层

`app.py` 挂载：

- `routes/health.py`
- `routes/reports.py`
- `routes/pipeline.py`
- `routes/websocket.py`

趋势服务还会把 `services/trend/frontend/` 挂载为静态页面，并在 `/` 提供内置 UI。

### 流水线

核心流程：

```text
site_configs
    │
    ▼
scraper.py
    │
    ▼
processor.py
    │
    ▼
llm_analyzer.py
    │
    ▼
storage.py
    │
    ▼
reports + websocket progress
```

`scheduler.py` 负责调度和运行完整流水线，`runtime.py` 负责服务生命周期和共享状态。

## 6. 模型路由

路径：`services/model_router.py`

模型选择集中在 `ModelRouter`：

```python
router.text_model("design_chat")
router.vision_model("vision_tagging")
router.image_model("image_generation")
router.image_edit_model("image_edit")
router.tryon_model("virtual_tryon")
router.trend_model("trend_analysis")
router.fallback_model(failed_model)
```

配置来源优先级：

1. `MODEL_ROUTES_JSON`
2. `MODEL_<TASK>_PRIMARY` / `MODEL_<TASK>_FALLBACK`
3. 兼容旧变量：`AMUX_TEXT_MODEL`、`AMUX_IMAGE_MODEL`、`LLM_MODEL` 等
4. 默认值

趋势分析通过 `litellm_model_id()` 和 `litellm_fallback_model_id()` 生成 LiteLLM 可识别的模型 ID。

## 7. 配置

项目只使用根目录 `.env`。

关键配置：

| 变量 | 说明 |
| --- | --- |
| `FASHION_FRONTEND_PORT` | 前端端口 |
| `DESIGN_STUDIO_PORT` | 设计服务端口 |
| `TREND_ANALYSIS_PORT` | 趋势服务端口 |
| `CORS_ALLOWED_ORIGINS` | 后端允许来源 |
| `AMUX_API_KEY` | 设计 AI API key |
| `AMUX_TEXT_MODEL` | 设计对话/视觉模型 |
| `AMUX_IMAGE_MODEL` | 图片生成模型 |
| `AMUX_IMAGE_EDIT_MODEL` | 图片编辑模型 |
| `AMUX_TRYON_MODEL` | 试衣模型 |
| `LLM_PROVIDER` | 趋势 LLM provider |
| `LLM_MODEL` | 趋势分析模型 |
| `MODEL_ROUTES_JSON` | 统一模型路由 |

`services/trend/config.py` 通过 pydantic-settings 指向根目录 `.env`。

## 8. 数据存储

| 路径 | 说明 |
| --- | --- |
| `services/design/data/profiles.db` | 设计侧用户、画像、项目、素材和衣橱数据 |
| `services/design/data/tool_traces/tool_calls.jsonl` | Agent 工具调用记录 |
| `services/design/outputs/` | 生成图片 |
| `services/trend/storage/fashion_pipeline.db` | 趋势文章、报告、任务和图片映射 |
| `services/trend/data/` | 抓取和报告中间文件 |
| `services/trend/logs/` | 趋势服务日志 |

## 9. 回退服务

`services/_stubs/` 是轻量 stub 服务，用于真实后端导入失败或显式配置 stub 时保证启动器仍能响应健康检查。

stub 不是正式业务实现；真实功能应在 `services/design/` 和 `services/trend/` 中维护。

## 10. 当前已知边界

- 没有独立 Gateway 服务。
- 趋势服务仍有较多模块使用裸导入，移动文件前需要同步更新 import。
- `runtime.py` 仍偏大，后续可继续拆到更细的 service/repository 模块。
- 真实外部 AI 调用依赖 `.env` 中的 API key；缺失时部分能力会进入 stub 或失败回退。

## 11. 趋势分析前端模块（React 迁移状态）

`frontend/src/modules/trend-analysis/` 已完成五步 React 化迁移，不再是 iframe 黑盒。

### 当前模块结构

```text
frontend/src/modules/trend-analysis/
├── types.ts                  — 类型定义（TaskState / PipelineState / ReportDetail 等）
├── trendApi.ts               — API 层（fetchPipelineState / fetchReportDetail / WebSocket 工厂）
├── utils.ts                  — 工具函数（shouldShowLegacyTrendFrame）
├── TrendAnalysisWorkspace.tsx — 页面编排，WebSocket / polling 生命周期
├── trend-analysis.css
└── components/
    ├── PipelineControlPanel.tsx  — Start / Pause / Resume + 进度展示
    ├── LatestReportCard.tsx      — 最近报告摘要卡片
    ├── TrendReportList.tsx       — 报告列表侧边栏
    ├── TrendReportDetail.tsx     — 报告详情主区域（React 原生）
    └── LegacyTrendFrame.tsx      — 旧版 iframe 包装器（仅保留，不再作主视图）
```

### React 已接管的能力

| 能力 | 实现 |
| --- | --- |
| Pipeline Start / Pause / Resume | PipelineControlPanel |
| WebSocket 实时状态 + 轮询 fallback | TrendAnalysisWorkspace |
| 报告列表浏览 | TrendReportList |
| 报告详情展示 | TrendReportDetail |
| 最近报告摘要 | LatestReportCard |

### Legacy iframe 策略

`services/trend/frontend/` 的旧版 HTML/CSS/JS 页面仍然存在，在以下场景继续工作：

- **独立访问 `http://localhost:8002`**：旧页面完整运行，包含自己的 WebSocket 连接和 Pipeline 控制 UI。
- **嵌入调试预览**：TrendReportDetail 可通过 Legacy Preview 按钮展开旧版 iframe（默认隐藏）。

当旧页面以 `?embedded=1` 参数加载时：
- 不建立 WebSocket 连接（避免与 React 层竞争）
- `#report/{id}` hash 参数会触发 hashchange 监听，自动导航到指定报告

Legacy Preview 入口**默认隐藏**，仅在以下条件显示：

```text
1. 环境变量：VITE_SHOW_LEGACY_TREND_IFRAME=true（重启前端后生效）
2. URL 参数：?debugLegacyTrend=1（无需重启，关闭 tab 或去掉参数即恢复）
```

### Vite 代理关系

| 前端路径 | 后端 |
| --- | --- |
| `/api/trend/*` | `localhost:8002/api/*`（自动去掉 `/api/trend` 前缀） |
| `/ws/pipeline` | `localhost:8002/ws/pipeline`（WebSocket 升级） |
