"""Turn any supported input into a card draft: image crop, OCR text, parsed fields.

Supported inputs: JPG, PNG, BMP, TIF, WEBP, PDF (first page), clipboard images, and pasted text.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .imaging import crop_card, decode_image_bytes, encode_png, read_image
from .ocr import read_card_text
from .parser import ParsedCard, parse_card_text

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
PDF_EXTS = {".pdf"}
SUPPORTED_EXTS = IMAGE_EXTS | PDF_EXTS


@dataclass
class Capture:
    parsed: ParsedCard
    raw_text: str = ""
    image_png: bytes | None = None  # cropped card, None for text-only input
    ocr_engine: str = ""
    messages: list[str] = field(default_factory=list)


def _pdf_first_page(path: Path) -> np.ndarray:
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:
        raise RuntimeError("PDF support needs the PyMuPDF package.") from exc
    doc = fitz.open(str(path))
    try:
        if doc.page_count == 0:
            raise ValueError("The PDF has no pages.")
        pix = doc[0].get_pixmap(dpi=200)
        data = pix.tobytes("png")
    finally:
        doc.close()
    return decode_image_bytes(data)


def process_image(img: np.ndarray) -> Capture:
    crop = crop_card(img)
    messages = [crop.message]
    ocr = read_card_text(crop.image)
    if ocr.error:
        messages.append(ocr.error)
    parsed = parse_card_text(ocr.text)
    if not crop.detected:
        parsed.warnings["image"] = "Card outline not found; the crop may include background."
    return Capture(
        parsed=parsed,
        raw_text=ocr.text,
        image_png=encode_png(crop.image),
        ocr_engine=ocr.engine,
        messages=messages,
    )


def process_file(path: str | Path) -> Capture:
    path = Path(path)
    ext = path.suffix.lower()
    if ext in PDF_EXTS:
        img = _pdf_first_page(path)
    elif ext in IMAGE_EXTS:
        img = read_image(str(path))
    else:
        raise ValueError(f"Unsupported file type: {ext or 'no extension'}")
    return process_image(img)


def process_png_bytes(data: bytes) -> Capture:
    return process_image(decode_image_bytes(data))


def process_text(text: str) -> Capture:
    parsed = parse_card_text(text)
    return Capture(parsed=parsed, raw_text=text, ocr_engine="pasted text",
                   messages=["Fields read from pasted text."])
