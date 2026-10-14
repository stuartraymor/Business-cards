"""Tests for the logic layer. Run with: python -m unittest discover -s tests -t ."""
import os
import sys
import tempfile
import unittest

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from business_cards.capture import process_text  # noqa: E402
from business_cards.export import card_to_vcard, export_csv  # noqa: E402
from business_cards.imaging import crop_card  # noqa: E402
from business_cards.parser import check_email, check_phone, format_phone, parse_card_text  # noqa: E402
from business_cards.storage import CardStore, normalize_tags  # noqa: E402


def make_card_photo() -> np.ndarray:
    """A synthetic photo: a slightly rotated white card on a dark table."""
    canvas = np.full((900, 1200, 3), (120, 110, 100), np.uint8)
    card = np.full((350, 600, 3), 245, np.uint8)
    cv2.putText(card, "JANE SMITH", (40, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (30, 30, 30), 3)
    cv2.putText(card, "Acme Tool Inc", (40, 220), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (30, 30, 30), 2)
    src = np.float32([[0, 0], [599, 0], [599, 349], [0, 349]])
    dst = np.float32([[300, 220], [880, 260], [850, 610], [270, 580]])
    m = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(card, m, (1200, 900))
    mask = cv2.warpPerspective(np.full((350, 600), 255, np.uint8), m, (1200, 900))
    canvas[mask > 0] = warped[mask > 0]
    return canvas


def _vcard_escape_check():
    from business_cards.export import _vcard_escape
    return _vcard_escape("a;b")


class ParserTests(unittest.TestCase):
    def test_full_card(self):
        card = parse_card_text(
            "Jane Smith\nSenior Sales Manager\nAcme Machine & Tool Inc.\n"
            "Office: 231.555.0142 x204\nCell 616-555-0199\njane.smith@acmetool.com\n"
            "www.acmetool.com\n1234 Industrial Dr, Muskegon, MI 49441")
        self.assertEqual(card.name, "Jane Smith")
        self.assertEqual(card.title, "Senior Sales Manager")
        self.assertEqual(card.company, "Acme Machine & Tool Inc.")
        self.assertEqual(card.phone, "(231) 555-0142 ext. 204")
        self.assertEqual(card.mobile, "(616) 555-0199")
        self.assertEqual(card.email, "jane.smith@acmetool.com")
        self.assertEqual(card.website, "acmetool.com")
        self.assertIn("Muskegon", card.address)
        self.assertEqual(card.notes, "")
        self.assertEqual(card.warnings, {})

    def test_title_is_not_company(self):
        card = parse_card_text("Mary Ng\nPurchasing Agent\nSpartan Fasteners\nmary@spartanfast.com")
        self.assertEqual(card.title, "Purchasing Agent")
        self.assertEqual(card.company, "Spartan Fasteners")
        self.assertNotIn("company", card.warnings)

    def test_personal_email_warns(self):
        card = parse_card_text("Bob Jones\nBuyer\nWidgetCo LLC\n(231) 555-0100\nbob@gmail.com")
        self.assertIn("email", card.warnings)

    def test_missing_name_warns(self):
        card = parse_card_text("blurry 12 ##\n???")
        self.assertIn("name", card.warnings)
        self.assertIn("name", card.low_confidence)

    def test_phone_checks(self):
        self.assertEqual(format_phone("2315550142"), "(231) 555-0142")
        self.assertEqual(format_phone("1-231-555-0142"), "(231) 555-0142")
        self.assertIsNone(check_phone("(231) 555-0142"))
        self.assertIn("digits", check_phone("(231) 555-01"))
        self.assertIn("Area code", check_phone("(031) 555-0142"))
        self.assertIn("repeated", check_phone("(222) 222-2222"))

    def test_email_checks(self):
        self.assertIsNotNone(check_email("not-an-email", ""))
        self.assertIsNone(check_email("a@acme.com", "Acme Tool"))
        self.assertIsNotNone(check_email("a@zebra.com", "Acme Tool"))


class ImagingTests(unittest.TestCase):
    def test_finds_and_straightens_card(self):
        result = crop_card(make_card_photo())
        self.assertTrue(result.detected)
        h, w = result.image.shape[:2]
        self.assertGreater(w, h)
        self.assertLess(abs(w / h - 1.75), 0.3)

    def test_plain_image_is_not_detected(self):
        result = crop_card(np.full((300, 400, 3), 128, np.uint8))
        self.assertFalse(result.detected)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.store = CardStore(self.dir)

    def tearDown(self):
        self.store.close()

    def test_crud_and_filters(self):
        a = self.store.add_card({"name": "Jane Smith", "company": "Acme Tool", "email": "jane@acme.com",
                                 "phone": "(231) 555-0142", "category": "Vendor", "tags": "Tooling, Urgent"},
                                b"\x89PNG-test", "raw")
        b = self.store.add_card({"name": "Bob Jones", "company": "Widget Co", "category": "Reseller"})
        self.assertEqual(len(self.store.list_cards()), 2)
        self.assertEqual([c["company"] for c in self.store.list_cards(search="acme jane")], ["Acme Tool"])
        self.assertEqual([c["name"] for c in self.store.list_cards(category="Reseller")], ["Bob Jones"])
        self.assertEqual([c["name"] for c in self.store.list_cards(tag="urgent")], ["Jane Smith"])
        self.assertEqual([c["name"] for c in self.store.list_cards(sort_by="name", ascending=False)],
                         ["Jane Smith", "Bob Jones"])
        self.store.update_card(b, {"favorite": 1})
        self.assertEqual([c["name"] for c in self.store.list_cards(favorites_only=True)], ["Bob Jones"])
        self.assertTrue(self.store.image_path(self.store.get_card(a)["image_path"]).exists())
        self.store.delete_card(a)
        self.assertEqual(len(self.store.list_cards()), 1)
        self.assertEqual(self.store.all_tags(), [])

    def test_duplicates(self):
        self.store.add_card({"name": "Jane Smith", "company": "Acme Tool", "email": "jane@acme.com",
                             "mobile": "(616) 555-0199"})
        self.assertEqual(len(self.store.find_duplicates({"email": "JANE@acme.com"})), 1)
        self.assertEqual(len(self.store.find_duplicates({"phone": "1-616-555-0199"})), 1)
        self.assertEqual(self.store.find_duplicates({"email": "other@x.com"}), [])

    def test_sql_injection_is_safe(self):
        self.store.add_card({"name": "Safe"})
        self.assertEqual(len(self.store.list_cards(search="x' OR '1'='1")), 0)
        self.assertEqual(len(self.store.list_cards(sort_by="name; DROP TABLE cards")), 1)

    def test_tags_normalize(self):
        self.assertEqual(normalize_tags(" Tooling, urgent ,tooling;Vendor"), "tooling,urgent,vendor")


class CaptureAndExportTests(unittest.TestCase):
    def test_text_capture(self):
        cap = process_text("Mary Ng\nPurchasing Agent\nSpartan Fasteners\nmary@spartanfast.com\n(517) 555-0120")
        self.assertEqual(cap.parsed.name, "Mary Ng")
        self.assertIsNone(cap.image_png)

    def test_image_capture_end_to_end(self):
        from business_cards.capture import process_image
        cap = process_image(make_card_photo())
        self.assertIsNotNone(cap.image_png)
        self.assertTrue(cap.image_png.startswith(b"\x89PNG"))

    def test_csv_and_vcard(self):
        card = {"name": "Jane Smith", "company": "Acme, Inc", "email": "j@a.com", "favorite": 1}
        path = os.path.join(tempfile.mkdtemp(), "out.csv")
        self.assertEqual(export_csv([card], path), 1)
        with open(path, encoding="utf-8-sig") as fh:
            self.assertIn('"Acme, Inc"', fh.read())
        vcf = card_to_vcard(card)
        self.assertIn("N:Smith;Jane;;;", vcf)
        self.assertIn("ORG:Acme\\, Inc", vcf)
        self.assertEqual(_vcard_escape_check(), "a\\;b")


if __name__ == "__main__":
    unittest.main()
