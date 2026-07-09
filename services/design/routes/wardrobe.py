import asyncio
import os
import urllib.request
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile

import db
from runtime import (
    OUTPUTS_DIR,
    OutfitAddItemRequest,
    OutfitCreateRequest,
    OutfitPatchRequest,
    WardrobeBatchDeleteRequest,
    WardrobeFromDesignRequest,
    WardrobeFromTrendRequest,
    WardrobePatchRequest,
    _PERSON_IMAGE_TYPES,
    _ensure_owned_session,
    _require_wardrobe_user,
    _save_wardrobe_image,
    _wardrobe_auto_tag,
    _wardrobe_row_to_dict,
)

router = APIRouter()


@router.get("/api/wardrobe/items")
async def wardrobe_list_items(
    authorization: Optional[str] = Header(None),
    category: Optional[str] = None,
    source_type: Optional[str] = None,
    season: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 30,
):
    email = _require_wardrobe_user(authorization)
    rows, total = db.list_wardrobe_items(email, category, source_type, season, search, page, limit)
    return {"items": [_wardrobe_row_to_dict(r) for r in rows], "total": total, "page": page}


@router.post("/api/wardrobe/items/from-trend")
async def wardrobe_from_trend(req: WardrobeFromTrendRequest, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    item_id = uuid.uuid4().hex[:12]
    try:
        img_data = await asyncio.to_thread(lambda: urllib.request.urlopen(req.image_url).read())
    except Exception:
        raise HTTPException(400, "Failed to download image")
    image_url, thumb_url = _save_wardrobe_image(email, item_id, img_data)
    db.create_wardrobe_item(item_id, email, image_url, "trend", req.source_ref, req.image_url, req.name)
    db.patch_wardrobe_item(item_id, email, thumbnail_url=thumb_url) if thumb_url else None
    asyncio.create_task(_wardrobe_auto_tag(item_id, image_url))
    return {"id": item_id, "image_url": image_url, "source_label": "时尚趋势"}


@router.post("/api/wardrobe/items/from-design")
async def wardrobe_from_design(req: WardrobeFromDesignRequest, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    if req.session_id:
        _ensure_owned_session(email, req.session_id, create_if_missing=False)
    if req.image_type in _PERSON_IMAGE_TYPES:
        raise HTTPException(
            400,
            "模特图/试穿图属于人物展示，不适合加入衣橱。衣橱只用于单品(衣服/鞋/包)，请改用「收藏到作品集」。",
        )
    item_id = uuid.uuid4().hex[:12]
    src_rel = req.image_url.removeprefix("/api/design/images/")
    base_dir = os.path.abspath(OUTPUTS_DIR)
    src_path = os.path.abspath(os.path.join(base_dir, src_rel.replace("/", os.sep)))
    if os.path.commonpath([base_dir, src_path]) != base_dir:
        raise HTTPException(404, "Source image not found")
    if not os.path.exists(src_path):
        raise HTTPException(404, "Source image not found")
    with open(src_path, "rb") as f:
        img_data = f.read()
    ext = os.path.splitext(src_path)[1].lstrip(".") or "png"
    image_url, thumb_url = _save_wardrobe_image(email, item_id, img_data, ext)
    db.create_wardrobe_item(item_id, email, image_url, "design", req.session_id, req.image_url, req.name)
    asyncio.create_task(_wardrobe_auto_tag(item_id, image_url))
    return {"id": item_id, "image_url": image_url, "source_label": "我的设计"}


@router.post("/api/wardrobe/items")
async def wardrobe_upload(
    file: UploadFile = File(...),
    name: str = Form(""),
    authorization: Optional[str] = Header(None),
):
    email = _require_wardrobe_user(authorization)
    item_id = uuid.uuid4().hex[:12]
    data = await file.read()
    ext = (file.filename or "image.png").rsplit(".", 1)[-1].lower() or "png"
    image_url, thumb_url = _save_wardrobe_image(email, item_id, data, ext)
    db.create_wardrobe_item(item_id, email, image_url, "upload", name=name)
    asyncio.create_task(_wardrobe_auto_tag(item_id, image_url))
    return {"id": item_id, "image_url": image_url, "source_label": "我的上传"}


@router.get("/api/wardrobe/items/{item_id}")
async def wardrobe_get_item(item_id: str, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    row = db.get_wardrobe_item(item_id, email)
    if not row:
        raise HTTPException(404, "Item not found")
    return {"item": _wardrobe_row_to_dict(row)}


@router.patch("/api/wardrobe/items/{item_id}")
async def wardrobe_patch_item(item_id: str, req: WardrobePatchRequest, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    updates = {k: v for k, v in req.dict().items() if v is not None}
    row = db.patch_wardrobe_item(item_id, email, **updates)
    if not row:
        raise HTTPException(404, "Item not found")
    return {"item": _wardrobe_row_to_dict(row)}


@router.delete("/api/wardrobe/items/{item_id}")
async def wardrobe_delete_item(item_id: str, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    ok = db.delete_wardrobe_item(item_id, email)
    if not ok:
        raise HTTPException(404, "Item not found")
    return {"ok": True}


@router.post("/api/wardrobe/items/batch-delete")
async def wardrobe_batch_delete(req: WardrobeBatchDeleteRequest, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    removed = db.delete_wardrobe_items_batch(req.item_ids, email)
    return {"removed": removed}


@router.post("/api/wardrobe/items/{item_id}/re-analyze")
async def wardrobe_re_analyze(item_id: str, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    row = db.get_wardrobe_item(item_id, email)
    if not row:
        raise HTTPException(404, "Item not found")
    db.update_wardrobe_item_ai(item_id, {}, "pending")
    asyncio.create_task(_wardrobe_auto_tag(item_id, row["image_url"]))
    return {"ok": True}


@router.get("/api/wardrobe/stats")
async def wardrobe_stats(authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    return db.get_wardrobe_stats(email)


@router.post("/api/wardrobe/outfits")
async def wardrobe_create_outfit(req: OutfitCreateRequest, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    outfit_id = uuid.uuid4().hex[:12]
    db.create_outfit(outfit_id, email, req.name, req.item_ids,
                     description=req.description, occasion=req.occasion, season=req.season, style=req.style)
    outfit = db.get_outfit(outfit_id, email)
    return {"outfit": outfit}


@router.get("/api/wardrobe/outfits")
async def wardrobe_list_outfits(
    authorization: Optional[str] = Header(None),
    occasion: Optional[str] = None,
    season: Optional[str] = None,
):
    email = _require_wardrobe_user(authorization)
    return {"outfits": db.list_outfits(email, occasion, season)}


@router.get("/api/wardrobe/outfits/{outfit_id}")
async def wardrobe_get_outfit(outfit_id: str, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    outfit = db.get_outfit(outfit_id, email)
    if not outfit:
        raise HTTPException(404, "Outfit not found")
    return {"outfit": outfit}


@router.patch("/api/wardrobe/outfits/{outfit_id}")
async def wardrobe_patch_outfit(outfit_id: str, req: OutfitPatchRequest, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    updates = {k: v for k, v in req.dict().items() if v is not None}
    outfit = db.patch_outfit(outfit_id, email, **updates)
    if not outfit:
        raise HTTPException(404, "Outfit not found")
    return {"outfit": outfit}


@router.delete("/api/wardrobe/outfits/{outfit_id}")
async def wardrobe_delete_outfit(outfit_id: str, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    ok = db.delete_outfit(outfit_id, email)
    if not ok:
        raise HTTPException(404, "Outfit not found")
    return {"ok": True}


@router.post("/api/wardrobe/outfits/{outfit_id}/items")
async def wardrobe_add_outfit_item(outfit_id: str, req: OutfitAddItemRequest, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    outfit = db.get_outfit(outfit_id, email)
    if not outfit:
        raise HTTPException(404, "Outfit not found")
    db.add_outfit_item(outfit_id, req.wardrobe_item_id, req.layer_order)
    return db.get_outfit(outfit_id, email)


@router.delete("/api/wardrobe/outfits/{outfit_id}/items/{wardrobe_item_id}")
async def wardrobe_remove_outfit_item(outfit_id: str, wardrobe_item_id: str, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    ok = db.remove_outfit_item(outfit_id, wardrobe_item_id)
    if not ok:
        raise HTTPException(404, "Item not in outfit")
    return {"ok": True}
