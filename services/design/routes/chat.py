from fastapi import APIRouter

from runtime import *

router = APIRouter()


@router.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        user_row = _require_user()
        user_email = user_row["email"]
        personalization_ctx = ""
        personal_profile = db.get_personal_profile(user_email)
        designer_project = None
        if req.mode == "designer" and req.designer_project_id:
            ws = db.get_designer_workspace(user_email)
            designer_project = next(
                (p for p in ws.get("projects", []) if p["id"] == req.designer_project_id), None
            )
        personalization_ctx = _build_personalization_context(
            req.mode, personal_profile, designer_project
        )
        if req.mode == "personal":
            trend_ctx = _build_trend_context(req.trend_id, req.trend_enabled)
            if trend_ctx:
                personalization_ctx = (personalization_ctx + "\n\n" + trend_ctx).strip()

        session = get_session(req.session_id, personalization_ctx)
        session.user_email = user_email
        session.mode = req.mode
        session.designer_project_id = req.designer_project_id
        if not check_rate_limit(req.session_id):
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

        async def _stream_and_side_effects():
            async for chunk in _safe_stream_chat(session, req.message):
                yield chunk
            # After stream completes: signal extraction + history analysis (fire-and-forget)
            asyncio.create_task(_async_update_signals(
                user_email, req.mode, req.designer_project_id, req.message
            ))
            total = db.count_user_sessions(user_email, req.mode, req.designer_project_id if req.mode == "designer" else None)
            if req.mode == "personal":
                asyncio.create_task(_maybe_analyze_personal(user_email, total))
            elif req.mode == "designer" and req.designer_project_id:
                asyncio.create_task(_maybe_analyze_designer(user_email, req.designer_project_id, total))

        return StreamingResponse(_stream_and_side_effects(), media_type="application/x-ndjson")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] chat endpoint: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/session/reset")
async def reset_session(req: ResetRequest):
    session = get_session(req.session_id)
    session.reset()
    return {"status": "ok"}


@router.get("/api/session/{session_id}/images")
async def get_session_images(session_id: str):
    session = get_session(session_id)
    return {"images": session.generated_images}


@router.get("/api/session/{session_id}/state")
async def get_session_state(session_id: str):
    session = get_session(session_id)
    return session.get_state_summary()


@router.post("/api/session/favorite")
async def add_favorite(req: FavoriteRequest):
    session = get_session(req.session_id)
    if session.add_favorite(req.image_id):
        return {"status": "ok", "favorites_count": len(session.favorites)}
    raise HTTPException(status_code=404, detail="图片未找到")


@router.delete("/api/session/favorite")
async def remove_favorite(req: FavoriteRequest):
    session = get_session(req.session_id)
    if session.remove_favorite(req.image_id):
        return {"status": "ok", "favorites_count": len(session.favorites)}
    raise HTTPException(status_code=404, detail="收藏未找到")


@router.get("/api/session/{session_id}/favorites")
async def get_favorites(session_id: str):
    session = get_session(session_id)
    return {"favorites": session.favorites}


@router.get("/api/session/{session_id}/stats")
async def get_session_stats(session_id: str):
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
    session = get_session(session_id)
    return {
        "session_id": session_id,
        "exported_at": datetime.now().isoformat(),
        "stats": session.stats,
        "images": session.generated_images,
        "favorites": session.favorites,
        "state": session.get_state_summary(),
    }

