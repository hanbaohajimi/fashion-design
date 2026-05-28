"""
Trend Analysis Service - Port 8002
优先加载 ai_fashion 完整后端；若目录不存在或导入失败，则自动启用内置占位服务，
避免统一平台一直显示「趋势分析未就绪」。

环境变量：
  AI_FASHION_BACKEND  — 含 api 模块的目录：存在 **api 包**（api/）或 **api.py**（单文件）均可。
  未设置时自动检测（按顺序）：`backend/vendor/ai_fashion/ai_fashion`、`backend/vendor/ai_fashion`、
  项目根下 **`ai_fashion/ai_fashion`**、`ai_fashion`，最后 `G:\\ai_fashion\\ai_fashion`。
  项目根 .env 可由 start.py 预加载后在此生效。
  FASHION_TREND_USE_STUB — force: 1/true=仅占位；0/false=强制尝试 ai_fashion（失败则退出码非零前打印错误）
  TREND_ANALYSIS_PORT   — 监听端口，默认 8002
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


def _is_ai_fashion_root(p: Path) -> bool:
    """支持 api 包目录或单文件 api.py（与仓库内 ai_fashion 布局一致）。"""
    if not p.is_dir():
        return False
    return (p / "api").is_dir() or (p / "api.py").is_file()


def _resolve_ai_fashion_backend() -> str:
    _load_dotenv()
    env = os.environ.get("AI_FASHION_BACKEND", "").strip()
    if env:
        return env
    root = _project_root()
    for parts in (
        ("backend", "vendor", "ai_fashion", "ai_fashion"),
        ("backend", "vendor", "ai_fashion"),
        ("ai_fashion", "ai_fashion"),
        ("ai_fashion",),
    ):
        p = root.joinpath(*parts)
        if _is_ai_fashion_root(p):
            return str(p)
    return r"G:\ai_fashion\ai_fashion"


ORIGINAL_BACKEND = _resolve_ai_fashion_backend().strip()
os.environ.setdefault("TREND_ANALYSIS_PORT", "8002")


def _stub_env_forced() -> bool | None:
    """None = auto；True = 强制占位；False = 强制完整后端。"""
    raw = os.environ.get("FASHION_TREND_USE_STUB", "auto").strip().lower()
    if raw in ("1", "true", "yes", "stub"):
        return True
    if raw in ("0", "false", "no", "full"):
        return False
    return None


def _should_try_full_backend() -> bool:
    mode = _stub_env_forced()
    if mode is True:
        return False
    if mode is False:
        return True
    return os.path.isdir(ORIGINAL_BACKEND)


def _load_app():
    """返回 (app, is_stub, info_msg)。"""
    if not _should_try_full_backend():
        from trend_stub_app import app as stub_app

        return stub_app, True, f"auto stub (backend path missing or not a directory: {ORIGINAL_BACKEND})"

    if ORIGINAL_BACKEND not in sys.path:
        sys.path.insert(0, ORIGINAL_BACKEND)

    try:
        from api import app as full_app  # type: ignore[import-not-found]

        return full_app, False, ORIGINAL_BACKEND
    except Exception as e:
        print(f"[Trend Analysis] 无法从 ai_fashion 加载 api 应用: {e}")
        if _stub_env_forced() is False:
            raise
        from trend_stub_app import app as stub_app

        return stub_app, True, "fallback stub after import error"


app, _STUB_MODE, _BACKEND_INFO = _load_app()

if not _STUB_MODE:
    try:
        from platform_season_display_filter import install_season_display_filter

        install_season_display_filter(app)
        print(
            "[Trend Analysis] 已启用季节展示过滤（FASHION_DISABLE_SEASON_DISPLAY_FILTER=1 可关闭）"
        )
    except Exception as e:
        print(f"[Trend Analysis] 季节展示过滤未挂载: {e}")

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("TREND_ANALYSIS_PORT", "8002"))
    if _STUB_MODE:
        print(f"[Trend Analysis] 运行模式: 占位服务 (port {port})")
        print(f"[Trend Analysis] 说明: {_BACKEND_INFO}")
    else:
        print(f"[Trend Analysis] 运行模式: ai_fashion 完整后端 (port {port})")
        print(f"[Trend Analysis] 路径: {_BACKEND_INFO}")

    uvicorn.run(app, host="0.0.0.0", port=port)
