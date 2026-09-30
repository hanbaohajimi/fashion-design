@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title AI Fashion Design Platform

where pwsh.exe >nul 2>nul
if "%ERRORLEVEL%"=="0" (
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-platform.ps1" %*
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-platform.ps1" %*
)
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Startup did not complete. Review the message above and try again.
  pause
)

exit /b %EXIT_CODE%
