@echo off
title Business Cards Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not finish. See the message above.
  pause
  exit /b 1
)
timeout /t 3 >nul
