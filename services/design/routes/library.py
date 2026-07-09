import asyncio
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

import db
from runtime import (
    CollectionCreateRequest,
    CollectionItemsRequest,
    CollectionPatchRequest,
    LibraryAnalyzeRequest,
    LibraryPatchRequest,
    RetryTagsRequest,
    SuggestOutfitRequest,
    _analyze_library_for_profile,
    _auto_tag_image,
    _require_user,
    _row_to_item,
    _run_llm_summary,
)

router = APIRouter()


@router.get("/api/library")
async def list_library(
    authorization: Optional[str] = Header(None),
    mode: Optional[str] = None,
    project_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    is_favorite: Optional[bool] = None,
    tags: Optional[str] = None,
    page: int = 1,
    limit: int = 30,
):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    tag_list = [t.strip() for t in tags.split(",")] if tags else None
    rows, total = db.list_library_items(
        user["email"],
        mode=mode,
        designer_project_id=project_id,
        collection_id=collection_id,
        is_favorite=is_favorite,
        tags=tag_list,
        page=page,
        limit=limit,
    )
    items = [_row_to_item(r) for r in rows]
    return {"items": items, "total": total, "page": page, "has_more": (page * limit) < total}


@router.patch("/api/library/{item_id}")
async def patch_library_item(item_id: str, req: LibraryPatchRequest):
    user = _require_user()
    kwargs = {}
    if req.is_favorite is not None:
        kwargs["is_favorite"] = req.is_favorite
    if req.user_tags is not None:
        kwargs["user_tags"] = req.user_tags
    if req.notes is not None:
        kwargs["notes"] = req.notes
    if req.save_context is not None:
        kwargs["save_context"] = req.save_context
    row = db.patch_library_item(item_id, user["email"], **kwargs)
    if not row:
        raise HTTPException(status_code=404, detail="图片不存在")
    item = _row_to_item(row)
    # If favorited, trigger library analysis
    if req.is_favorite is True:
        asyncio.create_task(_analyze_library_for_profile(user["email"], "personal"))
    return {"item": item}


@router.delete("/api/library/{item_id}")
async def delete_library_item(item_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    ok = db.soft_delete_library_item(item_id, user["email"])
    if not ok:
        raise HTTPException(status_code=404, detail="图片不存在")
    return {"status": "ok"}


@router.get("/api/library/stats")
async def get_library_stats(authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    stats = db.get_library_stats(user["email"])
    return stats


@router.get("/api/library/{item_id}/similar")
async def get_similar_items(item_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    row = db.get_library_item(item_id, user["email"])
    if not row:
        raise HTTPException(status_code=404, detail="图片不存在")
    try:
        target_tags = json.loads(row["auto_tags"] or "{}")
    except Exception:
        target_tags = {}

    target_colors = set(target_tags.get("colors", []))
    target_styles = set(target_tags.get("style_keywords", []))
    target_sil = target_tags.get("silhouette", "")
    target_occ = set(target_tags.get("occasions", []))

    rows, _ = db.list_library_items(user["email"], limit=200)
    scored = []
    for r in rows:
        if r["id"] == item_id:
            continue
        try:
            t = json.loads(r["auto_tags"] or "{}")
        except Exception:
            continue
        score = (
            len(target_colors & set(t.get("colors", []))) * 2
            + len(target_styles & set(t.get("style_keywords", []))) * 3
            + (2 if target_sil and t.get("silhouette") == target_sil else 0)
            + len(target_occ & set(t.get("occasions", [])))
        )
        max_score = max(len(target_colors) * 2 + len(target_styles) * 3 + 2 + len(target_occ), 1)
        norm = score / max_score
        if norm >= 0.3:
            scored.append((_row_to_item(r), norm))
    scored.sort(key=lambda x: -x[1])
    return {"items": [x[0] for x in scored[:12]]}


@router.post("/api/library/analyze")
async def trigger_library_analyze(req: LibraryAnalyzeRequest):
    user = _require_user()
    await _analyze_library_for_profile(user["email"], "personal")
    await _analyze_library_for_profile(user["email"], "designer")
    return {"status": "ok"}


@router.post("/api/library/retry-tags")
async def retry_failed_tags(req: RetryTagsRequest):
    user = _require_user()
    rows, _ = db.list_library_items(user["email"], limit=500)
    count = 0
    for row in rows:
        if row["tag_status"] == "failed":
            db.update_library_item_tags(row["id"], {}, "pending")
            asyncio.create_task(_auto_tag_image(row["id"], row["image_url"], row["generation_prompt"] or ""))
            count += 1
    return {"status": "ok", "retrying": count}


@router.post("/api/library/suggest-outfit")
async def suggest_outfit(req: SuggestOutfitRequest):
    user = _require_user()
    occasion = req.occasion or "通勤"
    weather = req.weather or {}
    temp = weather.get("temp", 20)
    condition = weather.get("condition", "")

    # Get tagged items
    rows, _ = db.list_library_items(user["email"], mode="personal", limit=200)
    tagged = [_row_to_item(r) for r in rows if r["tag_status"] == "completed"]
    if not tagged:
        return {"outfits": [], "message": "库中还没有足够的图片，先生成一些服装图片吧"}

    # Build tag summary
    item_summaries = []
    for item in tagged[:50]:
        t = item["auto_tags"]
        summary = f"ID:{item['id']} 类型:{','.join(t.get('garment_types',[]))} 颜色:{','.join(t.get('colors',[]))} 廓形:{t.get('silhouette','')} 场合:{','.join(t.get('occasions',[]))} 风格:{','.join(t.get('style_keywords',[]))}"
        item_summaries.append(summary)

    system_prompt = (
        "你是专业造型师。根据用户的穿搭库和今日场合，推荐2-3套搭配。"
        '严格按以下JSON返回：{"outfits":[{"description":"搭配说明（30字内）","item_ids":["id1","id2"],"tags":["标签"]}]}'
    )
    user_prompt = (
        f"今日场合：{occasion}\n天气：{condition} {temp}°C\n"
        f"用户穿搭库（共{len(tagged)}件）：\n" + "\n".join(item_summaries)
    )

    result = await _run_llm_summary(system_prompt, user_prompt)
    if not result:
        return {"outfits": [], "message": "AI 暂时无法生成搭配建议"}

    # Resolve item objects
    item_map = {item["id"]: item for item in tagged}
    outfits = []
    for outfit in result.get("outfits", []):
        items = [item_map[iid] for iid in outfit.get("item_ids", []) if iid in item_map]
        outfits.append({
            "description": outfit.get("description", ""),
            "items": items,
            "tags": outfit.get("tags", []),
        })
    return {"outfits": outfits}


@router.get("/api/library/collections")
async def list_collections(authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    rows = db.list_collections(user["email"])
    result = []
    for row in rows:
        col = dict(row)
        col["item_count"] = db.get_collection_item_count(col["id"])
        col["cover_image"] = db.get_collection_cover(col["id"])
        col["is_smart"] = bool(col.get("is_smart"))
        result.append(col)
    return {"collections": result}


@router.post("/api/library/collections")
async def create_collection(req: CollectionCreateRequest):
    user = _require_user()
    col_id = uuid.uuid4().hex
    db.create_collection(col_id, user["email"], req.name, mode=req.mode, designer_project_id=req.designer_project_id)
    row = db.get_collection(col_id, user["email"])
    col = dict(row)
    col["item_count"] = 0
    col["cover_image"] = None
    col["is_smart"] = False
    return {"collection": col}


@router.patch("/api/library/collections/{col_id}")
async def patch_collection(col_id: str, req: CollectionPatchRequest):
    user = _require_user()
    kwargs = {}
    if req.name is not None:
        kwargs["name"] = req.name
    if req.cover_item_id is not None:
        kwargs["cover_item_id"] = req.cover_item_id
    if req.sort_order is not None:
        kwargs["sort_order"] = req.sort_order
    row = db.patch_collection(col_id, user["email"], **kwargs)
    if not row:
        raise HTTPException(status_code=404, detail="合集不存在")
    col = dict(row)
    col["item_count"] = db.get_collection_item_count(col_id)
    col["cover_image"] = db.get_collection_cover(col_id)
    col["is_smart"] = bool(col.get("is_smart"))
    return {"collection": col}


@router.delete("/api/library/collections/{col_id}")
async def delete_collection(col_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    ok = db.delete_collection(col_id, user["email"])
    if not ok:
        raise HTTPException(status_code=404, detail="合集不存在")
    return {"status": "ok"}


@router.post("/api/library/collections/{col_id}/items")
async def add_to_collection(col_id: str, req: CollectionItemsRequest):
    user = _require_user()
    if not db.get_collection(col_id, user["email"]):
        raise HTTPException(status_code=404, detail="合集不存在")
    db.add_items_to_collection(col_id, req.item_ids)
    return {"status": "ok", "item_count": db.get_collection_item_count(col_id)}


@router.delete("/api/library/collections/{col_id}/items/{item_id}")
async def remove_from_collection(col_id: str, item_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    if not db.get_collection(col_id, user["email"]):
        raise HTTPException(status_code=404, detail="合集不存在")
    db.remove_item_from_collection(col_id, item_id)
    return {"status": "ok"}
