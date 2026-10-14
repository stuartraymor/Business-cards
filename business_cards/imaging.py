"""Find a business card in a photo or screenshot and crop it straight.

Returns a cropped, perspective-corrected image of the card. If no card-shaped
outline can be found, the full image is returned with detected=False so the
user can still see it and decide what to do.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

CARD_ASPECT = 3.5 / 2.0  # standard US business card, width / height
MAX_DETECT_SIDE = 1400
MIN_CARD_AREA_FRACTION = 0.08
MAX_OUTPUT_WIDTH = 1200


@dataclass
class CropResult:
    image: np.ndarray  # BGR
    detected: bool
    message: str


def read_image(path: str) -> np.ndarray:
    """Read any image format, including paths with non-ASCII characters."""
    data = np.fromfile(path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Could not read image: {path}")
    return img


def decode_image_bytes(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image data.")
    return img


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Order four points as top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).ravel()
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _candidate_quads(gray: np.ndarray) -> list[np.ndarray]:
    """Find quadrilaterals that could be the card, largest first."""
    quads: list[np.ndarray] = []
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    # Two edge passes: Canny for clear edges, and an adaptive threshold for low contrast.
    edges = [
        cv2.Canny(blurred, 50, 150),
        cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                              cv2.THRESH_BINARY_INV, 31, 10),
    ]
    kernel = np.ones((3, 3), np.uint8)
    for edge in edges:
        closed = cv2.morphologyEx(edge, cv2.MORPH_CLOSE, kernel, iterations=2)
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                quads.append(approx.reshape(4, 2).astype("float32"))
    return quads


def _quad_aspect_ok(quad: np.ndarray) -> bool:
    """Accept shapes near a card's ratio, or rotated to near it."""
    top = np.linalg.norm(quad[1] - quad[0])
    bottom = np.linalg.norm(quad[2] - quad[3])
    left = np.linalg.norm(quad[3] - quad[0])
    right = np.linalg.norm(quad[2] - quad[1])
    w = (top + bottom) / 2
    h = (left + right) / 2
    if w == 0 or h == 0:
        return False
    ratio = max(w, h) / min(w, h)
    return abs(ratio - CARD_ASPECT) / CARD_ASPECT < 0.35


def _warp(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    rect = _order_points(quad)
    (tl, tr, br, bl) = rect
    width = int(round(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl))))
    height = int(round(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl))))
    # Keep the card's real proportions, whichever way it was photographed.
    if width < height:
        width, height = height, width
    width = max(width, 10)
    height = max(height, 10)
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32")
    matrix = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img, matrix, (width, height))
    # Trim a thin margin: edge pixels from the table often show up as stray text.
    trim = max(2, int(0.015 * min(width, height)))
    if warped.shape[0] > 4 * trim and warped.shape[1] > 4 * trim:
        warped = warped[trim:-trim, trim:-trim]
    return warped


def _fallback_crop(img: np.ndarray) -> np.ndarray | None:
    """If edges fail, try the largest bright region (most cards are light)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    frame_area = img.shape[0] * img.shape[1]
    area = cv2.contourArea(biggest)
    # Too small is noise; nearly the whole frame means the threshold found nothing useful.
    if area < MIN_CARD_AREA_FRACTION * frame_area or area > 0.9 * frame_area:
        return None
    rect = cv2.minAreaRect(biggest)
    box = cv2.boxPoints(rect).astype("float32")
    if not _quad_aspect_ok(box):
        return None
    return _warp(img, box)


def crop_card(img: np.ndarray) -> CropResult:
    """Find the card in an image and return a straightened crop."""
    h, w = img.shape[:2]
    scale = min(1.0, MAX_DETECT_SIDE / max(h, w))
    small = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else img
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    image_area = small.shape[0] * small.shape[1]

    best = None
    for quad in _candidate_quads(gray):
        area = cv2.contourArea(quad)
        if area < MIN_CARD_AREA_FRACTION * image_area:
            continue
        if not _quad_aspect_ok(quad):
            continue
        if best is None or area > cv2.contourArea(best):
            best = quad

    if best is not None:
        card = _warp(small, best)
        message = "Card found and straightened."
    else:
        card = _fallback_crop(small)
        if card is not None:
            message = "Card found by brightness; please check the crop."
        else:
            card = small
            message = "Card outline not found; showing the full image. Retake the photo on a plain background for a better crop."
            return CropResult(_limit_width(card), False, message)

    return CropResult(_limit_width(card), True, message)


def _limit_width(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    if w <= MAX_OUTPUT_WIDTH:
        return img
    new_h = int(round(h * MAX_OUTPUT_WIDTH / w))
    return cv2.resize(img, (MAX_OUTPUT_WIDTH, new_h), interpolation=cv2.INTER_AREA)


def encode_png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("Could not encode image.")
    return buf.tobytes()
