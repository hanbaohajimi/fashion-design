# AI Fashion Design Platform

本项目是一个本地运行的 AI 时尚设计平台，由一个 React 前端和两个 FastAPI 后端组成：

- 前端工作台：端口 `3100`
- 设计服务 Design API：端口 `8001`
- 趋势服务 Trend API：端口 `8002`

平台支持趋势分析、AI 服装设计对话、图片生成/编辑、虚拟试衣、衣橱管理和用户画像管理。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19, Vite 8, TypeScript, Tailwind CSS v4, Fabric.js |
| 设计后端 | FastAPI, SQLite, amux.ai OpenAI-compatible API |
| 趋势后端 | FastAPI, SQLite, Playwright, LiteLLM |
| 启动器 | Python 本地平台控制台 |

## 快速开始

### 环境要求

- Node.js 18+
- Python 3.11+
- Playwright Chromium

### 安装依赖

```bash
python -m venv .venv
.venv\Scripts\activate

pip install -r services/design/requirements.txt
pip install -r services/trend_requirements.txt
python -m playwright install chromium

cd frontend && npm install && cd ..
```

### 配置

复制配置模板：

```bash
cp env.example .env
```

常用变量：

| 变量 | 说明 |
| --- | --- |
| `FASHION_FRONTEND_PORT` | 前端端口，默认 `3100` |
| `AMUX_API_KEY` | 设计服务使用的 amux.ai API key |
| `AMUX_TEXT_MODEL` | 设计对话/视觉模型 |
| `AMUX_IMAGE_MODEL` | 图片生成模型 |
| `LLM_PROVIDER` | 趋势分析模型提供方，支持 `deepseek`、`openai`、`anthropic`、`local` |
| `LLM_MODEL` | 趋势分析主模型 |
| `MODEL_ROUTES_JSON` | 可选的统一模型路由配置 |

项目只使用根目录 `.env`。不要在 `services/trend/` 下再创建单独 `.env`。

### 启动

```bash
start-isolated.bat
```

或手动：

```bash
.venv\Scripts\activate
python start.py
```

只做启动前检查：

```bash
python start.py --check-only
```

启动器会检查端口、数据库文件、`AMUX_API_KEY` 和 Playwright Chromium，并输出类似：

```text
Fashion Design Platform

[OK] Frontend port: 3100
[OK] Design API port: 8001
[OK] Trend API port: 8002
[OK] profiles.db found
[OK] fashion_pipeline.db found
[WARN] AMUX_API_KEY missing, design AI will use stub mode
[OK] Playwright Chromium installed

Open: http://localhost:3100
```

## 项目结构

```text
fashion-design/
├── frontend/                    React + Vite 前端
│   └── src/
│       ├── pages/               Landing、Auth、MainApp
│       ├── modules/             design-studio、trend-analysis、trends、tryon、wardrobe、library
│       └── components/          共享组件
├── services/
│   ├── model_router.py          统一模型路由器
│   ├── trend_runner.py          趋势服务启动器
│   ├── trend_requirements.txt
│   ├── _stubs/                  后端不可用时的轻量回退服务
│   ├── design/
│   │   ├── app.py               Design API FastAPI 应用
│   │   ├── runtime.py           设计服务运行时、会话、工具执行和业务函数
│   │   ├── server.py            兼容入口，仅导出 app
│   │   ├── run.py               设计服务启动器
│   │   ├── ai_clients.py        amux.ai 客户端
│   │   ├── db.py                用户画像、资产、衣橱等 SQLite 访问
│   │   ├── routes/              auth、chat、images、library、profile、trends、tryon、wardrobe
│   │   ├── agents/              工具注册表、BaseTool、trace、工具定义
│   │   ├── presets/             试衣预设资源
│   │   ├── data/                profiles.db、tool_traces
│   │   └── outputs/             生成图片输出
│   └── trend/
│       ├── app.py               Trend API FastAPI 应用
│       ├── runtime.py           趋势服务运行时、调度器和共享状态
│       ├── api.py               兼容入口，仅导出 app
│       ├── routes/              health、reports、pipeline、websocket
│       ├── scheduler.py         趋势流水线编排
│       ├── scraper.py           Playwright 抓取器
│       ├── llm_analyzer.py      LiteLLM 趋势分析
│       ├── storage.py           fashion_pipeline.db 访问
│       ├── frontend/            趋势服务内置静态页面
│       ├── prompts/
│       └── site_configs/
├── docs/                        架构、API、能力和产品文档
├── scripts/
├── env.example
├── start.py
└── start-isolated.bat
```

## API 入口

前端通过 Vite proxy 访问后端：

| 前端路径 | 目标 |
| --- | --- |
| `/api/design/*` | `http://127.0.0.1:8001/api/*` |
| `/api/images/*` | `http://127.0.0.1:8001/api/images/*` |
| `/api/tryon/*` | `http://127.0.0.1:8001/api/tryon/*` |
| `/api/trend/*` | `http://127.0.0.1:8002/api/*` |
| `/ws/*` | `http://127.0.0.1:8002/ws/*` |

`/api/gateway/*` 目前只是 Vite 中保留的预留代理，项目没有启动独立 Gateway 服务。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [API 对接](docs/API.md)
- [模块说明](docs/MODULES.md)
- [系统能力报告](docs/SYSTEM_CAPABILITIES_REPORT.md)
- [趋势服务说明](services/trend/README.md)

## 验证命令

```bash
python -m compileall -q services/design services/trend services/model_router.py start.py
node --check services/trend/frontend/app.js
cd frontend && npm run build
python start.py --check-only
```

## License

MIT
