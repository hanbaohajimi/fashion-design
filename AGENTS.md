# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

AI Fashion Design Platform — a single self-contained project with two backend services and one React frontend.

## Commands

### Start everything

```bash
# 方式一：一键启动（自动激活 venv）
start-isolated.bat

# 方式二：手动激活 venv 后启动
.venv\Scripts\activate       # Windows
python start.py
```

Launches Frontend (port 3100) + Design Studio (port 8001) + Trend Analysis (port 8002).

### Start individually
```bash
cd frontend && npm run dev                        # port 3100
cd services/design && python run.py              # port 8001
cd services && python trend_runner.py            # port 8002
```

### Install dependencies (隔离环境)
```bash
# 1. 创建 Python 虚拟环境（首次）
cd "G:\fashion-design"
python -m venv .venv

# 2. 激活虚拟环境
.venv\Scripts\activate       # Windows

# 3. 安装后端依赖
pip install -r services/design/requirements.txt
pip install -r services/trend_requirements.txt
python -m playwright install chromium

# 4. 安装前端依赖
cd frontend && npm install
```

## Project Layout

```
fashion design/
├── .venv/                       Python 虚拟环境（隔离，已在 .gitignore）
├── .env                         唯一配置文件（所有服务的 API Key + 模型参数）
├── env.example                  配置模板（复制为 .env 后填写）
├── start.py                     一键启动器（所有服务）
├── start-isolated.bat           一键启动脚本（自动激活 venv）
│
├── frontend/                    React 19 + Vite + Tailwind — unified shell
│   └── src/
│       ├── App.tsx              Router (view state + auth guards)
│       ├── pages/               Landing, Auth, ToolSelector, MainApp
│       ├── modules/             Workspace modules (design-studio, trend-analysis)
│       └── components/          Shared: Toast, ErrorBoundary
│
├── services/                    All backend services
│   ├── design/                  Design Studio (FastAPI, port 8001)
│   │   ├── server.py            Main app (AI chat + image gen/edit/tryon)
│   │   ├── ai_clients.py        amux.ai 客户端（OpenAI 兼容代理）
│   │   ├── run.py               Launcher with stub fallback
│   │   └── requirements.txt
│   ├── trend/                   Trend Analysis (FastAPI, port 8002)
│   │   ├── api.py               HTTP endpoints + WebSocket
│   │   ├── scheduler.py         Pipeline orchestrator (24h schedule)
│   │   ├── scraper.py           Playwright crawler
│   │   ├── llm_analyzer.py      LLM calls via LiteLLM (DeepSeek)
│   │   ├── processor.py         Article quality scoring
│   │   ├── models.py            Pydantic data models
│   │   ├── storage.py           SQLite access
│   │   ├── config.py            Settings (env_file 指向根 .env)
│   │   ├── frontend/            Vanilla HTML/CSS/JS served by FastAPI
│   │   ├── prompts/             LLM prompt templates
│   │   └── site_configs/        Vogue CN scraping config
│   ├── _stubs/                  Stub/placeholder apps (no real AI)
│   │   ├── design_stub_app.py
│   │   └── trend_stub_app.py
│   ├── trend_runner.py          Trend service launcher
│   └── trend_requirements.txt
│
├── docs/                        Architecture docs
├── scripts/                     install.bat, start-all.bat/sh, docgen/
└── services/design/data/        SQLite profiles.db
```

## Architecture Notes

### Vite Proxy (frontend/vite.config.ts)
- `/api/design/*` → `localhost:8001/api/*`
- `/api/images/*` → `localhost:8001/api/*`
- `/api/tryon/*` → `localhost:8001/api/*`
- `/api/trend/*` → `localhost:8002/api/*`
- `/ws/*` → `localhost:8002` (WebSocket for pipeline progress)

### Design Studio (services/design/)
Uses amux.ai proxy (OpenAI-compatible): `gpt-image-2` (image generation/edit/tryon), `gemini-3-pro-preview` or `Codex-sonnet-4-6` (chat + vision). API key via `AMUX_API_KEY` in root `.env`. `ai_clients.py` reads from `os.environ` directly (no dotenv).

### Trend Analysis (services/trend/)
All Python modules use **bare imports** (`from config import`, `from models import`) — they work because `trend_runner.py` inserts `services/trend/` into `sys.path`.

`config.py` sets `BASE_DIR = Path(__file__).parent`, and its pydantic-settings `env_file` points to **project root** `.env` (`BASE_DIR.parent.parent / ".env"`). All data/log/storage paths resolve relative to `services/trend/`.

The vanilla JS frontend (`services/trend/frontend/`) is served by FastAPI via `StaticFiles`. Changes there must pass `node --check services/trend/frontend/app.js`.

### Stub Services (services/_stubs/)
Lightweight FastAPI apps that respond to health checks when the real backend is unavailable. Loaded automatically by launchers when backend import fails.

## 统一配置文件

项目只使用**一个** `.env` 文件，位于项目根目录：

| 变量 | 服务 | 说明 |
|------|------|------|
| `FASHION_FRONTEND_PORT` | 前端 | Vite dev server 端口（默认 3100） |
| `AMUX_API_KEY` | 设计 | amux.ai API 密钥（api.amux.ai） |
| `AMUX_TEXT_MODEL` | 设计 | 文本/视觉模型（默认 gemini-3-pro-preview） |
| `AMUX_IMAGE_MODEL` | 设计 | 图像模型（默认 gpt-image-2） |
| `LLM_PROVIDER` | 趋势 | LiteLLM 提供者（deepseek / openai / anthropic） |
| `LLM_MODEL` | 趋势 | 模型名（如 deepseek-v4-pro） |
| `API_KEY` | 趋势 | DeepSeek API 密钥 |
| `QWEN_API_KEY` | 趋势 | 阿里百炼搜索（可选，platform.deepseek.com） |

三个启动器（`start.py`、`run.py`、`trend_runner.py`）都在启动时加载根 `.env` 到 `os.environ`，`config.py` 通过 pydantic-settings 的 `env_file` 也读取根 `.env`。

## 迁移到新机器

### 1. 打包传输（源机器）

```bash
# 在项目根目录上一层执行，排除 node_modules / venv / SQLite 数据 / 日志
tar --exclude='*/node_modules' \
    --exclude='*/__pycache__' \
    --exclude='*/.venv' \
    --exclude='*/storage/*.db' \
    --exclude='*/data/raw' \
    --exclude='*/logs' \
    -czf fashion-design.tar.gz "fashion-design/"
```

或用 rsync（适合同局域网）：

```bash
rsync -av --exclude='node_modules' --exclude='__pycache__' \
      --exclude='.venv' --exclude='storage/*.db' \
      fashion-design/ user@新机器IP:/目标路径/fashion-design/
```

### 2. 环境要求（目标机器）

| 依赖 | 最低版本 |
|------|---------|
| Node.js | 18+ |
| Python | 3.11+ |
| Chromium | 由 Playwright 自动安装 |

### 3. 安装依赖（目标机器）

```bash
cd fashion-design

# 创建 Python 虚拟环境
python -m venv .venv
.venv\Scripts\activate         # Windows

# 后端
pip install -r services/design/requirements.txt
pip install -r services/trend_requirements.txt
python -m playwright install chromium

# 前端
cd frontend && npm install && cd ..
```

### 4. 配置 API 密钥

```bash
# 只需复制一个文件
cp env.example .env
# 编辑 .env，填写必填项即可（详见上方「统一配置文件」章节）
```

### 5. 启动验证

```bash
# 使用便捷脚本
start-isolated.bat

# 或手动
.venv\Scripts\activate
python start.py

# 验证
# http://localhost:3100    前端
# http://localhost:8001/api/health   设计后端
# http://localhost:8002/api/health   趋势后端
```

### 迁移注意事项

- **不要迁移 `.env` 文件本身**，只复制 `env.example` 再填写新密钥。
- `services/design/data/profiles.db` 包含用户画像数据，按需决定是否一并迁移。
- `services/trend/storage/fashion_pipeline.db` 是趋势分析历史数据，可选迁移（不迁移则从零重跑流水线）。
- **所有 Python 依赖必须装在 `.venv` 内**，不要用系统 pip 安装，以免污染其他项目。

---

## Key Gotchas

- `services/trend/` Python files use bare module imports — **never move individual files out of that directory** without updating all import statements.
- Frontend port is **3100** (configurable via `FASHION_FRONTEND_PORT` in `.env`).
- After editing `services/trend/frontend/app.js`, always run `node --check services/trend/frontend/app.js` to catch syntax errors before restarting.
- **统一 `.env`**：所有模型和 API 配置都在项目根 `.env` 一个文件中。`config.py` 的 `env_file` 已改为指向根 `.env`，不要在 `services/trend/` 下再创建单独的 `.env`。
- **虚拟环境**：始终通过 `.venv\Scripts\activate` 激活后再运行 Python 命令，或使用 `start-isolated.bat` 一键启动。
