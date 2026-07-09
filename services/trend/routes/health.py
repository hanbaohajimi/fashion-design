from fastapi import APIRouter

from fastapi import HTTPException

from runtime import APP_VERSION, _health_payload, get_storage, logger, settings

router = APIRouter()


@router.get("/health")
@router.get("/api/health")
async def health():
    try:
        return _health_payload()
    except Exception as exc:
        logger.exception("Health check failed: {}", exc)
        raise HTTPException(
            503,
            detail={"status": "error", "message": str(exc)},
        )


@router.get("/api/meta")
async def api_meta():
    """前端可读的公开配置（不含密钥）"""
    from site_configs.loader import load_all_site_configs

    try:
        site_cfgs = load_all_site_configs()
        enabled_sites = sum(1 for c in site_cfgs if c.enabled)
    except Exception:
        enabled_sites = 0

    return {
        "version": APP_VERSION,
        "llm_configured": settings.is_llm_configured(),
        "timezone": settings.timezone,
        "schedule_hours": settings.schedule_hours,
        "store_backend": settings.store_backend,
        "stale_task_recovery_minutes": settings.stale_task_recovery_minutes,
        "enabled_site_count": enabled_sites,
    }


@router.get("/api/stats")
async def get_stats():
    try:
        return get_storage().get_stats()
    except Exception as exc:
        raise HTTPException(500, str(exc))
