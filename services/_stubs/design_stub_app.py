"""
设计工作台占位：未找到含 server.py 的时尚平台后端时仍监听 8001，
避免 Vite 代理 ECONNREFUSED / 502。不提供真实生图与蒙版编辑。
"""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI(title="Design Studio Stub", version="0.1.0")

STUB_HINT = (
    "当前为「设计服务占位模式」：本机未找到含 server.py 的设计后端。"
    "请将时尚平台 backend 拷贝或链接到 backend\\vendor\\design-backend，"
    "或在项目根 .env 设置 FASHION_DESIGN_BACKEND 指向该目录后重启 python start.py。"
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "design-studio-stub",
        "hint": STUB_HINT,
    }


async def _chat_stream() -> AsyncGenerator[bytes, None]:
    events: list[dict[str, str]] = [
        {"type": "status", "content": "占位模式（未加载完整设计后端）"},
        {
            "type": "message",
            "content": "## **设计服务占位模式**\n\n"
            + STUB_HINT
            + "\n\n此处仅用于联调前端与代理；**不具备真实生图**。",
        },
        {"type": "done"},
    ]
    for ev in events:
        yield (json.dumps(ev, ensure_ascii=False) + "\n").encode("utf-8")


@app.post("/api/chat")
async def chat(request: Request) -> StreamingResponse:
    try:
        await request.json()
    except Exception:
        pass
    return StreamingResponse(
        _chat_stream(),
        media_type="text/plain; charset=utf-8",
    )


@app.post("/api/session/reset")
def session_reset() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/enhance-prompt")
async def enhance_prompt(request: Request) -> dict[str, str]:
    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass
    raw = str(body.get("prompt") or "").strip()
    return {"enhanced": raw}


@app.post("/api/upload")
async def upload() -> dict[str, object]:
    return {"status": "ok", "stub": True, "images": []}


@app.post("/api/edit_with_mask")
def edit_with_mask() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": "占位模式不支持蒙版编辑；请配置 FASHION_DESIGN_BACKEND 并加载完整设计后端后重试。"
        },
    )
