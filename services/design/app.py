from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import runtime
from routes import auth, chat, health, images, library, profile, trends, tryon, wardrobe


def create_app() -> FastAPI:
    app = FastAPI(title="AI Fashion Design Backend")

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

    app.middleware("http")(runtime.authenticate_api_requests)
    app.on_event("startup")(runtime._start_trend_sync)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(chat.router)
    app.include_router(images.router)
    app.include_router(profile.router)
    app.include_router(library.router)
    app.include_router(trends.router)
    app.include_router(wardrobe.router)
    app.include_router(tryon.router)

    app.mount(
        "/api/tryon/preset-images",
        StaticFiles(directory=runtime.PRESETS_DIR),
        name="tryon-presets",
    )
    return app


app = create_app()
