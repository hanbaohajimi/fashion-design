# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Fashion Design Platform — a single self-contained project with two backend services and one React frontend.

## Commands

### Start everything
```bash
python start.py
```
Launches Frontend (port 3100) + Design Studio (port 8001) + Trend Analysis (port 8002).

### Start individually
```bash
cd frontend && npm run dev                        # port 3100
cd services/design && python run.py              # port 8001
cd services && python trend_runner.py            # port 8002
```

### Install dependencies
```bash
cd frontend && npm install
pip install -r services/design/requirements.txt
pip install -r services/trend_requirements.txt
pip install playwright && python -m playwright install chromium
```

## Project Layout

```
fashion design/
├── frontend/                    React 19 + Vite + Tailwind — unified shell
│   └── src/
│       ├── App.tsx              Router (view state + auth guards)
│       ├── pages/               Landing, Auth, ToolSelector, MainApp
│       ├── modules/             Workspace modules (design-studio, trend-analysis)
│       └── components/          Shared: Toast, ErrorBoundary
│
├── services/                    All backend services
│   ├── design/                  Design Studio (FastAPI, port 8001)
│   │   ├── server.py            Main app (~1500 lines, DashScope AI APIs)
│   │   ├── run.py               Launcher with stub fallback
│   │   └── requirements.txt
│   ├── trend/                   Trend Analysis (FastAPI, port 8002)
│   │   ├── api.py               HTTP endpoints
│   │   ├── scheduler.py         Pipeline orchestrator
│   │   ├── scraper.py           Playwright crawler
│   │   ├── llm_analyzer.py      DeepSeek LLM calls (parallel via asyncio.gather)
│   │   ├── processor.py         Article quality scoring
│   │   ├── models.py            Pydantic data models
│   │   ├── storage.py           SQLite access
│   │   ├── config.py            Settings (BASE_DIR = this dir)
│   │   ├── frontend/            Vanilla HTML/CSS/JS served by FastAPI
│   │   ├── prompts/             LLM prompt templates
│   │   └── site_configs/        Vogue CN scraping config
│   ├── _stubs/                  Stub/placeholder apps (no real AI)
│   │   ├── design_stub_app.py
│   │   └── trend_stub_app.py
│   ├── trend_runner.py          Trend service launcher
│   └── trend_requirements.txt
│
├── docs/                        Architecture docs + Word export
├── scripts/                     install.bat, start-all.bat/sh, docgen/
├── start.py                     One-command launcher
└── env.example                  Copy to .env to configure
```

## Architecture Notes

### Vite Proxy (frontend/vite.config.ts)
- `/api/design/*` → `localhost:8001/api/*`
- `/api/trend/*` → `localhost:8002/api/*`
- `/ws/*` → `localhost:8002` (WebSocket for pipeline progress)

### Design Studio (services/design/)
Uses DashScope APIs: `wan2.6-t2i` (text-to-image), `qwen-image-edit-max` (editing), `qwen-plus` (chat), `qwen-vl-max` (vision). API key in `server.py` via `DASHSCOPE_API_KEY`.

### Trend Analysis (services/trend/)
All Python modules use **bare imports** (`from config import`, `from models import`) — they work because `trend_runner.py` inserts `services/trend/` into `sys.path`. `config.py` sets `BASE_DIR = Path(__file__).parent`, so all data/log/storage paths resolve relative to `services/trend/`.

The vanilla JS frontend (`services/trend/frontend/`) is served by FastAPI via `StaticFiles`. Changes there must pass `node --check services/trend/frontend/app.js`.

### Stub Services (services/_stubs/)
Lightweight FastAPI apps that respond to health checks when the real backend is unavailable. Loaded automatically by launchers when backend import fails.

## Key Gotchas

- `services/trend/` Python files use bare module imports — **never move individual files out of that directory** without updating all import statements.
- Frontend port is **3100** (configurable via `FASHION_FRONTEND_PORT` in `.env`).
- After editing `services/trend/frontend/app.js`, always run `node --check services/trend/frontend/app.js` to catch syntax errors before restarting.
