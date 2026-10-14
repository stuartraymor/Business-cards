@echo off
REM Builds BusinessCards.exe and, if Inno Setup 6 is installed, the installer.
REM Run this from the business-cards folder on your Windows PC.
setlocal
cd /d "%~dp0"

echo [1/4] Creating virtual environment...
python -m venv .venv || goto :fail
call .venv\Scripts\activate.bat || goto :fail

echo [2/4] Installing requirements...
python -m pip install --upgrade pip || goto :fail
python -m pip install -r requirements.txt || goto :fail

echo [3/4] Running tests...
python -m unittest discover -s tests -t . || goto :fail

echo [4/4] Building BusinessCards.exe...
pyinstaller --noconfirm --onefile --windowed --name BusinessCards --collect-submodules winrt run.py || goto :fail
echo.
echo Built: dist\BusinessCards.exe  (this file runs on its own)

set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if exist "%ISCC%" (
  "%ISCC%" installer.iss || goto :fail
  echo Built: installer\BusinessCardsSetup.exe  (installs, adds Start menu entry, and uninstalls cleanly)
) else (
  echo Inno Setup 6 is not installed, so the installer was skipped.
  echo Install it free from https://jrsoftware.org/isinfo.php and run this script again.
)
echo.
echo Done.
exit /b 0

:fail
echo.
echo Build failed. Scroll up to see the first error.
exit /b 1
