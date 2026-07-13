from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

import db
from runtime import OUTPUTS_DIR, _ensure_owned_session, _require_user


router = APIRouter()


def _json_value(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        parsed = json.loads(str(value))
        return parsed
    except Exception:
        return default


def _canvas_payload(row) -> dict:
    if not row:
        return {"state": {}, "revision": 0, "updated_at": None}
    return {
        "state": _json_value(row["state_json"], {}),
        "revision": int(row["revision"]),
        "updated_at": row["updated_at"],
    }


def _asset_payload(row) -> dict:
    return {
        "id": row["id"],
        "design_id": row["design_id"],
        "project_id": row["project_id"],
        "session_id": row["session_id"],
        "parent_asset_id": row["parent_asset_id"],
        "image_url": row["image_url"],
        "kind": row["kind"],
        "prompt": row["prompt"] or "",
        "model_name": row["model_name"] or "",
        "tool_name": row["tool_name"] or "",
        "trace_id": row["trace_id"],
        "metadata": _json_value(row["metadata"], {}),
        "created_at": row["created_at"],
    }


def _job_payload(row) -> dict:
    return {
        "id": row["id"],
        "design_id": row["design_id"],
        "project_id": row["project_id"],
        "session_id": row["session_id"],
        "kind": row["kind"],
        "status": row["status"],
        "progress": int(row["progress"] or 0),
        "request": _json_value(row["request_json"], {}),
        "result": _json_value(row["result_json"], {}),
        "error": row["error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
    }


class CanvasSaveRequest(BaseModel):
    state: dict = Field(default_factory=dict)
    expected_revision: Optional[int] = None


class CanvasRevisionRequest(BaseModel):
    label: str = ""


@router.post("/api/designs/{design_id}/canvas/assets")
async def upload_canvas_asset(design_id: str, file: UploadFile = File(...)):
    user = _require_user()
    design = db.get_design(design_id, user["email"])
    if not design:
        raise HTTPException(404, "设计不存在")
    _ensure_owned_session(
        user["email"],
        design_id,
        project_id=design["project_id"],
        design_id=design_id,
    )

    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(400, "画布仅支持图片素材")
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "文件为空")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(413, "图片不能超过 25MB")

    suffix = Path(file.filename or "image.png").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}:
        suffix = ".png"
    user_key = hashlib.sha256(user["email"].encode("utf-8")).hexdigest()[:16]
    target_dir = Path(OUTPUTS_DIR) / "canvas_assets" / user_key / design_id
    target_dir.mkdir(parents=True, exist_ok=True)
    asset_id = uuid.uuid4().hex
    target = target_dir / f"{asset_id}{suffix}"
    target.write_bytes(raw)
    image_url = f"/api/images/canvas_assets/{user_key}/{design_id}/{target.name}"
    row = db.create_generation_asset(
        asset_id=asset_id,
        user_email=user["email"],
        design_id=design_id,
        project_id=design["project_id"],
        session_id=design_id,
        image_url=image_url,
        kind="canvas_upload",
        metadata={"filename": file.filename or target.name, "content_type": content_type, "size": len(raw)},
    )
    return {"asset": _asset_payload(row)}


@router.get("/api/designs/{design_id}/canvas")
async def get_canvas(design_id: str):
    user = _require_user()
    if not db.get_design(design_id, user["email"]):
        raise HTTPException(404, "设计不存在")
    return _canvas_payload(db.get_canvas_document(design_id, user["email"]))


@router.put("/api/designs/{design_id}/canvas")
async def save_canvas(design_id: str, req: CanvasSaveRequest):
    user = _require_user()
    try:
        row, conflict = db.save_canvas_document(
            design_id,
            user["email"],
            req.state,
            expected_revision=req.expected_revision,
        )
    except ValueError:
        raise HTTPException(404, "设计不存在")
    if conflict:
        raise HTTPException(
            409,
            detail={
                "message": "画布已在其他窗口更新，请重新载入后再保存",
                "server": _canvas_payload(row),
            },
        )
    return _canvas_payload(row)


@router.get("/api/designs/{design_id}/canvas/revisions")
async def list_canvas_revisions(design_id: str):
    user = _require_user()
    if not db.get_design(design_id, user["email"]):
        raise HTTPException(404, "设计不存在")
    rows = db.list_canvas_revisions(design_id, user["email"])
    return {"revisions": [dict(row) for row in rows]}


@router.post("/api/designs/{design_id}/canvas/revisions")
async def create_canvas_revision(design_id: str, req: CanvasRevisionRequest):
    user = _require_user()
    if not db.get_design(design_id, user["email"]):
        raise HTTPException(404, "设计不存在")
    row = db.create_canvas_revision(design_id, user["email"], req.label)
    if not row:
        raise HTTPException(409, "画布尚未保存，无法创建版本")
    return {"revision": dict(row)}


@router.post("/api/designs/{design_id}/canvas/revisions/{revision_id}/restore")
async def restore_canvas_revision(design_id: str, revision_id: str):
    user = _require_user()
    snapshot = db.get_canvas_revision(revision_id, design_id, user["email"])
    if not snapshot:
        raise HTTPException(404, "画布版本不存在")
    state = _json_value(snapshot["state_json"], {})
    row, _ = db.save_canvas_document(design_id, user["email"], state)
    return _canvas_payload(row)


@router.get("/api/designs/{design_id}/assets")
async def list_design_assets(design_id: str):
    user = _require_user()
    if not db.get_design(design_id, user["email"]):
        raise HTTPException(404, "设计不存在")
    rows = db.list_generation_assets(user["email"], design_id=design_id)
    return {"assets": [_asset_payload(row) for row in rows]}


@router.get("/api/jobs")
async def list_jobs(session_id: Optional[str] = None):
    user = _require_user()
    rows = db.list_generation_jobs(user["email"], session_id=session_id)
    return {"jobs": [_job_payload(row) for row in rows]}


@router.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    user = _require_user()
    row = db.get_generation_job(job_id, user["email"])
    if not row:
        raise HTTPException(404, "任务不存在")
    return {"job": _job_payload(row)}
