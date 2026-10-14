"""Turn raw card text into structured fields, with validation warnings.

This module has no GUI or OCR dependencies so it can be tested on its own.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

CATEGORIES = ("Vendor", "Reseller", "Business", "Other")

TITLE_WORDS = {
    "manager", "engineer", "director", "president", "owner", "supervisor",
    "representative", "rep", "account", "technician", "coordinator", "buyer",
    "sales", "vice", "vp", "ceo", "cfo", "coo", "cto", "partner", "consultant",
    "specialist", "foreman", "lead", "chief", "officer", "analyst", "estimator",
    "machinist", "programmer", "planner", "superintendent", "founder", "principal",
    "purchasing", "procurement", "agent", "administrator", "assistant", "operator",
    "executive", "head", "associate", "accountant", "controller", "quality", "operations",
    "estimating", "contracts", "dispatcher", "scheduler", "inspector",
}

COMPANY_WORDS = {
    "inc", "inc.", "llc", "corp", "corporation", "co", "co.", "ltd", "company",
    "group", "industries", "machine", "machining", "shop", "supply", "supplies",
    "tool", "tooling", "engineering", "services", "solutions", "systems", "fasteners",
    "fastener", "plastics", "metals", "steel", "products", "partners", "gear", "bearing",
    "precision", "electric", "electronics", "printing", "press", "media", "mold", "mould",
    "manufacturing", "fabrication", "publishing", "books", "technologies",
}

STREET_WORDS = {
    "st", "street", "ave", "avenue", "rd", "road", "blvd", "boulevard", "dr", "drive",
    "ln", "lane", "way", "hwy", "highway", "pkwy", "parkway", "ct", "court", "suite",
    "ste", "pl", "place", "unit",
}

PHONE_RE = re.compile(
    r"(?:(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})"
    r"(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
WEB_RE = re.compile(r"(?:https?://|www\.)[^\s,;]+|\b[a-z0-9\-]+\.(?:com|net|org|biz|info|us|io|co)\b", re.IGNORECASE)
ZIP_RE = re.compile(r"\b\d{5}(?:-\d{4})?\b")
PHONE_LABEL_RE = re.compile(r"^(?:tel|phone|ph|p|office|o|mobile|cell|c|fax|f|direct|d)[\s:.\-]", re.IGNORECASE)


@dataclass
class ParsedCard:
    name: str = ""
    title: str = ""
    company: str = ""
    phone: str = ""
    mobile: str = ""
    fax: str = ""
    email: str = ""
    website: str = ""
    address: str = ""
    category: str = "Business"
    notes: str = ""
    # Field name -> human-readable warning. Warnings never block saving.
    warnings: dict[str, str] = field(default_factory=dict)
    # Fields the parser is unsure about; the UI highlights these in yellow.
    low_confidence: set[str] = field(default_factory=set)


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def format_phone(raw: str) -> str:
    """Format a US-style phone number as (XXX) XXX-XXXX [ext. N]."""
    ext_match = re.search(r"(?:x|ext\.?|extension)\s*(\d{1,6})\s*$", raw, re.IGNORECASE)
    ext = ext_match.group(1) if ext_match else ""
    core = raw[: ext_match.start()] if ext_match else raw
    d = _digits(core)
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    if len(d) != 10:
        return raw.strip()
    out = f"({d[:3]}) {d[3:6]}-{d[6:]}"
    return f"{out} ext. {ext}" if ext else out


def check_phone(formatted: str) -> str | None:
    """Return a warning if a phone number looks wrong, otherwise None."""
    core = re.split(r"\sext\.", formatted)[0]
    d = _digits(core)
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    if len(d) != 10:
        return f"Phone has {len(d)} digits; a US number should have 10."
    if d[0] in "01":
        return "Area code starts with 0 or 1, which is not a valid US area code."
    if d[3] in "01":
        return "Exchange starts with 0 or 1, which is not valid for US numbers."
    if len(set(d)) == 1:
        return "Phone number is a single repeated digit; it may be a placeholder."
    return None


FREE_MAIL_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com"}


def check_email(email: str, company: str) -> str | None:
    """Return a warning if an email looks wrong, otherwise None."""
    if not EMAIL_RE.fullmatch(email):
        return "Email address format looks invalid."
    domain = email.split("@", 1)[1].lower()
    if domain in FREE_MAIL_DOMAINS:
        return f"Personal email domain ({domain}); confirm this is the business contact."
    if company:
        stem = re.sub(r"[^a-z0-9]", "", company.lower())
        dom_stem = re.sub(r"[^a-z0-9]", "", domain.split(".")[0])
        if dom_stem and stem and dom_stem[:4] not in stem and stem[:4] not in dom_stem:
            return f"Email domain '{domain}' does not seem to match the company name."
    return None


def _clean_line(line: str) -> str:
    line = re.sub(r"\s+", " ", line)
    # Strip leading/trailing punctuation left over from edges, keeping "(" and "+" for phones.
    line = re.sub(r"^[^A-Za-z0-9(+]+", "", line)
    line = re.sub(r"[^A-Za-z0-9).]+$", "", line)
    return line.strip()


def _is_noise(line: str) -> bool:
    """OCR debris: too few letters or digits to be real card text."""
    return len(re.findall(r"[A-Za-z0-9]", line)) < 3


def _words(line: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z.&'\-]*", line)


def _looks_like_name(line: str) -> bool:
    if any(ch.isdigit() for ch in line) or "@" in line or "/" in line:
        return False
    words = _words(line)
    if not 2 <= len(words) <= 4:
        return False
    if any(w.lower().rstrip(".") in TITLE_WORDS | COMPANY_WORDS | STREET_WORDS for w in words):
        return False
    return all(w[0].isupper() for w in words if len(w) > 1)


def _looks_like_title(line: str) -> bool:
    return any(w.lower().rstrip(".") in TITLE_WORDS for w in _words(line))


def _looks_like_company(line: str) -> bool:
    return any(w.lower() in COMPANY_WORDS for w in _words(line))


def _looks_like_address(line: str) -> bool:
    has_zip = bool(ZIP_RE.search(line))
    has_street = any(w.lower().rstrip(".") in STREET_WORDS for w in _words(line)) and bool(re.search(r"\d", line))
    return has_zip or has_street


def parse_card_text(text: str) -> ParsedCard:
    """Extract card fields from raw text. Works on OCR output or pasted text."""
    card = ParsedCard()
    lines = [_clean_line(l) for l in text.splitlines()]
    lines = [l for l in lines if l and not _is_noise(l)]
    remaining = list(lines)

    # Email and website first: they are the most reliable matches.
    emails = EMAIL_RE.findall(text)
    if emails:
        card.email = emails[0]
    web = [w for w in WEB_RE.findall(text) if "@" not in w]
    if web:
        card.website = web[0].rstrip(".,")

    # Phone numbers: label them mobile/fax when the label says so.
    for line in lines:
        for match in PHONE_RE.finditer(line):
            raw = match.group(0)
            prefix = line[: match.start()].strip()
            formatted = format_phone(raw)
            label = prefix.lower()
            if "fax" in label or label.endswith("f") and len(label) <= 2:
                card.fax = card.fax or formatted
            elif "mobile" in label or "cell" in label or label.endswith("c") and len(label) <= 2:
                card.mobile = card.mobile or formatted
            else:
                card.phone = card.phone or formatted
    if not card.phone and card.mobile:
        card.phone, card.mobile = card.mobile, ""

    for name_field, value in (("phone", card.phone), ("mobile", card.mobile), ("fax", card.fax)):
        if value:
            issue = check_phone(value)
            if issue:
                card.warnings[name_field] = issue
                card.low_confidence.add(name_field)

    if card.email:
        issue = check_email(card.email, "")
        if issue:
            card.warnings["email"] = issue
            card.low_confidence.add("email")

    # Address: lines with a zip code or a street word and a number.
    addr_lines = [l for l in remaining if _looks_like_address(l)]
    if addr_lines:
        card.address = ", ".join(addr_lines)
        remaining = [l for l in remaining if l not in addr_lines]

    # Drop lines that are purely contact data.
    contact_lines = []
    for line in remaining:
        stripped = PHONE_RE.sub("", WEB_RE.sub("", EMAIL_RE.sub("", line)))
        stripped = PHONE_LABEL_RE.sub("", stripped).strip(" :.-|,()")
        if not stripped or not re.search(r"[A-Za-z]", stripped):
            contact_lines.append(line)
    remaining = [l for l in remaining if l not in contact_lines]

    # Title first: "Senior Sales Manager" must not be mistaken for a company.
    title_lines = [l for l in remaining if _looks_like_title(l)]
    if title_lines:
        card.title = title_lines[0]
        remaining.remove(title_lines[0])

    # Company: a line with a company word, else the first leftover line.
    company_lines = [l for l in remaining if _looks_like_company(l)]
    if company_lines:
        card.company = company_lines[0]
        remaining.remove(company_lines[0])

    # Name: the first name-shaped line.
    name_lines = [l for l in remaining if _looks_like_name(l)]
    if name_lines:
        card.name = name_lines[0]
        remaining.remove(name_lines[0])
    else:
        card.low_confidence.add("name")
        card.warnings["name"] = "No name found; please enter it."

    if not card.company and remaining:
        card.company = remaining.pop(0)
        card.low_confidence.add("company")
        card.warnings["company"] = "Company was guessed; please check it."
    if not card.company:
        card.warnings["company"] = "No company found; please enter it."
        card.low_confidence.add("company")

    # Check email against the company now that it is known.
    if card.email and card.company:
        issue = check_email(card.email, card.company)
        if issue:
            card.warnings["email"] = issue
            card.low_confidence.add("email")

    if not (card.phone or card.mobile or card.email):
        card.warnings["contact"] = "No phone or email found; the card may be unreadable."

    card.notes = "\n".join(remaining)
    return card
