import asyncio
import json
import traceback
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import db
from runtime import (
    ChatRequest,
    FavoriteRequest,
    ResetRequest,
    _async_update_signals,
    _build_personalization_context,
    _build_trend_context,
    _ensure_owned_session,
    _maybe_analyze_designer,
    _maybe_analyze_personal,
    _require_user,
    _safe_stream_chat,
    check_rate_limit,
    get_session,
)

router = APIRouter()


@router.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        user_row = _require_user()
        user_email = user_row["email"]
        personalization_ctx = ""
        personal_profile = db.get_personal_profile(user_email)
        if req.project_id and not db.get_project(req.project_id, user_email):
            raise HTTPException(status_code=404, detail="项目不存在")
        bound_design_id = _ensure_owned_session(
            user_email,
            req.session_id,
            project_id=req.project_id,
            design_id=req.design_id,
        )
        session_row = db.get_owned_chat_session(req.session_id, user_email)
        effective_project_id = session_row["project_id"] if session_row else req.project_id
        project = None
        if effective_project_id:
            ws = db.get_designer_workspace(user_email)
            project = next(
                (p for p in ws.get("projects", []) if p["id"] == effective_project_id), None
            )
            if not project:
                raise HTTPException(status_code=404, detail="项目不存在")
        personalization_ctx = _build_personalization_context(personal_profile, project)
        trend_ctx = _build_trend_context(req.trend_id, req.trend_enabled)
        if trend_ctx:
            personalization_ctx = (personalization_ctx + "\n\n" + trend_ctx).strip()

        session = get_session(req.session_id, personalization_ctx)
        session.user_email = user_email
        session.project_id = effective_project_id
        session.design_id = bound_design_id
        if not check_rate_limit(req.session_id):
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

        async def _stream_and_side_effects():
            assistant_content = ""
            assistant_images: list[dict] = []
            if bound_design_id:
                db.add_message(uuid.uuid4().hex, bound_design_id, "user", req.message)
            async for chunk in _safe_stream_chat(session, req.message, capability_id=req.capability_id):
                if bound_design_id:
                    try:
                        event = json.loads(chunk)
                        if event.get("type") == "image" and event.get("url"):
                            img = {
                                "url": event.get("url"),
                                "type": event.get("image_type") or event.get("capability") or "image",
                            }
                            if img not in assistant_images:
                                assistant_images.append(img)
                        elif event.get("type") == "message":
                            assistant_content = str(event.get("content") or "")
                            imgs = event.get("images")
                            if isinstance(imgs, list):
                                assistant_images = imgs
                        elif event.get("type") == "error" and not assistant_content:
                            assistant_content = str(event.get("content") or "")
                    except Exception:
                        pass
                yield chunk
            if bound_design_id and (assistant_content or assistant_images):
                db.add_message(
                    uuid.uuid4().hex,
                    bound_design_id,
                    "assistant",
                    assistant_content or "操作已完成。",
                    assistant_images,
                )
            # After stream completes: signal extraction + history analysis (fire-and-forget)
            asyncio.create_task(_async_update_signals(
                user_email, effective_project_id, req.message
            ))
            asyncio.create_task(_maybe_analyze_personal(
                user_email, db.count_user_sessions(user_email)
            ))
            if effective_project_id:
                asyncio.create_task(_maybe_analyze_designer(
                    user_email,
                    effective_project_id,
                    db.count_user_sessions(user_email, effective_project_id),
                ))

        return StreamingResponse(_stream_and_side_effects(), media_type="application/x-ndjson")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] chat endpoint: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/session/reset")
async def reset_session(req: ResetRequest):
    user = _require_user()
    _ensure_owned_session(user["email"], req.session_id)
    session = get_session(req.session_id)
    session.reset()
    return {"status": "ok"}


@router.get("/api/session/{session_id}/images")
async def get_session_images(session_id: str):
    user = _require_user()
    _ensure_owned_session(user["email"], session_id, create_if_missing=False)
    session = get_session(session_id)
    return {"images": session.generated_images}


@router.get("/api/session/{session_id}/state")
async def get_session_state(session_id: str):
    user = _require_user()
    _ensure_owned_session(user["email"], session_id, create_if_missing=False)
    session = get_session(session_id)
    return session.get_state_summary()


@router.post("/api/session/favorite")
async def add_favorite(req: FavoriteRequest):
    user = _require_user()
    _ensure_owned_session(user["email"], req.session_id, create_if_missing=False)
    session = get_session(req.session_id)
    if session.add_favorite(req.image_id):
        return {"status": "ok", "favorites_count": len(session.favorites)}
    raise HTTPException(status_code=404, detail="图片未找到")


@router.delete("/api/session/favorite")
async def remove_favorite(req: FavoriteRequest):
    user = _require_user()
    _ensure_owned_session(user["email"], req.session_id, create_if_missing=False)
    session = get_session(req.session_id)
    if session.remove_favorite(req.image_id):
        return {"status": "ok", "favorites_count": len(session.favorites)}
    raise HTTPException(status_code=404, detail="收藏未找到")


@router.get("/api/session/{session_id}/favorites")
async def get_favorites(session_id: str):
    user = _require_user()
    _ensure_owned_session(user["email"], session_id, create_if_missing=False)
    session = get_session(session_id)
    return {"favorites": session.favorites}


@router.get("/api/session/{session_id}/stats")
async def get_session_stats(session_id: str):
    user = _require_user()
    _ensure_owned_session(user["email"], session_id, create_if_missing=False)
    session = get_session(session_id)
    duration = (datetime.now() - datetime.fromisoformat(session.stats["start_time"])).total_seconds()
    return {
        **session.stats,
        "duration_seconds": round(duration),
        "session_id": session_id[:8],
        "images": [
            {"id": img.get("id"), "type": img.get("type"), "time": img.get("time"), "url": img.get("url")}
            for img in session.generated_images
        ],
    }


@router.get("/api/session/{session_id}/export")
async def export_session(session_id: str):
    """Export all session images and metadata as a JSON manifest."""
    user = _require_user()
    _ensure_owned_session(user["email"], session_id, create_if_missing=False)
    session = get_session(session_id)
    return {
        "session_id": session_id,
        "exported_at": datetime.now().isoformat(),
        "stats": session.stats,
        "images": session.generated_images,
        "favorites": session.favorites,
        "state": session.get_state_summary(),
    }
