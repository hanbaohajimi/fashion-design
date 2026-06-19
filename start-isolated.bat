@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   AI Fashion Design Platform (隔离环境)
echo ============================================
echo.

REM 激活 Python 虚拟环境
echo [1/2] 激活 Python 虚拟环境...
call .venv\Scripts\activate.bat
echo       虚拟环境已激活: %VIRTUAL_ENV%

echo.
echo [2/2] 启动所有服务...
echo.
python start.py

pause
