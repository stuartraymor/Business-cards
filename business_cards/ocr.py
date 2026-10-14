"""Read text from a card image.

Engines are tried in order:
1. Windows built-in OCR (Windows.Media.Ocr via the winrt packages). Free, offline,
   and ships with Windows 10 and 11.
2. Tesseract via pytesseract, if the user has installed it.

If neither works, the app still runs and the user can paste text instead.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import numpy as np

from .imaging import encode_png

log = logging.getLogger(__name__)


@dataclass
class OcrResult:
    text: str
    engine: str  # "windows", "tesseract", or "" when no engine ran
    error: str = ""


async def _windows_ocr_async(png: bytes) -> str:
    # Imported here so the app still starts on machines without winrt.
    from winrt.windows.graphics.imaging import BitmapDecoder
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.storage.streams import DataWriter, InMemoryRandomAccessStream

    stream = InMemoryRandomAccessStream()
    writer = DataWriter(stream)
    writer.write_bytes(png)
    await writer.store_async()
    await writer.flush_async()
    writer.detach_stream()
    stream.seek(0)

    decoder = await BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    engine = OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        raise RuntimeError("Windows OCR has no language pack installed.")
    result = await engine.recognize_async(bitmap)
    return "\n".join(line.text for line in result.lines)


def _windows_ocr(png: bytes) -> str:
    return asyncio.run(_windows_ocr_async(png))


def _tesseract_ocr(img: np.ndarray) -> str:
    import cv2
    import pytesseract

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    return pytesseract.image_to_string(gray, config="--psm 6")


def read_card_text(img: np.ndarray) -> OcrResult:
    """Run OCR on a card image. Never raises; reports the problem in .error."""
    errors = []
    try:
        png = encode_png(img)
        text = _windows_ocr(png)
        if text.strip():
            return OcrResult(text, "windows")
        errors.append("Windows OCR found no text.")
    except Exception as exc:  # winrt missing, not on Windows, no language pack, etc.
        log.info("Windows OCR unavailable: %s", exc)
        errors.append(f"Windows OCR unavailable ({exc}).")

    try:
        text = _tesseract_ocr(img)
        if text.strip():
            return OcrResult(text, "tesseract")
        errors.append("Tesseract found no text.")
    except Exception as exc:
        log.info("Tesseract unavailable: %s", exc)
        errors.append("Tesseract not installed.")

    return OcrResult("", "", " ".join(errors))
