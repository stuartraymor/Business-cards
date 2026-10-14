@echo off
REM Double-click this file. It installs Python and Inno Setup if needed,
REM builds the app, and then starts the installer. Requires Windows 10 or 11.
setlocal
cd /d "%~dp0"
echo Business Cards - build and install
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo Python not found. Installing Python 3.12 with winget...
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements || goto :fail
  echo Python installed. Close this window and double-click this file again so Windows can find it.
  pause
  exit /b 0
)

if not exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
  echo Installing Inno Setup 6 with winget...
  winget install -e --id JRSoftware.InnoSetup --accept-package-agreements --accept-source-agreements || echo Could not install Inno Setup; the installer step will be skipped.
)

call build_windows.bat || goto :fail

if exist "installer\BusinessCardsSetup.exe" (
  echo Starting the installer...
  start "" "installer\BusinessCardsSetup.exe"
) else (
  echo The installer was not built. You can still run dist\BusinessCards.exe directly.
)
exit /b 0

:fail
echo.
echo Something went wrong. Copy the message above and send it to me.
pause
exit /b 1
