"""Compatibility entrypoint for the Trend API.

The FastAPI app now lives in app.py; route handlers live under routes/.
"""

from app import app

__all__ = ["app"]


if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.environ.get("TREND_ANALYSIS_PORT", "8002"))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=True)
