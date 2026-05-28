# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Fashion Design Platform — a unified platform merging two systems into a single self-contained project:
- **Design Studio** (port 8001): AI-powered fashion design with chat-based image generation, canvas editing, and virtual try-on. Backend (`server.py`) lives at `backend/design-studio/`.
- **Trend Analysis** (port 8002): Fashion trend scraping from Vogue China, LLM-powered analysis via DeepSeek, interactive word cloud, and trend reports. Backend source lives at `ai_fashion/ai_fashion/` (already in this repo).

## Commands

### Start everything (one command)
```bash
python start.py
```
Launches Frontend (port 3100) + Design Studio (port 8001) + Trend Analysis (port 8002). Ctrl+C stops all.

### Start individually
```bash
# Frontend only
cd frontend && npm run dev

# Design Studio backend only
cd backend/design-studio && python run.py

# Trend Analysis backend only
cd backend/trend-analysis && python run.py
```

### Install dependencies
```bash
cd frontend && npm install
pip install -r backend/design-studio/requirements.txt
pip install playwright && python -m playwright install chromium
# For trend analysis (ai_fashion):
cd ai_fashion/ai_fashion && pip install -e .
# Or individually:
pip install fastapi uvicorn loguru pydantic-settings python-dotenv click apscheduler beautifulsoup4 lxml aiohttp PyYAML python-dateutil litellm
```

### Generate Word document
```bash
cd scripts/docgen && npm install && node generate.mjs
```

## Architecture

### Project Layout
```
fashion design/
  frontend/              React 19 + Vite + Tailwind — unified shell app
  backend/
    design-studio/       Design backend: server.py (FastAPI) + run.py launcher
    trend-analysis/      Trend launcher: run.py → loads ai_fashion/ai_fashion/
  ai_fashion/
    ai_fashion/          Trend analysis backend (FastAPI + Playwright + SQLite)
  start.py               One-command launcher for all 3 services
  env.example            Copy to .env to configure ports/paths
```

### User Flow
`LandingPage → AuthPage → ToolSelector → MainApp(design-studio | trend-analysis)`

Views are controlled by `AppView` state in `App.tsx`. Auth uses `localStorage` keys: `af_user`, `af_token`, `af_users`.

### Frontend (React + Vite)
- `src/App.tsx` — Router: manages view state and auth guards
- `src/pages/` — Full-page views: Landing, Auth, ToolSelector, MainApp
- `src/workspaces/design-studio/` — Canvas + ChatPanel + FabricEditor
- `src/workspaces/trend-analysis/` — iframe wrapper pointing to `http://localhost:8002/`
- `src/components/` — Shared: Toast, ErrorBoundary

Vite proxy config (`vite.config.ts`):
- `/api/design/*` → `localhost:8001/api/*`
- `/api/trend/*` → `localhost:8002/api/*`
- `/ws/*` → `localhost:8002` (WebSocket for pipeline progress)

### Design Studio Backend (port 8001)
FastAPI app at `backend/design-studio/server.py`. Uses DashScope (Alibaba Cloud) APIs:
- `wan2.6-t2i` for text-to-image / `qwen-image-edit-max` for image editing
- `qwen-plus` for chat LLM / `qwen-vl-max` for vision analysis
- API key configured in `server.py` via `DASHSCOPE_API_KEY` env var
- `run.py` auto-detects `server.py` in the same directory — no config needed

### Trend Analysis Backend (port 8002)
FastAPI app from `ai_fashion/ai_fashion/api.py`. Config via `ai_fashion/ai_fashion/.env`. Key modules:
- `scheduler.py` — Pipeline orchestrator (crawl → dedupe → quality gate → season bucket → LLM)
- `scraper.py` — Playwright-based crawler for Vogue China
- `llm_analyzer.py` — DeepSeek calls with parallel summarization (`asyncio.gather` + `Semaphore`)
- `frontend/` — Vanilla HTML/CSS/JS served as static files (word cloud, reports, articles, keywords)
- `run.py` auto-detects `ai_fashion/ai_fashion/` relative to project root — no config needed

### Design System
CSS variables in `frontend/src/index.css`:
- Colors: `--ivory: #FAF8F5`, `--charcoal: #1A1A1A`, `--gold: #C9A96E`
- Fonts: `--font-display` (Playfair Display / Noto Serif SC), `--font-body` (Inter / Noto Sans SC)

## Key Gotchas

- The trend frontend JS (`ai_fashion/ai_fashion/frontend/app.js`) is a ~2000-line vanilla JS file. Always run `node --check ai_fashion/ai_fashion/frontend/app.js` after editing to catch syntax errors.
- ChatPanel API calls use the `/api/design/` prefix (rewritten by Vite proxy). The backend expects `/api/` paths.
- The trend analysis iframe loads `http://localhost:8002/` directly, so the trend backend must be running.
- LLM analysis of 60+ articles takes 10-30 minutes. Pipeline runs in a background thread with WebSocket progress updates at `/ws/pipeline`.
- Frontend port defaults to **3100** (not 3000) to avoid conflicts. Configurable via `FASHION_FRONTEND_PORT` in `.env`.
