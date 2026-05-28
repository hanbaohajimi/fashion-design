"""
Trend Analysis Service — Port 8002

Loads services/trend as the full backend (auto-detected).
Falls back to _stubs/trend_stub_app.py if unavailable.

Environment variables:
  AI_FASHION_BACKEND       — path to dir containing api.py or api/ package
  FASHION_TREND_USE_STUB   — auto (default) | 1/true (force stub) | 0/false (force full)
  TREND_ANALYSIS_PORT      — listen port, default 8002
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _project_root() -> Path:
    # services/trend_runner.py → services → project root
    return Path(__file__).resolve().parent.parent


def _stubs_dir() -> Path:
    return Path(__file__).resolve().parent / "_stubs"


def _load_dotenv() -> None:
    path = _project_root() / ".env"
    if not path.is_file():
        return
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except OSError:
        pass


def _is_trend_root(p: Path) -> bool:
    if not p.is_dir():
        return False
    return (p / "api").is_dir() or (p / "api.py").is_file()


def _resolve_trend_backend() -> str:
    _load_dotenv()
    env = os.environ.get("AI_FASHION_BACKEND", "").strip()
    if env:
        return env
    root = _project_root()
    # Default: services/trend/ (self-contained layout)
    for parts in (
        ("services", "trend"),
        ("ai_fashion", "ai_fashion"),   # legacy path if someone moved it back
    ):
        p = root.joinpath(*parts)
        if _is_trend_root(p):
            return str(p)
    return r"G:\ai_fashion\ai_fashion"


def _stub_env_forced() -> bool | None:
    raw = os.environ.get("FASHION_TREND_USE_STUB", "auto").strip().lower()
    if raw in ("1", "true", "yes", "stub"):
        return True
    if raw in ("0", "false", "no", "full"):
        return False
    return None


def _import_stub():
    stubs = str(_stubs_dir())
    if stubs not in sys.path:
        sys.path.insert(0, stubs)
    from trend_stub_app import app as stub_app  # type: ignore[import-not-found]
    return stub_app


ORIGINAL_BACKEND = _resolve_trend_backend().strip()
os.environ.setdefault("TREND_ANALYSIS_PORT", "8002")


def _load_app():
    mode = _stub_env_forced()
    if mode is True:
        return _import_stub(), True, "FASHION_TREND_USE_STUB=1 forced stub"
    if mode is None and not os.path.isdir(ORIGINAL_BACKEND):
        return _import_stub(), True, f"auto stub (path missing: {ORIGINAL_BACKEND})"

    if ORIGINAL_BACKEND not in sys.path:
        sys.path.insert(0, ORIGINAL_BACKEND)
    try:
        from api import app as full_app  # type: ignore[import-not-found]
        return full_app, False, ORIGINAL_BACKEND
    except Exception as e:
        print(f"[Trend] Failed to load api app: {e}")
        if mode is False:
            raise
        return _import_stub(), True, f"fallback stub after import error: {e}"


app, _STUB_MODE, _BACKEND_INFO = _load_app()

if not _STUB_MODE:
    try:
        # platform_season_display_filter lives in services/trend/
        trend_dir = str(Path(ORIGINAL_BACKEND))
        if trend_dir not in sys.path:
            sys.path.insert(0, trend_dir)
        from platform_season_display_filter import install_season_display_filter
        install_season_display_filter(app)
        print("[Trend] Season display filter enabled (FASHION_DISABLE_SEASON_DISPLAY_FILTER=1 to disable)")
    except Exception as e:
        print(f"[Trend] Season filter not mounted: {e}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("TREND_ANALYSIS_PORT", "8002"))
    mode_label = "stub" if _STUB_MODE else "full"
    print(f"[Trend] mode={mode_label} port={port} path={_BACKEND_INFO}")
    uvicorn.run(app, host="0.0.0.0", port=port)
