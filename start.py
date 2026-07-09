"""
AI Fashion Design Platform local console.

Usage:
  python start.py
  python start.py --check-only

Starts Frontend (port 3100 by default) + Design API (8001) + Trend API (8002),
then prints a compact platform health summary.
"""
from __future__ import annotations

import argparse
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
DESIGN_DIR = PROJECT_DIR / "services" / "design"
TREND_RUNNER_DIR = PROJECT_DIR / "services"

PROFILES_DB = DESIGN_DIR / "data" / "profiles.db"
TREND_DB = PROJECT_DIR / "services" / "trend" / "storage" / "fashion_pipeline.db"

processes: list[subprocess.Popen] = []


@dataclass(frozen=True)
class StatusLine:
    level: str
    message: str


def _load_dotenv() -> None:
    """Load root .env without overriding existing environment variables."""
    path = PROJECT_DIR / ".env"
    if not path.is_file():
        return

    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except OSError as exc:
        print(f"[WARN] Could not read .env: {exc}")


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        print(f"[WARN] Invalid {name}={raw!r}; using {default}")
        return default


_load_dotenv()
FRONTEND_PORT = _int_env("FASHION_FRONTEND_PORT", 3100)
DESIGN_PORT = _int_env("DESIGN_STUDIO_PORT", 8001)
TREND_PORT = _int_env("TREND_ANALYSIS_PORT", 8002)


def stream_output(proc: subprocess.Popen, prefix: str) -> None:
    """Stream subprocess output with a stable service prefix."""
    if proc.stdout is None:
        return
    try:
        for line in iter(proc.stdout.readline, b""):
            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                print(f"[{prefix}] {text}", flush=True)
    except Exception:
        pass


def start_service(name: str, cmd: str, cwd: Path) -> subprocess.Popen | None:
    """Start a subprocess and stream its output."""
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=os.environ.copy(),
            shell=True,
        )
        processes.append(proc)
        thread = threading.Thread(target=stream_output, args=(proc, name), daemon=True)
        thread.start()
        return proc
    except Exception as exc:
        print(f"[ERROR] Failed to start {name}: {exc}")
        return None


def check_port(port: int, timeout: float = 8.0) -> bool:
    """Wait for a local TCP port to accept connections."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def check_file(path: Path, ok_message: str, warn_message: str) -> StatusLine:
    if path.is_file():
        return StatusLine("OK", ok_message)
    return StatusLine("WARN", f"{warn_message}: {path}")


def check_amux_key() -> StatusLine:
    if os.environ.get("AMUX_API_KEY", "").strip():
        return StatusLine("OK", "AMUX_API_KEY configured")
    return StatusLine("WARN", "AMUX_API_KEY missing, design AI will use stub mode")


def _extract_playwright_chromium_locations(output: str) -> list[Path]:
    locations: list[Path] = []
    in_chromium_block = False

    for raw in output.splitlines():
        line = raw.strip()
        if not line:
            continue

        if "playwright chromium" in line:
            in_chromium_block = True
            continue
        if line.startswith(("FFmpeg", "Winldd")):
            in_chromium_block = False
            continue

        if in_chromium_block and line.startswith("Install location:"):
            _, _, value = line.partition(":")
            location = value.strip()
            if location:
                locations.append(Path(location))

    return locations


def check_playwright_chromium() -> StatusLine:
    try:
        import playwright  # noqa: F401
    except Exception:
        return StatusLine(
            "WARN",
            "Playwright package missing, run: python -m pip install playwright",
        )

    try:
        result = subprocess.run(
            [sys.executable, "-m", "playwright", "install", "chromium", "--dry-run"],
            cwd=str(PROJECT_DIR),
            env=os.environ.copy(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
    except Exception as exc:
        return StatusLine("WARN", f"Playwright Chromium check failed: {exc}")

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().splitlines()
        suffix = f": {detail[-1]}" if detail else ""
        return StatusLine("WARN", f"Playwright Chromium check failed{suffix}")

    locations = _extract_playwright_chromium_locations(result.stdout)
    if any(path.is_dir() for path in locations):
        return StatusLine("OK", "Playwright Chromium installed")

    return StatusLine(
        "WARN",
        "Playwright Chromium missing, run: python -m playwright install chromium",
    )


def service_port_status(name: str, port: int, ready: bool) -> StatusLine:
    if ready:
        return StatusLine("OK", f"{name} port: {port}")
    return StatusLine("WARN", f"{name} port: {port} not responding yet")


def print_status(lines: list[StatusLine]) -> None:
    print("Fashion Design Platform")
    print()
    for line in lines:
        print(f"[{line.level}] {line.message}")
    print()
    print(f"Open: http://localhost:{FRONTEND_PORT}")


def build_preflight_status() -> list[StatusLine]:
    return [
        check_file(PROFILES_DB, "profiles.db found", "profiles.db missing"),
        check_file(TREND_DB, "fashion_pipeline.db found", "fashion_pipeline.db missing"),
        check_amux_key(),
        check_playwright_chromium(),
    ]


def ensure_frontend_dependencies() -> None:
    node_modules = FRONTEND_DIR / "node_modules"
    if node_modules.is_dir():
        return

    print("[PLATFORM] Installing frontend dependencies...")
    subprocess.run("npm install", cwd=str(FRONTEND_DIR), shell=True, check=True)
    print()


def cleanup(*_args: object) -> None:
    print("\n[PLATFORM] Shutting down all services...")
    for proc in processes:
        try:
            proc.terminate()
        except Exception:
            pass

    time.sleep(1)

    for proc in processes:
        try:
            if proc.poll() is None:
                proc.kill()
        except Exception:
            pass

    print("[PLATFORM] All services stopped.")
    raise SystemExit(0)


def start_platform() -> None:
    python_cmd = sys.executable

    print("[PLATFORM] Starting Design API...")
    start_service("Design", f'"{python_cmd}" run.py', DESIGN_DIR)

    print("[PLATFORM] Starting Trend API...")
    start_service("Trend", f'"{python_cmd}" trend_runner.py', TREND_RUNNER_DIR)

    time.sleep(2)

    print("[PLATFORM] Starting Frontend...")
    start_service("Frontend", f"npx vite --port {FRONTEND_PORT} --host 0.0.0.0", FRONTEND_DIR)


def wait_for_platform() -> list[StatusLine]:
    frontend_ready = check_port(FRONTEND_PORT, timeout=12)
    design_ready = check_port(DESIGN_PORT, timeout=8)
    trend_ready = check_port(TREND_PORT, timeout=8)

    return [
        service_port_status("Frontend", FRONTEND_PORT, frontend_ready),
        service_port_status("Design API", DESIGN_PORT, design_ready),
        service_port_status("Trend API", TREND_PORT, trend_ready),
        *build_preflight_status(),
    ]


def monitor_processes() -> None:
    while True:
        for proc in processes:
            rc = proc.poll()
            if rc is not None:
                name = " ".join(proc.args[:3]) if isinstance(proc.args, list) else str(proc.args)
                print(
                    f"\n[WARN] 子进程已退出（退出码 {rc}）: {name}",
                    flush=True,
                )
        time.sleep(2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start the local Fashion Design Platform.")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Print platform checks without starting services.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    if args.check_only:
        lines = [
            StatusLine("OK", f"Frontend port: {FRONTEND_PORT}"),
            StatusLine("OK", f"Design API port: {DESIGN_PORT}"),
            StatusLine("OK", f"Trend API port: {TREND_PORT}"),
            *build_preflight_status(),
        ]
        print_status(lines)
        return

    ensure_frontend_dependencies()
    start_platform()

    print()
    lines = wait_for_platform()
    print_status(lines)
    print("Press Ctrl+C to stop all services.")
    print()

    try:
        monitor_processes()
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
