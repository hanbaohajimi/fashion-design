@echo off
cd /d "%~dp0"

echo ============================================
echo   AI Fashion Design Platform (isolated)
echo ============================================
echo.

REM Check if venv exists
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] .venv not found. Run: python -m venv .venv
    echo         Then: .venv\Scripts\pip install -r services/design/requirements.txt
    echo         Then: .venv\Scripts\pip install -r services/trend_requirements.txt
    echo         Then: .venv\Scripts\python -m playwright install chromium
    pause
    exit /b 1
)

echo [OK] Using isolated Python: .venv\Scripts\python.exe
echo.
echo Starting all services...
echo.

REM Force Python to output UTF-8 (CMD default GBK would garble Chinese logs)
set PYTHONIOENCODING=utf-8
.venv\Scripts\python.exe start.py

pause
