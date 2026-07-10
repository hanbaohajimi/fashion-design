"""Designs (conversation threads) routes — 2026-07 refactor."""
from __future__ import annotations

import re
import uuid
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

import db
from runtime import _require_user

router = APIRouter()


def _utc_iso(value: str) -> str:
    """Normalize legacy SQLite UTC timestamps to an explicit ISO-8601 UTC value."""
    raw = str(value or "").strip()
    if not raw:
        return raw
    normalized = raw.replace(" ", "T", 1)
    if normalized.endswith("Z") or re.search(r"[+-]\d{2}:\d{2}$", normalized):
        return normalized
    return f"{normalized}Z"


class CreateDesignRequest(BaseModel):
    title: Optional[str] = ""
    project_id: Optional[str] = None


class PatchDesignRequest(BaseModel):
    title: Optional[str] = None
    project_id: Optional[str] = None
    starred: Optional[bool] = None


def _design_to_dict(row) -> dict:
    if row is None:
        return {}
    return {
        "id": row["id"],
        "title": row["title"] or "无标题设计",
        "project_id": row["project_id"],
        "starred": bool(row["starred"]),
        "created_at": _utc_iso(row["created_at"]),
        "updated_at": _utc_iso(row["updated_at"]),
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
        "created_at": _utc_iso(row["created_at"]),
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
    # Use is-not-None for scalar fields (more reliable than fields_set across
    # Pydantic v1/v2). project_id can be explicitly null, so still needs fields_set.
    patch = {}
    if req.title is not None:
        patch["title"] = req.title.strip()
    if req.starred is not None:
        patch["starred"] = bool(req.starred)
    fields_set = getattr(req, "model_fields_set", getattr(req, "__fields_set__", set()))
    if "project_id" in fields_set:
        if req.project_id and not db.get_project(req.project_id, user["email"]):
            raise HTTPException(status_code=404, detail="项目不存在")
        patch["project_id"] = req.project_id
    row = db.patch_design(design_id, user["email"], **patch)
    return {"design": _design_to_dict(row)}


@router.delete("/api/designs/{design_id}")
async def delete_design(design_id: str):
    user = _require_user()
    if not db.delete_design(design_id, user["email"]):
        raise HTTPException(status_code=404, detail="设计不存在")
    return {"status": "ok"}


@router.post("/api/designs/{design_id}/auto-title")
async def auto_title_design(design_id: str):
    """Generate a short title for a design using its first user message."""
    user = _require_user()
    row = db.get_design(design_id, user["email"])
    if not row:
        raise HTTPException(status_code=404, detail="设计不存在")

    # Skip if a meaningful title already exists
    current = (row["title"] or "").strip()
    if current and current != "无标题设计":
        return {"title": current}

    # Fetch first user message
    messages = db.list_messages(design_id)
    first_user_msg = next((m["content"] for m in messages if m["role"] == "user"), None)
    if not first_user_msg:
        return {"title": None}

    try:
        from ai_clients import simple_chat
        raw = simple_chat([
            {
                "role": "system",
                "content": (
                    "你是一个设计命名助手。根据用户的设计请求，生成一个简洁的中文设计名称。"
                    "要求：2-8个汉字，不含标点符号，直接输出名称本身，不要解释、不要引号。"
                ),
            },
            {
                "role": "user",
                "content": f"设计请求：{first_user_msg[:300]}",
            },
        ])
        title = re.sub(r'[「」【】《》""''\'\"\s,，。.!！?？:：]', "", raw).strip()[:20]
        if title:
            db.patch_design(design_id, user["email"], title=title)
            return {"title": title}
    except Exception:
        pass

    return {"title": None}
