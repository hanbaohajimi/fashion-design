from fastapi import APIRouter

from runtime import *

router = APIRouter()


@router.get("/api/health")
async def health():
    return {
        "status": "ok",
        "sessions": len(sessions),
        "time": datetime.now().isoformat(),
        "models": {"image": IMAGE_MODEL, "llm": TEXT_MODEL},
    }

