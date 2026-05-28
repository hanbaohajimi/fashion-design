"""
Design Studio Service — Port 8001

Resolution order for the design backend (server.py):
  1. FASHION_DESIGN_BACKEND env var (set in project .env)
  2. Same directory as this file (backend/design-studio/server.py)  ← default when self-contained
  3. backend/vendor/design-backend/server.py
  4. G:\\时尚平台\\backend  (legacy fallback)

If server.py is not found, falls back to the built-in stub service so the
platform stays responsive even without the full design backend.

Environment variables:
  FASHION_DESIGN_BACKEND     — absolute path to dir containing server.py
  FASHION_DESIGN_USE_STUB    — auto (default) | 1/true (force stub) | 0/false (force full, exit on fail)
  DESIGN_STUDIO_PORT         — listen port, default 8001
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


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
    # Default: co-located server.py in the same directory (self-contained layout)
    same_dir = Path(__file__).resolve().parent
    if (same_dir / "server.py").is_file():
        return str(same_dir)
    # Fallback: vendor directory
    vend = _project_root() / "backend" / "vendor" / "design-backend"
    if vend.is_dir() and (vend / "server.py").is_file():
        return str(vend)
    # Legacy fallback
    return r"G:\时尚平台\backend"


def _stub_env_forced() -> bool | None:
    raw = os.environ.get("FASHION_DESIGN_USE_STUB", "auto").strip().lower()
    if raw in ("1", "true", "yes", "stub"):
        return True
    if raw in ("0", "false", "no", "full"):
        return False
    return None


def _has_server_py(root: str) -> bool:
    return Path(root, "server.py").is_file()


def _load_app() -> tuple[object, bool, str]:
    """Returns (FastAPI app, is_stub, info_msg)."""
    resolved = _resolve_design_backend()
    mode = _stub_env_forced()

    if mode is True:
        from design_stub_app import app as stub_app
        return stub_app, True, "FASHION_DESIGN_USE_STUB=1 forced stub"

    if _has_server_py(resolved):
        if resolved not in sys.path:
            sys.path.insert(0, resolved)
        try:
            from server import app as full_app  # type: ignore[import-not-found]
            return full_app, False, resolved
        except Exception as e:
            print(f"[Design Studio] Failed to load server app: {e}")
            if mode is False:
                raise SystemExit(1) from e
            from design_stub_app import app as stub_app
            return stub_app, True, f"import failed, falling back to stub: {e}"

    print(
        f"[Design Studio] server.py not found at: {resolved}\n"
        "Falling back to stub service (port accessible, no real AI generation).\n"
        "To enable full functionality: server.py is included at backend/design-studio/server.py — "
        "this should work automatically. Check FASHION_DESIGN_BACKEND in .env if needed."
    )
    if mode is False:
        raise SystemExit(1)

    from design_stub_app import app as stub_app
    return stub_app, True, f"server.py missing: {resolved}"


os.environ.setdefault("DESIGN_STUDIO_PORT", "8001")
app, _STUB_MODE, _BACKEND_INFO = _load_app()

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("DESIGN_STUDIO_PORT", "8001"))
    if _STUB_MODE:
        print(f"[Design Studio] Mode: stub (port {port})")
        print(f"[Design Studio] Reason: {_BACKEND_INFO}")
    else:
        print(f"[Design Studio] Mode: full backend (port {port})")
        print(f"[Design Studio] Path: {_BACKEND_INFO}")

    uvicorn.run(app, host="0.0.0.0", port=port)
