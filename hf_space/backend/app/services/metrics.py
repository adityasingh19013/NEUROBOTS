"""Metric engine (FR-6). Every result stores the rows that were included and excluded, with reasons."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import CleanRow, MetricContribution, MetricDefinition, MetricResult, Project, RawRow
from app.services.validate import RANGES, label

CALC_TYPES = {"count_distinct_people", "count_rows", "people_with_min_events", "mean_difference", "ratio"}


class MetricConfigError(ValueError):
    pass


@dataclass
class Contribution:
    row: CleanRow
    included: bool
    category: str | None = None
    reason: str | None = None


@dataclass
class Evaluation:
    value: float | None
    units: int
    contributions: list[Contribution] = field(default_factory=list)
    detail: dict = field(default_factory=dict)


# --------------------------------------------------------------------- formatting

def unit_kind(unit: str) -> str:
    u = (unit or "").lower()
    if u in ("%", "percent", "percentage") or "percent" in u:
        return "percent"
    if u.startswith("point"):
        return "points"
    return "count"


def format_value(value: float | None, unit: str) -> str:
    if value is None:
        return "n/a"
    kind = unit_kind(unit)
    if kind == "percent":
        return f"{value * 100:.1f}".rstrip("0").rstrip(".") + "%"
    if kind == "points":
        return f"{value:+.2f}"
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}"


# --------------------------------------------------------------------- defaults

def default_definitions() -> list[dict]:
    """Load metric config. Accepts a list, or {"metrics": [...]} as in sample_data/metric_definitions.json."""
    path = get_settings().sample_data_dir / "metric_definitions.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    if isinstance(data, dict):
        data = data.get("metrics")
    if not data or not all("calc" in m for m in data):
        from app.services.default_metrics import DEFAULT_METRICS
        return DEFAULT_METRICS
    return data


def roles_used(calc: dict, calcs_by_code: dict[str, dict], _seen: frozenset = frozenset()) -> list[str]:
    """File roles a calculation reads, following references to other metrics."""
    roles: list[str] = []

    def add(rs):
        for r in rs:
            if r and r not in roles:
                roles.append(r)

    add([calc.get("role")])
    if calc.get("type") in ("people_with_min_events", "ratio") or (calc.get("filters") or {}).get("people_in"):
        add(["beneficiary registry"])
    for ref in (calc.get("base"), calc.get("denominator"), (calc.get("filters") or {}).get("people_in")):
        if ref and ref in calcs_by_code and ref not in _seen:
            add(roles_used(calcs_by_code[ref], calcs_by_code, _seen | {ref}))
    if calc.get("numerator"):
        add(roles_used(calc["numerator"], calcs_by_code, _seen))
    order = ["beneficiary registry", "attendance", "survey", "other"]
    return sorted(roles, key=lambda r: order.index(r) if r in order else 99)


def seed_definitions(db: Session, project: Project) -> None:
    defs = default_definitions()
    calcs = {(m.get("code") or m["id"]): m["calc"] for m in defs}
    for i, m in enumerate(defs):
        calc = dict(m["calc"])
        if calc.get("filters", {}).get("program") and project.program:
            calc["filters"] = {**calc["filters"], "program": project.program}
        db.add(MetricDefinition(project_id=project.id, code=m.get("code") or m["id"], name=m["name"],
                                definition=m["definition"], unit=m.get("unit", "people"),
                                source_roles=m.get("source_roles") or roles_used(calc, calcs),
                                calc=calc, caveat=m.get("caveat"), position=i))


def validate_calc(calc: dict, known_codes: set[str]) -> None:
    t = calc.get("type")
    if t not in CALC_TYPES:
        raise MetricConfigError(f"Unknown calculation type '{t}'. Use one of: {', '.join(sorted(CALC_TYPES))}.")
    people_in = (calc.get("filters") or {}).get("people_in")
    if people_in and people_in not in known_codes:
        raise MetricConfigError(f"filters.people_in refers to unknown metric '{people_in}'.")
    if t == "people_with_min_events":
        if calc.get("base") not in known_codes:
            raise MetricConfigError("people_with_min_events needs 'base' = code of a count_rows metric.")
        if int(calc.get("min_events", 0)) < 1:
            raise MetricConfigError("min_events must be at least 1.")
    if t == "mean_difference" and not (calc.get("field_a") and calc.get("field_b")):
        raise MetricConfigError("mean_difference needs field_a and field_b.")
    if t == "ratio":
        if calc.get("denominator") not in known_codes:
            raise MetricConfigError("ratio needs 'denominator' = code of another metric.")
        validate_calc(calc.get("numerator") or {}, known_codes)


# --------------------------------------------------------------------- evaluation

class Engine:
    def __init__(self, db: Session, project: Project, defs: list[MetricDefinition]):
        self.project = project
        self.defs = {d.code: d for d in defs}
        rows = list(db.scalars(select(CleanRow).where(CleanRow.project_id == project.id)
                               .order_by(CleanRow.raw_row_id)))
        self.rows_by_role: dict[str, list[CleanRow]] = defaultdict(list)
        for r in rows:
            self.rows_by_role[r.role].append(r)
        self.row_numbers = dict(db.execute(
            select(RawRow.id, RawRow.row_number).where(RawRow.id.in_([r.raw_row_id for r in rows]))).all())
        self.cache: dict[str, Evaluation] = {}
        self.visiting: set[str] = set()

    # ---- row filters
    def exclusion(self, r: CleanRow, filters: dict) -> tuple[str, str] | None:
        if r.excluded:
            return "exact duplicate", r.exclude_reason or "exact duplicate"
        v, flags = r.values, r.flags or {}
        problems = flags.get("problems", {})
        if filters.get("period"):
            d = v.get("event_date")
            if not d:
                if problems.get("event_date"):
                    return "invalid date", "date could not be read"
                return "missing date", "date missing"
            if not (self.project.period_start <= date.fromisoformat(d) <= self.project.period_end):
                return "outside period", f"date {d} is outside the reporting period"
        if filters.get("attended"):
            a = v.get("attended")
            if a is None:
                if problems.get("attended"):
                    return "attendance not recognised", "attendance mark not recognised"
                return "attendance missing", "attendance mark missing"
            if a is False:
                return "marked absent", "marked absent"
        prog = filters.get("program")
        if prog and (v.get("program") or "").strip().lower() != prog.strip().lower():
            return "other program", f"program is '{v.get('program') or 'blank'}'"
        if r.role != "beneficiary registry" and (filters.get("linked", True)):
            if r.link_status == "review":
                return "link pending review", "link to an enrolled person is pending review"
            if r.link_status not in ("linked", "confirmed") or r.person_id is None:
                return "unmatched", "unmatched – not enrolled"
        return None

    def evaluate_code(self, code: str) -> Evaluation:
        if code in self.cache:
            return self.cache[code]
        if code in self.visiting:
            raise MetricConfigError(f"Circular metric reference at {code}")
        if code not in self.defs:
            raise MetricConfigError(f"Unknown metric '{code}'")
        self.visiting.add(code)
        ev = self.evaluate(self.defs[code].calc)
        self.visiting.discard(code)
        self.cache[code] = ev
        return ev

    def evaluate(self, calc: dict) -> Evaluation:
        t = calc.get("type")
        filters = calc.get("filters") or {}

        if t in ("count_distinct_people", "count_rows"):
            contribs, people = [], set()
            allowed = None
            if filters.get("people_in"):
                ref = self.evaluate_code(filters["people_in"])
                allowed = {c.row.person_id for c in ref.contributions if c.included}
            for r in self.rows_by_role.get(calc["role"], []):
                ex = self.exclusion(r, filters)
                if not ex and allowed is not None and r.person_id not in allowed:
                    ex = ("not in " + filters["people_in"], f"person is not counted in {filters['people_in']}")
                if ex:
                    contribs.append(Contribution(r, False, *ex))
                else:
                    contribs.append(Contribution(r, True))
                    people.add(r.person_id)
            if t == "count_rows":
                n = sum(1 for c in contribs if c.included)
                return Evaluation(n, n, contribs)
            return Evaluation(len(people), len(people), contribs)

        if t == "people_with_min_events":
            base = self.evaluate_code(calc["base"])
            n_min = int(calc.get("min_events", 2))
            counts = Counter(c.row.person_id for c in base.contributions if c.included)
            active = {p for p, k in counts.items() if k >= n_min}
            contribs = []
            for c in base.contributions:
                if not c.included:
                    contribs.append(c)
                elif c.row.person_id in active:
                    contribs.append(Contribution(c.row, True))
                else:
                    k = counts[c.row.person_id]
                    contribs.append(Contribution(c.row, False, "below minimum",
                                                 f"person has {k} qualifying record(s); minimum is {n_min}"))
            return Evaluation(len(active), len(active), contribs, {"min_events": n_min})

        if t == "mean_difference":
            fa, fb = calc["field_a"], calc["field_b"]
            lo, hi = calc.get("valid_range") or [None, None]
            valid, contribs = [], []
            for r in self.rows_by_role.get(calc["role"], []):
                ex = self.exclusion(r, filters)
                if not ex:
                    for f in (fb, fa):
                        x = r.values.get(f)
                        if x is None:
                            ex = ("invalid score", f"{label(f)} missing or unreadable")
                            break
                        rng = (lo, hi) if lo is not None else RANGES.get(f)
                        if rng and not (rng[0] <= x <= rng[1]):
                            ex = ("invalid score", f"{label(f)} = {x} is outside {rng[0]}–{rng[1]}")
                            break
                if ex:
                    contribs.append(Contribution(r, False, *ex))
                else:
                    valid.append(r)
            if calc.get("latest_per_person"):
                latest: dict[int, CleanRow] = {}
                for r in valid:
                    cur = latest.get(r.person_id)
                    k = (r.values.get("event_date") or "", self.row_numbers.get(r.raw_row_id, 0))
                    if cur is None or k >= (cur.values.get("event_date") or "",
                                            self.row_numbers.get(cur.raw_row_id, 0)):
                        latest[r.person_id] = r
                keep = {id(r) for r in latest.values()}
                for r in valid:
                    if id(r) not in keep:
                        newer = latest[r.person_id]
                        contribs.append(Contribution(r, False, "superseded",
                                                     f"superseded by a later response (row "
                                                     f"{self.row_numbers.get(newer.raw_row_id)})"))
                valid = [r for r in valid if id(r) in keep]
            for r in valid:
                contribs.append(Contribution(r, True))
            diffs = [r.values[fa] - r.values[fb] for r in valid]
            value = sum(diffs) / len(diffs) if diffs else None
            contribs.sort(key=lambda c: c.row.raw_row_id)
            return Evaluation(value, len(diffs), contribs, {"sum_of_differences": sum(diffs), "n": len(diffs)})

        if t == "ratio":
            num = self.evaluate(calc["numerator"])
            den = self.evaluate_code(calc["denominator"])
            value = (num.value / den.value) if num.value is not None and den.value else None
            return Evaluation(value, num.units, num.contributions,
                              {"numerator": num.value, "denominator": den.value,
                               "denominator_metric": calc["denominator"]})

        raise MetricConfigError(f"Unknown calculation type '{t}'")


def compute_all(db: Session, project: Project, user: str | None = None) -> list[MetricResult]:
    old = [r.id for r in db.scalars(select(MetricResult).where(MetricResult.project_id == project.id))]
    if old:
        db.execute(delete(MetricContribution).where(MetricContribution.result_id.in_(old)))
        db.execute(delete(MetricResult).where(MetricResult.id.in_(old)))
    defs = list(db.scalars(select(MetricDefinition).where(MetricDefinition.project_id == project.id)
                           .order_by(MetricDefinition.position, MetricDefinition.id)))
    engine = Engine(db, project, defs)
    results = []
    for d in defs:
        try:
            ev = engine.evaluate_code(d.code)
            detail = ev.detail
        except (MetricConfigError, KeyError, TypeError) as e:
            ev, detail = Evaluation(None, 0, []), {"error": str(e)}
        excluded = [c for c in ev.contributions if not c.included]
        res = MetricResult(project_id=project.id, metric_code=d.code, value=ev.value, included=ev.units,
                           excluded=len(excluded), excluded_reasons=dict(Counter(c.category for c in excluded)),
                           detail=detail)
        db.add(res)
        db.flush()
        db.add_all(MetricContribution(result_id=res.id, clean_row_id=c.row.id, raw_row_id=c.row.raw_row_id,
                                      person_id=c.row.person_id, included=c.included, reason=c.reason)
                   for c in ev.contributions)
        results.append(res)
    project.metrics_computed_at = datetime.now(timezone.utc)
    from app.services import audit
    audit.log(db, project.id, "compute", rule="metrics_computed", user=user, run_id=project.last_run_id,
              note="; ".join(f"{r.metric_code}={format_value(r.value, next(d.unit for d in defs if d.code == r.metric_code))}"
                             for r in results))
    db.flush()
    return results
