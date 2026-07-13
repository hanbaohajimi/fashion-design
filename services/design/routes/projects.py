"""Projects CRUD routes — standalone project workspace (2026-07 refactor)."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from typing import Optional

import db
from runtime import OUTPUTS_DIR, _require_user

router = APIRouter()


def _json_obj(raw, default):
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, type(default)) else default
    except Exception:
        return default


class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = ""


class PatchProjectRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    brief: Optional[object] = None
    instructions: Optional[str] = None
    starred: Optional[bool] = None
    status: Optional[str] = None
    design_language: Optional[dict] = None
    dynamic: Optional[dict] = None


class PatchProjectAssetRequest(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    enabled: Optional[bool] = None
    extracted_text: Optional[str] = None


def _project_asset_to_dict(row) -> dict:
    try:
        metadata = json.loads(row["metadata"] or "{}")
    except Exception:
        metadata = {}
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "name": row["name"],
        "kind": row["kind"],
        "mime_type": row["mime_type"] or "",
        "image_url": row["image_url"],
        "extracted_text": row["extracted_text"] or "",
        "enabled": bool(row["enabled"]),
        "metadata": metadata,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _project_to_dict(row) -> dict:
    if row is None:
        return {}
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"] or "active",
        "description": row["description"] or "",
        "brief": _json_obj(row["brief"], {}),
        "instructions": row["instructions"] or "",
        "design_language": _json_obj(row["design_language"], {}),
        "dynamic": _json_obj(row["dynamic"], {}),
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


@router.get("/api/projects/{project_id}/assets")
async def list_project_assets(project_id: str):
    user = _require_user()
    if not db.get_project(project_id, user["email"]):
        raise HTTPException(status_code=404, detail="项目不存在")
    rows = db.list_project_assets(project_id, user["email"])
    return {"assets": [_project_asset_to_dict(row) for row in rows]}


@router.post("/api/projects/{project_id}/assets")
async def upload_project_asset(
    project_id: str,
    file: UploadFile = File(...),
    kind: str = Form("reference"),
):
    user = _require_user()
    if not db.get_project(project_id, user["email"]):
        raise HTTPException(status_code=404, detail="项目不存在")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="项目资料不能超过 25MB")

    raw_name = Path(file.filename or "project-reference").name
    mime_type = (file.content_type or "application/octet-stream").lower()
    suffix = Path(raw_name).suffix.lower()
    allowed_images = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    allowed_text = {".txt", ".md", ".json", ".csv", ".tsv"}
    if suffix not in allowed_images | allowed_text:
        raise HTTPException(
            status_code=400,
            detail="当前支持 PNG/JPG/WebP/GIF 与 TXT/MD/JSON/CSV/TSV",
        )

    asset_id = uuid.uuid4().hex
    user_key = __import__("hashlib").sha256(user["email"].encode("utf-8")).hexdigest()[:12]
    target_dir = Path(OUTPUTS_DIR) / "project_assets" / user_key / project_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{asset_id}{suffix}"
    target_path.write_bytes(data)

    extracted_text = ""
    image_url = None
    if suffix in allowed_text:
        extracted_text = data.decode("utf-8", errors="replace")[:40000]
    else:
        rel = target_path.relative_to(Path(OUTPUTS_DIR)).as_posix()
        image_url = f"/api/design/images/{rel}"

    row = db.create_project_asset(
        asset_id,
        project_id,
        user["email"],
        raw_name,
        kind=kind.strip() or "reference",
        mime_type=mime_type,
        file_path=str(target_path.resolve()),
        image_url=image_url,
        extracted_text=extracted_text,
        metadata={"size": len(data), "extension": suffix},
    )
    return {"asset": _project_asset_to_dict(row)}


@router.patch("/api/projects/{project_id}/assets/{asset_id}")
async def patch_project_asset(project_id: str, asset_id: str, req: PatchProjectAssetRequest):
    user = _require_user()
    if not db.get_project(project_id, user["email"]):
        raise HTTPException(status_code=404, detail="项目不存在")
    fields_set = getattr(req, "model_fields_set", getattr(req, "__fields_set__", set()))
    patch = {key: getattr(req, key) for key in fields_set}
    row = db.patch_project_asset(asset_id, user["email"], **patch)
    if not row or row["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="项目资料不存在")
    return {"asset": _project_asset_to_dict(row)}


@router.delete("/api/projects/{project_id}/assets/{asset_id}")
async def delete_project_asset(project_id: str, asset_id: str):
    user = _require_user()
    row = db.delete_project_asset(asset_id, user["email"])
    if not row or row["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="项目资料不存在")
    path = row["file_path"]
    if path:
        try:
            resolved = Path(path).resolve()
            resolved.relative_to(Path(OUTPUTS_DIR).resolve())
            resolved.unlink(missing_ok=True)
        except Exception:
            pass
    return {"status": "ok"}
