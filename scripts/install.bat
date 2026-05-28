@echo off
chcp 65001 >nul
REM 安装本仓库依赖（与 README 一致，路径相对本脚本）

echo ======================================
echo   AI Fashion Design Platform — 安装依赖
echo ======================================

set "PROJECT_DIR=%~dp0.."

echo.
echo [1/4] Gateway（可选，端口 8000）...
cd /d "%PROJECT_DIR%\backend\gateway"
pip install -r requirements.txt
if errorlevel 1 goto :err

echo.
echo [2/5] 趋势服务基础依赖（FastAPI / uvicorn）...
cd /d "%PROJECT_DIR%\backend\services\trend-analysis"
if exist requirements.txt pip install -r requirements.txt

echo.
echo [3/5] ai_fashion 完整依赖（若存在项目根 ai_fashion\ai_fashion\pyproject.toml）...
if exist "%PROJECT_DIR%\ai_fashion\ai_fashion\pyproject.toml" (
  cd /d "%PROJECT_DIR%\ai_fashion\ai_fashion"
  pip install -e .
  if errorlevel 1 goto :err
) else (
  echo   未找到 ai_fashion\ai_fashion，已跳过。完整趋势中心需 clone 或拷贝后再执行本脚本。
)

echo.
echo [4/5] 前端（npm）...
cd /d "%PROJECT_DIR%\frontend"
call npm install
if errorlevel 1 goto :err

echo.
echo [5/5] 设计服务（时尚平台）...
echo   将 backend 放到 backend\vendor\design-backend\ 或设置 FASHION_DESIGN_BACKEND
echo   并在该 backend 目录按原项目安装 pip 依赖。
echo.
echo 建议：复制 env.example 为项目根目录 .env 并填写本机路径。
echo.
echo ======================================
echo   安装步骤完成。运行 scripts\start-all.bat 或 python start.py
echo ======================================
pause
exit /b 0

:err
echo.
echo [错误] 安装中断，请检查上方 pip/npm 输出。
pause
exit /b 1
