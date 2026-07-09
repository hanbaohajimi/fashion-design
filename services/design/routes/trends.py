from fastapi import APIRouter

from runtime import *

router = APIRouter()


@router.get("/api/trends")
async def get_trends(
    authorization: Optional[str] = Header(None),
    season: Optional[str] = None,
    recommended: bool = False,
    search: Optional[str] = None,
):
    user_row = _require_user()
    user_email = user_row["email"]
    user_keywords: list = []
    profile = db.get_personal_profile(user_email)
    s = profile.get("static", {})
    d = profile.get("dynamic", {})
    user_keywords = list(s.get("style_keywords") or [])
    user_keywords += list(s.get("occasions") or [])
    user_keywords += list(s.get("color_palette") or [])
    for k in (d.get("inferred_keywords") or []):
        if k.get("confidence", 0) >= 0.5:
            user_keywords.append(k["tag"])
            if k.get("source") == "library" and k.get("confidence", 0) >= 0.4:
                user_keywords.append(k["tag"])  # 2x weight
    fav_ids = db.get_trend_favorite_ids(user_email)

    rows = db.list_trends(season=season)
    trends = [_row_to_trend(r) for r in rows]

    if search:
        q = search.lower()
        trends = [t for t in trends if q in (t.get("name") or "").lower() or
                  any(q in kw.lower() for kw in t.get("keywords", []))]

    for t in trends:
        t["match_score"] = _compute_match_score(t, user_keywords) if user_keywords else None
        t["is_favorite"] = t["id"] in fav_ids

    if recommended and user_keywords:
        trends.sort(key=lambda t: t.get("match_score") or 0, reverse=True)

    current_season = season or db.get_latest_trend_season() or ""
    return {"trends": trends, "season": current_season}


@router.get("/api/trends/seasons")
async def get_trend_seasons():
    with db._lock:
        rows = db._get_conn().execute(
            "SELECT DISTINCT season FROM trends WHERE status='active' AND season != '' ORDER BY season DESC"
        ).fetchall()
    return {"seasons": [r["season"] for r in rows]}


@router.post("/api/trends/sync")
async def trigger_trend_sync(req: TrendSyncRequest):
    _require_user()
    count = await _sync_trends_from_report()
    return {"status": "ok", "synced": count}


@router.get("/api/trends/{trend_id}")
async def get_trend_detail(trend_id: str, authorization: Optional[str] = Header(None)):
    user_row = _require_user()
    row = db.get_trend(trend_id)
    if not row:
        raise HTTPException(status_code=404, detail="趋势不存在")
    trend = _row_to_trend(row)
    fav_ids = db.get_trend_favorite_ids(user_row["email"])
    trend["is_favorite"] = trend_id in fav_ids
    return {"trend": trend}


@router.post("/api/trends/{trend_id}/favorite")
async def favorite_trend(trend_id: str, req: TrendFavoriteRequest):
    user = _require_user()
    if not db.get_trend(trend_id):
        raise HTTPException(status_code=404, detail="趋势不存在")
    db.add_trend_favorite(user["email"], trend_id)
    return {"status": "ok"}


@router.delete("/api/trends/{trend_id}/favorite")
async def unfavorite_trend(trend_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    db.remove_trend_favorite(user["email"], trend_id)
    return {"status": "ok"}

