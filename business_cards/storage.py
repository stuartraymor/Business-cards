"""Local storage: one SQLite file plus a folder of cropped card images.

Everything lives under %APPDATA%\\BusinessCards on Windows, so backing up the app
means copying that folder.
"""
from __future__ import annotations

import os
import re
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .parser import CATEGORIES

SORTABLE = {
    "name": "name COLLATE NOCASE",
    "company": "company COLLATE NOCASE",
    "category": "category",
    "created": "created_at",
    "updated": "updated_at",
}

FIELDS = ("name", "title", "company", "category", "phone", "mobile", "fax",
          "email", "website", "address", "tags", "notes", "favorite")

SCHEMA = """
CREATE TABLE IF NOT EXISTS cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL DEFAULT '',
    company     TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'Business',
    phone       TEXT NOT NULL DEFAULT '',
    mobile      TEXT NOT NULL DEFAULT '',
    fax         TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    website     TEXT NOT NULL DEFAULT '',
    address     TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    favorite    INTEGER NOT NULL DEFAULT 0,
    image_path  TEXT NOT NULL DEFAULT '',
    raw_text    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_company ON cards(company);
CREATE INDEX IF NOT EXISTS idx_cards_email ON cards(email);
"""


def default_data_dir() -> Path:
    base = os.environ.get("APPDATA")
    root = Path(base) if base else Path.home() / ".local" / "share"
    return root / "BusinessCards"


class CardStore:
    def __init__(self, data_dir: Path | None = None):
        self.data_dir = Path(data_dir) if data_dir else default_data_dir()
        self.images_dir = self.data_dir / "images"
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.data_dir / "cards.db")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # ---- images -------------------------------------------------------
    def save_image(self, png_bytes: bytes) -> str:
        name = f"{uuid.uuid4().hex}.png"
        (self.images_dir / name).write_bytes(png_bytes)
        return name

    def image_path(self, name: str) -> Path | None:
        if not name:
            return None
        path = self.images_dir / name
        return path if path.exists() else None

    # ---- CRUD ---------------------------------------------------------
    def add_card(self, data: dict[str, Any], image_png: bytes | None = None, raw_text: str = "") -> int:
        now = datetime.now().isoformat(timespec="seconds")
        values = {f: data.get(f, "") for f in FIELDS}
        values["category"] = values["category"] if values["category"] in CATEGORIES else "Business"
        values["favorite"] = 1 if values["favorite"] else 0
        values["tags"] = normalize_tags(values["tags"])
        values["image_path"] = self.save_image(image_png) if image_png else ""
        values["raw_text"] = raw_text
        values["created_at"] = values["updated_at"] = now
        cols = ", ".join(values)
        marks = ", ".join("?" for _ in values)
        cur = self.conn.execute(f"INSERT INTO cards ({cols}) VALUES ({marks})", list(values.values()))
        self.conn.commit()
        return int(cur.lastrowid)

    def update_card(self, card_id: int, data: dict[str, Any]) -> None:
        values = {f: data[f] for f in FIELDS if f in data}
        if "category" in values and values["category"] not in CATEGORIES:
            values["category"] = "Business"
        if "tags" in values:
            values["tags"] = normalize_tags(values["tags"])
        if "favorite" in values:
            values["favorite"] = 1 if values["favorite"] else 0
        values["updated_at"] = datetime.now().isoformat(timespec="seconds")
        sets = ", ".join(f"{k} = ?" for k in values)
        self.conn.execute(f"UPDATE cards SET {sets} WHERE id = ?", [*values.values(), card_id])
        self.conn.commit()

    def get_card(self, card_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        return dict(row) if row else None

    def delete_card(self, card_id: int) -> None:
        row = self.conn.execute("SELECT image_path FROM cards WHERE id = ?", (card_id,)).fetchone()
        if row and row["image_path"]:
            path = self.images_dir / row["image_path"]
            if path.exists():
                path.unlink()
        self.conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        self.conn.commit()

    # ---- search, filter, sort -----------------------------------------
    def list_cards(self, search: str = "", category: str = "", tag: str = "",
                   favorites_only: bool = False, sort_by: str = "company",
                   ascending: bool = True) -> list[dict[str, Any]]:
        where, params = [], []
        if search.strip():
            # Every word must match somewhere, so "acme jane" finds Jane at Acme.
            for word in search.split():
                like = f"%{word}%"
                where.append("(name LIKE ? OR title LIKE ? OR company LIKE ? OR email LIKE ? "
                             "OR phone LIKE ? OR mobile LIKE ? OR address LIKE ? OR notes LIKE ? "
                             "OR tags LIKE ? OR raw_text LIKE ?)")
                params.extend([like] * 10)
        if category in CATEGORIES:
            where.append("category = ?")
            params.append(category)
        if tag:
            where.append("(',' || tags || ',') LIKE ?")
            params.append(f"%,{tag.lower()},%")
        if favorites_only:
            where.append("favorite = 1")
        sql = "SELECT * FROM cards"
        if where:
            sql += " WHERE " + " AND ".join(where)
        order = SORTABLE.get(sort_by, SORTABLE["company"])
        sql += f" ORDER BY {order} {'ASC' if ascending else 'DESC'}, id ASC"
        return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def all_tags(self) -> list[str]:
        tags: set[str] = set()
        for (value,) in self.conn.execute("SELECT tags FROM cards WHERE tags != ''"):
            tags.update(t for t in value.split(",") if t)
        return sorted(tags)

    # ---- duplicates ---------------------------------------------------
    def find_duplicates(self, data: dict[str, Any], exclude_id: int | None = None) -> list[dict[str, Any]]:
        """Cards that share an email, a phone number, or a very similar company and name."""
        matches: dict[int, dict[str, Any]] = {}
        email = (data.get("email") or "").strip().lower()
        if email:
            for row in self.conn.execute("SELECT * FROM cards WHERE lower(email) = ?", (email,)):
                matches[row["id"]] = dict(row)
        phone_digits = {digits(data.get(f, "")) for f in ("phone", "mobile")} - {""}
        if phone_digits:
            for row in self.conn.execute("SELECT * FROM cards"):
                row_digits = {digits(row["phone"]), digits(row["mobile"])} - {""}
                if row_digits & phone_digits:
                    matches[row["id"]] = dict(row)
        company = (data.get("company") or "").strip().lower()
        name = (data.get("name") or "").strip().lower()
        if company and name:
            for row in self.conn.execute("SELECT * FROM cards WHERE lower(name) = ?", (name,)):
                if company.split()[:1] == row["company"].lower().split()[:1]:
                    matches[row["id"]] = dict(row)
        if exclude_id is not None:
            matches.pop(exclude_id, None)
        return list(matches.values())


def digits(value: str) -> str:
    d = re.sub(r"\D", "", value or "")
    return d[1:] if len(d) == 11 and d.startswith("1") else d


def normalize_tags(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        parts = value
    else:
        parts = re.split(r"[,;]", str(value or ""))
    cleaned = []
    for part in parts:
        tag = part.strip().lower()
        if tag and tag not in cleaned:
            cleaned.append(tag)
    return ",".join(cleaned)
