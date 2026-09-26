"""Standardisation rules (FR-3). Pure functions: they never touch raw data."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from dateutil import parser as dateparser

# ---------------------------------------------------------------- helpers

_SPACES = re.compile(r"\s+")
_ISO = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$")
_DMY = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$")

YES = {"y", "yes", "1", "true", "t", "present", "p", "attended", "haan", "ha"}
NO = {"n", "no", "0", "false", "f", "absent", "a", "nahi"}
GENDER = {
    "f": "Female", "female": "Female", "woman": "Female", "w": "Female", "girl": "Female",
    "m": "Male", "male": "Male", "man": "Male", "boy": "Male",
    "o": "Other", "other": "Other", "transgender": "Other", "non-binary": "Other", "nonbinary": "Other",
}
RECOMMEND = {
    "y": "Yes", "yes": "Yes", "1": "Yes", "true": "Yes",
    "n": "No", "no": "No", "0": "No", "false": "No",
    "unsure": "Unsure", "not sure": "Unsure", "maybe": "Unsure", "don't know": "Unsure",
    "dont know": "Unsure", "dk": "Unsure", "can't say": "Unsure",
}


def is_blank(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def collapse(s: str) -> str:
    return _SPACES.sub(" ", s).strip()


def title(s: str) -> str:
    return " ".join(w[:1].upper() + w[1:].lower() for w in collapse(s).split(" "))


def normalise_name(name) -> str:
    """Name form used for matching: lowercase, letters/digits only, single spaces."""
    if is_blank(name):
        return ""
    s = re.sub(r"[^\w\s]", " ", str(name).lower())
    return collapse(s)


def normalise_phone(v) -> tuple[str | None, str | None]:
    """Return (10-digit phone or None, problem)."""
    if is_blank(v):
        return None, None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    digits = re.sub(r"\D", "", str(v))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10:
        return None, "invalid_format"
    return digits, None


def parse_date(v) -> tuple[str | None, str | None, str | None]:
    """Return (ISO date, assumption, problem). Day-first is the default for ambiguous dates."""
    if is_blank(v):
        return None, None, None
    if isinstance(v, (int, float)) and 20000 <= v <= 80000:
        return (date(1899, 12, 30) + timedelta(days=int(v))).isoformat(), "excel_serial", None
    s = str(v).strip()
    try:
        m = _ISO.match(s)
        if m:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat(), None, None
        m = _DMY.match(s)
        if m:
            a, b, y = int(m[1]), int(m[2]), int(m[3])
            if y < 100:
                y += 2000
            if a > 12:
                return date(y, b, a).isoformat(), None, None
            if b > 12:
                return date(y, a, b).isoformat(), "month_first_detected", None
            if a == b:
                return date(y, b, a).isoformat(), None, None
            return date(y, b, a).isoformat(), "day_first", None
        d = dateparser.parse(s, dayfirst=True)
        return d.date().isoformat(), "day_first", None
    except (ValueError, OverflowError):
        return None, None, "invalid_format"


def parse_int(v) -> tuple[int | None, str | None]:
    if is_blank(v):
        return None, None
    if isinstance(v, bool):
        return None, "invalid_format"
    if isinstance(v, (int, float)):
        if isinstance(v, float) and not v.is_integer():
            return round(v), None
        return int(v), None
    s = str(v).strip()
    try:
        f = float(s)
    except ValueError:
        return None, "invalid_format"
    return (int(f) if f.is_integer() else round(f)), None


# ---------------------------------------------------------------- per-field rules

@dataclass
class FieldResult:
    value: object
    rule: str | None = None
    problem: str | None = None  # invalid_format | unrecognised
    assumption: str | None = None


def standardise_field(fld: str, raw) -> FieldResult:
    if fld in ("full_name", "location"):
        if is_blank(raw):
            return FieldResult(None)
        out = title(str(raw))
        return FieldResult(out, "trim_titlecase" if out != raw else None)

    if fld == "program":
        if is_blank(raw):
            return FieldResult(None)
        out = title(str(raw))
        return FieldResult(out, "category_case" if out != raw else None)

    if fld in ("session_topic",):
        if is_blank(raw):
            return FieldResult(None)
        out = collapse(str(raw))
        return FieldResult(out, "trim_spaces" if out != raw else None)

    if fld == "external_id":
        if is_blank(raw):
            return FieldResult(None)
        out = collapse(str(raw)).upper()
        return FieldResult(out, "trim_upper" if out != str(raw) else None)

    if fld == "phone":
        out, problem = normalise_phone(raw)
        if problem:
            return FieldResult(None, "phone_invalid", problem)
        return FieldResult(out, "phone_10_digits" if out is not None and out != str(raw) else None)

    if fld == "event_date":
        out, assumption, problem = parse_date(raw)
        if problem:
            return FieldResult(None, "date_invalid", problem)
        rule = None
        if out is not None and out != str(raw):
            rule = {"day_first": "date_day_first_to_iso", "month_first_detected": "date_month_first_to_iso",
                    "excel_serial": "excel_serial_to_iso"}.get(assumption or "", "date_to_iso")
        return FieldResult(out, rule, None, assumption)

    if fld == "gender":
        if is_blank(raw):
            return FieldResult("Unknown", "blank_gender_to_unknown")
        key = collapse(str(raw)).lower()
        if key in GENDER:
            out = GENDER[key]
            return FieldResult(out, "gender_map" if out != raw else None)
        return FieldResult("Unknown", "gender_unrecognised_to_unknown", "unrecognised")

    if fld == "attended":
        if is_blank(raw):
            return FieldResult(None)
        key = collapse(str(raw)).lower()
        if key in YES:
            return FieldResult(True, "yes_no_to_bool")
        if key in NO:
            return FieldResult(False, "yes_no_to_bool")
        return FieldResult(None, None, "unrecognised")

    if fld == "recommend":
        if is_blank(raw):
            return FieldResult(None)
        key = collapse(str(raw)).lower()
        if key in RECOMMEND:
            out = RECOMMEND[key]
            return FieldResult(out, "recommend_map" if out != raw else None)
        return FieldResult(None, None, "unrecognised")

    if fld in ("age", "score_before", "score_after"):
        out, problem = parse_int(raw)
        if problem:
            return FieldResult(None, "number_invalid", problem)
        return FieldResult(out, "to_integer" if out is not None and str(out) != str(raw) else None)

    # unknown canonical field: pass through trimmed text
    if is_blank(raw):
        return FieldResult(None)
    return FieldResult(collapse(str(raw)) if isinstance(raw, str) else raw)


@dataclass
class RowResult:
    values: dict = field(default_factory=dict)
    changes: list = field(default_factory=list)       # (field, source_col, before, after, rule, assumption)
    problems: dict = field(default_factory=dict)      # field -> problem
    missing: list = field(default_factory=list)       # fields blank in source
    raw_by_field: dict = field(default_factory=dict)  # field -> raw value


def standardise_row(original: dict, column_fields: dict[str, str]) -> RowResult:
    """column_fields: source column -> canonical field (ignored columns omitted)."""
    res = RowResult()
    for col, fld in column_fields.items():
        raw = original.get(col)
        res.raw_by_field[fld] = raw
        if is_blank(raw):
            res.missing.append(fld)
        fr = standardise_field(fld, raw)
        res.values[fld] = fr.value
        if fr.problem:
            res.problems[fld] = fr.problem
        if fr.rule:
            res.changes.append((fld, col, raw, fr.value, fr.rule, fr.assumption))
    return res
