"""Exact + fuzzy duplicate detection (FR-5 steps 1-2). Pure functions."""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass

from rapidfuzz import fuzz

from app.services.standardise import normalise_name

SUGGESTED = 90
REVIEW = 70


@dataclass
class MatchRecord:
    raw_row_id: int
    name: str        # normalised
    phone: str | None
    location: str    # normalised

    @classmethod
    def from_values(cls, raw_row_id: int, values: dict) -> "MatchRecord":
        return cls(raw_row_id, normalise_name(values.get("full_name")), values.get("phone"),
                   normalise_name(values.get("location")))

    @property
    def block_name(self) -> str:
        return self.name.replace(" ", "")[:3]


NAME_ONLY_POINTS = 35


def score_pair(a: MatchRecord, b: MatchRecord) -> tuple[float, dict]:
    """PRD FR-5 score. Extra rule: when a phone is missing, an exact name match scores +35 so it lands in
    'needs review' (70-89) – name-only matches are never strong enough to be suggested automatically."""
    phone_both = bool(a.phone and b.phone)
    phone_match = 50 if phone_both and a.phone == b.phone else 0
    phone_conflict = -30 if phone_both and a.phone != b.phone else 0
    ratio = fuzz.token_sort_ratio(a.name, b.name) if a.name and b.name else 0.0
    name_pts = round(ratio * 0.40, 1)
    name_only = NAME_ONLY_POINTS if not phone_both and ratio == 100 else 0
    loc = 10 if a.location and b.location and a.location == b.location else 0
    score = round(max(0.0, min(100.0, phone_match + name_pts + name_only + loc + phone_conflict)), 1)
    if not phone_both:
        score = min(score, 89.0)
    return score, {
        "phone_match": phone_match, "name_similarity": round(ratio, 1), "name_points": name_pts,
        "name_only_match": name_only, "phone_missing": not phone_both,
        "location_match": loc, "phone_conflict": phone_conflict, "total": score,
    }


def band(score: float) -> str | None:
    if score >= SUGGESTED:
        return "suggested"
    if score >= REVIEW:
        return "review"
    return None


def candidate_pairs(records: list[MatchRecord]) -> list[tuple[MatchRecord, MatchRecord, float, dict]]:
    """Blocking: only compare records sharing a phone or the first 3 letters of the name."""
    blocks: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(records):
        if r.phone:
            blocks["p:" + r.phone].append(i)
        if r.block_name:
            blocks["n:" + r.block_name].append(i)
    seen: set[tuple[int, int]] = set()
    out = []
    for members in blocks.values():
        for x in range(len(members)):
            for y in range(x + 1, len(members)):
                i, j = sorted((members[x], members[y]))
                if (i, j) in seen:
                    continue
                seen.add((i, j))
                a, b = records[i], records[j]
                score, breakdown = score_pair(a, b)
                if band(score):
                    out.append((a, b, score, breakdown))
    return out


def exact_duplicate_key(values: dict) -> str:
    return json.dumps(values, sort_keys=True, default=str)
