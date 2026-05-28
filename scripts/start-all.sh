#!/bin/bash
# AI Fashion Design Platform — 与 README 一致，推荐从项目根执行：
#   python start.py
#
# 本脚本保留「多终端式」启动方式（调试用）。

set -euo pipefail

echo "======================================"
echo "  AI Fashion Design Platform"
echo "  推荐: cd 到项目根后执行  python start.py"
echo "======================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "[1/3] Design Studio (8001)..."
cd "$PROJECT_DIR/backend/services/design-studio"
python run.py &
DESIGN_PID=$!

echo ""
echo "[2/3] Trend Analysis (8002)..."
cd "$PROJECT_DIR/backend/services/trend-analysis"
python run.py &
TREND_PID=$!

sleep 2

echo ""
echo "[3/3] Frontend (端口见 vite.config.ts，默认 3100)..."
cd "$PROJECT_DIR/frontend"
npm run dev &
FRONT_PID=$!

echo ""
echo "======================================"
echo "  Design:  http://localhost:8001"
echo "  Trend:   http://localhost:8002"
echo "  Frontend: 默认 http://localhost:3100"
echo "  可在项目根 .env 设置 FASHION_FRONTEND_PORT"
echo "======================================"
echo "Ctrl+C 停止全部"

trap 'echo Stopping...; kill $DESIGN_PID $TREND_PID $FRONT_PID 2>/dev/null || true; exit 0' INT TERM

wait
