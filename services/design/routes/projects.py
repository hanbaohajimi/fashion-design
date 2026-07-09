"""Projects CRUD routes — standalone project workspace (2026-07 refactor)."""
from __future__ import annotations

import uuid
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from runtime import *

router = APIRouter()


class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = ""


class PatchProjectRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    brief: Optional[str] = None
    instructions: Optional[str] = None
    starred: Optional[bool] = None


def _project_to_dict(row) -> dict:
    if row is None:
        return {}
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"] or "",
        "brief": row["brief"] or "",
        "instructions": row["instructions"] or "",
        "starred": bool(row["starred"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("/api/projects")
async def list_projects(search: str = ""):
    user = _require_user()
    rows = db.list_projects(user["email"], search=search)
    return {"projects": [_project_to_dict(r) for r in rows]}


@router.post("/api/projects")
async def create_project(req: CreateProjectRequest):
    user = _require_user()
    project_id = str(uuid.uuid4())
    row = db.create_project(
        project_id=project_id,
        user_email=user["email"],
        name=req.name.strip(),
        description=req.description or "",
    )
    return {"project": _project_to_dict(row)}


@router.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    user = _require_user()
    row = db.get_project(project_id, user["email"])
    if not row:
        raise HTTPException(status_code=404, detail="项目不存在")
    # Include linked designs
    designs = db.list_designs(user["email"], project_id=project_id)
    designs_list = [
        {
            "id": d["id"],
            "title": d["title"] or "无标题设计",
            "created_at": d["created_at"],
            "updated_at": d["updated_at"],
        }
        for d in designs
    ]
    return {"project": _project_to_dict(row), "designs": designs_list}


@router.patch("/api/projects/{project_id}")
async def patch_project(project_id: str, req: PatchProjectRequest):
    user = _require_user()
    existing = db.get_project(project_id, user["email"])
    if not existing:
        raise HTTPException(status_code=404, detail="项目不存在")
    kwargs = {k: v for k, v in req.dict().items() if v is not None}
    row = db.patch_project(project_id, user["email"], **kwargs)
    return {"project": _project_to_dict(row)}


@router.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    user = _require_user()
    ok = db.delete_project(project_id, user["email"])
    if not ok:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"status": "ok"}
