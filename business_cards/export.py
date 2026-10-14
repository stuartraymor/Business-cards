"""Export the card list to CSV (for Excel) or vCard (for phone and Outlook contacts)."""
from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable

CSV_COLUMNS = [
    ("Name", "name"), ("Title", "title"), ("Company", "company"), ("Category", "category"),
    ("Phone", "phone"), ("Mobile", "mobile"), ("Fax", "fax"), ("Email", "email"),
    ("Website", "website"), ("Address", "address"), ("Tags", "tags"), ("Notes", "notes"),
    ("Favorite", "favorite"), ("Created", "created_at"), ("Updated", "updated_at"),
]


def export_csv(cards: Iterable[dict], path: str | Path) -> int:
    count = 0
    # utf-8-sig so Excel opens accented characters correctly.
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow([header for header, _ in CSV_COLUMNS])
        for card in cards:
            row = []
            for _, key in CSV_COLUMNS:
                value = card.get(key, "")
                if key == "favorite":
                    value = "Yes" if value else ""
                row.append(value)
            writer.writerow(row)
            count += 1
    return count


def _vcard_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def card_to_vcard(card: dict) -> str:
    name = (card.get("name") or "").strip()
    parts = name.split()
    last = parts[-1] if len(parts) > 1 else ""
    first = " ".join(parts[:-1]) if len(parts) > 1 else name
    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"N:{_vcard_escape(last)};{_vcard_escape(first)};;;",
        f"FN:{_vcard_escape(name)}",
    ]
    if card.get("company"):
        lines.append(f"ORG:{_vcard_escape(card['company'])}")
    if card.get("title"):
        lines.append(f"TITLE:{_vcard_escape(card['title'])}")
    if card.get("phone"):
        lines.append(f"TEL;TYPE=WORK,VOICE:{_vcard_escape(card['phone'])}")
    if card.get("mobile"):
        lines.append(f"TEL;TYPE=CELL:{_vcard_escape(card['mobile'])}")
    if card.get("fax"):
        lines.append(f"TEL;TYPE=FAX:{_vcard_escape(card['fax'])}")
    if card.get("email"):
        lines.append(f"EMAIL;TYPE=WORK:{_vcard_escape(card['email'])}")
    if card.get("website"):
        lines.append(f"URL:{_vcard_escape(card['website'])}")
    if card.get("address"):
        lines.append(f"ADR;TYPE=WORK:;;{_vcard_escape(card['address'])};;;;")
    if card.get("notes"):
        lines.append(f"NOTE:{_vcard_escape(card['notes'])}")
    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"


def export_vcard(cards: Iterable[dict], path: str | Path) -> int:
    count = 0
    with open(path, "w", encoding="utf-8", newline="") as fh:
        for card in cards:
            fh.write(card_to_vcard(card))
            count += 1
    return count
