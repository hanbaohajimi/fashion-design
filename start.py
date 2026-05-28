"""
AI Fashion Design Platform — Single-command startup
Usage: python start.py
Starts Frontend (port 3100) + Design Studio (port 8001) + Trend Analysis (port 8002)
"""
import subprocess
import sys
import os
import signal
import time
import threading

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
DESIGN_DIR = os.path.join(PROJECT_DIR, "backend", "design-studio")
TREND_DIR = os.path.join(PROJECT_DIR, "backend", "trend-analysis")


def _load_dotenv() -> None:
    """加载项目根目录 .env（KEY=VALUE），不覆盖已存在的环境变量。"""
    path = os.path.join(PROJECT_DIR, ".env")
    if not os.path.isfile(path):
        return
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = val
    except OSError:
        pass


_load_dotenv()
FRONTEND_PORT = int(os.environ.get("FASHION_FRONTEND_PORT", "3100"))

processes = []


def stream_output(proc, prefix, color):
    """Stream subprocess output with a colored prefix."""
    colors = {"red": "\033[91m", "green": "\033[92m", "blue": "\033[94m", "reset": "\033[0m"}
    c = colors.get(color, "")
    r = colors["reset"]
    try:
        for line in iter(proc.stdout.readline, b""):
            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                print(f"{c}[{prefix}]{r} {text}")
    except Exception:
        pass


def start_service(name, cmd, cwd, color):
    """Start a subprocess and stream its output."""
    env = os.environ.copy()
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            shell=True,
        )
        processes.append(proc)
        thread = threading.Thread(target=stream_output, args=(proc, name, color), daemon=True)
        thread.start()
        return proc
    except Exception as e:
        print(f"\033[91m[ERROR]\033[0m Failed to start {name}: {e}")
        return None


def check_port(port, timeout=8):
    """Wait for a port to become available."""
    import socket
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.5)
    return False


def cleanup(*args):
    print("\n\033[93m[PLATFORM]\033[0m Shutting down all services...")
    for p in processes:
        try:
            p.terminate()
        except Exception:
            pass
    time.sleep(1)
    for p in processes:
        try:
            p.kill()
        except Exception:
            pass
    print("\033[93m[PLATFORM]\033[0m All services stopped.")
    sys.exit(0)


def main():
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    print()
    print("\033[1m╔══════════════════════════════════════════════════╗\033[0m")
    print("\033[1m║       AI Fashion Design Platform  v1.0           ║\033[0m")
    print("\033[1m╚══════════════════════════════════════════════════╝\033[0m")
    print()

    # Check node_modules
    if not os.path.isdir(os.path.join(FRONTEND_DIR, "node_modules")):
        print("\033[93m[PLATFORM]\033[0m Installing frontend dependencies...")
        subprocess.run("npm install", cwd=FRONTEND_DIR, shell=True, check=True)
        print()

    # Start services
    python_cmd = sys.executable

    print("\033[92m[1/3]\033[0m Starting Design Studio (port 8001)...")
    start_service("Design", f'"{python_cmd}" run.py', DESIGN_DIR, "green")

    print("\033[94m[2/3]\033[0m Starting Trend Analysis (port 8002)...")
    start_service("Trend", f'"{python_cmd}" run.py', TREND_DIR, "blue")

    time.sleep(2)

    print(f"\033[91m[3/3]\033[0m Starting Frontend (port {FRONTEND_PORT})...")
    start_service("Front", f"npx vite --port {FRONTEND_PORT} --host", FRONTEND_DIR, "red")

    # Wait for services
    time.sleep(3)
    print()
    print("\033[1m┌──────────────────────────────────────────────────┐\033[0m")

    if check_port(8001, 5):
        print("\033[1m│  \033[92m●\033[0m\033[1m Design Studio   http://localhost:8001       │\033[0m")
    else:
        print("\033[1m│  \033[91m○\033[0m\033[1m Design Studio   启动中...                   │\033[0m")

    if check_port(8002, 3):
        print("\033[1m│  \033[92m●\033[0m\033[1m Trend Analysis  http://localhost:8002       │\033[0m")
    else:
        print("\033[1m│  \033[93m○\033[0m\033[1m Trend Analysis  需要 ai_fashion 依赖        │\033[0m")

    if check_port(FRONTEND_PORT, 5):
        print(f"\033[1m│  \033[92m●\033[0m\033[1m Frontend        http://localhost:{FRONTEND_PORT}       │\033[0m")
    else:
        print("\033[1m│  \033[91m○\033[0m\033[1m Frontend        启动中...                   │\033[0m")

    print("\033[1m├──────────────────────────────────────────────────┤\033[0m")
    print(f"\033[1m│  \033[96m→ 打开浏览器访问 http://localhost:{FRONTEND_PORT}\033[0m\033[1m        │\033[0m")
    print("\033[1m│  \033[90mCtrl+C 停止所有服务\033[0m\033[1m                         │\033[0m")
    print("\033[1m└──────────────────────────────────────────────────┘\033[0m")
    print()

    # Keep running
    try:
        while True:
            # Check if any process died
            for p in processes:
                if p.poll() is not None:
                    pass  # Don't crash if one service exits
            time.sleep(2)
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
