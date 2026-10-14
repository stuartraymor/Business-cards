# Business Cards

A Windows app to capture business cards and keep your vendors, resellers, and contacts in one searchable list.

Take a photo or screenshot of a card (or paste text), and the app crops the card, reads the text, and fills in the fields. Check the yellow fields, save, and find the card later by name, company, phone, email, tag, or category.

**Everything stays on your computer.** No account, no cloud service. Your data is one database file plus a folder of card images.

## Features

- **Capture from anything:** photos (JPG, PNG, and more), screenshots from the clipboard, PDFs (first page), drag-and-drop, or pasted text
- **Automatic crop:** finds the card in a messy photo, straightens it, and removes the background
- **Auto-fill:** reads name, title, company, phone, mobile, fax, email, website, and address
- **Safeguards:** yellow highlights on uncertain fields, warnings for invalid or odd phone numbers and emails, personal-email warnings, and duplicate warnings before saving. Warnings never block you from saving
- **Dashboard:** search every field, filter by category, tag, or favorites, and sort by any column
- **View the card:** click a row to see its image; double-click to view it full size
- **Export:** CSV for Excel, or vCard for phone and Outlook contacts

## Install (Windows)

Build it yourself, with no GitHub account needed: see [BUILD.md](BUILD.md). It produces an `.exe` and an installer with a normal uninstaller.


1. Go to the [Releases](../../releases) page and download `BusinessCards.exe`.
2. Run it. Windows may show a SmartScreen warning because the app is not code-signed; choose **More info → Run anyway** if you trust the source.

Windows 10 or 11 is required for built-in text recognition. If the text recognizer is unavailable, you can install [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) as a fallback, or paste the card text instead.

## Where your data lives

| What | Where |
|---|---|
| Card database | `%APPDATA%\BusinessCards\cards.db` |
| Card images | `%APPDATA%\BusinessCards\images\` |
| Crash log | `%APPDATA%\BusinessCards\crash.log` |

To back up, copy the `BusinessCards` folder. To move to a new computer, copy it there.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+O | Add card from file |
| Ctrl+Shift+V | Paste screenshot or text from the clipboard |
| Ctrl+N | New card |
| Enter | Save (in the editor) |

## Run from source

Requires Python 3.12 on Windows.

```bash
pip install -r requirements.txt
python run.py
```

Run the tests:

```bash
python -m unittest discover -s tests -t .
```

Build the executable yourself:

```bash
pyinstaller --noconfirm --onefile --windowed --name BusinessCards --collect-submodules winrt run.py
```

The GitHub Actions workflow in `.github/workflows/build.yml` runs the tests and builds `BusinessCards.exe` on every push. When you publish a release, it attaches the `.exe` to that release.

## Project layout

```
business_cards/
  parser.py      Turns card text into fields and warnings (no GUI, fully tested)
  imaging.py     Finds and straightens the card in a photo
  ocr.py         Text recognition: Windows OCR, with Tesseract as fallback
  capture.py     Connects inputs (files, PDFs, clipboard, text) to the steps above
  storage.py     SQLite database, search, sorting, duplicate detection
  export.py      CSV and vCard export
  ui_editor.py   Card editor and image viewer
  ui_main.py     Main dashboard window
tests/           Unit tests for the logic layer
```

## Limitations

- Text recognition works best on sharp, evenly lit cards. Glare, shadows, and heavily stylized fonts reduce accuracy; the yellow highlights show where to check.
- Name and title detection is heuristic. Always check the yellow fields before saving.
- The app reads only the first page of a PDF.

## License

MIT. See [LICENSE](LICENSE).
