"""Designs (conversation threads) routes — 2026-07 refactor."""
from __future__ import annotations

import uuid
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

import db
from runtime import _require_user

router = APIRouter()


class CreateDesignRequest(BaseModel):
    title: Optional[str] = ""
    project_id: Optional[str] = None


class PatchDesignRequest(BaseModel):
    title: Optional[str] = None


def _design_to_dict(row) -> dict:
    if row is None:
        return {}
    return {
        "id": row["id"],
        "title": row["title"] or "无标题设计",
        "project_id": row["project_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _message_to_dict(row) -> dict:
    try:
        images = json.loads(row["images"] or "[]")
    except Exception:
        images = []
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "images": images if isinstance(images, list) else [],
        "created_at": row["created_at"],
    }


@router.get("/api/designs")
async def list_designs(project_id: Optional[str] = None):
    """
    project_id omitted → standalone designs (no project).
    project_id=xxx    → designs inside that project.
    """
    user = _require_user()
    rows = db.list_designs(user["email"], project_id=project_id)
    return {"designs": [_design_to_dict(r) for r in rows]}


@router.get("/api/designs/recents")
async def list_recent_designs(limit: int = 10):
    user = _require_user()
    rows = db.list_recent_designs(user["email"], limit=min(limit, 30))
    return {"designs": [_design_to_dict(r) for r in rows]}


@router.post("/api/designs")
async def create_design(req: CreateDesignRequest):
    user = _require_user()
    if req.project_id:
        project = db.get_project(req.project_id, user["email"])
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")
    design_id = str(uuid.uuid4())
    row = db.create_design(
        design_id=design_id,
        user_email=user["email"],
        title=req.title or "",
        project_id=req.project_id,
    )
    return {"design": _design_to_dict(row)}


@router.get("/api/designs/{design_id}")
async def get_design(design_id: str):
    user = _require_user()
    row = db.get_design(design_id, user["email"])
    if not row:
        raise HTTPException(status_code=404, detail="设计不存在")
    messages = db.list_messages(design_id)
    msgs = [_message_to_dict(m) for m in messages]
    return {"design": _design_to_dict(row), "messages": msgs}


@router.patch("/api/designs/{design_id}")
async def patch_design(design_id: str, req: PatchDesignRequest):
    user = _require_user()
    row = db.get_design(design_id, user["email"])
    if not row:
        raise HTTPException(status_code=404, detail="设计不存在")
    if req.title is not None:
        db.update_design_title(design_id, req.title)
    row = db.get_design(design_id, user["email"])
    return {"design": _design_to_dict(row)}
