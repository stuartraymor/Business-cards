"""Main window: the card dashboard with search, filters, sorting, and capture."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QBuffer, QIODevice, Qt, QThread, Signal
from PySide6.QtGui import QAction, QGuiApplication, QKeySequence
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QComboBox, QFileDialog, QHBoxLayout, QHeaderView,
    QLabel, QLineEdit, QMainWindow, QMessageBox, QPushButton, QSplitter, QStatusBar,
    QTableWidget, QTableWidgetItem, QToolBar, QVBoxLayout, QWidget,
)

from . import __version__
from .capture import SUPPORTED_EXTS, Capture, process_file, process_png_bytes, process_text
from .export import export_csv, export_vcard
from .parser import CATEGORIES
from .storage import CardStore
from .ui_editor import CardEditor

COLUMNS = [
    ("Name", "name", "name"),
    ("Title", "title", None),
    ("Company", "company", "company"),
    ("Category", "category", "category"),
    ("Phone", "phone", None),
    ("Email", "email", None),
    ("Updated", "updated_at", "updated"),
]

SORT_OPTIONS = [("Company", "company"), ("Name", "name"), ("Category", "category"),
                ("Newest added", "created"), ("Recently updated", "updated")]


class CaptureWorker(QThread):
    """Runs OCR and cropping off the UI thread so the window never freezes."""
    done_ok = Signal(object)
    failed = Signal(str)

    def __init__(self, job, parent=None):
        super().__init__(parent)
        self._job = job

    def run(self):
        try:
            self.done_ok.emit(self._job())
        except Exception as exc:  # shown to the user, never crashes the app
            self.failed.emit(str(exc))


def qimage_to_png(image) -> bytes:
    buf = QBuffer()
    buf.open(QIODevice.OpenModeFlag.WriteOnly)
    image.save(buf, "PNG")
    return bytes(buf.data())


class MainWindow(QMainWindow):
    def __init__(self, store: CardStore):
        super().__init__()
        self.store = store
        self._workers: list[CaptureWorker] = []
        self._rows: list[dict] = []
        self._current_id: int | None = None
        self._pending_raw_text = ""
        self._sort_key = "company"
        self._ascending = True

        self.setWindowTitle(f"Business Cards {__version__}")
        self.resize(1280, 780)
        self.setAcceptDrops(True)

        self._build_toolbar()
        self._build_body()
        self.setStatusBar(QStatusBar())
        self.refresh()
        self.editor.clear()

    # ---- layout -------------------------------------------------------
    def _build_toolbar(self):
        bar = QToolBar("Main")
        bar.setMovable(False)
        self.addToolBar(bar)

        def action(text, slot, shortcut=None):
            act = QAction(text, self)
            if shortcut:
                act.setShortcut(QKeySequence(shortcut))
            act.triggered.connect(slot)
            bar.addAction(act)
            self.addAction(act)
            return act

        action("Add from file...", self.capture_files, "Ctrl+O")
        action("Paste screenshot or text", self.capture_clipboard, "Ctrl+Shift+V")
        action("New card", self.new_card, "Ctrl+N")
        bar.addSeparator()
        action("Export CSV...", lambda: self.export("csv"))
        action("Export contacts (vCard)...", lambda: self.export("vcf"))

    def _build_body(self):
        filters = QHBoxLayout()
        self.search = QLineEdit(placeholderText="Search name, company, phone, email, tags, notes...")
        self.search.setClearButtonEnabled(True)
        self.search.textChanged.connect(self.refresh)
        filters.addWidget(self.search, 3)

        self.category_box = QComboBox()
        self.category_box.addItem("All categories", "")
        for cat in CATEGORIES:
            self.category_box.addItem(cat, cat)
        self.category_box.currentIndexChanged.connect(self.refresh)
        filters.addWidget(self.category_box)

        self.tag_box = QComboBox()
        self.tag_box.currentIndexChanged.connect(self.refresh)
        filters.addWidget(self.tag_box)

        self.fav_box = QCheckBox("Favorites only")
        self.fav_box.toggled.connect(self.refresh)
        filters.addWidget(self.fav_box)

        self.sort_box = QComboBox()
        for label, key in SORT_OPTIONS:
            self.sort_box.addItem(label, key)
        self.sort_box.currentIndexChanged.connect(self._on_sort_box)
        filters.addWidget(self.sort_box)

        self.direction_btn = QPushButton("A to Z")
        self.direction_btn.clicked.connect(self._toggle_direction)
        filters.addWidget(self.direction_btn)

        self.table = QTableWidget(0, len(COLUMNS))
        self.table.setHorizontalHeaderLabels([c[0] for c in COLUMNS])
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.horizontalHeader().sectionClicked.connect(self._on_header)
        self.table.itemSelectionChanged.connect(self._on_selection)
        self.table.itemDoubleClicked.connect(lambda _: self.editor.view_image())

        self.editor = CardEditor()
        self.editor.save_requested.connect(self.save_card)
        self.editor.delete_requested.connect(self.delete_card)
        self.editor.discard_requested.connect(self.discard_new)

        left = QWidget()
        left_layout = QVBoxLayout(left)
        left_layout.addLayout(filters)
        left_layout.addWidget(self.table)
        self.count_label = QLabel()
        left_layout.addWidget(self.count_label)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.addWidget(left)
        splitter.addWidget(self.editor)
        splitter.setSizes([820, 420])
        self.setCentralWidget(splitter)

    # ---- data and filtering ------------------------------------------
    def refresh(self, *_):
        self._refresh_tags()
        tag = self.tag_box.currentData() or ""
        category = self.category_box.currentData() or ""
        self._rows = self.store.list_cards(
            search=self.search.text(), category=category, tag=tag,
            favorites_only=self.fav_box.isChecked(), sort_by=self._sort_key,
            ascending=self._ascending)
        self.table.setRowCount(len(self._rows))
        selected_row = -1
        for r, card in enumerate(self._rows):
            values = [card["name"], card["title"], card["company"], card["category"],
                      card["phone"] or card["mobile"], card["email"], card["updated_at"]]
            for c, value in enumerate(values):
                item = QTableWidgetItem(str(value))
                if c == 0:
                    item.setData(Qt.ItemDataRole.UserRole, card["id"])
                    if card["favorite"]:
                        item.setText("★ " + str(value))
                self.table.setItem(r, c, item)
            if card["id"] == self._current_id:
                selected_row = r
        self.table.resizeColumnsToContents()
        if selected_row >= 0:
            self.table.blockSignals(True)
            self.table.selectRow(selected_row)
            self.table.blockSignals(False)
        total = self.store.conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
        self.count_label.setText(f"Showing {len(self._rows)} of {total} cards")

    def _refresh_tags(self):
        current = self.tag_box.currentData()
        tags = self.store.all_tags()
        self.tag_box.blockSignals(True)
        self.tag_box.clear()
        self.tag_box.addItem("All tags", "")
        for tag in tags:
            self.tag_box.addItem(tag, tag)
        index = self.tag_box.findData(current) if current else 0
        self.tag_box.setCurrentIndex(max(index, 0))
        self.tag_box.blockSignals(False)

    def _on_sort_box(self, _index):
        self._sort_key = self.sort_box.currentData()
        self.refresh()

    def _toggle_direction(self):
        self._ascending = not self._ascending
        self.direction_btn.setText("A to Z" if self._ascending else "Z to A")
        self.refresh()

    def _on_header(self, section: int):
        _, _, key = COLUMNS[section]
        if not key:
            self.status(f"{COLUMNS[section][0]} can't be sorted; use the search box.")
            return
        if self._sort_key == key:
            self._toggle_direction()
        else:
            self._sort_key = key
            index = self.sort_box.findData(key)
            if index >= 0:
                self.sort_box.blockSignals(True)
                self.sort_box.setCurrentIndex(index)
                self.sort_box.blockSignals(False)
            self.refresh()

    def _on_selection(self):
        rows = self.table.selectionModel().selectedRows()
        if not rows:
            return
        card_id = self.table.item(rows[0].row(), 0).data(Qt.ItemDataRole.UserRole)
        self.show_card(card_id)

    def show_card(self, card_id: int):
        card = self.store.get_card(card_id)
        if not card:
            return
        self._current_id = card_id
        image = self.store.image_path(card["image_path"])
        png = image.read_bytes() if image else None
        self.editor.load(card, png, None, set(), card_id=card_id,
                         banner="" if png else "This card has no saved image.")

    # ---- capture ------------------------------------------------------
    def capture_files(self):
        patterns = " ".join(f"*{ext}" for ext in sorted(SUPPORTED_EXTS))
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Choose business card photos, screenshots, or PDFs", "",
            f"Business cards ({patterns});;All files (*)")
        for path in paths:
            self._start_capture(lambda p=path: process_file(p), Path(path).name)

    def capture_clipboard(self):
        clipboard = QGuiApplication.clipboard()
        image = clipboard.image()
        if not image.isNull():
            png = qimage_to_png(image)
            self._start_capture(lambda: process_png_bytes(png), "clipboard image")
            return
        text = clipboard.text().strip()
        if text:
            self._start_capture(lambda: process_text(text), "pasted text")
            return
        self.status("Nothing to paste. Copy a screenshot or some card text first.")

    def new_card(self):
        self._current_id = None
        self.table.clearSelection()
        self.editor.load({"category": "Business"}, None, None, set(), card_id=None,
                         banner="New card: type the details, or add a photo, screenshot, or PDF.",
                         is_new=True)

    def dragEnterEvent(self, event):  # noqa: N802
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event):  # noqa: N802
        for url in event.mimeData().urls():
            path = url.toLocalFile()
            if path:
                self._start_capture(lambda p=path: process_file(p), Path(path).name)

    def _start_capture(self, job, label: str):
        self.status(f"Reading {label}...")
        worker = CaptureWorker(job, self)
        worker.done_ok.connect(lambda cap, lbl=label: self._capture_ready(cap, lbl))
        worker.failed.connect(lambda msg, lbl=label: self._capture_failed(msg, lbl))
        worker.finished.connect(lambda w=worker: self._workers.remove(w) if w in self._workers else None)
        self._workers.append(worker)
        worker.start()

    def _capture_ready(self, cap: Capture, label: str):
        self._current_id = None
        self.table.clearSelection()
        notes = list(cap.messages)
        banner = f"Review the details from {label}. Yellow fields need a check."
        self.editor.load(
            {**cap.parsed.__dict__, "category": cap.parsed.category},
            cap.image_png, cap.parsed.warnings, cap.parsed.low_confidence,
            card_id=None, banner=banner + ("\n" + "\n".join(notes) if notes else ""),
            is_new=True)
        self._pending_raw_text = cap.raw_text
        self.status("Review the card, then click Save card.")

    def _capture_failed(self, message: str, label: str):
        QMessageBox.warning(self, "Could not read card",
                            f"{label}: {message}\n\nYou can still type the details in by hand.")
        self.new_card()
        self.status("Could not read that card.")

    # ---- saving and deleting ------------------------------------------
    def save_card(self, data: dict):
        if not data.get("name") and not data.get("company"):
            QMessageBox.information(self, "Nothing to save",
                                    "Please enter at least a name or a company.")
            return
        duplicates = self.store.find_duplicates(data, exclude_id=self.editor.card_id)
        if duplicates:
            names = "\n".join(f"- {d['name'] or '(no name)'} at {d['company'] or '(no company)'}"
                              for d in duplicates[:5])
            answer = QMessageBox.question(
                self, "Possible duplicate",
                f"This looks like a card already saved:\n{names}\n\nSave it anyway?")
            if answer != QMessageBox.StandardButton.Yes:
                return
        if self.editor.card_id is None:
            png = self.editor.image_png
            raw = getattr(self, "_pending_raw_text", "") if png else ""
            card_id = self.store.add_card(data, png, raw)
            self._pending_raw_text = ""
            self.status("Card saved.")
        else:
            self.store.update_card(self.editor.card_id, data)
            card_id = self.editor.card_id
            self.status("Changes saved.")
        self._current_id = card_id
        self.refresh()
        self.show_card(card_id)

    def delete_card(self):
        card_id = self.editor.card_id
        if card_id is None:
            return
        card = self.store.get_card(card_id) or {}
        answer = QMessageBox.question(
            self, "Delete card",
            f"Delete {card.get('name') or 'this card'} from {card.get('company') or 'the list'}?\n"
            "The saved image will be deleted too. This can't be undone.")
        if answer != QMessageBox.StandardButton.Yes:
            return
        self.store.delete_card(card_id)
        self._current_id = None
        self.refresh()
        self.new_card()
        self.status("Card deleted.")

    def discard_new(self):
        self._pending_raw_text = ""
        self.editor.clear()
        self.status("Discarded.")

    # ---- export -------------------------------------------------------
    def export(self, kind: str):
        cards = self._rows
        if not cards:
            QMessageBox.information(self, "Nothing to export", "No cards match the current filters.")
            return
        if kind == "csv":
            path, _ = QFileDialog.getSaveFileName(self, "Export CSV", "business_cards.csv", "CSV (*.csv)")
            if path:
                count = export_csv(cards, path)
                self.status(f"Exported {count} cards to CSV.")
        else:
            path, _ = QFileDialog.getSaveFileName(self, "Export contacts", "business_cards.vcf", "vCard (*.vcf)")
            if path:
                count = export_vcard(cards, path)
                self.status(f"Exported {count} contacts.")

    def status(self, text: str):
        self.statusBar().showMessage(text, 8000)

    def closeEvent(self, event):  # noqa: N802
        for worker in self._workers:
            worker.wait(2000)
        self.store.close()
        super().closeEvent(event)
