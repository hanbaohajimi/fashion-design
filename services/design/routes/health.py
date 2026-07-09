from datetime import datetime

from fastapi import APIRouter

from ai_clients import IMAGE_MODEL, TEXT_MODEL
from runtime import sessions

router = APIRouter()


@router.get("/api/health")
async def health():
    return {
        "status": "ok",
        "sessions": len(sessions),
        "time": datetime.now().isoformat(),
        "models": {"image": IMAGE_MODEL, "llm": TEXT_MODEL},
    }
