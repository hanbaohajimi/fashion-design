@echo off
chcp 65001 >nul
REM AI Fashion Design Platform — 一键启动（与 README / start.py 一致）
set "PROJECT_DIR=%~dp0.."
cd /d "%PROJECT_DIR%"

echo ======================================
echo   AI Fashion Design Platform
echo   正在启动（前端 + 设计 + 趋势）...
echo ======================================
echo.
echo 提示：端口见下方输出；前端默认与 vite.config 一致（多为 3100）。
echo 可在项目根复制 env.example 为 .env 后修改 FASHION_FRONTEND_PORT 等变量。
echo.

python start.py
if errorlevel 1 (
  echo.
  echo [错误] 未能启动。请确认已安装 Python，并在项目根执行过 scripts\install.bat
  pause
  exit /b 1
)

pause
