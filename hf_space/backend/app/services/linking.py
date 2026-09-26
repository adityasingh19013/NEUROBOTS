"""Build canonical people from the registry and link attendance/survey rows to them (FR-5 step 3)."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from app.services.dedupe import REVIEW, SUGGESTED, MatchRecord, score_pair


class UnionFind:
    def __init__(self, items):
        self.parent = {i: i for i in items}

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            lo, hi = sorted((ra, rb))
            self.parent[hi] = lo


def group_registry(registry_ids: list[int], merged_pairs: list[tuple[int, int]]) -> list[list[int]]:
    """Group registry raw-row ids into people using only human-confirmed merges."""
    uf = UnionFind(registry_ids)
    for a, b in merged_pairs:
        if a in uf.parent and b in uf.parent:
            uf.union(a, b)
    groups: dict[int, list[int]] = defaultdict(list)
    for rid in registry_ids:
        groups[uf.find(rid)].append(rid)
    return sorted((sorted(g) for g in groups.values()), key=lambda g: g[0])


@dataclass
class LinkResult:
    person_index: int | None      # index into the list of groups
    registry_raw_row_id: int | None
    score: float
    breakdown: dict
    band: str                     # linked | review | unmatched


class Linker:
    def __init__(self, groups: list[list[int]], records: dict[int, MatchRecord]):
        self.records = records
        self.person_of: dict[int, int] = {rid: gi for gi, g in enumerate(groups) for rid in g}
        self.by_phone: dict[str, list[int]] = defaultdict(list)
        self.by_name: dict[str, list[int]] = defaultdict(list)
        for rid, r in records.items():
            if r.phone:
                self.by_phone[r.phone].append(rid)
            if r.block_name:
                self.by_name[r.block_name].append(rid)

    def link(self, rec: MatchRecord) -> LinkResult:
        cands = set(self.by_phone.get(rec.phone, [])) if rec.phone else set()
        if rec.block_name:
            cands |= set(self.by_name.get(rec.block_name, []))
        best: tuple | None = None
        for rid in cands:
            score, breakdown = score_pair(rec, self.records[rid])
            key = (-score, self.person_of[rid], rid)
            if best is None or key < best[0]:
                best = (key, rid, score, breakdown)
        if best is None:
            return LinkResult(None, None, 0.0, {}, "unmatched")
        _, rid, score, breakdown = best
        if score >= SUGGESTED:
            b = "linked"
        elif score >= REVIEW:
            b = "review"
        else:
            b = "unmatched"
        return LinkResult(self.person_of[rid], rid, score, breakdown, b)
