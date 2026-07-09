import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

import db
from runtime import (
    CreateSessionRequest,
    DesignerProjectAnalyzeRequest,
    DesignerProjectConfirmRequest,
    DesignerProjectCreateRequest,
    DesignerProjectPatchRequest,
    PersonalAnalyzeRequest,
    PersonalOnboardingRequest,
    PersonalStaticPatchRequest,
    ProfileConfirmRequest,
    ProjectTrendAddRequest,
    _build_personalization_context,
    _build_trend_context,
    _maybe_analyze_designer,
    _maybe_analyze_personal,
    _require_user,
    get_session,
)

router = APIRouter()


@router.get("/api/profile/personal")
async def get_personal_profile_endpoint(authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    profile = db.get_personal_profile(user["email"])
    return {"profile": profile}


@router.post("/api/profile/personal/onboarding")
async def personal_onboarding(req: PersonalOnboardingRequest):
    user = _require_user()
    profile = db.get_personal_profile(user["email"])
    profile["static"] = req.static
    profile.setdefault("dynamic", {
        "inferred_keywords": [], "disliked_elements": [],
        "color_tendency": [], "sessions_analyzed": 0,
    })
    profile["meta"] = {"onboarding_completed": True, "updated_at": datetime.now().isoformat()}
    db.save_personal_profile(user["email"], profile)
    return {"status": "ok", "profile": profile}


@router.patch("/api/profile/personal/static")
async def patch_personal_static(req: PersonalStaticPatchRequest):
    user = _require_user()
    profile = db.get_personal_profile(user["email"])
    profile.setdefault("static", {}).update(req.static)
    profile.setdefault("meta", {})["updated_at"] = datetime.now().isoformat()
    db.save_personal_profile(user["email"], profile)
    return {"status": "ok", "profile": profile}


@router.post("/api/profile/personal/analyze")
async def trigger_personal_analyze(req: PersonalAnalyzeRequest):
    user = _require_user()
    total = db.count_user_sessions(user["email"], "personal")
    await _maybe_analyze_personal(user["email"], max(total, 1))
    profile = db.get_personal_profile(user["email"])
    return {"status": "ok", "profile": profile}


@router.post("/api/profile/personal/confirm")
async def confirm_personal_review(req: ProfileConfirmRequest):
    user = _require_user()
    profile = db.get_personal_profile(user["email"])
    pending = profile.pop("pending_review", None)
    if not pending:
        return {"status": "ok", "profile": profile}
    # merge accepted items
    result = pending.get("result", {})
    accepted_tags = {item.get("tag") for item in req.accepted_items if item.get("tag")}
    existing_tags = {k["tag"] for k in profile.get("dynamic", {}).get("inferred_keywords", [])}
    for kw in result.get("top_style_keywords", []):
        if kw.get("tag") in accepted_tags and kw["tag"] not in existing_tags:
            profile.setdefault("dynamic", {}).setdefault("inferred_keywords", []).append(kw)
    db.save_personal_profile(user["email"], profile)
    return {"status": "ok", "profile": profile}


@router.get("/api/profile/designer/projects")
async def get_designer_projects(authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    workspace = db.get_designer_workspace(user["email"])
    return {"workspace": workspace}


@router.post("/api/profile/designer/projects")
async def create_designer_project(req: DesignerProjectCreateRequest):
    user = _require_user()
    workspace = db.get_designer_workspace(user["email"])
    project = {
        "id": uuid.uuid4().hex,
        "name": req.name,
        "status": "active",
        "created_at": datetime.now().isoformat(),
        "brief": req.brief,
        "design_language": req.design_language,
        "dynamic": {
            "design_signatures": [],
            "recurring_elements": [],
            "sessions_analyzed": 0,
        },
    }
    workspace.setdefault("projects", []).append(project)
    workspace["active_project_id"] = project["id"]
    workspace["meta"] = {"onboarding_completed": True, "updated_at": datetime.now().isoformat()}
    db.save_designer_workspace(user["email"], workspace)
    return {"status": "ok", "project": project, "workspace": workspace}


@router.patch("/api/profile/designer/projects/{project_id}")
async def patch_designer_project(project_id: str, req: DesignerProjectPatchRequest):
    user = _require_user()
    workspace = db.get_designer_workspace(user["email"])
    for proj in workspace.get("projects", []):
        if proj["id"] == project_id:
            if req.name is not None:
                proj["name"] = req.name
            if req.status is not None:
                proj["status"] = req.status
            if req.brief is not None:
                proj.setdefault("brief", {}).update(req.brief)
            if req.design_language is not None:
                proj.setdefault("design_language", {}).update(req.design_language)
            if req.status is not None:
                proj["status"] = req.status
            break
    else:
        raise HTTPException(status_code=404, detail="项目未找到")
    workspace.setdefault("meta", {})["updated_at"] = datetime.now().isoformat()
    db.save_designer_workspace(user["email"], workspace)
    return {"status": "ok", "workspace": workspace}


@router.delete("/api/profile/designer/projects/{project_id}")
async def archive_designer_project(project_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    workspace = db.get_designer_workspace(user["email"])
    for proj in workspace.get("projects", []):
        if proj["id"] == project_id:
            proj["status"] = "archived"
            break
    else:
        raise HTTPException(status_code=404, detail="项目未找到")
    db.save_designer_workspace(user["email"], workspace)
    return {"status": "ok"}


@router.post("/api/profile/designer/projects/{project_id}/analyze")
async def trigger_designer_analyze(project_id: str, req: DesignerProjectAnalyzeRequest):
    user = _require_user()
    cnt = db.count_user_sessions(user["email"], "designer", project_id)
    await _maybe_analyze_designer(user["email"], project_id, max(cnt, 1))
    workspace = db.get_designer_workspace(user["email"])
    return {"status": "ok", "workspace": workspace}


@router.post("/api/profile/designer/projects/{project_id}/confirm")
async def confirm_designer_review(project_id: str, req: DesignerProjectConfirmRequest):
    user = _require_user()
    workspace = db.get_designer_workspace(user["email"])
    for proj in workspace.get("projects", []):
        if proj.get("id") == project_id:
            proj.pop("pending_review", None)
            accepted_patterns = {item.get("pattern") for item in req.accepted_items if item.get("pattern")}
            existing = {s["pattern"] for s in proj.get("dynamic", {}).get("design_signatures", [])}
            for item in req.accepted_items:
                if item.get("pattern") and item["pattern"] not in existing:
                    proj.setdefault("dynamic", {}).setdefault("design_signatures", []).append(item)
            break
    db.save_designer_workspace(user["email"], workspace)
    return {"status": "ok", "workspace": workspace}


@router.post("/api/conversations")
async def create_conversation(req: CreateSessionRequest):
    user = _require_user()
    session_id = uuid.uuid4().hex
    db.create_chat_session(session_id, user["email"], req.mode, req.designer_project_id)
    # Build personalization context now so it's baked into the session
    personal_profile = db.get_personal_profile(user["email"])
    designer_project = None
    if req.mode == "designer" and req.designer_project_id:
        ws = db.get_designer_workspace(user["email"])
        designer_project = next(
            (p for p in ws.get("projects", []) if p["id"] == req.designer_project_id), None
        )
        if not designer_project:
            raise HTTPException(status_code=404, detail="项目不存在")
    ctx = _build_personalization_context(req.mode, personal_profile, designer_project)
    if req.mode == "personal":
        trend_ctx = _build_trend_context(req.trend_id, req.trend_enabled)
        if trend_ctx:
            ctx = (ctx + "\n\n" + trend_ctx).strip()
    get_session(session_id, ctx)  # pre-create with context
    if req.trend_id or req.trend_enabled:
        db.update_session_trend(session_id, req.trend_id, req.trend_enabled)
    return {
        "session_id": session_id,
        "mode": req.mode,
        "designer_project_id": req.designer_project_id,
        "trend_id": req.trend_id,
        "trend_enabled": req.trend_enabled,
    }


@router.post("/api/profile/designer/projects/{project_id}/trends")
async def add_trend_to_project(project_id: str, req: ProjectTrendAddRequest):
    user = _require_user()
    trend_row = db.get_trend(req.trend_id)
    if not trend_row:
        raise HTTPException(status_code=404, detail="趋势不存在")
    workspace = db.get_designer_workspace(user["email"])
    for proj in workspace.get("projects", []):
        if proj.get("id") == project_id:
            anchors = proj.setdefault("brief", {}).setdefault("trend_anchors", [])
            if len(anchors) >= 3:
                raise HTTPException(status_code=400, detail="每个项目最多添加3个趋势锚点")
            if any(a["trend_id"] == req.trend_id for a in anchors):
                return {"workspace": workspace}  # already added
            anchors.append({
                "trend_id": req.trend_id,
                "trend_name": trend_row["name"],
                "alignment_note": req.alignment_note or "",
                "added_at": datetime.now().isoformat(),
            })
            break
    else:
        raise HTTPException(status_code=404, detail="项目不存在")
    db.save_designer_workspace(user["email"], workspace)
    return {"workspace": workspace}


@router.delete("/api/profile/designer/projects/{project_id}/trends/{trend_id}")
async def remove_trend_from_project(
    project_id: str, trend_id: str, authorization: Optional[str] = Header(None)
):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    workspace = db.get_designer_workspace(user["email"])
    for proj in workspace.get("projects", []):
        if proj.get("id") == project_id:
            anchors = proj.get("brief", {}).get("trend_anchors", [])
            proj["brief"]["trend_anchors"] = [a for a in anchors if a["trend_id"] != trend_id]
            break
    db.save_designer_workspace(user["email"], workspace)
    return {"workspace": workspace}
