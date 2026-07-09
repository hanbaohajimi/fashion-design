# CLAUDE.md

This repository is an AI Fashion Design Platform with one React frontend and two FastAPI services.

## Current Service Map

| Service | Port | Current entrypoint | Compatibility file |
| --- | ---: | --- | --- |
| Frontend | `3100` | `frontend/src/App.tsx` via Vite | n/a |
| Design API | `8001` | `services/design/app.py` | `services/design/server.py` |
| Trend API | `8002` | `services/trend/app.py` | `services/trend/api.py` |

`server.py` and `api.py` are compatibility entrypoints only. New backend work should go into route modules, runtime modules, model routing, or focused service helpers.

## Commands

```bash
start-isolated.bat

.venv\Scripts\activate
python start.py
python start.py --check-only
```

Start individually:

```bash
cd frontend && npm run dev
cd services/design && python run.py
cd services && python trend_runner.py
```

Install:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r services/design/requirements.txt
pip install -r services/trend_requirements.txt
python -m playwright install chromium
cd frontend && npm install
```

Validate:

```bash
python -m compileall -q services/design services/trend services/model_router.py start.py
node --check services/trend/frontend/app.js
cd frontend && npm run build
python start.py --check-only
```

## Repository Layout

```text
fashion-design/
├── frontend/
│   └── src/
│       ├── pages/
│       ├── modules/
│       └── components/
├── services/
│   ├── model_router.py
│   ├── trend_runner.py
│   ├── design/
│   │   ├── app.py
│   │   ├── runtime.py
│   │   ├── routes/
│   │   ├── agents/
│   │   ├── ai_clients.py
│   │   ├── db.py
│   │   ├── run.py
│   │   └── server.py
│   └── trend/
│       ├── app.py
│       ├── runtime.py
│       ├── routes/
│       ├── scheduler.py
│       ├── scraper.py
│       ├── llm_analyzer.py
│       ├── storage.py
│       ├── config.py
│       └── api.py
├── docs/
├── env.example
└── start.py
```

## Frontend Proxy

`frontend/vite.config.ts` maps:

- `/api/design/*` to `localhost:8001/api/*`
- `/api/images/*` to `localhost:8001/api/images/*`
- `/api/tryon/*` to `localhost:8001/api/tryon/*`
- `/api/trend/*` to `localhost:8002/api/*`
- `/ws/*` to `localhost:8002/ws/*`

The `/api/gateway/*` proxy is reserved. No Gateway service is started by `start.py`.

## Design API Notes

`services/design/app.py` mounts these route groups:

- `auth`
- `profile`
- `chat`
- `images`
- `library`
- `tryon`
- `wardrobe`
- `trends`
- `health`

Agent tools are registered through `runtime.TOOL_REGISTRY` using the `services/design/agents/` package. Tool call traces are persisted to `services/design/data/tool_traces/tool_calls.jsonl`.

## Trend API Notes

`services/trend/app.py` mounts:

- `health`
- `reports`
- `pipeline`
- `websocket`
- the static trend frontend at `/`

Trend modules still rely on bare imports from `services/trend/`, so keep that import model in mind before moving files.

## Configuration

Use one root `.env` file copied from `env.example`.

Important variables:

- `FASHION_FRONTEND_PORT`
- `DESIGN_STUDIO_PORT`
- `TREND_ANALYSIS_PORT`
- `AMUX_API_KEY`
- `AMUX_TEXT_MODEL`
- `AMUX_IMAGE_MODEL`
- `LLM_PROVIDER`
- `LLM_MODEL`
- `MODEL_ROUTES_JSON`

Model selection is centralized in `services/model_router.py`.
