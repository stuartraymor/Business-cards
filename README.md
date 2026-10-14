# Business Cards

A Windows app for capturing and organizing business cards. Add a photo, screenshot, or pasted text, and it crops the card, reads the text, and fills the fields. It searches, filters, sorts, and exports to CSV and vCard.

Everything stays on your computer. There is no cloud service and no account.

## Status

Version 1.0.0, in testing. Verified so far:
- Card cropping and text parsing on 12 synthetic test cards (name, title, email, phone, website: 12/12; company: 8/12).
- Save, search, filter, sort, and export flows in an automated browser test.

Not yet verified:
- Installer and app on a clean Windows machine.
- Windows OCR results on real card photos (the test used Tesseract as a stand-in).

See the open issues for known problems and planned work.

## Install (Windows)

1. Download the source as a zip, or clone this repo, and extract it.
2. Double-click `Install.cmd`.
3. If Windows shows "Windows protected your PC", click "More info" then "Run anyway". The app is not code-signed.

The installer downloads the Electron runtime from GitHub (about 110 MB, one time), verifies its SHA-256 hash, and installs for the current user only. It creates Start menu and desktop shortcuts.

## Layout

- `app/` - the Electron app (main process, renderer, parser, imaging, storage, exporter, PowerShell OCR).
- `install.ps1`, `uninstall.ps1`, `Install.cmd` - Windows installer and uninstaller.
- `dev/` - automated tests and the browser flow test. Not packaged for end users.

## Running the tests

Requires Node.js.

```
node --test dev/test-parser.js dev/test-imaging.js dev/test-store.js dev/test-exporter.js dev/test-app-files.js
```

The browser flow test needs Playwright and Chromium.

## Data

Cards are stored in `%APPDATA%\BusinessCards`. Uninstalling asks whether to delete them.
