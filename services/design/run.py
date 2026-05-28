"""
Design Studio Service — Port 8001

Resolution order for server.py:
  1. FASHION_DESIGN_BACKEND env var
  2. Same directory as this file (services/design/server.py)  ← default self-contained
  3. G:\\时尚平台\\backend  (legacy fallback)

Environment variables:
  FASHION_DESIGN_BACKEND     — absolute path to dir containing server.py
  FASHION_DESIGN_USE_STUB    — auto (default) | 1/true (force stub) | 0/false (force full)
  DESIGN_STUDIO_PORT         — listen port, default 8001
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _project_root() -> Path:
    # services/design/run.py → services/design → services → project root
    return Path(__file__).resolve().parent.parent.parent


def _stubs_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "_stubs"


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


def _resolve_design_backend() -> str:
    _load_dotenv()
    env = os.environ.get("FASHION_DESIGN_BACKEND", "").strip()
    if env:
        return env
    # Default: co-located server.py (self-contained layout)
    same_dir = Path(__file__).resolve().parent
    if (same_dir / "server.py").is_file():
        return str(same_dir)
    return r"G:\时尚平台\backend"


def _stub_env_forced() -> bool | None:
    raw = os.environ.get("FASHION_DESIGN_USE_STUB", "auto").strip().lower()
    if raw in ("1", "true", "yes", "stub"):
        return True
    if raw in ("0", "false", "no", "full"):
        return False
    return None


def _import_stub():
    stubs = str(_stubs_dir())
    if stubs not in sys.path:
        sys.path.insert(0, stubs)
    from design_stub_app import app as stub_app  # type: ignore[import-not-found]
    return stub_app


def _load_app() -> tuple[object, bool, str]:
    resolved = _resolve_design_backend()
    mode = _stub_env_forced()

    if mode is True:
        return _import_stub(), True, "FASHION_DESIGN_USE_STUB=1 forced stub"

    if Path(resolved, "server.py").is_file():
        if resolved not in sys.path:
            sys.path.insert(0, resolved)
        try:
            from server import app as full_app  # type: ignore[import-not-found]
            return full_app, False, resolved
        except Exception as e:
            print(f"[Design Studio] Failed to load server app: {e}")
            if mode is False:
                raise SystemExit(1) from e
            return _import_stub(), True, f"import failed, falling back to stub: {e}"

    print(
        f"[Design Studio] server.py not found at: {resolved}\n"
        "Falling back to stub (port accessible, no real AI generation)."
    )
    if mode is False:
        raise SystemExit(1)
    return _import_stub(), True, f"server.py missing: {resolved}"


os.environ.setdefault("DESIGN_STUDIO_PORT", "8001")
app, _STUB_MODE, _BACKEND_INFO = _load_app()

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("DESIGN_STUDIO_PORT", "8001"))
    mode_label = "stub" if _STUB_MODE else "full"
    print(f"[Design Studio] mode={mode_label} port={port} path={_BACKEND_INFO}")
    uvicorn.run(app, host="0.0.0.0", port=port)
