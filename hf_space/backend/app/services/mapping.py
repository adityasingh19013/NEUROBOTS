"""Auto-suggest canonical fields for source columns (FR-2.2 – FR-2.4)."""
from __future__ import annotations

import re

from rapidfuzz import fuzz

CANONICAL_FIELDS: dict[str, dict] = {
    "external_id":   {"label": "Beneficiary ID", "type": "text"},
    "full_name":     {"label": "Full name", "type": "text", "pii": True},
    "phone":         {"label": "Phone", "type": "phone", "pii": True},
    "gender":        {"label": "Gender", "type": "category"},
    "age":           {"label": "Age", "type": "number"},
    "location":      {"label": "Location / village", "type": "text"},
    "event_date":    {"label": "Date (enrolment / session / response)", "type": "date"},
    "program":       {"label": "Program", "type": "category"},
    "session_topic": {"label": "Session topic", "type": "text"},
    "attended":      {"label": "Attended (yes/no)", "type": "yes-no"},
    "score_before":  {"label": "Score before", "type": "number"},
    "score_after":   {"label": "Score after", "type": "number"},
    "recommend":     {"label": "Would recommend", "type": "category"},
}

SYNONYMS: dict[str, list[str]] = {
    "external_id": ["beneficiary id", "ben id", "id", "participant id", "member id", "reg no",
                    "registration no", "registration number", "beneficiary code"],
    "full_name": ["full name", "name", "participant name", "beneficiary name", "respondent name",
                  "student name", "member name", "respondent"],
    "phone": ["phone", "mobile", "ph no", "contact", "mobile no", "phone number", "contact number",
              "mobile number", "phone no", "cell"],
    "gender": ["gender", "sex"],
    "age": ["age", "age years", "age in years"],
    "location": ["village", "location", "place", "district", "town", "area", "locality", "block", "city"],
    "event_date": ["enrollment date", "enrolment date", "date", "session date", "response date",
                   "survey date", "date of survey", "date of joining", "attendance date", "joining date",
                   "submitted at"],
    "program": ["program", "programme", "course", "scheme", "project"],
    "session_topic": ["session topic", "topic", "module", "session", "session name"],
    "attended": ["present", "attended", "attendance", "attendance status"],
    "score_before": ["confidence before", "score before", "pre score", "before", "pre", "baseline score"],
    "score_after": ["confidence after", "score after", "post score", "after", "post", "endline score"],
    "recommend": ["would recommend", "recommend", "recommendation", "would you recommend"],
}

# Which value pattern backs up which fields.
TYPE_HINTS = {"phone": {"phone"}, "date": {"event_date"}, "yes-no": {"attended", "recommend"}}

MIN_CONFIDENCE = 0.6


def column_signature(columns: list[str]) -> str:
    import hashlib
    key = "|".join(sorted(normalise_header(c) for c in columns))
    return hashlib.sha256(key.encode()).hexdigest()


def apply_template(suggestions: list[dict], template: dict | None) -> list[dict]:
    """Override suggestions with a saved template's confirmed choices."""
    if not template:
        return suggestions
    for s in suggestions:
        t = template.get(s["source_column"])
        if t is not None:
            s["canonical_field"] = t.get("field")
            s["is_pii"] = bool(t.get("is_pii"))
            s["confidence"] = 1.0 if t.get("field") else 0.0
            s["reason"] = "from saved template" if t.get("field") else "ignored in saved template"
    return suggestions


def normalise_header(h: str) -> str:
    h = re.sub(r"\(.*?\)", " ", h.lower())
    h = re.sub(r"[_\-./#:]+", " ", h)
    return re.sub(r"\s+", " ", h).strip()


def header_score(header: str) -> list[tuple[str, float, str]]:
    norm = normalise_header(header)
    scored = []
    for fld, words in SYNONYMS.items():
        best, best_word = 0.0, ""
        for w in words:
            s = 100.0 if norm == w else fuzz.token_sort_ratio(norm, w)
            if s > best:
                best, best_word = s, w
        scored.append((fld, best, best_word))
    scored.sort(key=lambda t: -t[1])
    return scored


def suggest_mapping(profile: list[dict]) -> list[dict]:
    """profile: output of profiling.profile_columns. Returns one suggestion per column."""
    candidates = []
    for i, col in enumerate(profile):
        for fld, score, word in header_score(col["column"])[:4]:
            conf = score / 100
            reason = f"header ≈ '{word}'" if score < 100 else f"header matches '{word}'"
            if fld in TYPE_HINTS.get(col["detected_type"], set()):
                conf = min(1.0, conf + 0.15)
                reason += f"; values look like {col['detected_type']}"
            candidates.append((conf, i, fld, reason))
        # value-pattern-only suggestion (e.g. unnamed column full of phone numbers)
        for fld in TYPE_HINTS.get(col["detected_type"], set()):
            candidates.append((0.65, i, fld, f"values look like {col['detected_type']}"))

    # Greedy one-to-one assignment, best confidence first.
    candidates.sort(key=lambda t: -t[0])
    assigned_cols: dict[int, tuple] = {}
    used_fields: set[str] = set()
    for conf, i, fld, reason in candidates:
        if i in assigned_cols or fld in used_fields or conf < MIN_CONFIDENCE:
            continue
        assigned_cols[i] = (fld, conf, reason)
        used_fields.add(fld)

    out = []
    for i, col in enumerate(profile):
        fld, conf, reason = assigned_cols.get(i, (None, 0.0, "no confident match – ignored"))
        out.append({
            "source_column": col["column"],
            "canonical_field": fld,
            "confidence": round(conf, 2),
            "reason": reason,
            "is_pii": bool(fld and CANONICAL_FIELDS[fld].get("pii")),
            "detected_type": col["detected_type"],
            "samples": col["samples"],
            "blank_pct": col["blank_pct"],
            "distinct_count": col["distinct_count"],
        })
    return out
