# Build Business Cards on your Windows PC

Everything runs locally. No GitHub or cloud services are needed.

## What you need (one time)

1. **Python 3.12** from https://www.python.org/downloads/windows/
   During install, tick **"Add python.exe to PATH"**.
2. **Inno Setup 6** (optional, for the installer) from https://jrsoftware.org/isinfo.php

## Build

1. Unzip the folder anywhere, for example `Documents\business-cards`.
2. Double-click **build_windows.bat**, or run it from a Command Prompt in that folder.
3. It takes a few minutes the first time because it downloads the packages.

Results:

| File | What it is |
|---|---|
| `dist\BusinessCards.exe` | The app as one file. Double-click to run. |
| `installer\BusinessCardsSetup.exe` | Installs the app, adds Start menu and desktop shortcuts, and appears in Windows Settings > Apps so you can uninstall it. Built only if Inno Setup is installed. |

## Uninstall

- **If you used the installer:** Settings > Apps > Business Cards > Uninstall. You are asked whether to delete your saved cards too.
- **If you only used the .exe:** delete `BusinessCards.exe`. Your cards stay in `%APPDATA%\BusinessCards` unless you delete that folder too.

## If the build fails

The script stops at the first error and prints it. Copy that error message and send it to me.
