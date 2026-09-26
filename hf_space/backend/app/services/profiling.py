"""Column profiling (FR-2.1)."""
from __future__ import annotations

from app.services.standardise import YES, NO, collapse, is_blank, normalise_phone, parse_date, parse_int


def detect_type(values: list) -> str:
    vals = [v for v in values if not is_blank(v)]
    if not vals:
        return "text"
    n = len(vals)

    def share(pred) -> float:
        return sum(1 for v in vals if pred(v)) / n

    if share(lambda v: collapse(str(v)).lower() in YES | NO) >= 0.8:
        return "yes-no"
    if share(lambda v: normalise_phone(v)[0] is not None and len(str(v).replace(" ", "")) >= 9) >= 0.6:
        return "phone"
    if share(lambda v: parse_int(v)[1] is None) >= 0.8:
        return "number"
    if share(lambda v: isinstance(v, str) and any(c in v for c in "-/.") and parse_date(v)[0] is not None) >= 0.6:
        return "date"
    distinct = {collapse(str(v)).lower() for v in vals}
    if len(distinct) <= max(5, int(0.2 * n)) and n >= 5:
        return "category"
    return "text"


def profile_columns(columns: list[str], rows: list[dict]) -> list[dict]:
    total = len(rows)
    out = []
    for col in columns:
        values = [r.get(col) for r in rows]
        non_blank = [v for v in values if not is_blank(v)]
        samples: list = []
        for v in non_blank:
            if v not in samples:
                samples.append(v)
            if len(samples) == 5:
                break
        out.append({
            "column": col,
            "detected_type": detect_type(values),
            "blank_pct": round(100 * (total - len(non_blank)) / total, 1) if total else 0.0,
            "blank_count": total - len(non_blank),
            "distinct_count": len({str(v) for v in non_blank}),
            "samples": samples,
        })
    return out
