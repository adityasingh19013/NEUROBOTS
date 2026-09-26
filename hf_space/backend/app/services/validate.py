"""Validation checks that turn a standardised row into issues (FR-4)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

REQUIRED: dict[str, set[str]] = {
    "beneficiary registry": {"full_name", "event_date"},
    "attendance": {"full_name", "event_date", "attended"},
    "survey": {"full_name", "event_date", "score_before", "score_after"},
    "other": set(),
}
# Missing phone is not fatal (matching can fall back to name) but lowers match confidence.
RECOMMENDED: dict[str, set[str]] = {
    "beneficiary registry": {"phone", "age", "gender"},
    "attendance": {"phone"},
    "survey": {"phone", "recommend"},
    "other": set(),
}
RANGES: dict[str, tuple[int, int]] = {"age": (0, 120), "score_before": (1, 5), "score_after": (1, 5)}

FIELD_LABELS = {
    "external_id": "ID", "full_name": "Name", "phone": "Phone", "gender": "Gender", "age": "Age",
    "location": "Location", "event_date": "Date", "program": "Program", "session_topic": "Session topic",
    "attended": "Attendance mark", "score_before": "Score before", "score_after": "Score after",
    "recommend": "Would recommend",
}

SEVERITY = {
    "missing_required": "High", "out_of_range": "High",
    "missing_value": "Medium", "invalid_format": "Medium", "unrecognised": "Medium",
    "out_of_period": "Medium", "unmatched": "Medium", "link_review": "Medium",
    "conflicting_records": "Low", "exact_duplicate": "Low", "possible_duplicate": "Low",
}

ISSUE_TYPE_LABELS = {
    "missing_required": "Required field missing", "missing_value": "Missing value",
    "out_of_range": "Out of range", "invalid_format": "Invalid format", "unrecognised": "Unrecognised value",
    "out_of_period": "Out-of-period date", "unmatched": "Unmatched record", "link_review": "Link needs review",
    "conflicting_records": "Conflicting records", "exact_duplicate": "Exact duplicate row",
    "possible_duplicate": "Possible duplicate person",
}


@dataclass
class Finding:
    type: str
    field: str | None
    value: object
    message: str

    @property
    def severity(self) -> str:
        return SEVERITY[self.type]


def label(fld: str | None) -> str:
    return FIELD_LABELS.get(fld or "", fld or "")


def validate_row(role: str, mapped_fields: set[str], values: dict, raw_by_field: dict, missing: list[str],
                 problems: dict[str, str], period_start: date, period_end: date) -> list[Finding]:
    out: list[Finding] = []
    required = REQUIRED.get(role, set()) & mapped_fields
    recommended = RECOMMENDED.get(role, set()) & mapped_fields

    for fld in sorted(required):
        if fld in missing:
            out.append(Finding("missing_required", fld, None, f"{label(fld)} is blank (required for {role})."))
    for fld in sorted(recommended):
        if fld in missing:
            out.append(Finding("missing_value", fld, None, f"{label(fld)} is blank."))

    for fld, problem in sorted(problems.items()):
        raw = raw_by_field.get(fld)
        if problem == "invalid_format":
            out.append(Finding("invalid_format", fld, raw, f"{label(fld)} '{raw}' could not be read."))
        elif problem == "unrecognised":
            out.append(Finding("unrecognised", fld, raw, f"{label(fld)} value '{raw}' is not recognised."))

    for fld, (lo, hi) in RANGES.items():
        v = values.get(fld)
        if isinstance(v, int) and not (lo <= v <= hi):
            out.append(Finding("out_of_range", fld, v, f"{label(fld)} = {v} is outside the valid range {lo}–{hi}."))

    d = values.get("event_date")
    if d:
        dd = date.fromisoformat(d)
        if dd > period_end:
            out.append(Finding("out_of_period", "event_date", d,
                               f"Date {d} is after the reporting period ends ({period_end.isoformat()})."))
        elif dd < period_start and role != "beneficiary registry":
            out.append(Finding("out_of_period", "event_date", d,
                               f"Date {d} is before the reporting period starts ({period_start.isoformat()})."))
    return out
