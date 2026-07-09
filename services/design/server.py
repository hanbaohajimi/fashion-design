"""Compatibility entrypoint for the Design API.

The FastAPI app now lives in app.py; route handlers live under routes/.
"""

from app import app

__all__ = ["app"]
