BUSINESS CARDS - WINDOWS SETUP
==============================

INSTALL
1. Right-click the downloaded zip and choose "Extract All...". (Setup will not run from inside the zip.)
2. Open the extracted folder and double-click Install.cmd.
3. If Windows shows "Windows protected your PC", click "More info", then "Run anyway".
   This appears because the app is not code-signed. It is safe to continue.
Setup downloads the app runtime (about 110 MB, one time) from GitHub, checks it,
installs for your user account only (no admin rights needed), and adds Start menu
and desktop shortcuts. Business Cards opens when setup finishes.

If your network blocks the download, setup prints a link. Download that file in
your browser, rename it electron.zip, put it next to Install.cmd, and run Install.cmd again.

USING IT
- Add a photo or screenshot of a card: click "Add photo or screenshot", drag a
  photo onto the window, or copy a screenshot and click "Paste from clipboard".
- Paste card text: click "Paste card text" and paste what you copied from an email or signature.
- Check the yellow fields and the red notes, correct anything, then click Save card.
- Click a row to see its card. Double-click, or click the card image, to view it full size.
- Search any field, filter by category, tag, or favorites, and click a column to sort.
- Export to Excel (CSV) or Export contacts (vCard, for phones and Outlook).

YOUR DATA
Your cards are stored only on this computer, in:
  %APPDATA%\BusinessCards
Copy that folder to back up your cards or move them to another computer.
"Data folder" in the app opens it.

UNINSTALL
Settings > Apps > Installed apps > Business Cards > Uninstall.
You are asked whether to also delete your saved cards. Choosing No keeps them.
