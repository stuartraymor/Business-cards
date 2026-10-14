"""The card editor: one form used both to review a new capture and to edit a saved card.

Warnings never block saving. Fields the parser is unsure about are shaded yellow,
and phone or email problems show a red note under the field.
"""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QFormLayout, QFrame, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QScrollArea, QTextEdit, QVBoxLayout, QWidget,
)

from .parser import CATEGORIES, check_email, check_phone, format_phone

LOW_CONFIDENCE_STYLE = "background-color: #fff3b0;"
PHONE_FIELDS = ("phone", "mobile", "fax")


def pixmap_from_png(data: bytes | None) -> QPixmap:
    pix = QPixmap()
    if data:
        pix.loadFromData(data, "PNG")
    return pix


class ClickableLabel(QLabel):
    double_clicked = Signal()

    def mouseDoubleClickEvent(self, event):  # noqa: N802 (Qt naming)
        self.double_clicked.emit()
        super().mouseDoubleClickEvent(event)


class ImageViewer(QDialog):
    """Shows the cropped card at a size that fits the window. Opened from the table."""

    def __init__(self, png: bytes, title: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(900, 600)
        self._pixmap = pixmap_from_png(png)
        self._label = QLabel(alignment=Qt.AlignmentFlag.AlignCenter)
        self._label.setMinimumSize(100, 100)
        scroll = QScrollArea()
        scroll.setWidget(self._label)
        scroll.setWidgetResizable(True)
        layout = QVBoxLayout(self)
        layout.addWidget(scroll)
        self._rescale()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._rescale()

    def _rescale(self):
        if self._pixmap.isNull():
            self._label.setText("No image saved for this card.")
            return
        target = self.size()
        self._label.setPixmap(self._pixmap.scaled(
            max(100, target.width() - 40), max(100, target.height() - 40),
            Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))


class CardEditor(QWidget):
    save_requested = Signal(dict)     # emits the field values
    delete_requested = Signal()
    discard_requested = Signal()

    TEXT_FIELDS = ("name", "title", "company", "phone", "mobile", "fax", "email",
                   "website", "address", "tags")

    def __init__(self, parent=None):
        super().__init__(parent)
        self._card_id: int | None = None
        self._image_png: bytes | None = None
        self._fields: dict[str, QLineEdit] = {}
        self._field_notes: dict[str, QLabel] = {}
        self._banner = QLabel(wordWrap=True)
        self._banner.setFrameShape(QFrame.Shape.StyledPanel)
        self._banner.hide()

        self._thumb = ClickableLabel(alignment=Qt.AlignmentFlag.AlignCenter)
        self._thumb.setMinimumHeight(160)
        self._thumb.setCursor(Qt.CursorShape.PointingHandCursor)
        self._thumb.setToolTip("Double-click to view the full card")
        self._thumb.double_clicked.connect(self.view_image)
        self._thumb.setStyleSheet("border: 1px solid #bbb; background: #fafafa;")

        form = QFormLayout()
        labels = {"name": "Name", "title": "Title", "company": "Company", "phone": "Phone",
                  "mobile": "Mobile", "fax": "Fax", "email": "Email", "website": "Website",
                  "address": "Address", "tags": "Tags (comma separated)"}
        for key in self.TEXT_FIELDS:
            edit = QLineEdit()
            self._fields[key] = edit
            note = QLabel()
            note.setStyleSheet("color: #b00020; font-size: 11px;")
            note.hide()
            self._field_notes[key] = note
            box = QVBoxLayout()
            box.setContentsMargins(0, 0, 0, 0)
            box.addWidget(edit)
            box.addWidget(note)
            wrapper = QWidget()
            wrapper.setLayout(box)
            form.addRow(labels[key] + ":", wrapper)
            if key in PHONE_FIELDS or key == "email":
                edit.editingFinished.connect(lambda k=key: self._validate(k))

        self._category = QComboBox()
        self._category.addItems(CATEGORIES)
        form.addRow("Category:", self._category)

        self._notes = QTextEdit()
        self._notes.setFixedHeight(70)
        form.addRow("Notes:", self._notes)

        self._favorite = QCheckBox("Favorite")
        form.addRow("", self._favorite)

        self._save_btn = QPushButton("Save card")
        self._save_btn.setDefault(True)
        self._save_btn.clicked.connect(self._on_save)
        self._discard_btn = QPushButton("Discard")
        self._discard_btn.clicked.connect(self.discard_requested.emit)
        self._delete_btn = QPushButton("Delete card")
        self._delete_btn.clicked.connect(self.delete_requested.emit)
        self._view_btn = QPushButton("View full card")
        self._view_btn.clicked.connect(self.view_image)

        buttons = QHBoxLayout()
        buttons.addWidget(self._save_btn)
        buttons.addWidget(self._discard_btn)
        buttons.addStretch(1)
        buttons.addWidget(self._view_btn)
        buttons.addWidget(self._delete_btn)

        layout = QVBoxLayout(self)
        layout.addWidget(self._banner)
        layout.addWidget(self._thumb)
        layout.addLayout(form)
        layout.addLayout(buttons)
        layout.addStretch(1)
        self.clear()

    # ---- loading ------------------------------------------------------
    def clear(self):
        self.load({}, None, None, set(), card_id=None, banner="Select a card, or add a new one.")
        self._set_enabled(False)

    def load(self, data: dict, image_png: bytes | None, warnings: dict | None,
             low_confidence: set, card_id: int | None = None, banner: str = "",
             is_new: bool = False):
        self._card_id = card_id
        self._image_png = image_png
        self._set_enabled(True)
        for key, edit in self._fields.items():
            edit.setText(str(data.get(key, "") or ""))
            edit.setStyleSheet(LOW_CONFIDENCE_STYLE if key in low_confidence else "")
            self._field_notes[key].hide()
        self._category.setCurrentText(data.get("category") or "Business")
        self._notes.setPlainText(data.get("notes", "") or "")
        self._favorite.setChecked(bool(data.get("favorite")))
        self._delete_btn.setVisible(card_id is not None)
        self._discard_btn.setVisible(is_new)
        self._view_btn.setEnabled(bool(image_png))
        self._thumb.setPixmap(pixmap_from_png(image_png).scaledToHeight(
            160, Qt.TransformationMode.SmoothTransformation) if image_png else QPixmap())
        if not image_png:
            self._thumb.setText("No image for this card")
        # Re-run the checks so warnings from the parser and from validation agree.
        for key, text in (warnings or {}).items():
            if key in self._field_notes:
                self._show_note(key, text)
        for key in ("phone", "mobile", "fax", "email"):
            self._validate(key, show_ok=False)
        self._set_banner(banner, warnings or {})

    def _set_enabled(self, enabled: bool):
        for w in (*self._fields.values(), self._category, self._notes, self._favorite, self._save_btn):
            w.setEnabled(enabled)

    def _set_banner(self, text: str, warnings: dict):
        extra = [msg for key, msg in warnings.items() if key not in self._field_notes]
        lines = [text] if text else []
        lines += [m for m in extra]
        if lines:
            self._banner.setText("\n".join(lines))
            self._banner.setStyleSheet("background: #fff8e1; padding: 6px; border: 1px solid #f0c040;")
            self._banner.show()
        else:
            self._banner.hide()

    # ---- validation ---------------------------------------------------
    def _show_note(self, key: str, text: str):
        note = self._field_notes[key]
        note.setText(text)
        note.show()
        self._fields[key].setStyleSheet(LOW_CONFIDENCE_STYLE)

    def _validate(self, key: str, show_ok: bool = True):
        if not self.isEnabled():
            return
        edit = self._fields[key]
        value = edit.text().strip()
        self._field_notes[key].hide()
        if key in PHONE_FIELDS and value:
            formatted = format_phone(value)
            edit.setText(formatted)
            issue = check_phone(formatted)
        elif key == "email" and value:
            issue = check_email(value, self._fields["company"].text().strip())
        else:
            issue = None
        if issue:
            self._show_note(key, issue)
        else:
            edit.setStyleSheet("")

    def view_image(self):
        if self._image_png:
            title = self._fields["name"].text() or "Business card"
            ImageViewer(self._image_png, title, self).exec()

    # ---- saving -------------------------------------------------------
    def values(self) -> dict:
        data = {key: edit.text().strip() for key, edit in self._fields.items()}
        data["category"] = self._category.currentText()
        data["notes"] = self._notes.toPlainText().strip()
        data["favorite"] = 1 if self._favorite.isChecked() else 0
        return data

    def _on_save(self):
        for key in PHONE_FIELDS + ("email",):
            self._validate(key, show_ok=False)
        self.save_requested.emit(self.values())

    @property
    def card_id(self) -> int | None:
        return self._card_id

    @property
    def image_png(self) -> bytes | None:
        return self._image_png
