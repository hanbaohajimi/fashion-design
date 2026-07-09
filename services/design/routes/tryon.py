from fastapi import APIRouter

from runtime import *

router = APIRouter()


@router.get("/api/tryon/presets/{category}")
async def tryon_list_presets(
    category: str,
    gender: Optional[str] = None,
    type: Optional[str] = None,
    sub_category: Optional[str] = None,
):
    items = _load_preset_manifest(category)
    if gender:
        items = [it for it in items if it.get("gender") == gender]
    if type:
        items = [it for it in items if it.get("type") == type]
    if sub_category:
        items = [it for it in items if it.get("category") == sub_category]
    return {"category": category, "items": items}


@router.post("/api/tryon/generate")
async def tryon_generate(req: TryOnGenerateRequest, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)

    if not req.clothes:
        raise HTTPException(400, "请至少选择一件衣物")

    # Serialize concurrent generate calls per user — avoids burning DashScope budget
    # if the user double-clicks or hits the API twice from two tabs.
    user_lock = _get_user_tryon_lock(email)
    if user_lock.locked():
        raise HTTPException(429, "上一次生成尚未完成，请稍候")

    async with user_lock:
        return await _tryon_generate_impl(email, req)


@router.post("/api/tryon/save-outfit")
async def tryon_save_outfit(req: SaveTryOnOutfitRequest, authorization: Optional[str] = Header(None)):
    email = _require_wardrobe_user(authorization)
    if not req.wardrobe_item_ids and not req.preset_clothing_ids:
        raise HTTPException(400, "请至少包含一件衣物")
    if not (req.name or "").strip():
        raise HTTPException(400, "请提供穿搭名称")

    # Validate existing wardrobe IDs belong to this user
    for wid in req.wardrobe_item_ids:
        if not db.get_wardrobe_item(wid, email):
            raise HTTPException(404, f"衣橱衣物不存在: {wid}")

    new_ids = _ingest_preset_clothes_to_wardrobe(email, req.preset_clothing_ids)
    all_ids = list(req.wardrobe_item_ids) + new_ids
    if not all_ids:
        raise HTTPException(400, "没有可保存的衣物")

    outfit_id = uuid.uuid4().hex[:12]
    db.create_outfit(
        outfit_id, email, req.name.strip(), all_ids,
        description=req.description,
        occasion=req.occasion,
        season=req.season,
        style=req.style,
        cover_image_url=req.generated_image_url,
    )
    outfit = db.get_outfit(outfit_id, email)
    return {"outfit_id": outfit_id, "outfit": outfit, "ingested_preset_ids": new_ids}

