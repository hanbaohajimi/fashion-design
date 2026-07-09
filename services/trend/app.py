from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import runtime
from routes import health, pipeline, reports, websocket


def create_app() -> FastAPI:
    app = FastAPI(
        title="AI Fashion Pipeline API",
        version=runtime.APP_VERSION,
        lifespan=runtime.lifespan,
    )

    cors_origins = [
        origin.strip()
        for origin in os.environ.get(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:3100,http://127.0.0.1:3100",
        ).split(",")
        if origin.strip()
    ]
    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
        )

    app.include_router(health.router)
    app.include_router(reports.router)
    app.include_router(pipeline.router)
    app.include_router(websocket.router)
    mount_frontend(app)
    return app


def mount_frontend(app: FastAPI) -> None:
    frontend_dir = Path(__file__).parent / "frontend"
    if frontend_dir.exists():
        app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

        @app.get("/")
        async def serve_index():
            index_path = frontend_dir / "index.html"
            if index_path.exists():
                return FileResponse(
                    str(index_path),
                    headers={
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                        "Pragma": "no-cache",
                    },
                )
            return JSONResponse({"error": "frontend/index.html not found"}, status_code=404)
    else:
        @app.get("/")
        async def no_frontend():
            return {"message": "AI Fashion API is running. Place frontend/ directory for UI."}


app = create_app()
