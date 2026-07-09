# AGENTS.md

This file gives coding agents the current repository map and working rules for this project.

## Project Overview

AI Fashion Design Platform is a local-first fashion design console with:

- React frontend on port `3100`
- Design API on port `8001`
- Trend API on port `8002`

The backend is intentionally split into thin FastAPI app files, route modules, runtime modules, model routing, and Agent tool infrastructure.

## Commands

### Start everything

```bash
start-isolated.bat
```

or:

```bash
.venv\Scripts\activate
python start.py
```

### Preflight only

```bash
python start.py --check-only
```

### Start individually

```bash
cd frontend && npm run dev
cd services/design && python run.py
cd services && python trend_runner.py
```

### Install dependencies

```bash
python -m venv .venv
.venv\Scripts\activate

pip install -r services/design/requirements.txt
pip install -r services/trend_requirements.txt
python -m playwright install chromium

cd frontend && npm install
```

### Validation

```bash
python -m compileall -q services/design services/trend services/model_router.py start.py
node --check services/trend/frontend/app.js
cd frontend && npm run build
python start.py --check-only
```

## Project Layout

```text
fashion-design/
├── start.py                     Local platform console and health summary
├── start-isolated.bat           Windows launcher that activates .venv
├── env.example                  Root .env template
├── frontend/                    React 19 + Vite + Tailwind application
│   └── src/
│       ├── pages/               LandingPage, AuthPage, MainApp
│       ├── modules/             design-studio, trend-analysis, trends, tryon, wardrobe, library
│       └── components/          Shared UI such as ErrorBoundary
├── services/
│   ├── model_router.py          Central model routing for text, vision, image, try-on, trend tasks
│   ├── trend_runner.py          Trend service launcher
│   ├── trend_requirements.txt
│   ├── _stubs/                  Stub apps used only when real backends fail to import
│   ├── design/
│   │   ├── app.py               FastAPI app factory and router mounting
│   │   ├── runtime.py           Design runtime, sessions, tools, trend sync, business functions
│   │   ├── server.py            Compatibility entrypoint that imports app
│   │   ├── run.py               Design launcher with stub fallback
│   │   ├── ai_clients.py        amux.ai OpenAI-compatible client
│   │   ├── db.py                SQLite repositories and profile/asset persistence
│   │   ├── routes/              auth, chat, health, images, library, profile, trends, tryon, wardrobe
│   │   ├── agents/              BaseTool, registry, concrete tools, JSONL trace store
│   │   ├── presets/             Virtual try-on preset manifests and images
│   │   ├── data/                profiles.db and tool_traces/tool_calls.jsonl
│   │   └── outputs/             Generated image files
│   └── trend/
│       ├── app.py               FastAPI app factory and router mounting
│       ├── runtime.py           Scheduler lifecycle, shared runtime state, helpers
│       ├── api.py               Compatibility entrypoint that imports app
│       ├── routes/              health, reports, pipeline, websocket
│       ├── scheduler.py         Pipeline orchestrator
│       ├── scraper.py           Playwright crawler
│       ├── llm_analyzer.py      LiteLLM analysis calls
│       ├── processor.py         Article quality and processing
│       ├── storage.py           SQLite storage layer
│       ├── config.py            Settings that read the project root .env
│       ├── frontend/            Static trend-analysis UI served by FastAPI
│       ├── prompts/
│       └── site_configs/
└── docs/
```

## Architecture Notes

### Frontend proxy

`frontend/vite.config.ts` proxies:

- `/api/design/*` to Design API `/api/*`
- `/api/images/*` to Design API `/api/images/*`
- `/api/tryon/*` to Design API `/api/tryon/*`
- `/api/trend/*` to Trend API `/api/*`
- `/ws/*` to Trend API WebSocket

`/api/gateway/*` is only a reserved proxy target. The project does not currently start a Gateway service.

### Design service

The current Design API entrypoint is `services/design/app.py`.

`services/design/server.py` exists only for compatibility. Do not add new route logic there. Put route handlers in `services/design/routes/` and shared behavior in `services/design/runtime.py` or an appropriate service/helper module.

Agent tools are registered through `services/design/agents/registry.py` and mounted in `runtime.TOOL_REGISTRY`. Tool calls are recorded as JSONL traces under `services/design/data/tool_traces/tool_calls.jsonl`.

### Trend service

The current Trend API entrypoint is `services/trend/app.py`.

`services/trend/api.py` exists only for compatibility. Route handlers live in `services/trend/routes/`. The pipeline lifecycle and shared state live in `services/trend/runtime.py`.

Many trend modules still use bare imports such as `from config import settings`; this works because `services/trend_runner.py` inserts `services/trend/` into `sys.path`. Avoid moving individual trend modules without updating imports.

### Model routing

`services/model_router.py` centralizes model selection for:

- design chat
- vision tagging
- image generation
- image editing
- virtual try-on
- trend analysis
- fallbacks

Prefer adding new model choices to the router or `.env` route settings instead of hardcoding model names in business code.

### Configuration

The project uses one root `.env` file. `services/trend/config.py` reads that root file via pydantic-settings, and launchers also load root `.env` into `os.environ`.

## Key Gotchas

- Keep `server.py` and `api.py` thin compatibility entrypoints.
- After editing `services/trend/frontend/app.js`, run `node --check services/trend/frontend/app.js`.
- Frontend port defaults to `3100`.
- `profiles.db` and `fashion_pipeline.db` are local runtime data. Treat DB changes intentionally.
- The startup console can run in stub mode when backend imports fail or required API keys are missing.
